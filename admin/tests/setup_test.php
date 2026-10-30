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

test('a folder that only starts with the same name is outside', function () {
    $root = tmpDir('alno-root');
    mkdir("$root/site");
    mkdir("$root/site-data");
    mkdir("$root/site/data");
    ok(!(new Store("$root/site-data"))->isInside("$root/site"));
    ok((new Store("$root/site/data"))->isInside("$root/site"));
    ok((new Store("$root/site"))->isInside("$root/site"), 'the root itself');
    ok(!(new Store("$root/site"))->isInside(''), 'no document root, as on the command line');
    rmTree($root);
});
finish();
