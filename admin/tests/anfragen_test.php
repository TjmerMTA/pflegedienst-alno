<?php
// Section 4 of docs/anfragen-format.md rule by rule, and who may see what. The records hold personal
// and health data: every value in them came from a stranger.
declare(strict_types=1);
require_once __DIR__ . '/harness.php';

const STORED = '6f1c0e5b9d3a4f7e8a2b1c0d9e8f7a6b';
const OTHER = 'aaaabbbbccccddddeeeeffff00001111';
const IP_HASH = 'f63982b1640f5c0f9a9becc2a39bed16';

$e = new Env();
$auth = new Auth($e->store);
$auth->addUser('buero', $e->password, false, 'de', true);
$admin = $e->as('admin');
$red = $e->as('redakteurin');
$buero = $e->as('buero');

test('values come back as they are, as strings: escaping is the client\'s', function () use ($e, $admin) {
    $evil = '<img src=x onerror=alert(1)>';
    $id = $e->anfrage(['fields' => ['name' => $evil, 'phone' => "<script>a</script>", 'message' => "\"><b>\n'x"], 'page' => '/<x>/', 'files' => [['name' => "$evil.pdf", 'stored' => STORED, 'size' => 1, 'type' => 'text/plain']]]);
    $list = $admin->get('anfragen')['json']['items'];
    $row = array_column($list, null, 'id')[$id];
    eq($row['name'], $evil);
    eq($row['phone'], '<script>a</script>');
    $d = $admin->get('anfragen/item', ['id' => $id]);
    eq($d['json']['fields']['name'], $evil);
    eq($d['json']['fields']['message'], "\"><b>\n'x");
    eq($d['json']['page'], '/<x>/');
    eq($d['json']['attachments'][0]['name'], "$evil.pdf");
    has($d['headers']['content-type'][0], 'application/json');
    eq($d['headers']['x-content-type-options'][0], 'nosniff');
    has($d['headers']['content-security-policy'][0], "default-src 'none'");
    eq($admin->post('anfragen/trash', ['id' => $id])['status'], 200);
    eq($admin->post('anfragen/delete', ['id' => $id])['status'], 200);
});

test('non-scalar fields are dropped, a broken record does not stop the list', function () use ($e, $admin) {
    $id = $e->anfrage(['fields' => ['name' => 'Ok', 'x' => ['a' => 1]], 'files' => 'kein Array']);
    $e->store->write('anfragen/2026-01-01-000000-0000000000000000.json', '{ kaputt');
    $r = $admin->get('anfragen');
    eq($r['status'], 200, $r['body']);
    ok(in_array($id, array_column($r['json']['items'], 'id'), true));
    $d = $admin->get('anfragen/item', ['id' => $id]);
    eq($d['status'], 200, $d['body']);
    eq($d['json']['fields'], ['name' => 'Ok']);
    eq($d['json']['attachments'], []);
    $e->store->delete('anfragen/2026-01-01-000000-0000000000000000.json');
    $e->store->delete("anfragen/$id.json");
});

test('ids are checked before any path is built', function () use ($e, $admin) {
    $e->store->write('anfragen/files/' . STORED, 'x');
    $good = '2026-10-30-132824-b48fc68bab33b63f';
    $bad = ['../../config', '../config', '..%2F..%2Fconfig', "$good/../../users", "../anfragen/$good", "$good\n", "$good.json", '2026-10-30-132824-B48FC68BAB33B63F', '2026-10-30-132824-b48fc68bab33b63', '/etc/passwd', '', 'users', "x\0"];
    foreach ($bad as $id) {
        $r = $admin->get('anfragen/item', ['id' => $id]);
        eq($r['status'], 404, show($id));
        eq($admin->get('anfragen/file', ['id' => $id, 'stored' => STORED])['status'], 404, show($id));
        foreach (['status', 'trash', 'restore', 'delete'] as $act) {
            eq($admin->post("anfragen/$act", ['id' => $id, 'status' => 'erledigt'])['status'], 404, "$act " . show($id));
        }
    }
    eq($admin->raw('GET', '/wp-admin/api.php?r=anfragen/item&id[]=x')['status'], 404, 'array');
    ok(is_file("$e->data/config.json"));
    ok(is_file("$e->data/users.json"));
});

test('stored names are checked too; files[].name never reaches a path', function () use ($e, $admin) {
    $id = $e->anfrage(['files' => [
        ['name' => '../../config.json', 'stored' => STORED, 'size' => 1, 'type' => 'application/pdf'],
        ['name' => 'x', 'stored' => '../../config.json', 'size' => 1, 'type' => 'application/pdf'],
    ]]);
    $e->store->write('anfragen/files/' . STORED, 'inhalt');
    foreach (['../../config.json', '../config.json', STORED . '/../x', strtoupper(STORED), substr(STORED, 0, 31), STORED . "\n", '.htaccess', ''] as $stored) {
        eq($admin->get('anfragen/file', ['id' => $id, 'stored' => $stored])['status'], 404, show($stored));
    }
    $d = $admin->get('anfragen/item', ['id' => $id])['json'];
    eq(array_column($d['attachments'], 'stored'), [STORED], 'a bad stored name is not even listed');
    $r = $admin->get('anfragen/file', ['id' => $id, 'stored' => STORED]);
    eq($r['status'], 200);
    eq($r['body'], 'inhalt');
    hasNot($r['headers']['content-disposition'][0], '/');
    $e->store->delete("anfragen/$id.json");
});

test('an attachment is served only if the record lists it', function () use ($e, $admin) {
    $mine = $e->anfrage([], [STORED => 'meine Datei']);
    $other = $e->anfrage([], [OTHER => 'fremde Datei']);
    eq($admin->get('anfragen/file', ['id' => $mine, 'stored' => STORED])['status'], 200);
    eq($admin->get('anfragen/file', ['id' => $mine, 'stored' => OTHER])['status'], 404, 'file of another record');
    $e->store->write('anfragen/files/ffffffffffffffffffffffffffffffff', 'niemandes Datei');
    eq($admin->get('anfragen/file', ['id' => $mine, 'stored' => 'ffffffffffffffffffffffffffffffff'])['status'], 404, 'file of no record');
    $e->store->delete('anfragen/files/' . OTHER);
    eq($admin->get('anfragen/file', ['id' => $other, 'stored' => OTHER])['status'], 404, 'listed, but gone');
    $e->store->delete("anfragen/$mine.json");
    $e->store->delete("anfragen/$other.json");
});

test('files are downloads: attachment, nosniff, the stored type, whatever they claim to be', function () use ($e, $admin) {
    foreach (['application/pdf' => 'application/pdf', 'text/html' => 'text/html', 'image/svg+xml' => 'image/svg+xml', 'text/html; charset=x' => 'application/octet-stream', "a\r\nX-Evil: 1" => 'application/octet-stream', '' => 'application/octet-stream'] as $type => $want) {
        $id = $e->anfrage(['files' => [['name' => 'x.html', 'stored' => STORED, 'size' => 5, 'type' => $type]]]);
        $e->store->write('anfragen/files/' . STORED, '<script>alert(1)</script>');
        $r = $admin->get('anfragen/file', ['id' => $id, 'stored' => STORED]);
        eq($r['status'], 200, $r['body']);
        ok(strncmp($r['headers']['content-disposition'][0], 'attachment;', 11) === 0, $r['headers']['content-disposition'][0]);
        eq($r['headers']['x-content-type-options'][0], 'nosniff');
        ok(strncmp($r['headers']['content-type'][0], $want, strlen($want)) === 0, show($type) . ' -> ' . $r['headers']['content-type'][0]);
        ok(!isset($r['headers']['x-evil']));
        $e->store->delete("anfragen/$id.json");
    }
});

test('a file name cannot break the header', function () use ($e, $admin) {
    $id = $e->anfrage(['files' => [['name' => "Bewerbung Müller\r\nSet-Cookie: a=b; \"x\".pdf", 'stored' => STORED, 'size' => 5, 'type' => 'application/pdf']]]);
    $r = $admin->get('anfragen/file', ['id' => $id, 'stored' => STORED]);
    eq($r['status'], 200);
    eq(count($r['headers']['content-disposition']), 1);
    ok(!isset($r['headers']['set-cookie']), show($r['headers']));
    has($r['headers']['content-disposition'][0], "filename*=UTF-8''Bewerbung%20M%C3%BCller_Set-Cookie_");
    $e->store->delete("anfragen/$id.json");
});

test('status change: atomic, stays 0600, keeps every other key', function () use ($e, $admin) {
    $id = $e->anfrage(['extra' => ['künftig' => 'vom Formular'], 'rechner' => 5]);
    $file = "$e->data/anfragen/$id.json";
    $before = json_decode((string) file_get_contents($file), true);
    $inode = fileinode($file);
    eq($admin->post('anfragen/status', ['id' => $id, 'status' => 'erledigt'])['status'], 200);
    clearstatcache();
    $after = json_decode((string) file_get_contents($file), true);
    eq($after['status'], 'erledigt');
    unset($after['status'], $before['status']);
    eq(array_keys($after), array_keys($before));
    eq($after, $before);
    eq(fileperms($file) & 0777, 0600);
    ok(fileinode($file) !== $inode, 'a new file renamed over the old one');
    eq(array_filter(scandir("$e->data/anfragen"), static fn ($f) => str_contains($f, '.tmp')), [], 'no temp file left');
    eq($admin->post('anfragen/status', ['id' => $id, 'status' => 'neu'])['status'], 200);
    eq($admin->post('anfragen/status', ['id' => $id, 'status' => 'geheim'])['status'], 404, 'only known statuses');
    eq(json_decode((string) file_get_contents($file), true)['status'], 'neu');
    $e->store->delete("anfragen/$id.json");
});

test('views, counts, newest first', function () use ($e, $admin, $red) {
    $a = $e->anfrage(['id' => '2026-10-29-100000-aaaaaaaaaaaaaaaa', 'received' => date('c')]);
    $b = $e->anfrage(['id' => '2026-10-30-100000-bbbbbbbbbbbbbbbb', 'received' => date('c')]);
    $c = $e->anfrage(['id' => '2026-10-28-100000-cccccccccccccccc', 'received' => date('c')]);
    $admin->post('anfragen/status', ['id' => $a, 'status' => 'erledigt']);
    $admin->post('anfragen/trash', ['id' => $c]);
    $all = $admin->get('anfragen')['json'];
    eq(array_column($all['items'], 'id'), [$b, $a]);
    eq($all['counts'], ['all' => 2, 'neu' => 1, 'erledigt' => 1, 'trash' => 1]);
    eq(array_column($admin->get('anfragen', ['view' => 'neu'])['json']['items'], 'id'), [$b]);
    eq(array_column($admin->get('anfragen', ['view' => 'erledigt'])['json']['items'], 'id'), [$a]);
    eq(array_column($admin->get('anfragen', ['view' => 'trash'])['json']['items'], 'id'), [$c]);
    eq($admin->get('anfragen', ['view' => 'unsinn'])['json']['view'], 'all');
    eq($admin->get('session')['json']['newAnfragen'], 1);
    eq($red->get('session')['json']['newAnfragen'], 0);
    foreach ([$a, $b] as $id) $e->store->delete("anfragen/$id.json");
    $e->store->delete("anfragen-papierkorb/$c.json");
});

test('trash and restore move the files along; a trashed record reads as trashed', function () use ($e, $admin) {
    $id = $e->anfrage([], [STORED => 'datei']);
    eq($admin->post('anfragen/trash', ['id' => $id])['status'], 200);
    ok(!is_file("$e->data/anfragen/$id.json"));
    ok(!is_file("$e->data/anfragen/files/" . STORED));
    ok(is_file("$e->data/anfragen-papierkorb/files/" . STORED));
    eq(fileperms("$e->data/anfragen-papierkorb/$id.json") & 0077, 0);
    $d = $admin->get('anfragen/item', ['id' => $id])['json'];
    eq($d['trashed'], true);
    eq($admin->get('anfragen/file', ['id' => $id, 'stored' => STORED])['body'], 'datei', 'a download still works from the trash');
    eq($admin->post('anfragen/status', ['id' => $id, 'status' => 'erledigt'])['status'], 404, 'status of the live ones only');
    eq($admin->post('anfragen/restore', ['id' => $id])['status'], 200);
    ok(is_file("$e->data/anfragen/$id.json"));
    ok(is_file("$e->data/anfragen/files/" . STORED));
    eq($admin->get('anfragen/item', ['id' => $id])['json']['trashed'], false);
    eq($admin->post('anfragen/restore', ['id' => $id])['status'], 404);
    $admin->post('anfragen/trash', ['id' => $id]);
    $admin->post('anfragen/delete', ['id' => $id]);
});

test('deleting a submission deletes its files; only from the trash', function () use ($e, $admin) {
    $id = $e->anfrage([], [STORED => 'x', OTHER => 'y']);
    $keep = $e->anfrage([], ['ffffffffffffffffffffffffffffffff' => 'z']);
    eq($admin->post('anfragen/delete', ['id' => $id])['status'], 404, 'a live record goes through the trash');
    ok(is_file("$e->data/anfragen/$id.json"));
    $admin->post('anfragen/trash', ['id' => $id]);
    $admin->post('anfragen/trash', ['id' => $keep]);
    eq($admin->post('anfragen/delete', ['id' => $id])['status'], 200);
    ok(!is_file("$e->data/anfragen-papierkorb/$id.json"));
    ok(!is_file("$e->data/anfragen-papierkorb/files/" . STORED));
    ok(!is_file("$e->data/anfragen-papierkorb/files/" . OTHER));
    ok(is_file("$e->data/anfragen-papierkorb/files/ffffffffffffffffffffffffffffffff"), 'other records keep theirs');
    eq($admin->get('anfragen/item', ['id' => $id])['status'], 404);
    $admin->post('anfragen/delete', ['id' => $keep]);
});

test('file names starting with a dot are ignored: writes in progress', function () use ($e, $admin) {
    $real = '2026-10-30-120000-1111111111111111';
    $e->anfrage(['id' => $real, 'received' => date('c')]);
    $rec = (string) file_get_contents("$e->data/anfragen/$real.json");
    $dot = "$e->data/anfragen/.$real.json";
    $tmp = "$e->data/anfragen/.tmp-2026-10-30-120000-2222222222222222.json";
    file_put_contents($dot, $rec);
    file_put_contents($tmp, '{ halb geschrieb');
    file_put_contents("$e->data/anfragen/kein-id-name.json", $rec);
    $r = $admin->get('anfragen')['json'];
    eq(array_column($r['items'], 'id'), [$real]);
    eq($r['counts']['all'], 1);
    eq($admin->get('anfragen/item', ['id' => ".$real"])['status'], 404);
    foreach ([$dot, $tmp, "$e->data/anfragen/kein-id-name.json", "$e->data/anfragen/$real.json"] as $f) unlink($f);
});

test('ip_hash is in no response', function () use ($e, $admin) {
    $id = $e->anfrage([], [STORED => 'x']);
    $bodies = [$admin->get('anfragen'), $admin->get('anfragen', ['view' => 'neu']), $admin->get('anfragen/item', ['id' => $id]), $admin->get('session'), $admin->post('anfragen/status', ['id' => $id, 'status' => 'erledigt']), $admin->post('anfragen/trash', ['id' => $id]), $admin->get('anfragen', ['view' => 'trash']), $admin->get('anfragen/item', ['id' => $id])];
    foreach ($bodies as $r) {
        hasNot($r['body'], IP_HASH);
        hasNot($r['body'], 'ip_hash');
    }
    hasNot($e->log(), IP_HASH);
    $admin->post('anfragen/delete', ['id' => $id]);
});

test('a read and a download are logged by id, with no content', function () use ($e, $admin) {
    $id = $e->anfrage(['fields' => ['name' => 'Bertha Beispiel', 'phone' => '0171 999', 'message' => 'Pflegegrad 3'], 'files' => [['name' => 'Arztbrief-Bertha.pdf', 'stored' => STORED, 'size' => 1, 'type' => 'application/pdf']]]);
    $e->store->write('anfragen/files/' . STORED, 'x');
    $admin->get('anfragen');
    $admin->get('anfragen/item', ['id' => $id]);
    $admin->get('anfragen/file', ['id' => $id, 'stored' => STORED]);
    $log = $e->log();
    has($log, '"event":"anfrage-read","user":"admin","id":"' . $id . '"');
    has($log, '"event":"anfrage-file","user":"admin","id":"' . $id . '"');
    foreach (['Bertha', '0171 999', 'Pflegegrad', 'Arztbrief'] as $private) hasNot($log, $private);
    $e->store->delete("anfragen/$id.json");
});

// ---------------- who may ----------------

$routes = static function (Client $c, string $id): array {
    return [
        'list' => $c->get('anfragen'), 'item' => $c->get('anfragen/item', ['id' => $id]), 'file' => $c->get('anfragen/file', ['id' => $id, 'stored' => STORED]),
        'status' => $c->post('anfragen/status', ['id' => $id, 'status' => 'erledigt']), 'trash' => $c->post('anfragen/trash', ['id' => $id]),
        'restore' => $c->post('anfragen/restore', ['id' => $id]), 'trash again' => $c->post('anfragen/trash', ['id' => $id]), 'delete' => $c->post('anfragen/delete', ['id' => $id]),
    ];
};

test('a user without the flag gets 403 on every Anfragen route, and nothing changes', function () use ($e, $red, $routes) {
    $id = $e->anfrage([], [STORED => 'x']);
    $before = (string) file_get_contents("$e->data/anfragen/$id.json");
    foreach ($routes($red, $id) as $what => $r) {
        eq($r['status'], 403, $what);
        eq($r['json']['error'], 'forbidden', $what);
        hasNot($r['body'], 'Ben Beispiel', $what);
    }
    eq((string) file_get_contents("$e->data/anfragen/$id.json"), $before);
    eq($red->get('session')['json']['anfragen'], false);
    $e->store->delete("anfragen/$id.json");
});

test('nobody logged in gets 401', function () use ($e, $routes) {
    $id = $e->anfrage();
    $c = $e->client();
    foreach ($routes($c, $id) as $what => $r) eq($r['status'], 401, $what);
    $e->store->delete("anfragen/$id.json");
});

test('an admin sees them without the flag', function () use ($e, $admin) {
    eq($e->store->readJson('users.json')['admin']['anfragen'], false);
    eq($admin->get('session')['json']['anfragen'], true);
    eq($admin->get('anfragen')['status'], 200);
});

test('the flag grants all of it, the same request later', function () use ($e, $buero, $routes) {
    $id = $e->anfrage([], [STORED => 'x']);
    eq($buero->get('session')['json']['anfragen'], true);
    eq($buero->get('session')['json']['admin'], false);
    foreach ($routes($buero, $id) as $what => $r) eq($r['status'], 200, "$what {$r['body']}");
    eq($buero->get('users')['status'], 403, 'the flag is not admin');
});

test('giving and taking the flag works at once, without a new login', function () use ($e, $admin, $red) {
    eq($red->get('anfragen')['status'], 403);
    eq($admin->post('users/update', ['name' => 'redakteurin', 'anfragen' => true])['status'], 200);
    eq($red->get('anfragen')['status'], 200);
    eq(array_column($admin->get('users')['json']['users'], null, 'name')['redakteurin']['anfragen'], true);
    eq($admin->post('users/update', ['name' => 'redakteurin', 'anfragen' => false])['status'], 200);
    eq($red->get('anfragen')['status'], 403);
});

test('a flag set when the user is created', function () use ($e, $admin) {
    eq($admin->post('users/add', ['name' => 'neue', 'password' => $e->password, 'anfragen' => true])['status'], 200);
    eq($e->as('neue')->get('anfragen')['status'], 200);
});

test('the cron address is for administrators only', function () use ($admin, $buero) {
    has((string) $admin->get('anfragen')['json']['cronUrl'], '/wp-admin/cron.php?key=test-cron-key');
    ok(!array_key_exists('cronUrl', (array) $buero->get('anfragen')['json']));
});
finish();
