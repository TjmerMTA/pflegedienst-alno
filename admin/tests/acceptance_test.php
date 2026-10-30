<?php
// Findings of the blind acceptance: the one phone field, the images of the brand group, upload titles and
// messages, images in the editor.
declare(strict_types=1);
require_once __DIR__ . '/harness.php';

function picture(int $w, int $h): string
{
    $im = imagecreatetruecolor($w, $h);
    ob_start();
    imagepng($im);
    return (string) ob_get_clean();
}

$contact = static fn (string $id, string $value) => Rules::validatePageValues(['groups' => [['id' => 'contact', 'fields' => [['id' => $id, 'label' => $id, 'type' => 'text', 'value' => $value]]]]]);
test('Telefon must hold a number: the call links are made from it', function () use ($contact) {
    eq($contact('phone', '0231 54 67 686'), []);
    eq($contact('phone', 'auf Anfrage')[0]['msg'] ?? '', Rules::MSG_BAD_PHONE);
    eq($contact('phone', '123')[0]['msg'] ?? '', Rules::MSG_BAD_PHONE);
});
test('Telefon holds one number and nothing beside it: every digit goes into the call link', function () use ($contact) {
    foreach (['0231 / 54 67 686', '0231-5467686', "0231\u{A0}5467686", '0231–5467686', '+49 (0) 231 5467686', '0049 231 5467686', '0231.5467686', '123456', '123456789012345'] as $ok) eq($contact('phone', $ok), [], $ok);
    foreach (['0231 5467686 (Mo-Fr 8-16)', '24h: 0231 5467686', '0231 5467686 oder 0231 999', '0231 5467686 / 0231 999', '1234567890123456', '12345'] as $bad) eq($contact('phone', $bad)[0]['msg'] ?? '', Rules::MSG_BAD_PHONE, $bad);
});
test('Telefon international is optional, and if set it is international', function () use ($contact) {
    eq($contact('phoneIntl', ''), []);
    eq($contact('phoneIntl', '+49 231 5467686'), []);
    eq($contact('phoneIntl', '0231 5467686')[0]['msg'] ?? '', Rules::MSG_BAD_PHONE_INTL);
    eq($contact('phoneIntl', '+49 ruft zurück')[0]['msg'] ?? '', Rules::MSG_BAD_PHONE_INTL);
    foreach (['+ - - -', '+ 123 45', '+1234567890123456'] as $bad) eq($contact('phoneIntl', $bad)[0]['msg'] ?? '', Rules::MSG_BAD_PHONE_INTL, $bad);
    eq($contact('phoneIntl', '+123456789012345'), []);
});
test('the same field names outside the contact group are plain text', function () {
    eq(Rules::validatePageValues(['groups' => [['id' => 'kontakt', 'fields' => [['id' => 'phone', 'label' => 'x', 'type' => 'text', 'value' => 'Rufen Sie uns an']]]]]), []);
});

$image = static fn (array $rules, ?array $size) => Rules::validatePageValues(['groups' => [['id' => 'brand', 'fields' => [['id' => 'b', 'label' => 'Bild', 'type' => 'image', 'value' => 'a.png', 'alt' => 'x'] + $rules]]]], ['imageSize' => static fn () => $size]);
test('an image field checks its size rules', function () use ($image) {
    eq($image(['minWidth' => 1200, 'minHeight' => 630], [1200, 630]), []);
    eq($image(['minWidth' => 1200, 'minHeight' => 630], [800, 630])[0]['msg'] ?? '', Rules::msgImageSmall(1200, 630, 800, 630));
    eq($image(['minWidth' => 1200, 'minHeight' => 630], [1200, 629])[0]['msg'] ?? '', Rules::msgImageSmall(1200, 630, 1200, 629));
    eq($image(['square' => true], [512, 512]), []);
    eq($image(['square' => true], [512, 505]), [], 'a few pixels off are nothing');
    eq($image(['square' => true], [512, 400])[0]['msg'] ?? '', Rules::MSG_IMAGE_SQUARE);
    eq($image(['minWidth' => 96, 'square' => true], null), [], 'a file that does not say its size is not refused for it');
    eq($image([], [1, 1]), [], 'no rules, no check');
});

$e = new Env();
$admin = $e->as('admin');
$brand = ['id' => 'brand', 'label' => 'Bilder', 'fields' => [['id' => 'favicon', 'label' => 'Favicon', 'type' => 'image', 'required' => true, 'minWidth' => 180, 'minHeight' => 180, 'square' => true, 'value' => 'alt-klein.png', 'alt' => 'x']]];
$global = json_decode((string) $e->git->read('src/content/pages/_global.json'), true);
array_unshift($global['groups'], $brand);
$e->git->push(['src/content/pages/_global.json' => json_encode($global, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n", 'src/assets/img/alt-klein.png' => picture(64, 64)], 'brand');
$setFavicon = static function (string $path) use ($admin) {
    $d = $admin->get('page', ['id' => '_global'])['json'];
    return $admin->post('page', ['id' => '_global', 'hash' => $d['hash'], 'values' => ['brand' => ['favicon' => ['value' => $path, 'alt' => 'Symbol']]]]);
};
test('an image that was already there does not block a save of the page', function () use ($admin, $e) {
    $d = $admin->get('page', ['id' => '_global'])['json'];
    $values = ['brand' => ['favicon' => ['value' => 'alt-klein.png', 'alt' => 'neuer Text']]];
    $r = $admin->post('page', ['id' => '_global', 'hash' => $d['hash'], 'values' => $values]);
    eq($r['status'], 200, $r['body']);
});
test('a newly chosen favicon that is too small or not square is refused, with the sizes', function () use ($admin, $setFavicon) {
    $small = $admin->upload(picture(64, 64), 'klein.png', '&stage=1')['json']['files'][0]['path'];
    $r = $setFavicon($small);
    eq($r['status'], 422, $r['body']);
    has($r['body'], 'mindestens 180');
    $wide = $admin->upload(picture(400, 200), 'breit.png', '&stage=1')['json']['files'][0]['path'];
    eq($setFavicon($wide)['status'], 422);
    $good = $admin->upload(picture(200, 200), 'gut.png', '&stage=1')['json']['files'][0]['path'];
    $r = $setFavicon($good);
    eq($r['status'], 200, $r['body']);
});

test('the path Medien shows works in a text and is stored as the one the build needs', function () use ($admin, $e) {
    $d = $admin->get('entry/new', ['type' => 'post'])['json'];
    $p = $admin->upload(picture(40, 30), 'a.png', '&stage=1')['json']['files'][0]['path'];
    $body = "Vor ![Foto]($p) nach.\n\n![Team](team.jpg \"Titel\")\n\n`uploads/x.jpg` bleibt\n";
    $r = $admin->post('entry', ['type' => 'post', 'id' => '', 'slug' => 'medien-pfad', 'values' => ['title' => 'Medien', 'description' => 'd'] + $d['values'], 'body' => $body]);
    eq($r['status'], 200, $r['body']);
    $text = (string) $e->git->read('src/content/blog/medien-pfad.md');
    has($text, "Vor ![Foto](../../assets/img/$p) nach.");
    has($text, '![Team](../../assets/img/team.jpg "Titel")');
    has($text, '`uploads/x.jpg` bleibt');
    ok($e->git->read("src/assets/img/$p") !== null, 'staged image not carried');
});
test('a path that is no image of the library stays refused, and nothing else is rewritten', function () {
    eq(Rules::normalizeBodyImages('![a](uploads/nein.jpg)', static fn () => false), '![a](uploads/nein.jpg)');
    eq(Rules::normalizeBodyImages('![a](../../assets/img/a.jpg)', static fn () => true), '![a](../../assets/img/a.jpg)');
    eq(Rules::normalizeBodyImages('![a](/a.jpg)', static fn () => true), '![a](/a.jpg)');
    eq(Rules::normalizeBodyImages('![a](<a.jpg> "t") und [b](a.jpg)', static fn () => true), '![a](<../../assets/img/a.jpg> "t") und [b](a.jpg)');
    eq(Rules::normalizeBodyImages('ohne Bild', static fn () => true), 'ohne Bild');
});

test('an upload keeps its file name as a title to search by, not as a file name', function () use ($admin) {
    $r = $admin->upload(picture(40, 30), 'abnahme-hero Ü.png')['json']['files'][0];
    eq($r['title'], 'abnahme-hero Ü.png');
    ok(strpos($r['path'], 'abnahme') === false, 'random file name');
    $found = $admin->get('media', ['s' => 'ABNAHME'])['json']['images'];
    eq(array_column($found, 'path'), [$r['path']]);
    eq($found[0]['title'], 'abnahme-hero Ü.png');
    eq($admin->get('media/item', ['path' => $r['path']])['json']['image']['title'], 'abnahme-hero Ü.png');
});
test('saving the alt text keeps the title, deleting the image forgets both', function () use ($admin, $e) {
    $r = $admin->upload(picture(40, 30), 'bleibt.png')['json']['files'][0];
    eq($admin->post('media/meta', ['path' => $r['path'], 'alt' => 'Beschreibung'])['status'], 200);
    $i = $admin->get('media/item', ['path' => $r['path']])['json'];
    eq([$i['alt'], $i['image']['title']], ['Beschreibung', 'bleibt.png']);
    eq($admin->post('media/meta', ['path' => $r['path'], 'alt' => ''])['status'], 200);
    eq($admin->get('media/item', ['path' => $r['path']])['json']['image']['title'], 'bleibt.png');
    eq($admin->post('media/delete', ['path' => $r['path']])['status'], 200);
    ok(!isset($e->store->readJson('media.json', [])[$r['path']]), 'entry left');
});
test('a file name is reduced to a harmless title', function () {
    eq(Media::titleOf('C:\\Users\\x\\foto.jpg'), 'foto.jpg');
    eq(Media::titleOf('../../etc/passwd'), 'passwd');
    eq(Media::titleOf("a\x00b\n.jpg"), 'ab .jpg');
    eq(mb_strlen(Media::titleOf(str_repeat('ä', 300) . '.jpg')), 120);
});
test('a file over the limit gets a message that says what to do', function () {
    eq(Media::msgTooLarge(10 * 1048576), 'Datei zu groß (höchstens 10 MB). Bitte das Foto verkleinern und noch einmal hochladen.');
});
finish();
