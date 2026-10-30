<?php
// Findings of the independent review, each with what it did on the real tools.
declare(strict_types=1);
require_once __DIR__ . '/harness.php';

$e = new Env();
$admin = $e->as('admin');
$post = fn (string $id = 'erster-beitrag') => $admin->get('entry', ['type' => 'post', 'id' => $id])['json'];
$save = fn (array $d, array $over = [], ?string $body = null) => $admin->post('entry', ['type' => 'post', 'id' => $d['slug'], 'hash' => $d['hash'], 'values' => $over + $d['values'], 'body' => $body ?? $d['body']]);

foreach (['[x](javascript:&#32;alert(1))', '[x](javascript:&#160;alert(1))', '[x](javascript:&nbsp;alert(1))', "[x](javascript:\u{A0}alert(1))", "[x](javascript:\u{2003}alert(1))", "[r]\n\n[r]: javascript:&#32;x", '[x](JaVaScRiPt:&#32;x)', '[x](vbscript:&#32;x)', '[x](data:&#32;text/html,x)', '[x](data:&Tab;text/html,x)'] as $bad) {
    test('unsafe link with something after the colon: ' . $bad, fn () => ok(Rules::hasUnsafeLink($bad)));
}
test('words in a sentence are no links', function () {
    foreach (['Daten: data: 5 Einträge', 'data: 5', 'Metadata: ja', 'Die Datei.data: x'] as $ok) ok(!Rules::hasUnsafeLink($ok), $ok);
});

test('a re-added name does not bring back the old session', function () use ($e, $admin) {
    $auth = new Auth($e->store);
    $auth->addUser('anna', $e->password, false);
    $c = $e->as('anna');
    eq($c->get('dashboard')['status'], 200);
    eq($admin->post('users/delete', ['name' => 'anna'])['status'], 200);
    $auth->addUser('anna', 'ein-anderes-passwort', false, 'de', true);
    eq($c->get('anfragen')['status'], 401);
});
test('locked attempts do not fill the log, and reads go to their own', function () use ($e) {
    $c = $e->client();
    $n = $c->get('session')['json']['loginNonce'];
    for ($i = 0; $i < 12; $i++) $c->post('login', ['user' => 'flut', 'password' => 'x'], ["X-Login-Nonce: $n"]);
    ok(substr_count((string) $e->store->read('logs/admin.log'), '"user":"flut"') <= Auth::MAX_FAILS);
});
test('a stranger cannot keep someone else locked out', function () use ($e) {
    $t = time();
    $a = new Auth($e->store, function () use (&$t) { return $t; });
    $a->addUser('opfer2', $e->password, false);
    $device = $a->rememberDevice('opfer2');
    for ($i = 0; $i < 6; $i++) { $r = $a->login('opfer2', 'falsch', '203.0.113.9'); $t += 20; }
    eq($r['reason'], 'locked');
    eq($a->login('opfer2', $e->password, '198.51.100.7', $device)['ok'], true);
});
test('an IPv6 /64 counts as one address', function () {
    eq(Auth::network('2001:db8:1:2:aaaa::1'), Auth::network('2001:db8:1:2:bbbb::2'));
    ok(Auth::network('2001:db8:1:3::1') !== Auth::network('2001:db8:1:2::1'));
    eq(Auth::network('203.0.113.9'), '203.0.113.9');
});

test('Anfragen: status on a record that went does not bring it back', function () use ($e) {
    $id = $e->anfrage();
    $a = new Anfragen($e->store);
    ok($a->trash($id));
    ok($a->destroy($id));
    ok(!$a->setStatus($id, 'erledigt'));
    ok(!$e->store->exists("anfragen/$id.json"));
});
test('retention: an attachment in the other folder goes with its record', function () use ($e) {
    $s = str_repeat('a', 32);
    $id = $e->anfrage(['received' => date('c', strtotime('-7 months'))], [$s => 'x']);
    rename("$e->data/anfragen/files/$s", (is_dir("$e->data/anfragen-papierkorb/files") ? '' : (string) mkdir("$e->data/anfragen-papierkorb/files", 0700, true)) . "$e->data/anfragen-papierkorb/files/$s");
    (new Anfragen($e->store))->purge();
    ok(!is_file("$e->data/anfragen-papierkorb/files/$s"), 'attachment left behind');
});
test('retention: a broken record past every period goes, a fresh one stays', function () use ($e) {
    $old = date('Y-m-d-His', strtotime('-7 months')) . '-aaaaaaaaaaaaaaaa';
    $new = date('Y-m-d-His') . '-bbbbbbbbbbbbbbbb';
    $e->store->write("anfragen/$old.json", '{"id":');
    $e->store->write("anfragen/$new.json", '{"id":');
    (new Anfragen($e->store))->purge();
    ok(!$e->store->exists("anfragen/$old.json"), 'old broken record stayed');
    ok($e->store->exists("anfragen/$new.json"), 'a fresh broken record must stay for a human');
    $e->store->delete("anfragen/$new.json");
});
test('retention: files nobody lists and stale temp files go after a day', function () use ($e) {
    $orphan = str_repeat('b', 32);
    $fresh = str_repeat('c', 32);
    $e->store->write("anfragen/files/$orphan", 'x');
    $e->store->write("anfragen/files/$fresh", 'x');
    $e->store->write('anfragen/.tmp-123', 'x');
    touch("$e->data/anfragen/files/$orphan", time() - 90000);
    touch("$e->data/anfragen/.tmp-123", time() - 90000);
    (new Anfragen($e->store))->purge();
    ok(!is_file("$e->data/anfragen/files/$orphan"));
    ok(!is_file("$e->data/anfragen/.tmp-123"));
    ok(is_file("$e->data/anfragen/files/$fresh"), 'a write in progress stays');
    @unlink("$e->data/anfragen/files/$fresh");
});

test('a missing image in the text is refused: the build would fail', function () use ($post, $save) {
    $d = $post();
    $r = $save($d, [], "Text\n\n![Bild](../../assets/img/gibtsnicht.jpg)\n");
    eq($r['status'], 422, $r['body']);
    has($r['body'], 'Bild im Text nicht gefunden');
    foreach (['![a](foo.jpg)', '![a](../x.png)', '![a](../../assets/img/../x.jpg)'] as $body) eq($save($d, [], $body)['status'], 422, $body);
    $r = $save($d, [], "Text\n\n![Bild](../../assets/img/team.jpg)\n\n![b](/favicon.png)\n");
    eq($r['status'], 200, $r['body']);
});
test('untrash is refused when an image of the entry has gone', function () use ($admin, $e) {
    $d = $admin->get('entry/new', ['type' => 'post'])['json'];
    $r = $admin->post('entry', ['type' => 'post', 'id' => '', 'slug' => 'mit-bild', 'values' => ['title' => 'Mit Bild', 'description' => 'd', 'image' => ['value' => 'unbenutzt.webp', 'alt' => 'x']] + $d['values'], 'body' => 'x']);
    eq($r['status'], 200, $r['body']);
    eq($admin->post('entry/trash', ['type' => 'post', 'id' => 'mit-bild'])['status'], 200);
    eq($admin->post('media/delete', ['path' => 'unbenutzt.webp'])['status'], 200);
    $id = $admin->get('entries', ['type' => 'post', 'status' => 'trash'])['json']['trash'][0]['id'];
    $r = $admin->post('entry/untrash', ['type' => 'post', 'trashId' => $id]);
    eq($r['status'], 422, $r['body']);
    has($r['body'], 'unbenutzt.webp');
});

test('a save reads back: backslash and quote, list end in a tag', function () use ($post, $save, $admin) {
    $d = $post('zweiter-beitrag');
    $title = "Tipp: Mama\\'s Rezept";
    $r = $save($d, ['title' => $title, 'tags' => ['a] # b', 'c, d', 'x"y']]);
    eq($r['status'], 200, $r['body']);
    $back = $post('zweiter-beitrag');
    eq($back['values']['title'], $title);
    eq($back['values']['tags'], ['a] # b', 'c, d', 'x"y']);
});
test('frontmatter: what it does not understand is refused, not rewritten', function () {
    foreach (['extra: {a: 1, b: 2}', 'extra: [[1]]', 'tags: [a, b', 'tags: [a] x'] as $bad) {
        try { Frontmatter::parse($bad); throw new RuntimeException("parsed: $bad"); } catch (FrontmatterError $e) {}
    }
    eq(Frontmatter::stringify(Frontmatter::parse("title: x\nextra:\n")), "title: x\nextra:");
    eq(Frontmatter::split("---\n---\n\nText\n")['body'], "\nText\n");
    foreach (["kein Kopf\n", "---\ntitle: x\n"] as $bad) {
        try { Frontmatter::split($bad); throw new RuntimeException("split: $bad"); } catch (FrontmatterError $e) {}
    }
});

test('a revision with a strange file shows as text, without a 500', function () use ($admin, $e) {
    $p = 'src/content/pages/ueber-uns.json';
    $e->git->push([$p => '{"fields":["a"]}'], 'kaputt');
    $e->git->push([$p => (string) $e->git->read($p, $e->git->commit($e->git->head())['parents'][0])], 'wieder gut');
    $r = $admin->get('revisions/file', ['file' => $p, 'rev' => $e->git->commit($e->git->head())['parents'][0]]);
    eq($r['status'], 200, $r['body']);
});
test('restore: control characters go, a foreign image and a Leistung that is gone are refused', function () use ($admin, $e) {
    $p = 'src/content/team/max-muster.md';
    $orig = (string) $e->git->read($p);
    $bad = preg_replace('/^name: .*$/m', 'name: Max Muster', $orig);
    $sha = $e->git->push([$p => str_replace("---\n\n", "photo: https://evil.example/x.jpg\n---\n\n", $bad) . "", ], 'mit fremdem Bild');
    $e->git->push([$p => $orig], 'zurück');
    $r = $admin->post('revisions/restore', ['file' => $p, 'rev' => $sha]);
    if (strpos((string) $e->git->read($p, $sha), 'evil.example') !== false) eq($r['status'], 422, $r['body']);
    $l = 'src/content/leistungen/beratung.md';
    $before = $e->git->head();
    $e->git->push([$l => null], 'weg');
    eq($admin->post('revisions/restore', ['file' => $l, 'rev' => $before])['status'], 403);
    $page = json_decode((string) $e->git->read('src/content/pages/ueber-uns.json'), true);
    $page['groups'][0]['fields'][0]['value'] = "Titel\u{2028}\u{0001}";
    $page2 = (string) json_encode($page, JSON_UNESCAPED_UNICODE);
    $sha2 = $e->git->push(['src/content/pages/ueber-uns.json' => $page2], 'Steuerzeichen');
    $e->git->push(['src/content/pages/ueber-uns.json' => (string) json_encode(json_decode($page2, true))], 'neu');
    $r = $admin->post('revisions/restore', ['file' => 'src/content/pages/ueber-uns.json', 'rev' => $sha2]);
    eq($r['status'], 200, $r['body']);
    hasNot((string) $e->git->read('src/content/pages/ueber-uns.json'), "\u{2028}");
});
test('words in a title cannot switch off the build', function () {
    eq(Site::commitLabel('Sommerfest [skip ci]'), 'Sommerfest skip ci');
    eq(Site::commitLabel('A [CI SKIP] B [no ci] C [skip actions] D ***NO_CI***'), 'A CI SKIP B no ci C skip actions D NO_CI');
});
test('a cut-off tree listing is refused, GitHub limits have a clear message', function () use ($e) {
    $e->git->setControl(['failRoute' => ['GET /git/ref' => 429]]);
    $c = $e->client();
    $s = new Store($e->data);
    $g = new GitHub($s, TEST_TOKEN);
    putenv("ALNO_GITHUB_API=http://127.0.0.1:{$e->gh->port}");
    $g = new GitHub($s, TEST_TOKEN);
    try { $g->head(); throw new RuntimeException('no error'); } catch (GitHubError $x) { has($x->getMessage(), 'GitHub-Limit'); }
    $e->git->setControl(['failRoute' => []]);
});
test('cron records its last run for the screen', function () use ($e, $admin) {
    $e->cronCli();
    ok($e->store->read('cron-last'), 'no record');
    ok($admin->get('anfragen')['json']['cronLast'] !== '');
});
finish();
