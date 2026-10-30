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
test('Telefon international is optional, and if set it is international', function () use ($contact) {
    eq($contact('phoneIntl', ''), []);
    eq($contact('phoneIntl', '+49 231 5467686'), []);
    eq($contact('phoneIntl', '0231 5467686')[0]['msg'] ?? '', Rules::MSG_BAD_PHONE_INTL);
    eq($contact('phoneIntl', '+49 ruft zurück')[0]['msg'] ?? '', Rules::MSG_BAD_PHONE_INTL);
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
finish();
