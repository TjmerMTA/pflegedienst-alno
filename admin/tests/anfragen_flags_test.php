<?php
// The keys the endpoint added later: `invalid`, `files_refused`, and the storage warning.
declare(strict_types=1);
require_once __DIR__ . '/harness.php';

$e = new Env();
$id = '2026-10-30-120000-aaaabbbbccccdddd';
$clean = '2026-10-30-110000-1111222233334444';
$now = date('c');
$e->store->write("anfragen/$id.json", json_encode(['id' => $id, 'received' => $now, 'form' => 'beratung', 'page' => '/kontakt/', 'fields' => ['name' => 'A', 'phone' => '1', 'email' => 'kein at', 'datenschutz' => 'ja'], 'invalid' => ['email'], 'files' => [], 'files_refused' => 2, 'status' => 'neu', 'ip_hash' => 'ff']));
$e->store->write("anfragen/$clean.json", json_encode(['id' => $clean, 'received' => $now, 'form' => 'rueckruf', 'page' => '', 'fields' => ['name' => 'B', 'phone' => '2'], 'files' => [], 'status' => 'neu', 'ip_hash' => 'ee']));
$c = $e->as('admin');

test('detail hands out invalid and files_refused', function () use ($c, $id) {
    $d = $c->get('anfragen/item', ['id' => $id])['json'];
    eq($d['invalid'], ['email']);
    eq($d['filesRefused'], 2);
    eq($d['fields']['email'], 'kein at', 'the value stays as given');
});
test('the list too, and a record from before the new keys reads as clean', function () use ($c, $id, $clean) {
    $by = array_column($c->get('anfragen')['json']['items'], null, 'id');
    eq($by[$id]['invalid'], ['email']);
    eq($by[$id]['filesRefused'], 2);
    eq($by[$clean]['invalid'], []);
    eq($by[$clean]['filesRefused'], 0);
});
test('hostile keys in a record do no harm', function () use ($c, $e, $id) {
    $rec = json_decode((string) $e->store->read("anfragen/$id.json"), true);
    $rec['invalid'] = 'email';
    $rec['files_refused'] = 'viele';
    $e->store->write("anfragen/$id.json", (string) json_encode($rec));
    $d = $c->get('anfragen/item', ['id' => $id]);
    eq($d['status'], 200, $d['body']);
    eq($d['json']['invalid'], []);
    eq($d['json']['filesRefused'], 0);
    $rec['invalid'] = ['email', ['x'], 3];
    $rec['files_refused'] = -4;
    $e->store->write("anfragen/$id.json", (string) json_encode($rec));
    $d = $c->get('anfragen/item', ['id' => $id])['json'];
    eq($d['invalid'], ['email']);
    eq($d['filesRefused'], 0);
    $rec['invalid'] = ['email'];
    $rec['files_refused'] = 2;
    $e->store->write("anfragen/$id.json", (string) json_encode($rec));
});
test('a status change keeps the new keys', function () use ($c, $e, $id) {
    eq($c->post('anfragen/status', ['id' => $id, 'status' => 'erledigt'])['status'], 200);
    $rec = json_decode((string) $e->store->read("anfragen/$id.json"), true);
    eq($rec['invalid'], ['email']);
    eq($rec['files_refused'], 2);
    eq($rec['ip_hash'], 'ff');
});
test('no warning file, no warning', function () use ($c) {
    eq($c->get('dashboard')['json']['anfragenWarning'], null);
    eq($c->get('anfragen')['json']['warning'], null);
});
test('the warning shows on the dashboard and the Anfragen screen, numbers only', function () use ($c, $e) {
    $e->store->write('anfragen-warnung.json', json_encode(['code' => 'anfragen_voll', 'since' => '2026-10-30T13:28:24+01:00', 'used_mb' => 201.3, 'limit_mb' => 200, 'message' => '<script>x</script>']));
    $w = $c->get('dashboard');
    eq(array_keys($w['json']['anfragenWarning']), ['since', 'usedMb', 'limitMb'], $w['body']);
    eq($w['json']['anfragenWarning']['usedMb'], 201.3);
    eq((float) $w['json']['anfragenWarning']['limitMb'], 200.0);
    hasNot($w['body'], '<script>');
    eq($c->get('anfragen')['json']['warning']['usedMb'], 201.3);
});
test('someone who cannot read Anfragen gets no warning', function () use ($e) {
    $w = $e->as('redakteurin')->get('dashboard');
    eq($w['status'], 200);
    eq($w['json']['anfragenWarning'], null);
});
test('the warning goes when the endpoint removes the file', function () use ($c, $e) {
    $e->store->delete('anfragen-warnung.json');
    eq($c->get('dashboard')['json']['anfragenWarning'], null);
});
test('only administrators get the cron address', function () use ($c, $e) {
    has((string) $c->get('anfragen')['json']['cronUrl'], '/wp-admin/cron.php?key=test-cron-key');
    (new Auth($e->store))->setFlag('redakteurin', 'anfragen', true);
    $r = $e->as('redakteurin')->get('anfragen');
    eq($r['status'], 200, $r['body']);
    ok(!isset($r['json']['cronUrl']), 'key given to a non-admin');
});
finish();
