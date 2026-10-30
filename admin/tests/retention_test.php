<?php
// How long submissions stay. Default 6 months, applications separately. Purged on every list and
// detail and from cron.php; the trash cannot extend it and empties itself after 30 days.
declare(strict_types=1);
require_once __DIR__ . '/harness.php';

const STORED = '6f1c0e5b9d3a4f7e8a2b1c0d9e8f7a6b';
$ago = static fn (string $what) => date('c', strtotime("-$what"));
$plus = static fn (string $received, int $months) => gmdate('c', (new DateTimeImmutable('@' . strtotime($received)))->modify("+$months months")->getTimestamp());

$e = new Env();
$admin = $e->as('admin');

test('default: 6 months for both', function () use ($e, $admin, $plus) {
    $received = date('c');
    $id = $e->anfrage(['received' => $received]);
    $r = $admin->get('anfragen')['json'];
    eq($r['retention'], ['inquiries' => 6, 'applications' => 6]);
    eq(array_column($r['items'], null, 'id')[$id]['deleteAt'], $plus($received, 6));
    eq($admin->get('anfragen/item', ['id' => $id])['json']['deleteAt'], $plus($received, 6));
    $e->store->delete("anfragen/$id.json");
});

test('applications have a retention of their own: karriere, ausbildung', function () use ($e, $admin, $plus) {
    eq($admin->post('anfragen/retention', ['inquiries' => 3, 'applications' => 12])['status'], 200);
    $received = date('c');
    $ids = [];
    foreach (['karriere', 'ausbildung', 'beratung', 'rueckruf', 'erstbegutachtung', 'rechner', 'rechnertermin'] as $form) $ids[$form] = $e->anfrage(['received' => $received, 'form' => $form]);
    $rows = array_column($admin->get('anfragen')['json']['items'], null, 'form');
    foreach ($ids as $form => $id) eq($rows[$form]['deleteAt'], $plus($received, in_array($form, ['karriere', 'ausbildung'], true) ? 12 : 3), $form);
    foreach ($ids as $id) $e->store->delete("anfragen/$id.json");
    $admin->post('anfragen/retention', ['inquiries' => 6, 'applications' => 6]);
});

test('retention is set by administrators, within limits', function () use ($e, $admin) {
    foreach ([[0, 6], [6, 0], [61, 6], [6, 61], ['x', 6], [-1, 6]] as [$i, $a]) {
        eq($admin->post('anfragen/retention', ['inquiries' => $i, 'applications' => $a])['status'], 422, show([$i, $a]));
    }
    eq($e->as('redakteurin')->post('anfragen/retention', ['inquiries' => 1, 'applications' => 1])['status'], 403);
    (new Auth($e->store))->addUser('buero', $e->password, false, 'de', true);
    eq($e->as('buero')->post('anfragen/retention', ['inquiries' => 1, 'applications' => 1])['status'], 403, 'the flag is not enough');
    eq((new Anfragen($e->store))->retention(), ['inquiries' => 6, 'applications' => 6]);
});

test('the list purges what is due, with its files; the rest stays', function () use ($e, $admin, $ago) {
    $old = $e->anfrage(['received' => $ago('7 months')], [STORED => 'x']);
    $new = $e->anfrage(['received' => $ago('5 months')]);
    $r = $admin->get('anfragen')['json'];
    eq(array_column($r['items'], 'id'), [$new]);
    ok(!is_file("$e->data/anfragen/$old.json"));
    ok(!is_file("$e->data/anfragen/files/" . STORED), 'attachment gone');
    has($e->log(), '"event":"anfragen-purge","deleted":1');
    hasNot($e->log(), $old);
    $e->store->delete("anfragen/$new.json");
});

test('the detail purges too: an expired record is not shown', function () use ($e, $admin, $ago) {
    $old = $e->anfrage(['received' => $ago('7 months')], [STORED => 'x']);
    eq($admin->get('anfragen/item', ['id' => $old])['status'], 404);
    ok(!is_file("$e->data/anfragen/$old.json"));
    ok(!is_file("$e->data/anfragen/files/" . STORED));
});

test('a retention set shorter takes effect at the next look', function () use ($e, $admin, $ago) {
    $id = $e->anfrage(['received' => $ago('2 months')]);
    $app = $e->anfrage(['received' => $ago('2 months'), 'form' => 'karriere']);
    $admin->post('anfragen/retention', ['inquiries' => 1, 'applications' => 6]);
    eq(array_column($admin->get('anfragen')['json']['items'], 'id'), [$app]);
    $admin->post('anfragen/retention', ['inquiries' => 6, 'applications' => 6]);
    $e->store->delete("anfragen/$app.json");
});

test('cron.php on the command line purges', function () use ($e, $ago) {
    $old = $e->anfrage(['received' => $ago('7 months')], [STORED => 'x']);
    $new = $e->anfrage(['received' => date('c')]);
    [$code, $out] = $e->cronCli();
    eq($code, 0);
    eq($out, "deleted: 1\n");
    ok(!is_file("$e->data/anfragen/$old.json"));
    ok(!is_file("$e->data/anfragen/files/" . STORED));
    ok(is_file("$e->data/anfragen/$new.json"));
    eq($e->cronCli()[1], "deleted: 0\n");
    $e->store->delete("anfragen/$new.json");
});

test('cron.php by URL needs the right key', function () use ($e, $ago) {
    $old = $e->anfrage(['received' => $ago('7 months')]);
    $c = $e->client();
    foreach (['', '?key=', '?key=falsch', '?key[]=test-cron-key', '?other=test-cron-key'] as $q) {
        $r = $c->raw('GET', "/wp-admin/cron.php$q");
        eq($r['status'], 403, $q);
        eq($r['body'], '', $q);
        ok(is_file("$e->data/anfragen/$old.json"), $q);
    }
    $r = $c->raw('GET', '/wp-admin/cron.php?key=test-cron-key');
    eq($r['status'], 200, $r['body']);
    eq($r['body'], "deleted: 1\n");
    clearstatcache();
    ok(!is_file("$e->data/anfragen/$old.json"));
});

test('cron.php before the setup does nothing, even with an empty key', function () {
    $x = new Env(false);
    $r = $x->client()->raw('GET', '/wp-admin/cron.php?key=');
    eq($r['status'], 403);
    $x->stop();
});

test('the trash cannot extend the retention', function () use ($e, $admin, $ago) {
    // Five months old, trashed yesterday, then a month and a half passes for the record.
    $id = $e->anfrage(['received' => $ago('5 months')], [STORED => 'x']);
    eq($admin->post('anfragen/trash', ['id' => $id])['status'], 200);
    $file = "$e->data/anfragen-papierkorb/$id.json";
    $rec = json_decode((string) file_get_contents($file), true);
    $rec['received'] = $ago('7 months');
    $e->store->write("anfragen-papierkorb/$id.json", (string) json_encode($rec));
    eq($admin->get('anfragen', ['view' => 'trash'])['json']['items'], []);
    ok(!is_file($file));
    ok(!is_file("$e->data/anfragen-papierkorb/files/" . STORED), 'attachment of a purged record gone');
});

test('the trash cannot extend it for an application either', function () use ($e, $admin, $ago) {
    $id = $e->anfrage(['received' => $ago('5 months'), 'form' => 'karriere']);
    $admin->post('anfragen/trash', ['id' => $id]);
    $rec = json_decode((string) file_get_contents("$e->data/anfragen-papierkorb/$id.json"), true);
    $rec['received'] = $ago('7 months');
    $e->store->write("anfragen-papierkorb/$id.json", (string) json_encode($rec));
    eq($e->cronCli()[1], "deleted: 1\n");
});

test('the trash is emptied after 30 days, however young the record', function () use ($e, $admin) {
    $id = $e->anfrage([], [STORED => 'x']);
    $young = $e->anfrage();
    $admin->post('anfragen/trash', ['id' => $id]);
    $admin->post('anfragen/trash', ['id' => $young]);
    touch("$e->data/anfragen-papierkorb/$id.json", time() - 31 * 86400);
    touch("$e->data/anfragen-papierkorb/$young.json", time() - 29 * 86400);
    eq(array_column($admin->get('anfragen', ['view' => 'trash'])['json']['items'], 'id'), [$young]);
    ok(!is_file("$e->data/anfragen-papierkorb/$id.json"));
    ok(!is_file("$e->data/anfragen-papierkorb/files/" . STORED));
    $admin->post('anfragen/delete', ['id' => $young]);
});

test('a record in the trash shows when it really goes: the earlier of the two dates', function () use ($e, $admin, $ago, $plus) {
    $fresh = $e->anfrage(['received' => date('c')]);
    $admin->post('anfragen/trash', ['id' => $fresh]);
    $at = filemtime("$e->data/anfragen-papierkorb/$fresh.json");
    $want = gmdate('c', $at + Anfragen::TRASH_DAYS * 86400);
    eq(array_column($admin->get('anfragen', ['view' => 'trash'])['json']['items'], null, 'id')[$fresh]['deleteAt'], $want, 'trash date comes first');
    eq($admin->get('anfragen/item', ['id' => $fresh])['json']['deleteAt'], $want, 'detail too');
    $admin->post('anfragen/delete', ['id' => $fresh]);
    $received = date('c', strtotime('-5 months -20 days'));
    $soon = $e->anfrage(['received' => $received]);
    $admin->post('anfragen/trash', ['id' => $soon]);
    eq($admin->get('anfragen/item', ['id' => $soon])['json']['deleteAt'], $plus($received, 6), 'retention date comes first');
    $admin->post('anfragen/delete', ['id' => $soon]);
});

test('restoring from the trash does not reset the date', function () use ($e, $admin, $plus) {
    $received = date('c', strtotime('-1 month'));
    $id = $e->anfrage(['received' => $received]);
    $admin->post('anfragen/trash', ['id' => $id]);
    $admin->post('anfragen/restore', ['id' => $id]);
    eq($admin->get('anfragen/item', ['id' => $id])['json']['deleteAt'], $plus($received, 6));
    $e->store->delete("anfragen/$id.json");
});

test('the date is exact: a clock passed in decides', function () use ($e) {
    $received = '2026-01-15T12:00:00+01:00';
    $e->anfrage(['id' => '2026-01-15-120000-abcdefabcdefabcd', 'received' => $received]);
    $due = (new DateTimeImmutable($received))->modify('+6 months')->getTimestamp();
    eq((new Anfragen($e->store, $due - 1))->purge(), 0);
    ok(is_file("$e->data/anfragen/2026-01-15-120000-abcdefabcdefabcd.json"));
    eq((new Anfragen($e->store, $due))->purge(), 1);
    ok(!is_file("$e->data/anfragen/2026-01-15-120000-abcdefabcdefabcd.json"));
});

test('a record with no usable date falls back to its file time', function () use ($e, $admin) {
    $id = $e->anfrage(['received' => 'gestern']);
    touch("$e->data/anfragen/$id.json", time() - 200 * 86400);
    eq($admin->get('anfragen')['json']['items'], []);
    ok(!is_file("$e->data/anfragen/$id.json"));
});
test('an attachment past its date cannot be downloaded, even with the old link', function () use ($e, $admin, $ago) {
    $old = $e->anfrage(['received' => $ago('7 months')], [STORED => 'x']);
    eq($admin->get('anfragen/file', ['id' => $old, 'stored' => STORED])['status'], 404);
    ok(!is_file("$e->data/anfragen/files/" . STORED), 'attachment gone');
});

finish();
