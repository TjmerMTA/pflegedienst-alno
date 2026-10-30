<?php
// The admin as its own origin: nothing of it on the public site, cookies the site cannot touch,
// headers, and the per-account wait that keeps distributed guessing slow.
declare(strict_types=1);
require_once __DIR__ . '/harness.php';

$root = realpath(__DIR__ . '/../..');
$cookie = static function (array $r, string $name): string {
    foreach ($r['headers']['set-cookie'] ?? [] as $c) if (strncmp($c, "$name=", strlen($name) + 1) === 0) return $c;
    return '';
};

// ---------------- wait per account ----------------

$clock = function (?Store &$store, int &$t) {
    $store = new Store(tmpDir('alno-slow'));
    return new Auth($store, function () use (&$t) { return $t; });
};

test('the wait grows: two typos free, then 2, 4, 8 … up to five minutes', function () {
    eq(array_map([Auth::class, 'delayAfter'], [1, 2, 3, 4, 5, 6, 10, 11, 12, 500]), [0, 0, 2, 4, 8, 16, 256, 300, 300, 300]);
});
test('a guess during the wait is refused before the hash and not counted, from any network', function () use ($clock) {
    $t = 1000000;
    $a = $clock($s, $t);
    $a->addUser('anna', 'richtig-gutes-passwort');
    foreach (['10.0.0.1', '10.0.0.2', '10.0.0.3'] as $ip) eq($a->login('anna', 'x', $ip)['reason'], 'invalid');
    $r = $a->login('anna', 'richtig-gutes-passwort', '10.0.0.4');
    eq([$r['reason'], $r['retry']], ['slow', 2], 'a new network waits as well');
    $t += 1;
    eq($a->login('anna', 'y', '10.0.0.5')['retry'], 1);
    $t += 1;
    eq($a->login('anna', 'x', '10.0.0.6')['reason'], 'invalid');
    eq($a->login('anna', 'x', '10.0.0.7')['retry'], 4, 'the refused ones did not push it further');
    $t += 4;
    eq($a->login('anna', 'richtig-gutes-passwort', '10.0.0.8')['ok'], true);
});
test('distributed guessing stays slow: at most 300 a day at the cap', function () use ($clock) {
    $t = 1000000;
    $a = $clock($s, $t);
    $a->addUser('anna', 'richtig-gutes-passwort');
    $tried = 0;
    for ($i = 0; $i < 3000; $i++) {
        // A new network each time, never locked by its own count.
        $r = $a->login('anna', 'x', '10.' . ($i >> 8 & 255) . '.' . ($i & 255) . '.1');
        if ($r['reason'] === 'invalid') $tried++;
        $t += 29;
    }
    ok($tried > 200 && $tried <= 300, "guesses in a day: $tried");
});
test('after a day without failures the count starts again; success ends it at once', function () use ($clock) {
    $t = 1000000;
    $a = $clock($s, $t);
    $a->addUser('anna', 'richtig-gutes-passwort');
    for ($i = 0; $i < 3; $i++) { $a->login('anna', 'x', "10.0.1.$i"); $t += 100; }
    $t += 86401;
    eq($a->login('anna', 'x', '10.0.2.1')['reason'], 'invalid');
    eq($a->login('anna', 'x', '10.0.2.2')['reason'], 'invalid', 'second free one again');
    eq($a->login('anna', 'richtig-gutes-passwort', '10.0.2.3')['ok'], true);
    ok(!isset($s->readJson('lockout.json')['d:' . sha1('anna')]));
});
test('an unknown name waits exactly like a real one', function () use ($clock) {
    $t = 1000000;
    $a = $clock($s, $t);
    for ($i = 0; $i < 3; $i++) $a->login('niemand', 'x', "10.0.3.$i");
    eq($a->login('niemand', 'x', '10.0.3.9')['reason'], 'slow');
});
test('a known browser passes the wait, a stolen name or an old cookie does not', function () use ($clock) {
    $t = 1000000;
    $a = $clock($s, $t);
    $a->addUser('anna', 'richtig-gutes-passwort');
    $a->addUser('olga', 'richtig-gutes-passwort');
    $device = $a->rememberDevice('anna');
    for ($i = 0; $i < 3; $i++) $a->login('anna', 'x', "10.0.4.$i");
    eq($a->login('anna', 'richtig-gutes-passwort', '10.0.4.9', 'falsch')['reason'], 'slow', 'wrong token');
    eq($a->login('anna', 'richtig-gutes-passwort', '10.0.4.9', '')['reason'], 'slow', 'no token');
    for ($i = 0; $i < 3; $i++) $a->login('olga', 'x', "10.0.5.$i");
    eq($a->login('olga', 'richtig-gutes-passwort', '10.0.5.9', $device)['reason'], 'slow', "another user's token");
    eq($a->login('anna', 'richtig-gutes-passwort', '10.0.4.9', $device)['ok'], true);
    for ($i = 0; $i < 3; $i++) $a->login('anna', 'x', "10.0.6.$i");
    $t += 91 * 86400;
    for ($i = 0; $i < 3; $i++) $a->login('anna', 'x', "10.0.7.$i");
    eq($a->login('anna', 'richtig-gutes-passwort', '10.0.7.9', $device)['reason'], 'slow', 'expired token');
});
test('a new password forgets the browsers; the list stays short; only hashes are stored', function () use ($clock) {
    $t = 1000000;
    $a = $clock($s, $t);
    $a->addUser('anna', 'richtig-gutes-passwort');
    $device = $a->rememberDevice('anna');
    hasNot((string) $s->read('users.json'), $device);
    for ($i = 0; $i < 15; $i++) { $t += 1; $a->rememberDevice('anna'); }
    eq(count($a->users()['anna']['devices']), Auth::DEVICE_MAX);
    $a->setPassword('anna', 'ein-anderes-passwort');
    ok(!isset($a->users()['anna']['devices']));
});

// ---------------- over HTTP ----------------

$e = new Env();
test('the wait reaches the client with its seconds, and nothing goes to the log', function () use ($e) {
    $c = $e->client();
    for ($i = 0; $i < 3; $i++) eq($c->login('redakteurin', 'falsch')['status'], 401);
    $r = $c->login('redakteurin', $e->password);
    eq($r['status'], 429, $r['body']);
    eq($r['json']['error'], 'slow');
    ok($r['json']['retrySeconds'] >= 1 && $r['json']['retrySeconds'] <= 2, $r['body']);
    eq(substr_count($e->log(), '"event":"login-failed"'), 3);
    $e->openDelay();
    @unlink("$e->data/lockout.json");
});
test('a login sets the device cookie for 90 days', function () use ($e, $cookie) {
    $c = $e->client();
    $r = $c->login('redakteurin', $e->password);
    $ck = $cookie($r, 'alno_device');
    ok($ck !== '', 'no cookie');
    ok(stripos($ck, 'HttpOnly') !== false && stripos($ck, 'SameSite=Strict') !== false && stripos($ck, 'domain') === false, $ck);
    has($ck, 'Max-Age=7776000');
});
test('over HTTPS every cookie is __Host-, Secure, path /, and has no Domain', function () use ($e, $cookie) {
    $config = $e->store->readJson('config.json');
    $e->store->writeJson('config.json', ['hosts' => ['admin.pflegedienst-alno.de']] + $config);
    $c = $e->client();
    $c->headers = ['Host' => 'admin.pflegedienst-alno.de'];
    $s = $c->get('session');
    $r = $c->post('login', ['user' => 'redakteurin', 'password' => $e->password], ['X-Login-Nonce: ' . $s['json']['loginNonce']]);
    eq($r['status'], 200, $r['body']);
    foreach (['__Host-alno_session', '__Host-alno_device'] as $name) {
        $ck = $cookie($r, $name);
        ok($ck !== '', "$name missing: " . show($r['headers']['set-cookie'] ?? []));
        ok(stripos($ck, 'secure') !== false && stripos($ck, 'path=/;') !== false && stripos($ck, 'domain') === false, $ck);
    }
    eq($c->get('dashboard')['status'], 200, 'the session works under its new name');
    has((string) $c->get('users')['json']['error'], 'forbidden');
    $c2 = $e->as('admin');
    $e->store->writeJson('config.json', $config);
});
test('the public host is refused; the admin host is the default', function () use ($e) {
    $config = $e->store->readJson('config.json');
    $e->store->writeJson('config.json', array_diff_key($config, ['hosts' => 1]));
    $c = $e->client();
    $c->headers = ['Host' => 'pflegedienst-alno.de'];
    eq($c->get('session')['status'], 421);
    $c->headers = ['Host' => 'www.pflegedienst-alno.de'];
    eq($c->get('session')['status'], 421);
    $c->headers = ['Host' => 'admin.pflegedienst-alno.de'];
    eq($c->get('session')['status'], 401);
    $e->store->writeJson('config.json', $config);
});
test('a request from the public site or anywhere else gets nothing, GET included', function () use ($e) {
    $c = $e->as('admin');
    foreach (['same-site', 'cross-site'] as $from) {
        $c->headers = ['Sec-Fetch-Site' => $from];
        eq($c->get('session')['status'], 403, $from);
        eq($c->get('anfragen')['status'], 403, $from);
        eq($c->post('logout')['status'], 403, $from);
    }
    foreach (['same-origin', 'none'] as $from) {
        $c->headers = ['Sec-Fetch-Site' => $from];
        eq($c->get('session')['status'], 200, $from);
    }
});
test('links to the site are absolute, the login page gets its address too', function () use ($e, $root) {
    eq($e->client()->get('session')['json']['siteUrl'], 'https://pflegedienst-alno.de');
    $views = (string) file_get_contents("$root/admin/public/wp-admin/assets/js/views/layout.js") . (string) file_get_contents("$root/admin/public/wp-admin/assets/js/views/screens.js");
    hasNot($views, 'href="/"');
    has($views, 'href="${siteUrl}/"');
});
test('the cron address is the admin host', function () use ($e) {
    $config = $e->store->readJson('config.json');
    $e->store->writeJson('config.json', ['hosts' => ['admin.pflegedienst-alno.de', '127.0.0.1']] + $config);
    has((string) $e->as('admin')->get('anfragen')['json']['cronUrl'], '/wp-admin/cron.php?key=');
    $e->store->writeJson('config.json', $config);
});

// ---------------- what gets uploaded ----------------

test('the two docroots: nothing of the admin in the site, nothing of the site in the admin', function () use ($root) {
    $d = tmpDir('alno-assemble');
    mkdir("$d/dist/kontakt", 0755, true);
    file_put_contents("$d/dist/index.html", 'x');
    file_put_contents("$d/dist/CNAME", 'x');
    file_put_contents("$d/dist/.nojekyll", '');
    symlink("$root/admin", "$d/admin");
    exec('cd ' . escapeshellarg($d) . ' && bash ' . escapeshellarg("$root/scripts/assemble-upload.sh") . ' upload 2>&1', $o, $code);
    eq($code, 0, implode("\n", $o));
    foreach (['wp-admin', 'wp-login.php', 'CNAME', '.nojekyll', '.htaccess'] as $f) ok(!file_exists("$d/upload/site/$f"), "site/$f");
    ok(is_file("$d/upload/site/index.html"));
    foreach (['.htaccess', 'robots.txt', 'wp-login.php', 'wp-admin/.htaccess', 'wp-admin/api.php', 'wp-admin/cron.php', 'wp-admin/index.html', 'wp-admin/lib/.htaccess', 'wp-admin/schema/.htaccess'] as $f) ok(is_file("$d/upload/admin/$f"), "admin/$f");
    ok(!file_exists("$d/upload/admin/index.html"));
    unlink("$d/admin");
    rmTree($d);
});
test('a build without pages stops before the docroots are made', function () use ($root) {
    foreach (['no dist' => null, 'empty index.html' => ''] as $name => $index) {
        $d = tmpDir('alno-assemble-leer');
        if ($index !== null) { mkdir("$d/dist"); file_put_contents("$d/dist/index.html", $index); }
        symlink("$root/admin", "$d/admin");
        $o = [];
        exec('cd ' . escapeshellarg($d) . ' && bash ' . escapeshellarg("$root/scripts/assemble-upload.sh") . ' upload 2>&1', $o, $code);
        ok($code !== 0, $name);
        has(implode("\n", $o), 'nothing to deploy');
        ok(!is_dir("$d/upload"), 'no upload folder');
        unlink("$d/admin");
        rmTree($d);
    }
});
test('a site that holds the admin folder stops before the docroots are made', function () use ($root) {
    $d = tmpDir('alno-assemble-admin');
    mkdir("$d/dist/admin-alno", 0755, true);
    file_put_contents("$d/dist/index.html", 'x');
    symlink("$root/admin", "$d/admin");
    exec('cd ' . escapeshellarg($d) . ' && bash ' . escapeshellarg("$root/scripts/assemble-upload.sh") . ' upload 2>&1', $o, $code);
    ok($code !== 0, 'must fail');
    has(implode("\n", $o), 'admin-alno');
    unlink("$d/admin");
    rmTree($d);
});
test('the site\'s rules stay on its own hosts: the admin folder inherits this file', function () use ($root) {
    $h = (string) file_get_contents("$root/public/.htaccess");
    has($h, "<If \"%{HTTP_HOST} =~ /^(www\\.)?pflegedienst-alno\\.de\\.?(:[0-9]+)?\$/i\">\n    Header always set Content-Security-Policy");
    has($h, "RewriteCond %{HTTP_HOST} ^(www\\.)?pflegedienst-alno\\.de\\.?(:[0-9]+)?\$ [NC]\n");
    has($h, 'm#^/admin-alno(/|$)#i');
    has($h, "DirectoryIndex index.html\n");
    eq(preg_match('/^\s*Header\b/m', (string) preg_replace('/<If "%\{HTTP_HOST\} =~.*?<\/If>/s', '', $h)), 0);
});
test('the admin folder answers its own host only, and sends one CSP', function () use ($root) {
    $h = (string) file_get_contents("$root/admin/public/.htaccess");
    ok(strpos($h, '<If "%{HTTP_HOST} !~ /^(admin\.pflegedienst-alno\.de|') < strpos($h, 'RewriteEngine'), 'the refusal comes first');
    has($h, "  Require all denied\n</If>");
    has($h, "Header unset Content-Security-Policy\n  Header always set Content-Security-Policy");
    has($h, 'RewriteRule ^ https://admin.pflegedienst-alno.de%{REQUEST_URI} [R=301,L]');
});
test('the public site: plain HTTP goes to a fixed HTTPS address, and the CSP block stays', function () use ($root) {
    $h = (string) file_get_contents("$root/public/.htaccess");
    has($h, 'RewriteRule ^ https://pflegedienst-alno.de%{REQUEST_URI} [R=301,L]');
    hasNot($h, 'https://%{HTTP_HOST}');
    eq(substr_count($h, '__CSP__'), 1);
    has($h, 'Header always set Strict-Transport-Security');
});
test('the workflow deploys to two docroots; the data folder appears nowhere', function () use ($root) {
    $w = (string) file_get_contents("$root/.github/workflows/deploy.yml");
    has($w, 'scripts/deploy-sftp.sh upload/site "$SITE_ROOT" .alno-deploy-manifest "$ADMIN_DIR"');
    has($w, 'scripts/deploy-sftp.sh upload/admin "$ADMIN_ROOT" .alno-deploy-manifest-admin-alno');
    has($w, 'ADMIN_ROOT: public_html/admin-alno');
    has($w, 'ADMIN_DIR: admin-alno');
    hasNot($w, 'alno-data');
});
test('the admin\'s headers: strict CSP, HSTS, no framing, same on the page itself', function () use ($root) {
    $h = (string) file_get_contents("$root/admin/public/.htaccess");
    foreach (["default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self'", "connect-src 'self'", "form-action 'none'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'", 'Strict-Transport-Security', 'max-age=31536000; includeSubDomains', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy "same-origin"', 'Permissions-Policy', 'Cross-Origin-Opener-Policy', 'Cross-Origin-Resource-Policy', 'Cross-Origin-Embedder-Policy', 'X-Robots-Tag'] as $want) has($h, $want);
    foreach (["'unsafe-inline'", "'unsafe-eval'", 'data:', 'blob:', '*'] as $never) hasNot(preg_replace('/^\s*#.*$/m', '', $h), $never . ';');
    $i = (string) file_get_contents("$root/admin/public/wp-admin/index.html");
    has($i, "default-src 'none'; script-src 'self'");
    hasNot($i, 'unsafe');
});
finish();
