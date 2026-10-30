<?php
// Revisions are the history of the repository; a restore is a new commit and passes the same rules
// as a save, because an old revision is not to be trusted.
declare(strict_types=1);
require_once __DIR__ . '/harness.php';

const INDEX = 'src/content/pages/index.json';
const GLOBAL_ = 'src/content/pages/_global.json';
$e = new Env();
$c = $e->as('redakteurin');
$value = static fn (string $file, int $g, int $f) => json_decode((string) $e->git->read($file), true)['groups'][$g]['fields'][$f]['value'];

test('list, compare, restore makes a new commit', function () use ($c, $e, $value) {
    savePage($c, 'index', function (array &$v) { $v['hero']['h1'] = 'Revision A'; });
    $prev = savePage($c, 'index', function (array &$v) { $v['hero']['pill'] = 'Bleibt in A'; })['json']['job'];
    savePage($c, 'index', function (array &$v) { $v['hero']['h1'] = 'Revision B'; });

    $list = $c->get('revisions')['json'];
    $row = array_column($list['files'], null, 'file')[INDEX];
    eq($row['title'], 'Startseite');
    eq($row['author'], 'redakteurin');
    ok($row['count'] >= 3);

    $r = $c->get('revisions/file', ['file' => INDEX, 'rev' => $prev]);
    eq($r['status'], 200, $r['body']);
    eq($r['json']['selected']['hash'], $prev);
    eq($r['json']['same'], false);
    eq($r['json']['edit'], ['type' => 'page', 'id' => 'index']);
    $lines = array_column($r['json']['diff'], 'text');
    ok(in_array('Erster Bildschirm › Überschrift (H1): Revision B', $lines, true), 'readable, by field: ' . show($lines));
    hasNot($r['body'], '\\"fields\\"', 'no JSON in the comparison');
    ok(count($r['json']['revs']) >= 3);

    $head = count($e->git->history());
    $x = $c->post('revisions/restore', ['file' => INDEX, 'rev' => $prev]);
    eq($x['status'], 200, $x['body']);
    eq($value(INDEX, 1, 1), 'Revision A');
    eq(count($e->git->history()), $head + 1, 'history only grows');
    $commit = $e->git->commit($x['json']['job']);
    ok(preg_match('/^Admin: Revision [0-9a-f]{7} wiederhergestellt/', $commit['message']) === 1, $commit['message']);
    eq($commit['author']['name'], 'redakteurin');
    eq($x['json']['edit'], ['type' => 'page', 'id' => 'index']);
    has($e->log(), '"event":"restore"');
});

test('a short revision id works, the first revision is compared by default', function () use ($c, $e) {
    $sha = $c->get('revisions/file', ['file' => INDEX])['json']['selected']['hash'];
    $short = substr($sha, 0, 7);
    eq($c->get('revisions/file', ['file' => INDEX, 'rev' => $short])['json']['selected']['hash'], $sha);
    eq($c->post('revisions/restore', ['file' => INDEX, 'rev' => $short])['status'], 200);
});

test('a revision that does not exist', function () use ($c) {
    eq($c->post('revisions/restore', ['file' => INDEX, 'rev' => str_repeat('a', 40)])['status'], 404);
    eq($c->get('revisions/file', ['file' => INDEX, 'rev' => str_repeat('a', 40)])['json']['selected'], null);
});

test('only the formatting of a page file differing is not a change', function () use ($c, $e) {
    $f = 'src/content/pages/ueber-uns.json';
    $e->git->push([$f => json_encode(json_decode((string) $e->git->read($f), true), JSON_UNESCAPED_UNICODE)], 'Nur Formatierung');
    $prev = $c->get('revisions/file', ['file' => $f])['json']['revs'][1]['hash'];
    $r = $c->get('revisions/file', ['file' => $f, 'rev' => $prev]);
    eq($r['json']['selected']['hash'], $prev);
    eq($r['json']['same'], true, $r['body']);
});

test('a Markdown file can be restored, byte for byte', function () use ($c, $e) {
    $f = 'src/content/team/erika-beispiel.md';
    $old = $e->git->read($f);
    $prev = $e->git->head();
    $r = saveEntry($c, 'team', 'erika-beispiel', function (array &$v) { $v['role'] = 'Neue Rolle'; });
    eq($r['status'], 200, $r['body']);
    eq($c->post('revisions/restore', ['file' => $f, 'rev' => $prev])['status'], 200);
    eq($e->git->read($f), $old);
    eq($c->get('revisions/file', ['file' => $f])['json']['edit'], ['type' => 'team', 'id' => 'erika-beispiel']);
});

test('a deleted entry can come back from its history', function () use ($c, $e) {
    $f = 'src/content/team/max-muster.md';
    $old = $e->git->read($f);
    $prev = $e->git->head();
    $c->post('entry/trash', ['type' => 'team', 'id' => 'max-muster']);
    eq($c->post('revisions/restore', ['file' => $f, 'rev' => $prev])['status'], 200);
    eq($e->git->read($f), $old);
});

// ---------------- the same rules as a save ----------------

$refused = function (string $file, array $change, string $msg) use ($c, $e): void {
    $good = (string) $e->git->read($file);
    $bad = $e->git->push($change, 'Unsicher von außen');
    $e->git->push([$file => $good], 'Wieder sauber');
    $head = $e->git->head();
    $r = $c->post('revisions/restore', ['file' => $file, 'rev' => $bad]);
    eq($r['status'], 422, $r['body']);
    eq($r['json']['error'], 'validation');
    has(implode("\n", array_column($r['json']['errors'], 'msg')), $msg);
    eq($e->git->head(), $head, 'nothing committed');
    eq($e->git->read($file), $good);
};

test('a page revision with forbidden HTML in a richtext is refused', function () use ($e, $refused) {
    $page = json_decode((string) $e->git->read(INDEX), true);
    $page['groups'][1]['fields'][3]['value'] = '<p onclick="x()">a</p><script>alert(1)</script>';
    $refused(INDEX, [INDEX => Site::serializePage($page)], Rules::MSG_BAD_HTML);
});

test('a page revision with a tag in a plain field is refused', function () use ($e, $refused) {
    $page = json_decode((string) $e->git->read(INDEX), true);
    $page['groups'][1]['fields'][0]['value'] = 'x</script a';
    $refused(INDEX, [INDEX => Site::serializePage($page)], Rules::MSG_NO_HTML);
});

test('a revision cannot bring < into the contact data, not even in a list', function () use ($e, $refused) {
    $page = json_decode((string) $e->git->read(GLOBAL_), true);
    $page['groups'][0]['fields'][4]['value'][0]['time'] = '9 > 5';
    $refused(GLOBAL_, [GLOBAL_ => Site::serializePage($page)], Rules::MSG_NO_ANGLE);
});

test('a page revision with an image that is gone is refused', function () use ($e, $refused) {
    $page = json_decode((string) $e->git->read(INDEX), true);
    $page['groups'][1]['fields'][4]['value'] = 'geloescht.jpg';
    $refused(INDEX, [INDEX => Site::serializePage($page)], 'nicht gefunden');
});

test('a page revision with an image and no alt is refused', function () use ($e, $refused) {
    $page = json_decode((string) $e->git->read(INDEX), true);
    $page['groups'][1]['fields'][4]['value'] = 'team.jpg';
    $page['groups'][1]['fields'][4]['alt'] = '';
    $refused(INDEX, [INDEX => Site::serializePage($page)], Rules::MSG_ALT_REQUIRED);
});

test('a Markdown revision with a tag in its frontmatter is refused', function () use ($e, $refused) {
    $f = 'src/content/blog/erster-beitrag.md';
    $refused($f, [$f => str_replace('title: "Erster Beitrag: ein Test"', 'title: "x</script a"', (string) $e->git->read($f))], Rules::MSG_NO_HTML);
});

test('a Markdown revision with an unsafe link is refused', function () use ($e, $refused) {
    $f = 'src/content/blog/erster-beitrag.md';
    $refused($f, [$f => (string) $e->git->read($f) . "\n[x](javascript:alert(1))\n"], Rules::MSG_UNSAFE_LINK);
});

test('a Markdown revision with raw HTML comes back escaped', function () use ($c, $e) {
    $f = 'src/content/blog/erster-beitrag.md';
    $good = (string) $e->git->read($f);
    $bad = $e->git->push([$f => "$good\n<script>alert(1)</script>\n"], 'Unsicher');
    $e->git->push([$f => $good], 'Sauber');
    eq($c->post('revisions/restore', ['file' => $f, 'rev' => $bad])['status'], 200);
    $text = (string) $e->git->read($f);
    hasNot($text, '<script');
    has($text, '&lt;script>');
    $e->git->push([$f => $good], 'Sauber');
});

test('a revision the admin cannot read is refused', function () use ($c, $e) {
    $f = 'src/content/blog/erster-beitrag.md';
    $good = (string) $e->git->read($f);
    $bad = $e->git->push([$f => "---\ntitle: |\n  block\n---\n"], 'YAML');
    $e->git->push([$f => $good], 'Sauber');
    eq($c->post('revisions/restore', ['file' => $f, 'rev' => $bad])['status'], 422);
    $badJson = $e->git->push([INDEX => '{ kaputt'], 'JSON');
    $e->git->push([INDEX => (string) $e->git->read(INDEX, $e->git->commit($badJson)['parents'][0])], 'Sauber');
    eq($c->post('revisions/restore', ['file' => INDEX, 'rev' => $badJson])['status'], 422);
});

test('a page restore pours the old values into the current structure', function () use ($c, $e, $value) {
    $f = 'src/content/pages/ueber-uns.json';
    $old = json_decode((string) $e->git->read($f), true);
    // The old version has a field that no longer exists.
    $old['groups'][0]['fields'][] = ['id' => 'weg', 'label' => 'Weg', 'type' => 'text', 'value' => 'alter Wert'];
    $old['groups'][0]['fields'][0]['value'] = 'Alter Titel';
    $rev = $e->git->push([$f => Site::serializePage($old)], 'Alte Fassung');
    // The site moved on: new label, new field.
    $now = json_decode((string) $e->git->read($f), true);
    $now['groups'][0]['fields'] = array_values(array_filter($now['groups'][0]['fields'], static fn ($x) => $x['id'] !== 'weg'));
    $now['groups'][0]['fields'][0]['label'] = 'Neue Beschriftung';
    $now['groups'][0]['fields'][0]['value'] = 'Neuer Titel';
    $now['groups'][0]['fields'][] = ['id' => 'neu', 'label' => 'Neu', 'type' => 'text', 'value' => 'bleibt'];
    $e->git->push([$f => Site::serializePage($now)], 'Struktur geändert');
    $r = $c->post('revisions/restore', ['file' => $f, 'rev' => $rev]);
    eq($r['status'], 200, $r['body']);
    $page = json_decode((string) $e->git->read($f), true);
    $fields = array_column($page['groups'][0]['fields'], null, 'id');
    eq($fields['title']['value'], 'Alter Titel');
    eq($fields['title']['label'], 'Neue Beschriftung');
    eq($fields['neu']['value'], 'bleibt');
    ok(!isset($fields['weg']));
});

test('restoring needs a current page: one that is gone stays gone', function () use ($c, $e) {
    $f = 'src/content/pages/ueber-uns.json';
    $rev = $e->git->head();
    $e->git->push([$f => null], 'Seite gelöscht');
    eq($c->post('revisions/restore', ['file' => $f, 'rev' => $rev])['status'], 404);
    eq($c->get('revisions/file', ['file' => $f, 'rev' => $rev])['json']['edit'], null, 'nothing to open');
});

test('a restore that lost its race does not overwrite', function () use ($c, $e) {
    $rev = $e->git->history()[3];
    $theirs = (string) $e->git->read(INDEX) . ' ';
    $e->git->setControl(['raceOnPatch' => 1, 'raceFiles' => [INDEX => $theirs]]);
    $r = $c->post('revisions/restore', ['file' => INDEX, 'rev' => $rev]);
    $e->git->setControl(['raceFiles' => null, 'raceOnPatch' => 0]);
    eq($r['status'], 409, $r['body']);
    eq($e->git->read(INDEX), $theirs);
});
finish();
