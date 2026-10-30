<?php
// First run: only someone holding a write token gets through, once, and only with the data folder
// outside the web root.
declare(strict_types=1);
require_once __DIR__ . '/harness.php';

$password = 'richtig-gutes-passwort';
$form = static fn (array $over = []) => $over + ['token' => TEST_TOKEN, 'user' => 'chefin', 'password' => $password];
$post = static function (Client $c, array $body): array {
    $n = $c->get('session')['json']['loginNonce'] ?? '';
    return $c->post('setup', $body, ["X-Login-Nonce: $n"]);
};
$nothing = static function (Env $e): void {
    ok(!is_file("$e->data/config.json"), 'config.json written');
    ok(!is_file("$e->data/users.json"), 'users.json written');
};

$e = new Env(false);

test('a fresh installation says so and reports the host', function () use ($e) {
    $r = $e->client()->get('session');
    eq($r['status'], 401);
    eq($r['json']['error'], 'setup');
    ok($r['json']['loginNonce']);
    $checks = $r['json']['checks'];
    foreach (['php', 'phpOk', 'curl', 'mbstring', 'fileinfo', 'imageEngine', 'webp', 'uploadMax', 'postMax', 'memory', 'dataOutside'] as $k) ok(array_key_exists($k, $checks), $k);
    eq($checks['phpOk'], true);
    eq($checks['dataOutside'], true);
    eq($checks['imageEngine'], 'gd');
});

test('every other route waits for the setup', function () use ($e) {
    $c = $e->client();
    foreach (['dashboard', 'pages', 'users', 'anfragen'] as $r) eq($c->get($r)['status'], 503, $r);
    eq($c->post('login', ['user' => 'a'])['status'], 503);
    eq($c->post('page', ['id' => 'index'])['status'], 503);
});

test('setup needs the login nonce', function () use ($e, $form, $nothing) {
    $c = $e->client();
    $c->get('session');
    eq($c->post('setup', $form())['status'], 403);
    eq($c->post('setup', $form(), ['X-Login-Nonce: falsch'])['status'], 403);
    $nothing($e);
});

test('a stranger\'s token is refused and nothing is written', function () use ($e, $form, $post, $nothing) {
    $c = $e->client();
    $r = $post($c, $form(['token' => 'gestohlen']));
    eq($r['status'], 422, $r['body']);
    eq($r['json']['error'], 'token');
    has($r['json']['message'], 'Token');
    $nothing($e);
});

test('a read-only token is refused and nothing is written', function () use ($e, $form, $post, $nothing) {
    $r = $post($e->client(), $form(['token' => 'read-token']));
    eq($r['status'], 422, $r['body']);
    eq($r['json']['error'], 'token');
    $nothing($e);
    has($e->log(), '"event":"setup-rejected"');
    hasNot($e->log(), 'read-token');
    hasNot($e->log(), 'gestohlen');
});

test('bad names and short passwords are refused before GitHub is asked', function () use ($e, $form, $post, $nothing) {
    $e->clearRequests();
    eq($post($e->client(), $form(['token' => '  ']))['json']['error'], 'token');
    eq($post($e->client(), $form(['user' => '../x']))['json']['error'], 'bad_name');
    eq($post($e->client(), $form(['password' => 'kurz']))['json']['error'], 'too_short');
    eq($e->requests(), []);
    $nothing($e);
});

test('the right token sets it up; the token stays on the server', function () use ($e, $form, $post, $password) {
    $r = $post($e->client(), $form(['user' => 'Chefin']));
    eq($r['status'], 200, $r['body']);
    hasNot($r['body'], TEST_TOKEN);
    $config = $e->store->readJson('config.json');
    eq($config['token'], TEST_TOKEN);
    ok(strlen($config['cron_key']) >= 32);
    ok(in_array('admin.pflegedienst-alno.de', $config['hosts'], true));
    ok(!in_array('pflegedienst-alno.de', $config['hosts'], true), 'the public site is another origin');
    eq(fileperms("$e->data/config.json") & 0077, 0, 'config.json is private');
    eq((new Auth($e->store))->users()['chefin']['admin'], true);
    hasNot($e->log(), TEST_TOKEN);
    $c = $e->client();
    eq($c->login('chefin', $password)['status'], 200);
    eq($c->get('session')['json']['admin'], true);
    hasNot($c->get('session')['body'], TEST_TOKEN);
});

test('a second setup is refused, whoever asks', function () use ($e, $form, $password) {
    $config = (string) file_get_contents("$e->data/config.json");
    $users = (string) file_get_contents("$e->data/users.json");
    $c = $e->client();
    $n = $c->get('session')['json']['loginNonce'];
    $r = $c->post('setup', $form(['user' => 'dieb']), ["X-Login-Nonce: $n"]);
    eq($r['status'], 401, $r['body']);
    $admin = $e->client();
    $admin->login('chefin', $password);
    eq($admin->post('setup', $form(['user' => 'dieb']))['status'], 404);
    eq((string) file_get_contents("$e->data/config.json"), $config);
    $names = static fn (string $json) => array_map(static fn ($u) => $u['hash'], (array) json_decode($json, true));
    eq($names((string) file_get_contents("$e->data/users.json")), $names($users), 'no user added or changed');
});

$p = new Env(false, 6);
test('parallel setups: exactly one wins', function () use ($p, $form) {
    $c = $p->client();
    $n = $c->get('session')['json']['loginNonce'];
    $rs = $c->burst('setup', $form(), 6, ["X-Login-Nonce: $n"]);
    $by = array_count_values(array_column($rs, 'status'));
    eq($by[200] ?? 0, 1, show($by));
    eq(count((new Auth($p->store))->users()), 1);
});

test('a damaged config.json does not reopen the setup', function () use ($password) {
    $x = new Env(true);
    file_put_contents("$x->data/config.json", '{ kaputt');
    $r = (function () use ($x, $password) {
        $c = $x->client();
        $n = $c->get('session')['json']['loginNonce'];
        return $c->post('setup', ['token' => TEST_TOKEN, 'user' => 'dieb', 'password' => $password], ["X-Login-Nonce: $n"]);
    })();
    eq($r['status'], 403, $r['body']);
    ok(!isset((new Auth($x->store))->users()['dieb']));
    $x->stop();
});

// A web root of its own, so that nothing is created in the worktree.
$exposed = static function (string $docRoot, string $dataDir) use ($post, $form): void {
    $gh = new Env(false);
    $admin = new Server(['-t', $docRoot], ['ALNO_DATA_DIR' => $dataDir, 'ALNO_GITHUB_API' => "http://127.0.0.1:{$gh->gh->port}"]);
    $c = new Client("http://127.0.0.1:$admin->port");
    $checks = $c->get('session')['json']['checks'] ?? null;
    ok(is_array($checks), 'session answers');
    eq($checks['dataOutside'], false);
    $gh->clearRequests();
    $r = $post($c, $form());
    $admin->stop();
    eq($r['status'], 422, $r['body']);
    eq($r['json']['error'], 'data_dir');
    ok($r['json']['message'] !== '');
    ok(!is_file("$dataDir/config.json"), 'config.json written');
    ok(!is_file("$dataDir/users.json"), 'users.json written');
    eq($gh->requests(), [], 'the token is not even tried');
    $gh->stop();
};

test('a data folder inside the document root is refused', function () use ($exposed) {
    $root = tmpDir('alno-root');
    symlink(WP_ROOT . '/wp-admin', "$root/wp-admin");
    $exposed($root, "$root/alno-data");
    unlink("$root/wp-admin");
    rmTree($root);
});

test('a data folder inside the folder above the code is refused, whatever the document root is', function () use ($exposed) {
    $root = tmpDir('alno-root');
    mkdir("$root/public_html");
    exec('cp -R ' . escapeshellarg(WP_ROOT . '/wp-admin') . ' ' . escapeshellarg("$root/public_html/wp-admin"));
    // The address serves another folder that links to the code; what counts is where the code is.
    mkdir("$root/anderswo");
    symlink("$root/public_html/wp-admin", "$root/anderswo/wp-admin");
    $exposed("$root/anderswo", "$root/public_html/daten");
    rmTree($root);
});

foreach (['named public_html' => 'public_html', 'under any other name, as behind a link' => 'www/users/x'] as $name => $web) {
    test("a data folder in the site's web root is refused when the admin docroot lies inside it: $name", function () use ($exposed, $web) {
        $root = tmpDir('alno-root');
        mkdir("$root/$web/admin-alno", 0755, true);
        exec('cp -R ' . escapeshellarg(WP_ROOT . '/wp-admin') . ' ' . escapeshellarg("$root/$web/admin-alno/wp-admin"));
        $exposed("$root/$web/admin-alno", "$root/$web/alno-data");
        rmTree($root);
    });
}
test('a linked public_html as the document root changes nothing', function () use ($exposed) {
    $root = tmpDir('alno-root');
    mkdir("$root/www/x/admin-alno", 0755, true);
    exec('cp -R ' . escapeshellarg(WP_ROOT . '/wp-admin') . ' ' . escapeshellarg("$root/www/x/admin-alno/wp-admin"));
    mkdir("$root/home");
    symlink("$root/www/x", "$root/home/public_html");
    $exposed("$root/home/public_html/admin-alno", "$root/home/public_html/alno-data");
    rmTree($root);
});
test('a data folder beside the site is fine', function () use ($post, $form) {
    $root = tmpDir('alno-root');
    mkdir("$root/www/x/admin-alno", 0755, true);
    exec('cp -R ' . escapeshellarg(WP_ROOT . '/wp-admin') . ' ' . escapeshellarg("$root/www/x/admin-alno/wp-admin"));
    $gh = new Env(false);
    $admin = new Server(['-t', "$root/www/x/admin-alno"], ['ALNO_DATA_DIR' => "$root/www/alno-data", 'ALNO_GITHUB_API' => "http://127.0.0.1:{$gh->gh->port}"]);
    $c = new Client("http://127.0.0.1:$admin->port");
    eq($c->get('session')['json']['checks']['dataOutside'], true);
    $admin->stop();
    $gh->stop();
    rmTree($root);
});
test('with no home to be found setup names the file to write, and no folder appears', function () use ($post, $form) {
    $root = tmpDir('alno-root');
    mkdir("$root/www/x/admin-alno", 0755, true);
    exec('cp -R ' . escapeshellarg(WP_ROOT . '/wp-admin') . ' ' . escapeshellarg("$root/www/x/admin-alno/wp-admin"));
    file_put_contents("$root/prep.php", '<?php putenv("HOME"); putenv("ALNO_DATA_DIR");');
    $gh = new Env(false);
    $admin = new Server(['-d', 'disable_functions=posix_getpwuid', '-d', "auto_prepend_file=$root/prep.php", '-t', "$root/www/x/admin-alno"], ['ALNO_GITHUB_API' => "http://127.0.0.1:{$gh->gh->port}"]);
    $c = new Client("http://127.0.0.1:$admin->port");
    $checks = $c->get('session')['json']['checks'];
    eq($checks['dataOutside'] ?? null, false);
    eq($checks['dataFile'] ?? '', realpath("$root/www") . '/.alno-data-dir', 'the screen names the file, a linked layout hides where it is');
    $r = $post($c, $form());
    $admin->stop();
    $gh->stop();
    eq($r['status'], 422, $r['body']);
    eq($r['json']['error'], 'data_dir');
    eq($r['json']['file'], $checks['dataFile']);
    eq((string) shell_exec('find ' . escapeshellarg($root) . " -name 'alno-data*'"), '');
    rmTree($root);
});

test('a folder that only starts with the same name is outside', function () {
    $root = tmpDir('alno-root');
    mkdir("$root/site");
    mkdir("$root/site-data");
    mkdir("$root/site/data");
    $roots = [realpath("$root/site")];
    ok(!alno_inside_web("$root/site-data", $roots));
    ok(alno_inside_web("$root/site/data", $roots));
    ok(alno_inside_web("$root/site", $roots), 'the root itself');
    ok(!alno_inside_web("$root/site", []), 'no document root, as on the command line');
    rmTree($root);
});

// public_html a link, no posix, no HOME: the case in which a folder used to land in the web root.
$linked = static function (string $home = '') {
    $root = tmpDir('alno-root');
    mkdir("$root/www/users/x/admin-alno", 0755, true);
    mkdir("$root/home");
    symlink("$root/www/users/x", "$root/home/public_html");
    exec('cp -R ' . escapeshellarg(WP_ROOT . '/wp-admin') . ' ' . escapeshellarg("$root/www/users/x/admin-alno/wp-admin"));
    file_put_contents("$root/prep.php", '<?php putenv("ALNO_DATA_DIR");' . ($home === '' ? ' putenv("HOME");' : ' putenv("HOME=' . str_replace('ROOT', $root, $home) . '");'));
    return $root;
};
$serve = static function (string $root, Env $gh) {
    return new Server(['-d', 'disable_functions=posix_getpwuid', '-d', "auto_prepend_file=$root/prep.php", '-t', "$root/www/users/x/admin-alno"], ['ALNO_GITHUB_API' => "http://127.0.0.1:{$gh->gh->port}"]);
};
test('link, no posix, no HOME: no folder is guessed, setup refuses and leaves nothing behind', function () use ($linked, $serve, $post, $form) {
    $root = $linked();
    $gh = new Env(false);
    $admin = $serve($root, $gh);
    $c = new Client("http://127.0.0.1:$admin->port");
    eq($c->get('session')['json']['checks']['dataOutside'], false);
    $r = $post($c, $form());
    $admin->stop();
    $gh->stop();
    eq($r['status'], 422, $r['body']);
    eq($r['json']['error'], 'data_dir');
    eq((string) shell_exec('find ' . escapeshellarg($root) . " -name 'alno-data*' -o -name '.alno-data-dir'"), '');
    rmTree($root);
});
test('setup fixes the folder beside the site, and after that HOME no longer matters', function () use ($linked, $serve, $post, $form) {
    $root = $linked('ROOT/home');
    $gh = new Env(false);
    $admin = $serve($root, $gh);
    $c = new Client("http://127.0.0.1:$admin->port");
    eq($c->get('session')['json']['checks']['dataOutside'], true);
    $r = $post($c, $form());
    eq($r['status'], 200, $r['body']);
    $admin->stop();
    eq(trim((string) file_get_contents("$root/www/users/.alno-data-dir")), "$root/home/alno-data");
    ok(is_file("$root/home/alno-data/config.json"), 'config not in the fixed folder');
    file_put_contents("$root/prep.php", '<?php putenv("ALNO_DATA_DIR"); putenv("HOME");');
    $admin = $serve($root, $gh);
    $c = new Client("http://127.0.0.1:$admin->port");
    $s = $c->get('session');
    eq($s['json']['error'] ?? '', 'login', $s['body']);
    $admin->stop();
    $gh->stop();
    rmTree($root);
});
test('a SetEnv used for setup can go, as the next deploy makes it: the path stays in the setting', function () use ($linked, $serve, $post, $form) {
    $root = $linked('');
    file_put_contents("$root/prep.php", '<?php putenv("HOME"); putenv("ALNO_DATA_DIR=' . "$root/home/daten" . '");');
    $gh = new Env(false);
    $admin = $serve($root, $gh);
    eq($post(new Client("http://127.0.0.1:$admin->port"), $form())['status'], 200);
    $admin->stop();
    eq(trim((string) file_get_contents("$root/www/users/.alno-data-dir")), "$root/home/daten");
    file_put_contents("$root/prep.php", '<?php putenv("ALNO_DATA_DIR"); putenv("HOME");');
    $admin = $serve($root, $gh);
    $s = (new Client("http://127.0.0.1:$admin->port"))->get('session');
    eq($s['json']['error'] ?? '', 'login', $s['body']);
    $admin->stop();
    $gh->stop();
    rmTree($root);
});
test('with no home to be found the file the setup screen names is the way out', function () use ($linked, $serve, $post, $form) {
    $root = $linked('');
    $gh = new Env(false);
    $admin = $serve($root, $gh);
    $c = new Client("http://127.0.0.1:$admin->port");
    $file = $c->get('session')['json']['checks']['dataFile'];
    $admin->stop();
    file_put_contents($file, "$root/home/daten\n");
    $admin = $serve($root, $gh);
    $c = new Client("http://127.0.0.1:$admin->port");
    $checks = $c->get('session')['json']['checks'];
    eq([$checks['dataOutside'], $checks['dataFile']], [true, null]);
    eq($post($c, $form())['status'], 200);
    $admin->stop();
    $gh->stop();
    ok(is_file("$root/home/daten/config.json"), 'config not in the named folder');
    rmTree($root);
});
test('a setting that leads into the web root locks the admin: it does not read what lies there', function () use ($linked, $serve, $post, $form) {
    $root = $linked('ROOT/home');
    symlink("$root/www/users/x", "$root/umweg");
    mkdir("$root/www/users/x/daten");
    file_put_contents("$root/www/users/x/daten/config.json", json_encode(['token' => 'x', 'site_url' => 'https://a.de', 'hosts' => ['127.0.0.1']]));
    file_put_contents("$root/www/users/.alno-data-dir", "$root/umweg/daten\n");
    $gh = new Env(false);
    $admin = $serve($root, $gh);
    $c = new Client("http://127.0.0.1:$admin->port");
    $s = $c->get('session');
    eq($s['json']['error'] ?? '', 'setup', $s['body']);
    eq($s['json']['checks']['dataOutside'], false);
    $r = $post($c, $form());
    $admin->stop();
    $gh->stop();
    eq($r['json']['error'], 'data_dir');
    rmTree($root);
});
finish();
