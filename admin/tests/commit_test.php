<?php
// One save is one commit, whatever it carries, and it never overwrites anyone: stage + save, the
// retry after a lost race, the expected-sha preconditions.
declare(strict_types=1);
require_once __DIR__ . '/harness.php';

const INDEX = 'src/content/pages/index.json';
$e = new Env();
$c = $e->as('redakteurin');
$pending = static fn () => array_map('basename', glob("$e->data/pending/*") ?: []);

test('a staged image waits in the data folder, the repository does not hear of it', function () use ($c, $e, $pending) {
    $head = $e->git->head();
    $e->clearRequests();
    $r = $c->upload(img(40, 30), 'neu.jpg', '&stage=1');
    eq($r['status'], 200, $r['body']);
    $f = $r['json']['files'][0];
    eq($pending(), [$f['name']]);
    eq($e->git->head(), $head);
    eq($e->requests('POST'), [], 'not one write to GitHub');
    eq($e->git->read("src/assets/img/{$f['path']}"), null);
    eq(fileperms("$e->data/pending/{$f['name']}") & 0077, 0);
    $images = array_column($c->get('media')['json']['images'], null, 'path');
    eq($images[$f['path']]['pending'], true);
    eq($c->get('media/file', ['path' => $f['path']])['status'], 200);
    eq($c->get('media/item', ['path' => $f['path']])['json']['image']['pending'], true);
    $e->store->delete("pending/{$f['name']}");
});

test('stage + save that references it: exactly ONE commit holding both files, pending gone', function () use ($c, $e, $pending) {
    $f = $c->upload(img(40, 30), 'neu.jpg', '&stage=1')['json']['files'][0];
    $bytes = (string) file_get_contents("$e->data/pending/{$f['name']}");
    $head = $e->git->head();
    $runs = count($e->git->runs());
    $r = savePage($c, 'index', function (array &$v) use ($f) { $v['hero']['image'] = ['value' => $f['path'], 'alt' => 'Neues Bild']; });
    eq($r['status'], 200, $r['body']);
    $commit = $e->git->commit($r['json']['job']);
    eq($commit['parents'], [$head], 'one commit');
    eq($e->git->head(), $r['json']['job']);
    eq($e->git->changed($commit['sha']), ["src/assets/img/{$f['path']}", INDEX]);
    eq($e->git->read("src/assets/img/{$f['path']}"), $bytes);
    has((string) $e->git->read(INDEX), $f['path']);
    eq($pending(), []);
    eq(count($e->git->runs()), $runs + 1, 'one build');
    eq(array_column($c->get('media')['json']['images'], null, 'path')[$f['path']]['pending'], false);
});

test('a staged image in a list item goes the same way', function () use ($c, $e, $pending) {
    $f = $c->upload(img(20, 20, 'png'), 'k.png', '&stage=1')['json']['files'][0];
    $head = $e->git->head();
    $r = savePage($c, 'index', function (array &$v) use ($f) { $v['cards']['items'][0]['photo'] = ['value' => $f['path'], 'alt' => 'Karte']; });
    eq($r['status'], 200, $r['body']);
    eq($e->git->commit($r['json']['job'])['parents'], [$head]);
    eq($e->git->changed($r['json']['job']), ["src/assets/img/{$f['path']}", INDEX]);
    eq($pending(), []);
});

test('a staged image on a new entry goes the same way', function () use ($c, $e, $pending) {
    $f = $c->upload(img(20, 20), 't.jpg', '&stage=1')['json']['files'][0];
    $head = $e->git->head();
    $r = $c->post('entry', ['type' => 'team', 'id' => '', 'values' => ['name' => 'Neu Im Team', 'role' => 'Pflege', 'photo' => ['value' => $f['path'], 'alt' => '']]]);
    eq($r['status'], 200, $r['body']);
    eq($e->git->commit($r['json']['job'])['parents'], [$head]);
    eq($e->git->changed($r['json']['job']), ['src/assets/img/' . $f['path'], 'src/content/team/neu-im-team.md']);
    eq($pending(), []);
});

test('a staged image nobody refers to stays out of the commit', function () use ($c, $e, $pending) {
    $f = $c->upload(img(20, 20), 'x.jpg', '&stage=1')['json']['files'][0];
    $r = savePage($c, 'index', function (array &$v) { $v['hero']['pill'] = 'Ohne Bild'; });
    eq($e->git->changed($r['json']['job']), [INDEX]);
    eq($pending(), [$f['name']]);
    eq($e->git->read("src/assets/img/{$f['path']}"), null);
});

test('deleting a staged image touches no repository', function () use ($c, $e, $pending) {
    $name = $pending()[0];
    $head = $e->git->head();
    eq($c->post('media/delete', ['path' => "uploads/$name"])['status'], 200);
    eq($pending(), []);
    eq($e->git->head(), $head);
});

test('a refused or failed save keeps the staged image', function () use ($c, $e, $pending) {
    $f = $c->upload(img(20, 20), 'x.jpg', '&stage=1')['json']['files'][0];
    $value = ['value' => $f['path'], 'alt' => 'x'];
    eq(savePage($c, 'index', function (array &$v) use ($value) { $v['hero']['image'] = $value; $v['seo']['title'] = ''; })['status'], 422);
    eq($pending(), [$f['name']]);
    $e->git->setControl(['failRoute' => ['POST /git/commits' => 500]]);
    eq(savePage($c, 'index', function (array &$v) use ($value) { $v['hero']['image'] = $value; })['status'], 502);
    $e->git->setControl(['failRoute' => []]);
    eq($pending(), [$f['name']]);
    eq($e->git->read("src/assets/img/{$f['path']}"), null);
    $e->store->delete("pending/{$f['name']}");
});

test('an upload from the library commits at once, with [skip ci], and starts no build', function () use ($c, $e, $pending) {
    $head = $e->git->head();
    $runs = count($e->git->runs());
    $r = $c->upload(img(20, 20), 'bib.jpg');
    eq($r['status'], 200, $r['body']);
    $f = $r['json']['files'][0];
    $commit = $e->git->commit($e->git->head());
    eq($commit['parents'], [$head]);
    eq($commit['message'], "Admin: Bild hochgeladen – {$f['path']} [skip ci]");
    eq($e->git->changed($commit['sha']), ["src/assets/img/{$f['path']}"]);
    eq(count($e->git->runs()), $runs);
    eq($pending(), []);
});

// ---------------- conflicts ----------------

test('stale hash on a page: 409, someone pushed in between', function () use ($c, $e) {
    $p = $c->get('page', ['id' => 'index'])['json'];
    $e->git->push([INDEX => str_replace('Ohne Bild', 'Direkt gepusht', (string) $e->git->read(INDEX))], 'Gepusht');
    $v = pageValues($p['page']);
    $v['hero']['h1'] = 'Überschreibt nichts';
    $head = $e->git->head();
    $r = $c->post('page', ['id' => 'index', 'hash' => $p['hash'], 'values' => $v]);
    eq($r['status'], 409);
    eq($e->git->head(), $head);
    has((string) $e->git->read(INDEX), 'Direkt gepusht');
});

test('no hash at all is a conflict too', function () use ($c) {
    $p = $c->get('page', ['id' => 'index'])['json'];
    eq($c->post('page', ['id' => 'index', 'values' => pageValues($p['page'])])['status'], 409);
});

test('stale hash on an entry: 409', function () use ($c, $e) {
    $f = 'src/content/team/max-muster.md';
    $p = $c->get('entry', ['type' => 'team', 'id' => 'max-muster'])['json'];
    $e->git->push([$f => str_replace('Verwaltung', 'Andere Rolle', (string) $e->git->read($f))], 'Gepusht');
    $head = $e->git->head();
    $v = $p['values'];
    $v['role'] = 'Veraltet';
    $r = $c->post('entry', ['type' => 'team', 'id' => 'max-muster', 'hash' => $p['hash'], 'values' => $v]);
    eq($r['status'], 409);
    eq($e->git->head(), $head);
});

test('a lost race is retried from the new head: both changes survive', function () use ($c, $e) {
    foreach ([1, 2] as $losses) {
        $e->clearRequests();
        $e->git->setControl(['raceOnPatch' => $losses]);
        $before = count($e->git->history());
        $r = savePage($c, 'index', function (array &$v) use ($losses) { $v['hero']['pill'] = "Nach $losses Rennen"; });
        eq($r['status'], 200, $r['body']);
        eq(count($e->requests('PATCH')), $losses + 1, 'ref updates');
        eq($e->git->head(), $r['json']['job']);
        eq(count($e->git->history()), $before + $losses + 1, 'their pushes and my one commit');
        $names = array_keys($e->git->files());
        eq(count(array_filter($names, static fn ($n) => strncmp($n, 'fremd-', 6) === 0)), $losses === 1 ? 1 : 3, 'their files are still there');
        has((string) $e->git->read(INDEX), "Nach $losses Rennen");
    }
});

test('giving up after three lost races: 409, nothing of ours on the branch, the staged image kept', function () use ($c, $e, $pending) {
    $f = $c->upload(img(20, 20), 'x.jpg', '&stage=1')['json']['files'][0];
    $e->clearRequests();
    $e->git->setControl(['raceOnPatch' => 3]);
    $r = savePage($c, 'index', function (array &$v) use ($f) { $v['hero']['image'] = ['value' => $f['path'], 'alt' => 'x']; });
    eq($r['status'], 409, $r['body']);
    eq($r['json']['error'], 'conflict');
    eq(count($e->requests('PATCH')), 3, 'three tries, no fourth');
    hasNot((string) $e->git->read(INDEX), $f['path']);
    eq($e->git->read("src/assets/img/{$f['path']}"), null);
    eq($pending(), [$f['name']]);
    $e->store->delete("pending/{$f['name']}");
    eq($e->git->control()['raceOnPatch'], 0);
    eq(savePage($c, 'index', function (array &$v) { $v['hero']['pill'] = 'Wieder frei'; })['status'], 200);
});

test('a race on the same file does not overwrite it: the precondition holds on the retry', function () use ($c, $e) {
    $theirs = str_replace('Wieder frei', 'Ihre Änderung', (string) $e->git->read(INDEX));
    $e->clearRequests();
    $e->git->setControl(['raceOnPatch' => 1, 'raceFiles' => [INDEX => $theirs]]);
    $r = savePage($c, 'index', function (array &$v) { $v['hero']['h1'] = 'Meine Änderung'; });
    $e->git->setControl(['raceFiles' => null]);
    eq($r['status'], 409, $r['body']);
    eq(count($e->requests('PATCH')), 1, 'no second try over their change');
    eq($e->git->read(INDEX), $theirs);
});

test('a race on a new entry: the slug someone just took is not overwritten', function () use ($c, $e) {
    $f = 'src/content/team/doppelt.md';
    $e->git->setControl(['raceOnPatch' => 1, 'raceFiles' => [$f => "---\nname: Schon da\nrole: x\n---\n"]]);
    $r = $c->post('entry', ['type' => 'team', 'id' => '', 'slug' => 'doppelt', 'values' => ['name' => 'Doppelt', 'role' => 'y']]);
    $e->git->setControl(['raceFiles' => null]);
    eq($r['status'], 409, $r['body']);
    has((string) $e->git->read($f), 'Schon da');
});

test('a race on a trashed entry: it stays, and nothing lands in the trash', function () use ($c, $e) {
    $f = 'src/content/team/doppelt.md';
    $e->git->setControl(['raceOnPatch' => 1, 'raceFiles' => [$f => "---\nname: Geändert\nrole: x\n---\n"]]);
    $r = $c->post('entry/trash', ['type' => 'team', 'id' => 'doppelt']);
    $e->git->setControl(['raceFiles' => null]);
    eq($r['status'], 409, $r['body']);
    has((string) $e->git->read($f), 'Geändert');
    eq(glob("$e->data/trash/team/*") ?: [], []);
});

// ---------------- GitHub::commit itself ----------------

putenv("ALNO_GITHUB_API=http://127.0.0.1:{$e->gh->port}");
$gh = new GitHub($e->store, TEST_TOKEN);

test('expected sha: a file that changed refuses the commit before anything is written', function () use ($e, $gh) {
    $head = $e->git->head();
    $e->clearRequests();
    try {
        $gh->commit([INDEX => 'x'], 'm', 'a', [INDEX => str_repeat('0', 40)]);
        throw new RuntimeException('committed');
    } catch (ConflictError $x) {
        eq($x->getMessage(), INDEX);
    }
    eq($e->git->head(), $head);
    eq($e->requests('POST'), [], 'not one blob');
});

test('expected null: a file that exists refuses the commit', function () use ($e, $gh) {
    $head = $e->git->head();
    try {
        $gh->commit([INDEX => 'x'], 'm', 'a', [INDEX => null]);
        throw new RuntimeException('committed');
    } catch (ConflictError $x) {}
    eq($e->git->head(), $head);
});

test('expected sha of the file itself passes; a new file with expected null too', function () use ($e, $gh) {
    $sha = $e->git->files()[INDEX];
    $text = (string) $e->git->read(INDEX);
    $commit = $gh->commit([INDEX => "$text ", 'neu.txt' => 'neu'], 'zwei Dateien', 'a', [INDEX => $sha, 'neu.txt' => null]);
    eq($e->git->changed($commit), ['neu.txt', INDEX]);
    eq($e->git->read('neu.txt'), 'neu');
});

test('deleting: expected sha holds, a file already gone refuses', function () use ($e, $gh) {
    $sha = $e->git->files()['neu.txt'];
    $commit = $gh->commit(['neu.txt' => null], 'weg', 'a', ['neu.txt' => $sha]);
    eq($e->git->changed($commit), ['neu.txt']);
    try {
        $gh->commit(['neu.txt' => null], 'weg', 'a', ['neu.txt' => $sha]);
        throw new RuntimeException('committed');
    } catch (ConflictError $x) {}
});

test('binary content arrives unchanged', function () use ($e, $gh) {
    $bytes = random_bytes(4096) . "\0\xFF\xFE";
    $gh->commit(['bin.dat' => $bytes], 'binär', 'a');
    eq($e->git->read('bin.dat'), $bytes);
    eq((new GitHub($e->store, TEST_TOKEN))->blob($e->git->files()['bin.dat']), $bytes);
});
finish();
