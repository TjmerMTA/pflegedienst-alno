<?php
// Tess2's report on admin-app: A1, A2 and the low findings that were fixed.
declare(strict_types=1);
require_once __DIR__ . '/harness.php';

function jpeg(): string
{
    $im = imagecreatetruecolor(40, 30);
    ob_start();
    imagejpeg($im);
    return (string) ob_get_clean();
}

$e = new Env();
$admin = $e->as('admin');
$new = function (string $slug, string $title, string $body = 'Text') use ($admin) {
    $d = $admin->get('entry/new', ['type' => 'post'])['json'];
    return $admin->post('entry', ['type' => 'post', 'id' => '', 'slug' => $slug, 'values' => ['title' => $title, 'description' => 'd'] + $d['values'], 'body' => $body]);
};

foreach (['[sk[skip ci]ip ci] Neu', '[ci [ci skip]skip] Neu', '[no [no ci]ci] Neu', '[skip [skip actions]actions] Neu', '[actions [actions skip]skip] Neu', '***NO_***NO_CI***CI*** Neu', '[SKIP CI] Neu', '[ skip ci ] Neu', "[skip\nci] Neu"] as $i => $title) {
    test("no skip marker can arise from: $title", function () use ($new, $e, $title, $i) {
        $r = $new("marker-$i", $title);
        eq($r['status'], 200, $r['body']);
        $msg = $e->git->commit($r['json']['job'])['message'];
        ok(!preg_match('/\[[^\]]*(skip|no ci)[^\]]*\]|\*\*\*NO_CI\*\*\*/i', $msg), $msg);
        ok(count(array_filter($e->git->runs(), static fn ($run) => $run['head_sha'] === $r['json']['job'])) === 1, 'a run must start');
    });
}
test('the title itself is stored as typed; only the commit message loses the brackets', function () use ($new, $e) {
    $r = $new('klammern', 'Pflege [Teil 1] *neu*');
    eq($r['status'], 200, $r['body']);
    has((string) $e->git->read('src/content/blog/klammern.md'), 'Pflege [Teil 1] *neu*');
    has($e->git->commit($r['json']['job'])['message'], 'Pflege Teil 1 neu');
});

test('A2: a staged image in a body lands in the commit of the save', function () use ($admin, $e, $new) {
    $p = $admin->upload(jpeg(), 'a.jpg', '&stage=1')['json']['files'][0]['path'];
    $r = $new('mit-bild-im-text', 'Bild im Text', "![a](../../assets/img/$p)\n");
    eq($r['status'], 200, $r['body']);
    ok($e->git->read("src/assets/img/$p") !== null, 'image missing from the commit');
    eq(array_key_exists("src/assets/img/$p", $e->git->files($r['json']['job'])), true);
    ok(!is_file("$e->data/pending/" . basename($p)), 'pending file left');
});
test('A2: on untrash too', function () use ($admin, $e, $new) {
    $p = $admin->upload(jpeg(), 'a.jpg', '&stage=1')['json']['files'][0]['path'];
    $r = $new('untrash-bild', 'Untrash', "![a](../../assets/img/$p)\n");
    eq($r['status'], 200, $r['body']);
    eq($admin->post('entry/trash', ['type' => 'post', 'id' => 'untrash-bild'])['status'], 200);
    // The file goes from the repository and waits in pending/ again: what untrash has to carry.
    $name = basename($p);
    $e->git->push(["src/assets/img/$p" => null], 'weg');
    $e->store->write("pending/$name", jpeg());
    $id = null;
    foreach ($admin->get('entries', ['type' => 'post', 'status' => 'trash'])['json']['trash'] as $t) if ($t['slug'] === 'untrash-bild') $id = $t['id'];
    $u = $admin->post('entry/untrash', ['type' => 'post', 'trashId' => $id]);
    eq($u['status'], 200, $u['body']);
    ok($e->git->read("src/assets/img/$p") !== null, 'image missing');
    ok(!is_file("$e->data/pending/$name"));
});
test('A2: on restore of an entry too', function () use ($admin, $e) {
    $p = $admin->upload(jpeg(), 'a.jpg', '&stage=1')['json']['files'][0]['path'];
    $name = basename($p);
    $file = 'src/content/blog/erster-beitrag.md';
    $orig = (string) $e->git->read($file);
    $sha = $e->git->push([$file => rtrim($orig) . "\n\n![a](../../assets/img/$p)\n"], 'mit Bild');
    $e->git->push([$file => $orig], 'ohne');
    $r = $admin->post('revisions/restore', ['file' => $file, 'rev' => $sha]);
    eq($r['status'], 200, $r['body']);
    ok($e->git->read("src/assets/img/$p") !== null, 'image missing');
    ok(!is_file("$e->data/pending/$name"));
});

test('password change: five wrong current passwords lock the check, also for the right one', function () use ($e) {
    (new Auth($e->store))->addUser('stolen', $e->password);
    $c = $e->as('stolen');
    for ($i = 0; $i < 4; $i++) eq($c->post('profile/password', ['current' => 'falsch', 'password' => 'ein-neues-passwort'])['status'], 422);
    eq($c->post('profile/password', ['current' => 'falsch', 'password' => 'ein-neues-passwort'])['status'], 422);
    $r = $c->post('profile/password', ['current' => $e->password, 'password' => 'ein-neues-passwort']);
    eq($r['status'], 429, $r['body']);
    eq($r['json']['error'], 'locked');
    ok(password_verify($e->password, (new Auth($e->store))->users()['stolen']['hash']), 'password unchanged');
});
test('password change: a right password clears the count', function () use ($e) {
    $t = (new Auth($e->store));
    $t->addUser('tippt', $e->password);
    for ($i = 0; $i < 4; $i++) eq($t->checkCurrent('tippt', 'x'), 0);
    eq($t->checkCurrent('tippt', $e->password), true);
    eq($t->checkCurrent('tippt', 'x'), 0);
});

test('link targets: only the schemes richtext links have', function () {
    foreach (['[x](blob:https://a/b)', '[x](view-source:https://a)', '[x](ftp://a/b)', '[x](file:///etc/passwd)', "[r]\n\n[r]: ftp://a/b", '[x](&#102;tp://a)', '![x](ftp://a/b.jpg)'] as $bad) ok(Rules::hasUnsafeLink($bad), $bad);
    foreach (['[x](https://a/b)', '[x](http://a)', '[x](mailto:a@b.de)', '[x](tel:+49231)', '[x](/kontakt/)', '[x](#oben)', '[x](../a)', '[Hinweis]: Bitte beachten', 'Uhrzeit (Beginn: 8 Uhr)', "[r]\n\n[r]: https://a"] as $ok) ok(!Rules::hasUnsafeLink($ok), $ok);
});

test('staged images: unused ones go after seven days, and only so many can wait', function () use ($admin, $e) {
    $old = bin2hex(random_bytes(8)) . '.jpg';
    $fresh = bin2hex(random_bytes(8)) . '.jpg';
    $e->store->write("pending/$old", 'x');
    $e->store->write("pending/$fresh", 'x');
    touch("$e->data/pending/$old", time() - 8 * 86400);
    eq($e->cronCli()['code'] ?? 0, 0);
    ok(!is_file("$e->data/pending/$old"), 'old one stayed');
    ok(is_file("$e->data/pending/$fresh"), 'a fresh one must stay');
    for ($i = 0; $i < Media::PENDING_MAX; $i++) file_put_contents("$e->data/pending/" . bin2hex(random_bytes(8)) . '.jpg', 'x');
    $r = $admin->upload(jpeg(), 'a.jpg', '&stage=1');
    eq($r['status'], 422, $r['body']);
    has($r['body'], 'Zu viele Bilder');
    foreach (glob("$e->data/pending/*") ?: [] as $f) unlink($f);
});
finish();
