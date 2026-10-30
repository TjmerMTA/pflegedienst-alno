<?php
// The trash of blog and team: the entry leaves the repository first, a copy waits in the data folder.
declare(strict_types=1);
require_once __DIR__ . '/harness.php';

$e = new Env();
$c = $e->as('redakteurin');
$values = ['title' => 'Größe & Mut', 'description' => 'D', 'date' => '2026-10-01'];
$file = 'src/content/blog/groesse-mut.md';
$trashList = static fn (string $type = 'post') => $c->get('entries', ['type' => $type, 'status' => 'trash'])['json']['trash'];

test('trash: the entry leaves the repository in one commit, a copy goes to the data folder', function () use ($c, $e, $values, $file, $trashList) {
    $id = $c->post('entry', ['type' => 'post', 'id' => '', 'values' => $values, 'body' => "## Hallo\n\nText\n"])['json']['id'];
    eq($id, 'groesse-mut');
    $text = (string) $e->git->read($file);
    $runs = count($e->git->runs());
    $r = $c->post('entry/trash', ['type' => 'post', 'id' => $id]);
    eq($r['status'], 200, $r['body']);
    eq($e->git->read($file), null);
    eq($e->git->changed($r['json']['job']), [$file]);
    has($e->git->commit($r['json']['job'])['message'], 'Admin: in den Papierkorb – blog/groesse-mut.md');
    eq(count($e->git->runs()), $runs + 1, 'the page leaves the site with a build');
    $list = $trashList();
    eq(count($list), 1);
    eq($list[0]['slug'], 'groesse-mut');
    eq($list[0]['title'], 'Größe & Mut');
    eq($list[0]['by'], 'redakteurin');
    eq((string) file_get_contents("$e->data/trash/blog/{$list[0]['id']}.md"), $text);
    eq(fileperms("$e->data/trash/blog/{$list[0]['id']}.md") & 0077, 0);
    ok(!in_array('trash', array_map('strtolower', array_keys($e->git->files())), true));
    eq($c->get('entry', ['type' => 'post', 'id' => 'groesse-mut'])['status'], 404);
    eq($c->get('entries', ['type' => 'post'])['json']['counts']['trash'], 1);
});

test('restore: the same bytes come back, the trash is empty', function () use ($c, $e, $file, $trashList) {
    $id = $trashList()[0]['id'];
    $text = (string) file_get_contents("$e->data/trash/blog/$id.md");
    $r = $c->post('entry/untrash', ['type' => 'post', 'trashId' => $id]);
    eq($r['status'], 200, $r['body']);
    eq($r['json']['id'], 'groesse-mut');
    eq($e->git->read($file), $text);
    eq($trashList(), []);
    eq(glob("$e->data/trash/blog/*") ?: [], []);
    has($e->git->commit($r['json']['job'])['message'], 'aus dem Papierkorb wiederhergestellt');
});

test('restore is refused when the slug is taken', function () use ($c, $e, $values, $file, $trashList) {
    $c->post('entry/trash', ['type' => 'post', 'id' => 'groesse-mut']);
    $id = $trashList()[0]['id'];
    eq($c->post('entry', ['type' => 'post', 'id' => '', 'slug' => 'groesse-mut', 'values' => ['title' => 'Ein anderer'] + $values, 'body' => 'neu'])['status'], 200);
    $text = $e->git->read($file);
    $head = $e->git->head();
    $r = $c->post('entry/untrash', ['type' => 'post', 'trashId' => $id]);
    eq($r['status'], 409, $r['body']);
    eq($r['json']['error'], 'exists');
    eq($r['json']['message'], Rules::MSG_SLUG_TAKEN);
    eq($e->git->head(), $head);
    eq($e->git->read($file), $text);
    eq(count($trashList()), 1, 'the copy stays');
});

test('delete for good: the copy is gone, the repository was not touched', function () use ($c, $e, $trashList) {
    $id = $trashList()[0]['id'];
    $head = $e->git->head();
    eq($c->post('entry/delete', ['type' => 'post', 'trashId' => $id])['status'], 200);
    eq($trashList(), []);
    eq(glob("$e->data/trash/blog/*") ?: [], []);
    eq($e->git->head(), $head);
    eq($c->post('entry/delete', ['type' => 'post', 'trashId' => $id])['status'], 404);
});

test('team works the same way, and a hidden body comes back with the file', function () use ($c, $e, $trashList) {
    $f = 'src/content/team/max-muster.md';
    $text = "---\nname: Max Muster\nrole: Verwaltung\norder: 2\n---\n\nText, den die Verwaltung nicht zeigt.\n";
    $e->git->push([$f => $text], 'Mit Text');
    eq($c->post('entry/trash', ['type' => 'team', 'id' => 'max-muster'])['status'], 200);
    $list = $trashList('team');
    eq($list[0]['title'], 'Max Muster');
    eq($c->post('entry/untrash', ['type' => 'team', 'trashId' => $list[0]['id']])['status'], 200);
    eq($e->git->read($f), $text);
});

test('a file the admin cannot read can still go to the trash', function () use ($c, $e, $trashList) {
    $f = 'src/content/team/kaputt.md';
    $e->git->push([$f => "---\nname: |\n  block\n---\n"], 'Kaputt');
    eq($c->post('entry/trash', ['type' => 'team', 'id' => 'kaputt'])['status'], 200);
    $list = $trashList('team');
    eq($list[0]['title'], 'kaputt');
    eq($c->post('entry/delete', ['type' => 'team', 'trashId' => $list[0]['id']])['status'], 200);
});

test('the commit comes first: if it fails nothing lands in the trash', function () use ($c, $e, $trashList) {
    $e->git->setControl(['failRoute' => ['POST /git/trees' => 500]]);
    eq($c->post('entry/trash', ['type' => 'team', 'id' => 'max-muster'])['status'], 502);
    $e->git->setControl(['failRoute' => []]);
    ok($e->git->read('src/content/team/max-muster.md') !== null);
    eq($trashList('team'), []);
});

test('an entry that is gone cannot be trashed', function () use ($c) {
    eq($c->post('entry/trash', ['type' => 'team', 'id' => 'gibtsnicht'])['status'], 404);
});

test('Leistungen cannot be created or deleted', function () use ($c, $e) {
    $head = $e->git->head();
    eq($c->get('entry/new', ['type' => 'leistung'])['status'], 404);
    $r = $c->post('entry', ['type' => 'leistung', 'id' => '', 'values' => ['title' => 'x']]);
    eq($r['status'], 403, $r['body']);
    eq($c->post('entry/trash', ['type' => 'leistung', 'id' => 'grundpflege'])['status'], 403);
    eq($c->post('entry/untrash', ['type' => 'leistung', 'trashId' => '1-grundpflege'])['status'], 403);
    eq($c->post('entry/delete', ['type' => 'leistung', 'trashId' => '1-grundpflege'])['status'], 403);
    eq($e->git->head(), $head);
    ok($e->git->read('src/content/leistungen/grundpflege.md') !== null);
    eq($c->get('entries', ['type' => 'leistung', 'status' => 'trash'])['json']['trash'], []);
});
finish();
