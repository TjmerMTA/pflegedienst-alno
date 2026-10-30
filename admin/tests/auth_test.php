<?php
// Port of auth.test.mjs plus what the Node suite never had: parallel guesses, the login nonce, the
// Origin and Host checks route by route, cookie flags, request limits.
declare(strict_types=1);
require_once __DIR__ . '/harness.php';

$e = new Env();
const ROUTES = [
    'logout', 'page', 'entry', 'entry/trash', 'entry/untrash', 'entry/delete', 'media/upload', 'media/meta', 'media/delete', 'revisions/restore', 'profile/lang',
    'profile/password', 'users/add', 'users/update', 'users/delete', 'anfragen/status', 'anfragen/trash', 'anfragen/restore', 'anfragen/delete', 'anfragen/retention',
];
$cookieOf = static function (array $r, string $name): string {
    foreach ($r['headers']['set-cookie'] ?? [] as $c) if (strncmp($c, "$name=", strlen($name) + 1) === 0) $found = $c;
    return $found ?? '';
};

// ---------------- passwords, users ----------------

test('passwords are stored as salted hashes, users.json is private', function () use ($e) {
    $a = Auth::hashPassword('geheim-geheim');
    $b = Auth::hashPassword('geheim-geheim');
    ok($a !== $b);
    ok(password_verify('geheim-geheim', $a));
    ok(!password_verify('falsch', $a));
    hasNot((string) file_get_contents("$e->data/users.json"), $e->password);
    eq(fileperms("$e->data/users.json") & 0077, 0, 'users.json is private');
});

test('short passwords and odd names are refused', function () use ($e) {
    $auth = new Auth($e->store);
    eq($auth->addUser('kurz', '123'), 'too_short');
    eq($auth->addUser('../evil', $e->password), 'bad_name');
    eq($auth->addUser('lang', str_repeat('a', 73)), 'too_long');
    ok(!isset($auth->users()['lang']));
});

// ---------------- what needs a login ----------------

test('every route needs a login', function () use ($e) {
    $c = $e->client();
    foreach (['dashboard', 'pages', 'page', 'entries', 'entry', 'entry/new', 'media', 'media/item', 'media/file', 'revisions', 'revisions/file', 'status', 'users', 'anfragen', 'anfragen/item', 'anfragen/file'] as $r) {
        $x = $c->get($r);
        eq($x['status'], 401, "GET $r");
        eq($x['json']['error'], 'login', "GET $r");
    }
    foreach (ROUTES as $r) eq($c->post($r)['status'], 401, "POST $r");
});

// ---------------- session cookie ----------------

test('login sets a HttpOnly SameSite=Strict cookie on /wp-admin/; no Secure on plain local http', function () use ($e, $cookieOf) {
    $c = $e->client();
    $r = $c->login('redakteurin', $e->password);
    eq($r['status'], 200, $r['body']);
    $ck = $cookieOf($r, 'alno_session');
    ok($ck !== '', 'cookie set');
    ok(stripos($ck, 'path=/wp-admin/') !== false, $ck);
    ok(stripos($ck, 'HttpOnly') !== false, $ck);
    ok(stripos($ck, 'SameSite=Strict') !== false, $ck);
    ok(stripos($ck, 'Secure') === false, $ck);
    eq($c->get('dashboard')['status'], 200);
});

test('on a real host the cookies are Secure', function () use ($e, $cookieOf) {
    $config = $e->store->readJson('config.json');
    $e->store->writeJson('config.json', ['hosts' => ['admin.example']] + $config);
    $c = $e->client();
    $c->headers = ['Host' => 'admin.example'];
    $s = $c->get('session');
    ok(stripos($cookieOf($s, 'alno_login'), 'Secure') !== false, 'login cookie');
    $r = $c->post('login', ['user' => 'redakteurin', 'password' => $e->password], ['X-Login-Nonce: ' . $s['json']['loginNonce']]);
    eq($r['status'], 200, $r['body']);
    $ck = $cookieOf($r, 'alno_session');
    ok(stripos($ck, 'Secure') !== false, $ck);
    ok(stripos($ck, 'HttpOnly') !== false, $ck);
    ok(stripos($ck, 'SameSite=Strict') !== false, $ck);
    $e->store->writeJson('config.json', $config);
});

test('a session id the server did not make is not adopted', function () use ($e) {
    $c = $e->client();
    $c->cookies['alno_session'] = 'fixiert0fixiert0fixiert0fixiert0';
    $r = $c->login('redakteurin', $e->password);
    eq($r['status'], 200, $r['body']);
    ok($c->cookies['alno_session'] !== 'fixiert0fixiert0fixiert0fixiert0');
});

test('strange session cookies count as not logged in, and leave nothing behind', function () use ($e) {
    $before = count(glob("$e->data/sessions/sess_*") ?: []);
    foreach (['../../config', 'a', str_repeat('x', 500), 'unbekannt0unbekannt0unbekannt000', "a;b"] as $bad) {
        $c = $e->client();
        $c->cookies['alno_session'] = $bad;
        eq($c->get('dashboard')['status'], 401, $bad);
    }
    eq(count(glob("$e->data/sessions/sess_*") ?: []), $before, 'no session file per stranger');
});

test('session expires when idle', function () use ($e) {
    $c = $e->as('redakteurin');
    $file = "$e->data/sessions/sess_{$c->cookies['alno_session']}";
    $raw = (string) file_get_contents($file);
    // Seen a while ago: the visit counts.
    file_put_contents($file, preg_replace('/seen\|i:\d+/', 'seen|i:' . (time() - 120), $raw));
    eq($c->get('dashboard')['status'], 200);
    ok(preg_match('/seen\|i:(\d+)/', (string) file_get_contents($file), $m) === 1 && (int) $m[1] > time() - 60, 'seen moved on');
    file_put_contents($file, preg_replace('/seen\|i:\d+/', 'seen|i:' . (time() - Auth::SESSION_IDLE - 1), (string) file_get_contents($file)));
    eq($c->get('dashboard')['status'], 401);
});

test('logout needs the nonce and ends the session', function () use ($e) {
    $c = $e->as('redakteurin');
    $cookie = $c->cookies['alno_session'];
    $n = $c->nonce;
    $c->nonce = null;
    eq($c->post('logout')['status'], 403);
    eq($c->get('dashboard')['status'], 200);
    $c->nonce = $n;
    eq($c->post('logout')['status'], 200);
    eq($c->get('dashboard')['status'], 401);
    ok(!isset($c->cookies['alno_session']), 'cookie cleared');
    ok(!is_file("$e->data/sessions/sess_$cookie"), 'session file gone');
    $c->cookies['alno_session'] = $cookie;
    eq($c->get('dashboard')['status'], 401, 'the old cookie is dead');
    has($e->log(), '"event":"logout"');
});

test('a new password ends the other sessions; the one that changed it goes on', function () use ($e) {
    (new Auth($e->store))->addUser('pia', $e->password);
    $mine = $e->as('pia');
    $other = $e->as('pia');
    eq($other->get('dashboard')['status'], 200);
    $wrong = $mine->post('profile/password', ['current' => 'falsch', 'password' => 'neues-passwort-1']);
    eq($wrong['status'], 422);
    eq($wrong['json']['error'], 'wrong_password');
    eq($mine->post('profile/password', ['current' => $e->password, 'password' => 'kurz'])['json']['error'], 'too_short');
    eq($mine->post('profile/password', ['current' => $e->password, 'password' => 'neues-passwort-1'])['status'], 200);
    eq($other->get('dashboard')['status'], 401, 'other session ended');
    eq($mine->get('dashboard')['status'], 200, 'stays logged in');
    eq($e->client()->login('pia', $e->password)['status'], 401, 'old password');
    eq($e->client()->login('pia', 'neues-passwort-1')['status'], 200, 'new password');
    hasNot($e->log(), 'neues-passwort-1');
});

test('an admin setting a new password ends that user\'s sessions; deleting a user too', function () use ($e) {
    $auth = new Auth($e->store);
    $auth->addUser('gert', $e->password);
    $auth->addUser('hanna', $e->password);
    $admin = $e->as('admin');
    $g = $e->as('gert');
    $h = $e->as('hanna');
    eq($admin->post('users/update', ['name' => 'gert', 'password' => 'anderes-passwort'])['status'], 200);
    eq($g->get('dashboard')['status'], 401);
    eq($admin->post('users/delete', ['name' => 'hanna'])['status'], 200);
    eq($h->get('dashboard')['status'], 401);
    eq($admin->post('users/delete', ['name' => 'admin'])['status'], 409, 'not yourself');
    eq($admin->post('users/delete', ['name' => 'niemand'])['status'], 404);
});

test('only admins manage users', function () use ($e) {
    $c = $e->as('redakteurin');
    eq($c->get('users')['status'], 403);
    eq($c->post('users/add', ['name' => 'neu', 'password' => $e->password])['status'], 403);
    eq($c->post('users/update', ['name' => 'admin', 'password' => $e->password])['status'], 403);
    eq($c->post('users/delete', ['name' => 'admin'])['status'], 403);
    $a = $e->as('admin');
    eq($a->post('users/add', ['name' => 'neu', 'password' => 'kurz'])['json']['error'], 'too_short');
    eq($a->post('users/add', ['name' => '../neu', 'password' => $e->password])['json']['error'], 'bad_name');
    eq($a->post('users/add', ['name' => 'admin', 'password' => $e->password])['json']['error'], 'exists');
    eq($a->post('users/add', ['name' => 'Neu', 'password' => $e->password, 'lang' => 'ru'])['status'], 200);
    $list = array_column($a->get('users')['json']['users'], null, 'name');
    eq($list['neu']['lang'], 'ru');
    eq($list['neu']['admin'], false);
    hasNot($a->get('users')['body'], '$argon2', 'no hashes');
});

test('language is per user', function () use ($e) {
    (new Auth($e->store))->addUser('olga', $e->password);
    $o = $e->as('olga');
    $a = $e->as('admin');
    eq($o->get('session')['json']['lang'], 'de');
    eq($o->post('profile/lang', ['lang' => 'ru'])['status'], 200);
    eq($o->get('session')['json']['lang'], 'ru');
    eq($a->get('session')['json']['lang'], 'de');
    eq($o->post('profile/lang', ['lang' => 'xx'])['status'], 400);
});

// ---------------- login: nonce, lockout ----------------

test('login needs the double-submit nonce', function () use ($e) {
    $body = ['user' => 'redakteurin', 'password' => $e->password];
    $c = $e->client();
    $nonce = $c->get('session')['json']['loginNonce'];
    eq($c->post('login', $body)['status'], 403, 'no header');
    eq($c->post('login', $body, ['X-Login-Nonce: falsch'])['status'], 403, 'wrong header');
    $other = $e->client();
    eq($other->post('login', $body, ["X-Login-Nonce: $nonce"])['status'], 403, 'header without the cookie');
    eq($other->post('login', $body, ['X-Login-Nonce: '])['status'], 403, 'both empty');
    ok(!isset($other->cookies['alno_session']));
    eq($c->post('login', $body, ["X-Login-Nonce: $nonce"])['status'], 200);
});

test('the login nonce is cleared after use', function () use ($e) {
    $c = $e->client();
    $c->login('redakteurin', $e->password);
    ok(!isset($c->cookies['alno_login']));
});

test('lockout: five wrong passwords lock the account, even for the right password', function () use ($e) {
    (new Auth($e->store))->addUser('opfer', $e->password);
    $c = $e->client();
    for ($i = 0; $i < 4; $i++) eq($c->login('opfer', 'falsch')['status'], 401);
    $r = $c->login('opfer', 'falsch');
    eq($r['status'], 429);
    $r = $c->login('opfer', $e->password);
    eq($r['status'], 429);
    eq($r['json']['error'], 'locked');
    eq($r['json']['retryMinutes'], 15);
    ok(!isset($c->cookies['alno_session']));
    has($e->log(), '"reason":"locked"');
    hasNot($e->log(), 'falsch');
});

test('lockout ends after the lock time; success resets the counter', function () use ($e) {
    $store = new Store(tmpDir('alno-lock'));
    $t = 1000000;
    $auth = new Auth($store, function () use (&$t) { return $t; });
    $auth->addUser('anna', $e->password);
    for ($i = 0; $i < 5; $i++) $auth->login('anna', 'x', '1.1.1.1');
    eq($auth->login('anna', $e->password, '1.1.1.1')['reason'], 'locked');
    $t += 16 * 60;
    eq($auth->login('anna', $e->password, '1.1.1.1')['ok'], true);
    for ($i = 0; $i < 4; $i++) $auth->login('anna', 'x', '1.1.1.1');
    eq($auth->login('anna', $e->password, '1.1.1.1')['ok'], true);
    for ($i = 0; $i < 4; $i++) $auth->login('anna', 'x', '1.1.1.1');
    eq($auth->login('anna', $e->password, '1.1.1.1')['ok'], true, 'counter starts over after success');
    rmTree($store->dir);
});

test('one address cannot try many accounts', function () use ($e) {
    $store = new Store(tmpDir('alno-ip'));
    $auth = new Auth($store);
    $auth->addUser('bert', $e->password);
    for ($i = 0; $i < Auth::IP_MAX; $i++) $auth->login("a$i", 'x', '2.2.2.2');
    eq($auth->login('bert', $e->password, '2.2.2.2')['reason'], 'locked');
    eq($auth->login('bert', $e->password, '3.3.3.3')['ok'], true);
    rmTree($store->dir);
});

test('unknown users and wrong passwords answer alike', function () use ($e) {
    (new Auth($e->store))->addUser('echt', $e->password);
    $a = $e->client()->login('echt', 'falsch');
    $b = $e->client()->login('gibtsnicht', 'falsch');
    eq($a['status'], 401);
    eq($a['status'], $b['status']);
    eq($a['body'], $b['body']);
});

test('unknown users take as long as known ones', function () use ($e) {
    $store = new Store(tmpDir('alno-time'));
    $auth = new Auth($store);
    $auth->addUser('zeit', $e->password);
    $measure = function (string $user) use ($auth, $store): float {
        $times = [];
        for ($i = 0; $i < 5; $i++) {
            $store->delete('lockout.json');
            $t = microtime(true);
            $auth->login($user, 'falsch', '9.9.9.9');
            $times[] = microtime(true) - $t;
        }
        sort($times);
        return $times[2];
    };
    $known = $measure('zeit');
    $unknown = $measure('gibtsnicht');
    ok($unknown < $known * 1.5, sprintf('known %.0f ms, unknown %.0f ms', $known * 1000, $unknown * 1000));
    rmTree($store->dir);
});

test('login with junk in the fields is a wrong login, not a crash', function () use ($e) {
    (new Auth($e->store))->addUser('junk', $e->password);
    $c = $e->client();
    $n = $c->get('session')['json']['loginNonce'];
    foreach ([['user' => ['a'], 'password' => ['b']], ['user' => 5, 'password' => null], ['user' => ['x' => 1]], []] as $body) {
        $r = $c->raw('POST', '/wp-admin/api.php?r=login', json_encode((object) $body), ['Content-Type: application/json', "X-Login-Nonce: $n"]);
        eq($r['status'], 401, $r['body']);
    }
});

$p = new Env(true, 8);
test('40 parallel wrong logins cannot get more than MAX_FAILS guesses past the lock', function () use ($p) {
    $c = $p->client();
    $n = $c->get('session')['json']['loginNonce'];
    $rs = $c->burst('login', ['user' => 'redakteurin', 'password' => 'falsch-falsch'], 40, ["X-Login-Nonce: $n"]);
    $by = array_count_values(array_column($rs, 'status'));
    eq(count($rs), 40);
    eq(array_sum(array_intersect_key($by, [401 => 1, 429 => 1])), 40, show($by));
    ok(($by[401] ?? 0) <= Auth::MAX_FAILS, show($by));
    $t = $p->store->readJson('lockout.json');
    eq($t['u:' . sha1('redakteurin')]['count'], Auth::MAX_FAILS, 'attempts that reached the hash');
    eq($p->client()->login('redakteurin', $p->password)['status'], 429, 'the right password is locked out too');
});

// ---------------- CSRF, Origin, Host ----------------

$head = static fn () => $e->git->head();

test('CSRF: every POST route refuses a request without the token or with a wrong one', function () use ($e) {
    $c = $e->as('redakteurin');
    $n = $c->nonce;
    $head = $e->git->head();
    $before = (string) file_get_contents("$e->data/users.json");
    foreach (ROUTES as $route) {
        $c->nonce = null;
        $r = $c->post($route, ['id' => 'x']);
        eq($r['status'], 403, "$route no nonce");
        eq($r['json']['message'], 'csrf', $route);
        $c->nonce = 'falsch';
        eq($c->post($route, ['id' => 'x'])['status'], 403, "$route wrong nonce");
    }
    $c->nonce = $n;
    eq($c->upload('x', 'a.jpg', '', 'falsch')['status'], 403, 'upload');
    eq($e->git->head(), $head, 'nothing committed');
    eq((string) file_get_contents("$e->data/users.json"), $before, 'nothing written');
    has($e->log(), '"event":"csrf-reject"');
});

test('CSRF: another user\'s token does not work', function () use ($e) {
    $a = $e->as('redakteurin');
    $b = $e->as('admin');
    $a->nonce = $b->nonce;
    eq($a->post('profile/lang', ['lang' => 'ru'])['status'], 403);
});

test('cross-site Origin is refused on every POST route, before anything happens', function () use ($e) {
    $c = $e->as('admin');
    $head = $e->git->head();
    foreach (ROUTES as $route) {
        $r = $c->post($route, [], ['Origin: https://evil.example']);
        eq($r['status'], 403, $route);
        eq($r['json']['message'], 'origin', $route);
    }
    eq($e->git->head(), $head);
    eq($c->get('dashboard')['status'], 200, 'still logged in');
});

test('Origin: null, a foreign Referer, another port are refused; same origin and none pass', function () use ($e) {
    $c = $e->as('redakteurin');
    $own = $c->base;
    $body = ['lang' => 'de'];
    eq($c->post('profile/lang', $body, ['Origin: null'])['status'], 403, 'null');
    eq($c->post('profile/lang', $body, ['Referer: https://evil.example/x'])['status'], 403, 'Referer');
    eq($c->post('profile/lang', $body, ['Origin: http://127.0.0.1:1'])['status'], 403, 'port');
    eq($c->post('profile/lang', $body, ['Origin: x'])['status'], 403, 'no host at all');
    eq($c->post('profile/lang', $body, ["Origin: $own"])['status'], 200, 'same');
    eq($c->post('profile/lang', $body, ["Referer: $own/wp-admin/"])['status'], 200, 'same Referer');
    eq($c->post('profile/lang', $body)['status'], 200, 'none: the nonce alone');
    $evil = $e->client();
    $n = $evil->get('session')['json']['loginNonce'];
    eq($evil->post('login', ['user' => 'redakteurin', 'password' => $e->password], ["X-Login-Nonce: $n", 'Origin: https://evil.example'])['status'], 403, 'login too');
});

test('a foreign Host header is refused (DNS rebinding)', function () use ($e) {
    foreach (['evil.example', '127.0.0.1.evil.example', 'localhost.evil.example', 'localhost:80@evil.example'] as $host) {
        $c = $e->client();
        $c->headers = ['Host' => $host];
        $r = $c->get('session');
        eq($r['status'], 421, $host);
        eq($c->post('login')['status'], 421, $host);
        ok(!isset($r['json']['loginNonce']));
    }
});

// ---------------- request limits ----------------

test('wrong Content-Type is refused', function () use ($e) {
    $c = $e->as('redakteurin');
    $h = ['X-WP-Nonce: ' . $c->nonce];
    foreach (['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonx'] as $type) {
        $r = $c->raw('POST', '/wp-admin/api.php?r=profile/lang', '{"lang":"ru"}', array_merge($h, ["Content-Type: $type"]));
        eq($r['status'], 415, $type);
    }
    eq($c->raw('POST', '/wp-admin/api.php?r=profile/lang', '{"lang":"de"}', array_merge($h, ['Content-Type: application/json; charset=utf-8']))['status'], 200);
    $l = $e->client();
    $n = $l->get('session')['json']['loginNonce'];
    eq($l->raw('POST', '/wp-admin/api.php?r=login', '{"user":"redakteurin","password":"x"}', ['Content-Type: text/plain', "X-Login-Nonce: $n"])['status'], 415, 'login');
});

test('a body that is not one JSON object is refused', function () use ($e) {
    $c = $e->as('redakteurin');
    $h = ['X-WP-Nonce: ' . $c->nonce, 'Content-Type: application/json'];
    foreach (['nicht json', '[1,2]', '5', 'null', '"x"', str_repeat('[', 40) . str_repeat(']', 40)] as $body) {
        eq($c->raw('POST', '/wp-admin/api.php?r=profile/lang', $body, $h)['status'], 400, mb_substr($body, 0, 10));
    }
});

test('a body over 1 MB is refused before anything is parsed', function () use ($e) {
    $c = $e->as('redakteurin');
    $head = $e->git->head();
    $r = $c->post('page', ['id' => 'index', 'pad' => str_repeat('a', Rules::FORM_MAX_BYTES + 1)]);
    eq($r['status'], 413);
    eq($r['json']['message'], 'Anfrage zu groß');
    eq($e->git->head(), $head);
    eq($c->get('dashboard')['status'], 200, 'the server keeps working');
});

test('login accepts only a small body', function () use ($e) {
    $c = $e->client();
    $n = $c->get('session')['json']['loginNonce'];
    eq($c->post('login', ['pad' => str_repeat('a', 70 * 1024)], ["X-Login-Nonce: $n"])['status'], 413);
});

test('security headers are set', function () use ($e) {
    foreach ([$e->client()->get('session'), $e->as('redakteurin')->get('pages')] as $r) {
        eq($r['headers']['content-security-policy'][0], "default-src 'none'; frame-ancestors 'none'");
        eq($r['headers']['x-frame-options'][0], 'DENY');
        eq($r['headers']['x-content-type-options'][0], 'nosniff');
        eq($r['headers']['cache-control'][0], 'no-store');
        has($r['headers']['content-type'][0], 'application/json');
    }
});

test('unknown routes and methods', function () use ($e) {
    $c = $e->as('redakteurin');
    eq($c->get('gibtsnicht')['status'], 404);
    eq($c->post('gibtsnicht')['status'], 404);
    eq($c->raw('PUT', '/wp-admin/api.php?r=pages')['status'], 405);
    eq($c->raw('DELETE', '/wp-admin/api.php?r=pages')['status'], 405);
});
finish();
