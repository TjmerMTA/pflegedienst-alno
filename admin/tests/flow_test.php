<?php
// Port of flow.test.mjs: the whole way from a save to the repository, over HTTP. In the same order as
// the original, because the first save turns the hand-formatted fixture into the file format.
declare(strict_types=1);
require_once __DIR__ . '/harness.php';

const INDEX = 'src/content/pages/index.json';
$e = new Env();
$c = $e->as('admin');
$page = static fn (string $file = INDEX) => json_decode((string) $e->git->read($file), true);
$heroH1 = static fn () => $page()['groups'][1]['fields'][1]['value'];
$runs = static fn () => count($e->git->runs());

test('save: one commit, author the user, committer the bot, the new value in the file', function () use ($c, $e, $heroH1, $runs) {
    $head = $e->git->head();
    $before = $runs();
    $r = savePage($c, 'index', function (array &$v) { $v['hero']['h1'] = 'Neue Überschrift'; });
    eq($r['status'], 200, $r['body']);
    eq($heroH1(), 'Neue Überschrift');
    $commit = $e->git->commit($r['json']['job']);
    eq($commit['parents'], [$head]);
    eq($commit['message'], 'Admin: Startseite aktualisiert');
    eq($commit['author'], ['name' => 'admin', 'email' => 'admin@users.pflegedienst-alno.de', 'date' => $commit['author']['date']]);
    eq($commit['committer']['name'], 'alno-admin-bot');
    eq($e->git->changed($commit['sha']), [INDEX]);
    eq($runs(), $before + 1, 'a build is started');
    has($e->log(), '"event":"save"');
});

test('saving unchanged does nothing', function () use ($c, $e, $runs) {
    $head = $e->git->head();
    $before = $runs();
    $r = savePage($c, 'index', function (array &$v) {});
    eq($r['status'], 200);
    eq($r['json'], ['ok' => true, 'unchanged' => true]);
    eq($e->git->head(), $head);
    eq($runs(), $before);
});

test('invalid input: nothing written, nothing committed, nothing built; the answer keeps what was typed', function () use ($c, $e, $runs) {
    $head = $e->git->head();
    $text = $e->git->read(INDEX);
    $before = $runs();
    $long = str_repeat('x', 71);
    $r = savePage($c, 'index', function (array &$v) use ($long) { $v['seo']['title'] = $long; });
    eq($r['status'], 422);
    eq($r['json']['error'], 'validation');
    eq($r['json']['errors'][0]['msg'], 'höchstens 70 Zeichen (jetzt 71)');
    eq($r['json']['page']['groups'][0]['fields'][0]['value'], $long);
    eq($e->git->read(INDEX), $text);
    eq($e->git->head(), $head);
    eq($runs(), $before);
});

test('several saves in a row are each a commit of their own, the last value stays', function () use ($c, $e, $page) {
    $head = count($e->git->history());
    foreach (['Eins', 'Zwei', 'Drei', 'Vier'] as $v) {
        eq(savePage($c, 'index', function (array &$x) use ($v) { $x['hero']['pill'] = $v; })['status'], 200);
    }
    eq(count($e->git->history()), $head + 4);
    eq($page()['groups'][1]['fields'][0]['value'], 'Vier');
});

test('someone else changed the file: nothing is overwritten silently', function () use ($c, $e, $page, $heroH1) {
    $stale = $c->get('page', ['id' => 'index'])['json'];
    eq(savePage($c, 'index', function (array &$v) { $v['hero']['pill'] = 'Von Kollegin'; })['status'], 200);
    $values = pageValues($stale['page']);
    $values['hero']['h1'] = 'Veraltet';
    $r = $c->post('page', ['id' => 'index', 'hash' => $stale['hash'], 'values' => $values]);
    eq($r['status'], 409);
    eq($r['json']['error'], 'conflict');
    ok($r['json']['hash'] !== $stale['hash'], 'the new hash comes back');
    eq($r['json']['page']['groups'][1]['fields'][1]['value'], 'Veraltet', 'typed text is still in the answer');
    eq($page()['groups'][1]['fields'][0]['value'], 'Von Kollegin');
    ok($heroH1() !== 'Veraltet');
});

test('values with a changed structure are refused', function () use ($c) {
    $r = savePage($c, 'index', function (array &$v) { $v['hero']['neu'] = 'x'; });
    eq($r['status'], 422);
    eq($r['json']['errors'][0]['msg'], 'unbekanntes Feld');
    eq($r['json']['errors'][0]['path'], 'hero.neu');
});

test('list items: reorder, add, remove', function () use ($c, $page) {
    $r = savePage($c, 'index', function (array &$v) {
        $t = $v['hero']['trust'];
        $v['hero']['trust'] = [$t[1], $t[0], ['text' => 'Dritter']];
    });
    eq($r['status'], 200, $r['body']);
    eq(array_column($page()['groups'][1]['fields'][5]['value'], 'text'), ['Telefon {{hours}}', 'Alle Kassen', 'Dritter']);
    $r = savePage($c, 'index', function (array &$v) { array_pop($v['hero']['trust']); });
    eq($r['status'], 200, $r['body']);
    eq(count($page()['groups'][1]['fields'][5]['value']), 2);
});

test('image and alt change', function () use ($c, $page) {
    $r = savePage($c, 'index', function (array &$v) { $v['hero']['image'] = ['value' => 'team.jpg', 'alt' => 'Neuer Alternativtext']; });
    eq($r['status'], 200, $r['body']);
    $f = $page()['groups'][1]['fields'][4];
    eq($f['value'], 'team.jpg');
    eq($f['alt'], 'Neuer Alternativtext');
});

test('image and alt per list item', function () use ($c, $page) {
    $r = savePage($c, 'index', function (array &$v) { $v['cards']['items'][0]['photo'] = ['value' => 'hero/start.jpg', 'alt' => 'Anderes Bild']; });
    eq($r['status'], 200, $r['body']);
    eq($page()['groups'][2]['fields'][0]['value'][0]['photo'], ['value' => 'hero/start.jpg', 'alt' => 'Anderes Bild']);
    $used = $c->get('media/item', ['path' => 'hero/start.jpg'])['json']['usedOn'];
    ok(in_array('Karten › Karte 1', array_column($used, 'where'), true), show($used));
    ok(in_array('Anderes Bild', array_column($used, 'alt'), true));
});

test('removing an image saves value "" and alt "", even if the alt was still sent', function () use ($c, $page) {
    $r = savePage($c, 'index', function (array &$v) {
        ok($v['hero']['image']['alt'] !== '', 'the old alt is still sent');
        $v['hero']['image']['value'] = '';
    });
    eq($r['status'], 200, $r['body']);
    $f = $page()['groups'][1]['fields'][4];
    eq($f['value'], '');
    eq($f['alt'], '');
    eq(savePage($c, 'index', function (array &$v) { $v['hero']['image'] = ['value' => 'team.jpg', 'alt' => 'Wieder da']; })['status'], 200);
});

test('an image without alt is refused with a clear message, naming the list item', function () use ($c, $e) {
    $text = $e->git->read(INDEX);
    $r = savePage($c, 'index', function (array &$v) { $v['cards']['items'][0]['photo']['alt'] = '  '; });
    eq($r['status'], 422);
    eq($r['json']['errors'][0]['label'] . ': ' . $r['json']['errors'][0]['msg'], 'Karte 1 › Bild: ' . Rules::MSG_ALT_REQUIRED);
    eq($e->git->read(INDEX), $text);
});

test('finding 1: contact values with < or > are refused, nothing is written', function () use ($c, $e, $runs) {
    $f = 'src/content/pages/_global.json';
    $text = $e->git->read($f);
    $before = $runs();
    $r = savePage($c, '_global', function (array &$v) {
        $v['contact']['phone'] = 'ALNO GmbH</script a';
        $v['contact']['email'] = 'info@example.org>';
    });
    eq($r['status'], 422);
    eq(array_unique(array_column($r['json']['errors'], 'msg')), [Rules::MSG_NO_ANGLE]);
    eq($e->git->read($f), $text);
    eq($runs(), $before);
});

test('hostile content does not stall other requests', function () use ($c) {
    $t = microtime(true);
    $r = saveEntry($c, 'post', 'zweiter-beitrag', function (array &$v, string &$body) { $body = str_repeat("\n", 100000) . str_repeat('<a ', 10000) . 'Ende'; });
    eq($r['status'], 200, $r['body']);
    eq($c->get('entry', ['type' => 'post', 'id' => 'zweiter-beitrag'])['status'], 200);
    ok(microtime(true) - $t < 3, 'save and reopen stay fast');
});

test('blog: edit keeps the Markdown body and the unknown keys', function () use ($c, $e) {
    $f = 'src/content/blog/erster-beitrag.md';
    $original = $e->git->read($f);
    $r = saveEntry($c, 'post', 'erster-beitrag', function () {});
    eq($r['json'], ['ok' => true, 'id' => 'erster-beitrag', 'unchanged' => true], 'an unchanged save rewrites nothing');
    eq($e->git->read($f), $original);
    $r = saveEntry($c, 'post', 'erster-beitrag', function (array &$v) { $v['title'] = 'Neuer Titel: mit Doppelpunkt'; });
    eq($r['status'], 200, $r['body']);
    $text = (string) $e->git->read($f);
    has($text, "\ntitle: \"Neuer Titel: mit Doppelpunkt\"\n");
    has($text, "\ntags: [Test, Beispiel]\n");
    has($text, '> **Tipp:** ein Zitat.');
    has($e->git->commit($r['json']['job'])['message'], 'Admin: aktualisiert – Neuer Titel: mit Doppelpunkt (blog/erster-beitrag.md)');
});

test('blog: a new post, then a duplicate', function () use ($c, $e) {
    $post = ['type' => 'post', 'id' => '', 'slug' => '', 'values' => ['title' => 'Größe & Mut', 'description' => 'D', 'date' => '2026-10-01', 'tags' => ['A', 'B']], 'body' => "## Hallo\n\nText\n"];
    $r = $c->post('entry', $post);
    eq($r['status'], 200, $r['body']);
    eq($r['json']['id'], 'groesse-mut');
    $text = (string) $e->git->read('src/content/blog/groesse-mut.md');
    has($text, "\ntags: [A, B]\n");
    eq($e->git->commit($r['json']['job'])['author']['name'], 'admin');
    has($e->git->commit($r['json']['job'])['message'], 'Admin: neu – Größe & Mut (blog/groesse-mut.md)');
    $dup = $c->post('entry', $post);
    eq($dup['status'], 422);
    eq($dup['json']['errors'][0]['msg'], Rules::MSG_SLUG_TAKEN);
});

test('Leistungen: highlights and order are saved', function () use ($c, $e) {
    $r = saveEntry($c, 'leistung', 'grundpflege', function (array &$v) { $v['highlights'][] = 'Baden'; $v['order'] = '7'; });
    eq($r['status'], 200, $r['body']);
    $text = (string) $e->git->read('src/content/leistungen/grundpflege.md');
    has($text, "\norder: 7\n");
    has($text, "\n  - Baden\n");
    has($text, '## Was ist Grundpflege?');
});

test('a team member can be added', function () use ($c, $e) {
    $r = $c->post('entry', ['type' => 'team', 'id' => '', 'slug' => '', 'values' => ['name' => 'Neue Person', 'role' => 'Pflege']]);
    eq($r['status'], 200, $r['body']);
    ok($e->git->read('src/content/team/neue-person.md') !== null);
});

test('every read route answers, and no answer holds an empty placeholder', function () use ($c) {
    $routes = [['dashboard', []], ['pages', []], ['page', ['id' => 'index']], ['page', ['id' => '_global']], ['entries', ['type' => 'post']], ['entries', ['type' => 'leistung']], ['entries', ['type' => 'team']], ['entry', ['type' => 'post', 'id' => 'erster-beitrag']], ['entry/new', ['type' => 'post']], ['entry/new', ['type' => 'team']], ['media', []], ['revisions', []], ['status', []], ['users', []], ['anfragen', []], ['session', []]];
    foreach ($routes as [$r, $q]) {
        $x = $c->get($r, $q);
        eq($x['status'], 200, "$r: {$x['body']}");
        ok(is_array($x['json']), $r);
    }
});

test('entries: views, counts, search', function () use ($c, $e) {
    $list = $c->get('entries', ['type' => 'post'])['json'];
    eq($list['counts']['all'], count($list['entries']));
    eq($list['def']['key'], 'blog');
    ok(in_array('erster-beitrag', array_column($list['entries'], 'slug'), true));
    saveEntry($c, 'post', 'groesse-mut', function (array &$v) { $v['draft'] = true; });
    $drafts = $c->get('entries', ['type' => 'post', 'status' => 'draft'])['json'];
    eq(array_column($drafts['entries'], 'slug'), ['groesse-mut', 'zweiter-beitrag'], 'the fixture has a draft of its own');
    ok(!in_array('groesse-mut', array_column($c->get('entries', ['type' => 'post', 'status' => 'publish'])['json']['entries'], 'slug'), true));
    eq(array_column($c->get('entries', ['type' => 'post', 's' => 'GRÖßE'])['json']['entries'], 'slug'), ['groesse-mut']);
    eq($c->get('entries', ['type' => 'nix'])['status'], 404);
});

test('new entries start with today, posts only', function () use ($c) {
    eq($c->get('entry/new', ['type' => 'post'])['json']['values']['date'], date('Y-m-d'));
    eq($c->get('entry/new', ['type' => 'team'])['json']['slug'], '');
});

test('concurrent saves of different files all land in git', function () {
    $x = new Env(true, 4);
    $c = $x->as('admin');
    $a = $c->get('page', ['id' => 'ueber-uns'])['json'];
    $b = $c->get('page', ['id' => '_global'])['json'];
    $va = pageValues($a['page']);
    $vb = pageValues($b['page']);
    $va['seo']['title'] = 'Parallel A';
    $vb['contact']['phone'] = '0231 111111';
    $head = $x->git->head();
    $rs = $c->together([['page', ['id' => 'ueber-uns', 'hash' => $a['hash'], 'values' => $va]], ['page', ['id' => '_global', 'hash' => $b['hash'], 'values' => $vb]]]);
    eq(array_column($rs, 'status'), [200, 200], show(array_column($rs, 'body')));
    has((string) $x->git->read('src/content/pages/ueber-uns.json'), 'Parallel A');
    has((string) $x->git->read('src/content/pages/_global.json'), '0231 111111');
    $history = array_slice($x->git->history(), 0, 3);
    eq($history[2], $head, 'one commit after the other');
    $subjects = array_map(static fn ($s) => $x->git->commit($s)['message'], array_slice($history, 0, 2));
    sort($subjects);
    eq($subjects, ['Admin: Einstellungen aktualisiert', 'Admin: Über uns aktualisiert']);
    $x->stop();
});

test('if the commit fails, the repository stays as it was and nothing is built', function () use ($c, $e, $runs) {
    $head = $e->git->head();
    $text = $e->git->read(INDEX);
    $before = $runs();
    $e->git->setControl(['failRoute' => ['POST /git/trees' => 500]]);
    $r = savePage($c, 'index', function (array &$v) { $v['hero']['pill'] = 'Commit scheitert'; });
    $e->git->setControl(['failRoute' => []]);
    eq($r['status'], 502, $r['body']);
    eq($e->git->read(INDEX), $text);
    eq($e->git->head(), $head);
    eq($runs(), $before);
});

test('an unknown {{token}} is refused, a known one passes; as a link target it loses the link', function () use ($c, $e) {
    $r = savePage($c, 'index', function (array &$v) { $v['hero']['pill'] = 'Ruf {{telefon}} an'; });
    eq($r['status'], 422);
    eq($r['json']['errors'][0]['msg'], 'unbekannter Platzhalter {{telefon}}');
    $r = savePage($c, 'index', function (array &$v) { $v['hero']['pill'] = 'Ruf {{phone}} an'; $v['hero']['lead'] = '<p><a href="{{phone}}">Anruf</a></p>'; });
    eq($r['status'], 200, $r['body']);
    // Changed against Node: rules.json has safeHref({{x}}) => null, and no real page links a token.
    has((string) $e->git->read(INDEX), '"value": "<p>Anruf</p>"');
});

test('a new contact field is a known token only in the file that says so', function () use ($c) {
    $r = savePage($c, '_global', function (array &$v) { $v['footer']['note'] = '<p>{{phone}} und {{nix}}</p>'; });
    eq($r['status'], 422);
    eq($r['json']['errors'][0]['msg'], 'unbekannter Platzhalter {{nix}}');
});

test('values YAML would read as numbers, booleans or null stay strings', function () use ($c, $e) {
    foreach (['1e3', '0x10', '.5', '-1.5', 'null', 'Yes', '.inf', '1_000', '12:30', 'a: b', '# x', '- y', '"z"'] as $v) {
        $r = saveEntry($c, 'team', 'max-muster', function (array &$x) use ($v) { $x['role'] = $v; });
        eq($r['status'], 200, "$v: {$r['body']}");
        eq($c->get('entry', ['type' => 'team', 'id' => 'max-muster'])['json']['values']['role'], $v);
        ok(preg_match('/^role: (.*)$/m', (string) $e->git->read('src/content/team/max-muster.md'), $m) === 1);
        if (preg_match('/^(1e3|0x10|\.5|-1\.5|null|Yes|\.inf|1_000)$/D', $v)) ok($m[1][0] === '"', "$v must be quoted, got {$m[1]}");
    }
});

test('an image outside the library is kept, not dropped on save', function () use ($c, $e) {
    $f = 'src/content/team/max-muster.md';
    $e->git->push([$f => "---\nname: Max Muster\nrole: Verwaltung\nphoto: ../../other/foto.jpg\norder: 2\n---\n"], 'Testbild');
    $r = saveEntry($c, 'team', 'max-muster', function (array &$v) { $v['role'] = 'Geändert'; });
    eq($r['status'], 200, $r['body']);
    has((string) $e->git->read($f), "\nphoto: ../../other/foto.jpg\n");
});

test('a page file that does not parse is shown as broken and not written over', function () use ($c, $e) {
    $f = 'src/content/pages/ueber-uns.json';
    $good = $e->git->read($f);
    $e->git->push([$f => '{ kaputt'], 'Kaputt');
    $pages = array_column($c->get('pages')['json']['pages'], null, 'id');
    eq($pages['ueber-uns']['error'], 'JSON');
    $p = $c->get('page', ['id' => 'ueber-uns']);
    eq($p['status'], 200, $p['body']);
    ok($p['json']['structureErrors']);
    $r = $c->post('page', ['id' => 'ueber-uns', 'hash' => $p['json']['hash'], 'values' => []]);
    eq($r['status'], 422);
    eq($r['json']['error'], 'structure');
    eq($e->git->read($f), '{ kaputt');
    $e->git->push([$f => $good], 'Repariert');
});

test('a file that is not UTF-8 is refused, not shown empty and written over', function () use ($c, $e) {
    $f = 'src/content/team/max-muster.md';
    $good = $e->git->read($f);
    $latin1 = "---\nname: J\xFCrgen\nrole: x\n---\n";
    $e->git->push([$f => $latin1], 'Latin-1');
    $r = $c->get('entry', ['type' => 'team', 'id' => 'max-muster']);
    eq($r['status'], 422, $r['body']);
    eq($r['json']['error'], 'unreadable');
    $e->git->push([$f => $good], 'Repariert');
});

test('an entry the admin does not understand is refused, not rewritten', function () use ($c, $e) {
    $f = 'src/content/team/max-muster.md';
    $good = $e->git->read($f);
    $e->git->push([$f => "---\nname: |\n  block\n---\n"], 'YAML');
    $r = $c->get('entry', ['type' => 'team', 'id' => 'max-muster']);
    eq($r['status'], 422);
    eq($r['json']['error'], 'unreadable');
    $list = array_column($c->get('entries', ['type' => 'team'])['json']['entries'], null, 'slug');
    ok(isset($list['max-muster']['error']));
    eq($c->post('entry', ['type' => 'team', 'id' => 'max-muster', 'hash' => 'x', 'values' => ['name' => 'N', 'role' => 'R']])['status'], 422);
    $e->git->push([$f => $good], 'Repariert');
});
finish();
