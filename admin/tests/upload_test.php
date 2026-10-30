<?php
// Port of upload.test.mjs. Checks and re-encoding against Media directly, the rest over HTTP. GD is
// what runs here; the Imagick branch of Media is not exercised by any test (no Imagick installed).
declare(strict_types=1);
require_once __DIR__ . '/harness.php';

const LIMIT = 2097152;
$refused = static function (string $bytes, string $message, int $max = LIMIT): void {
    try {
        Media::process($bytes, $max);
    } catch (UploadError $x) {
        has($x->getMessage(), $message);
        return;
    }
    throw new RuntimeException("accepted, wanted: $message");
};

/** A chunk of a PNG file. */
function pngChunk(string $type, string $data): string
{
    return pack('N', strlen($data)) . $type . $data . pack('N', crc32($type . $data));
}

/** A valid PNG header claiming a size, without the pixels. */
function pngClaiming(int $w, int $h): string
{
    return "\x89PNG\r\n\x1A\n" . pngChunk('IHDR', pack('NNCCCCC', $w, $h, 8, 2, 0, 0, 0)) . pngChunk('IDAT', (string) gzcompress(str_repeat("\0", 100))) . pngChunk('IEND', '');
}

function webpChunk(string $type, string $data): string
{
    return $type . pack('V', strlen($data)) . $data . (strlen($data) % 2 ? "\0" : '');
}

/** An extended WebP with the animation flag: canvas 16x16, one frame chunk, $pad bytes before ANIM. */
function animatedWebp(int $pad = 0): string
{
    $body = webpChunk('VP8X', "\x02\0\0\0" . "\x0F\0\0" . "\x0F\0\0");
    if ($pad) $body .= webpChunk('ICCP', str_repeat('x', $pad));
    $body .= webpChunk('ANIM', "\0\0\0\0\0\0") . webpChunk('ANMF', str_repeat("\0", 32));
    return 'RIFF' . pack('V', strlen($body) + 4) . 'WEBP' . $body;
}

/** A JPEG with an APP1 Exif segment after the start marker. */
function withExif(string $jpeg, string $tiff): string
{
    $app1 = "Exif\0\0" . $tiff;
    return substr($jpeg, 0, 2) . "\xFF\xE1" . pack('n', strlen($app1) + 2) . $app1 . substr($jpeg, 2);
}

/** Little-endian TIFF with Orientation and Copyright. */
function tiff(int $orientation, string $copyright): string
{
    $text = $copyright . "\0";
    $offset = 8 + 2 + 2 * 12 + 4;
    return "II*\0" . pack('V', 8) . pack('v', 2)
        . pack('vvV', 0x0112, 3, 1) . pack('vv', $orientation, 0)
        . pack('vvVV', 0x8298, 2, strlen($text), $offset)
        . pack('V', 0) . $text;
}

$e = new Env();
$c = $e->as('redakteurin');

test('type is detected from content', function () {
    eq(Rules::sniffImage(img(10, 10, 'jpeg')), 'jpeg');
    eq(Rules::sniffImage(img(10, 10, 'png')), 'png');
    eq(Rules::sniffImage(img(10, 10, 'webp')), 'webp');
    eq(Rules::sniffImage('<?php echo 1; ?>xxxxxxxx'), null);
    eq(Rules::sniffImage('GIF89a..........'), null);
    eq(Rules::sniffImage('kurz'), null);
});

test('SVG, scripts and HTML are refused whatever they are called', function () use ($c, $refused) {
    $svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    $refused($svg, 'SVG');
    $refused('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>', 'SVG');
    $refused("  \n<SVG onload=alert(1)>", 'SVG');
    $refused('<?php system($_GET[0]); ?>aaaaaaaa', 'Nur JPG, PNG oder WebP');
    $refused('<html><script>1</script></html>', 'Nur JPG, PNG oder WebP');
    foreach (['x.jpg', 'x.png', 'x.svg', 'x.php'] as $name) {
        $r = $c->upload($svg, $name);
        eq($r['status'], 422, $name);
        eq($r['json']['files'], []);
        has($r['json']['errors'][0]['msg'], 'SVG');
        eq($r['json']['errors'][0]['file'], $name);
    }
});

test('a file with a JPEG header but no image is refused', function () use ($refused) {
    try {
        Media::process("\xFF\xD8\xFF\xE0" . str_repeat('nur text ', 10));
    } catch (UploadError $x) {
        ok(in_array($x->getMessage(), ['Die Datei ist kein lesbares Bild', 'Dateiinhalt passt nicht zum Bildformat'], true), $x->getMessage());
        return;
    }
    throw new RuntimeException('accepted');
});

test('a GIF named .jpg is refused; so is a PHP file with a JPEG start', function () use ($c, $refused) {
    $im = imagecreatetruecolor(4, 4);
    ob_start();
    imagegif($im);
    $gif = (string) ob_get_clean();
    $refused($gif, 'Nur JPG, PNG oder WebP');
    eq($c->upload($gif, 'bild.jpg')['status'], 422);
    eq($c->upload("\xFF\xD8\xFF\xE0<?php system('id'); ?>" . str_repeat('x', 100), 'a.php')['status'], 422);
});

test('polyglot: code after the image does not survive re-encoding', function () {
    foreach (['jpeg', 'png', 'webp'] as $f) {
        [$out] = Media::process(img(40, 40, $f) . '<?php system("id"); ?><script>alert(1)</script>');
        hasNot($out, '<?php', $f);
        hasNot($out, '<script>', $f);
    }
});

test('polyglot: code in an image comment does not survive either', function () {
    $good = img(40, 40);
    $comment = '<?php system("id"); ?>';
    [$out] = Media::process(substr($good, 0, 2) . "\xFF\xFE" . pack('n', strlen($comment) + 2) . $comment . substr($good, 2));
    hasNot($out, '<?php');
    $png = img(20, 20, 'png');
    [$out] = Media::process(substr($png, 0, 33) . pngChunk('tEXt', "Comment\0<?php evil(); ?>") . substr($png, 33));
    hasNot($out, '<?php');
});

test('longest side is limited, small images are not enlarged', function () {
    [, , $w, $h] = Media::process(img(3000, 1500));
    eq([$w, $h], [Rules::IMAGE_MAX_SIDE, 1200]);
    [, , $w, $h] = Media::process(img(1000, 4000));
    eq([$w, $h], [600, Rules::IMAGE_MAX_SIDE]);
    [, , $w, $h] = Media::process(img(100, 80));
    eq([$w, $h], [100, 80]);
    [$out] = Media::process(img(3000, 1500, 'png'));
    eq(array_slice(getimagesizefromstring($out), 0, 2), [Rules::IMAGE_MAX_SIDE, 1200], 'the bytes really are that size');
});

test('too many pixels are refused before anything is decoded', function () use ($c, $refused) {
    $refused(pngClaiming(7000, 7000), 'zu viele Pixel');
    $refused(pngClaiming(100000, 500), 'zu viele Pixel');
    eq($c->upload(pngClaiming(7000, 7000), 'gross.png')['status'], 422);
});

test('animated WebP is refused', function () use ($c, $refused) {
    $refused(animatedWebp(), 'Animierte Bilder');
    eq($c->upload(animatedWebp(), 'a.webp')['status'], 422);
});

test('animated WebP is refused when the ANIM chunk comes late too', function () use ($refused) {
    $refused(animatedWebp(5000), 'Animierte Bilder');
});

test('metadata (EXIF, GPS) is removed', function () {
    $in = withExif(img(30, 30), tiff(1, 'GEHEIM-EXIF'));
    has($in, 'GEHEIM-EXIF');
    if (function_exists('exif_read_data')) eq(exif_read_data('data://image/jpeg;base64,' . base64_encode($in))['Copyright'] ?? null, 'GEHEIM-EXIF', 'the test image really has EXIF');
    [$out] = Media::process($in);
    hasNot($out, 'GEHEIM-EXIF');
    hasNot($out, 'Exif');
});

test('EXIF orientation is applied before it is removed', function () {
    if (!function_exists('exif_read_data')) throw new Skip('no exif extension');
    [, , $w, $h] = Media::process(withExif(img(40, 20), tiff(6, 'x')));
    eq([$w, $h], [20, 40]);
    [, , $w, $h] = Media::process(withExif(img(40, 20), tiff(3, 'x')));
    eq([$w, $h], [40, 20]);
});

test('transparency survives', function () {
    $im = imagecreatetruecolor(8, 8);
    imagealphablending($im, false);
    imagesavealpha($im, true);
    imagefill($im, 0, 0, (int) imagecolorallocatealpha($im, 10, 20, 30, 127));
    ob_start();
    imagepng($im);
    [$out] = Media::process((string) ob_get_clean());
    $back = imagecreatefromstring($out);
    eq((imagecolorat($back, 3, 3) >> 24) & 0x7F, 127);
});

test('size limit', function () use ($c, $e, $refused) {
    $refused(str_repeat("\xff", LIMIT + 1), 'zu groß', LIMIT);
    $refused('', 'Leere Datei');
    $max = $c->get('session')['json']['uploadMaxBytes'];
    eq($max, LIMIT, 'php -S here allows 2 MB');
    $r = $c->upload(str_repeat("\xff", LIMIT + 200 * 1024), 'gross.jpg');
    eq($r['status'], 422, $r['body']);
    has($r['json']['errors'][0]['msg'], 'Datei zu groß (höchstens 2 MB)');
    $over = $c->upload(str_repeat("\xff", 9 * 1048576), 'riesig.jpg');
    eq($over['status'], 413, $over['body']);
    eq($c->get('dashboard')['status'], 200, 'the server keeps working');
});

test('an upload without a file', function () use ($c) {
    $r = $c->raw('POST', '/wp-admin/api.php?r=media/upload', "--b\r\nContent-Disposition: form-data; name=\"x\"\r\n\r\ny\r\n--b--\r\n", ['Content-Type: multipart/form-data; boundary=b', 'X-WP-Nonce: ' . $c->nonce]);
    eq($r['status'], 422, $r['body']);
    eq($r['json']['errors'][0]['msg'], 'Leere Datei');
});

test('random names; the uploaded name is never used', function () use ($c, $e) {
    $a = Media::randomName('jpg');
    ok($a !== Media::randomName('jpg'));
    ok(preg_match('/^[0-9a-f]{16}\.jpg$/D', $a) === 1, $a);
    foreach (['../../../../evil.jpg', 'sehr geheim.jpg', 'x.php.jpg', '<script>.jpg'] as $name) {
        $r = $c->upload(img(20, 20), $name);
        eq($r['status'], 200, $r['body']);
        $p = $r['json']['files'][0]['path'];
        ok(preg_match('/^uploads\/[0-9a-f]{16}\.jpg$/D', $p) === 1, $p);
        ok($e->git->read("src/assets/img/$p") !== null, $p);
    }
    ok(!is_file(dirname($e->data) . '/evil.jpg'));
});

test('the extension follows the content, not the name', function () use ($c) {
    ok(str_ends_with($c->upload(img(20, 20, 'png'), 'bild.jpg')['json']['files'][0]['path'], '.png'));
    ok(str_ends_with($c->upload(img(20, 20, 'webp'), 'bild.png')['json']['files'][0]['path'], '.webp'));
});

test('an upload lands in the library, in git, and reports its size', function () use ($c, $e) {
    $r = $c->upload(img(30, 20), 'neu.jpg');
    $f = $r['json']['files'][0];
    eq([$f['width'], $f['height']], [30, 20]);
    ok(in_array($f['path'], array_column($c->get('media')['json']['images'], 'path'), true));
    $commit = $e->git->commit($e->git->head());
    eq($commit['author']['name'], 'redakteurin');
    has($commit['message'], 'Admin: Bild hochgeladen');
    eq($c->get('media/item', ['path' => $f['path']])['status'], 200);
    has($e->log(), '"event":"upload"');
});

test('the library sees uploads after a reload, and searches by name', function () use ($c) {
    $r = $c->get('media', ['s' => 'hero']);
    eq(array_column($r['json']['images'], 'path'), ['hero/start.jpg']);
    eq($r['json']['images'][0]['pending'], false);
});

test('a media file is served as an image, thumbnails as JPEG', function () use ($c) {
    $r = $c->get('media/file', ['path' => 'team.jpg']);
    eq($r['headers']['content-type'][0], 'image/jpeg');
    eq($r['headers']['x-content-type-options'][0], 'nosniff');
    has($r['headers']['cache-control'][0], 'private');
    $r = $c->get('media/file', ['path' => 'logo-mark.png']);
    eq($r['headers']['content-type'][0], 'image/png');
    $t = $c->get('media/file', ['path' => 'logo-mark.png', 'thumb' => 1]);
    eq($t['headers']['content-type'][0], 'image/jpeg');
    eq(array_slice(getimagesizefromstring($t['body']), 0, 2), [360, 360]);
});

test('alt texts live in the library, cleaned and limited', function () use ($c, $e) {
    eq($c->post('media/meta', ['path' => 'team.jpg', 'alt' => "  Unser\nTeam  "])['status'], 200);
    $item = $c->get('media/item', ['path' => 'team.jpg'])['json'];
    eq($item['alt'], 'Unser Team');
    $images = array_column($c->get('media')['json']['images'], null, 'path');
    eq($images['team.jpg']['alt'], 'Unser Team');
    $c->post('media/meta', ['path' => 'team.jpg', 'alt' => str_repeat('x', 400)]);
    eq(mb_strlen($c->get('media/item', ['path' => 'team.jpg'])['json']['alt']), Rules::ALT_MAX);
    $c->post('media/meta', ['path' => 'team.jpg', 'alt' => '']);
    eq($c->get('media/item', ['path' => 'team.jpg'])['json']['alt'], '');
    ok(!isset(((array) $e->store->readJson('media.json'))['team.jpg']));
});

test('text from a user comes back as a JSON string, for the client to escape', function () use ($c) {
    $evil = '"><img src=x onerror=alert(1)>';
    $c->post('media/meta', ['path' => 'team.jpg', 'alt' => $evil]);
    $r = $c->get('media/item', ['path' => 'team.jpg']);
    eq($r['json']['alt'], $evil);
    has($r['headers']['content-type'][0], 'application/json');
    $c->post('media/meta', ['path' => 'team.jpg', 'alt' => '']);
});

test('«verwendet auf» lists pages, list items, collection entries', function () use ($c) {
    $used = $c->get('media/item', ['path' => 'team.jpg'])['json']['usedOn'];
    $titles = array_column($used, 'title');
    foreach (['Startseite', 'Erika Beispiel', 'Erster Beitrag: ein Test'] as $t) ok(in_array($t, $titles, true), $t . ' in ' . show($titles));
    ok(in_array('Karten › Karte 1', array_column($used, 'where'), true), show($used));
    $edit = array_column($used, 'edit');
    ok(in_array(['type' => 'team', 'id' => 'erika-beispiel'], $edit, true), show($edit));
});

test('«verwendet auf» lists the site\'s code', function () use ($c) {
    $used = $c->get('media/item', ['path' => 'logo-mark.png'])['json']['usedOn'];
    eq($used, [['title' => 'Website-Code', 'where' => 'src/components/Logo.astro', 'alt' => '', 'edit' => null]]);
});

test('«verwendet auf» finds an image inside the text of an entry', function () use ($c, $e) {
    $e->git->push(['src/content/blog/erster-beitrag.md' => (string) $e->git->read('src/content/blog/erster-beitrag.md') . "\n![x](../../assets/img/unbenutzt.webp)\n"], 'Bild im Text');
    $used = $c->get('media/item', ['path' => 'unbenutzt.webp'])['json']['usedOn'];
    eq(array_column($used, 'where'), ['Text']);
    eq($c->post('media/delete', ['path' => 'unbenutzt.webp'])['status'], 409);
    $e->git->push(['src/content/blog/erster-beitrag.md' => str_replace("\n![x](../../assets/img/unbenutzt.webp)\n", '', (string) $e->git->read('src/content/blog/erster-beitrag.md'))], 'Bild raus');
});

test('images in use and images imported by site code cannot be deleted', function () use ($c, $e) {
    $head = $e->git->head();
    eq($c->post('media/delete', ['path' => 'team.jpg'])['status'], 409);
    eq($c->post('media/delete', ['path' => 'team.jpg'])['json']['error'], 'in_use');
    eq($c->post('media/delete', ['path' => 'logo-mark.png'])['status'], 409);
    eq($e->git->head(), $head);
    ok($e->git->read('src/assets/img/logo-mark.png') !== null);
});

test('deleting an unused image commits without a build and keeps a copy in the data folder', function () use ($c, $e) {
    $runs = count($e->git->runs());
    $bytes = (string) $e->git->read('src/assets/img/unbenutzt.webp');
    $r = $c->post('media/delete', ['path' => 'unbenutzt.webp']);
    eq($r['status'], 200, $r['body']);
    eq($e->git->read('src/assets/img/unbenutzt.webp'), null);
    has($e->git->commit($e->git->head())['message'], '[skip ci]');
    eq(count($e->git->runs()), $runs);
    $kept = glob("$e->data/trash/media/*unbenutzt.webp");
    eq(count($kept), 1);
    eq((string) file_get_contents($kept[0]), $bytes);
    eq($c->post('media/delete', ['path' => 'unbenutzt.webp'])['status'], 404, 'gone');
});
test('every EXIF orientation is applied, mirrored ones too', function () {
    // Red top-left on a blue image, as the camera stored it. Where red must end up after turning it upright:
    $where = [1 => 'tl', 2 => 'tr', 3 => 'br', 4 => 'bl', 5 => 'tl', 6 => 'tr', 7 => 'br', 8 => 'bl'];
    foreach ($where as $orientation => $corner) {
        $im = imagecreatetruecolor(80, 40);
        imagefill($im, 0, 0, imagecolorallocate($im, 0, 0, 255));
        imagefilledrectangle($im, 0, 0, 19, 19, imagecolorallocate($im, 255, 0, 0));
        ob_start();
        imagejpeg($im, null, 95);
        $jpeg = (string) ob_get_clean();
        [$out, , $w, $h] = Media::process(withExif($jpeg, tiff($orientation, 'x')));
        eq([$w, $h], $orientation >= 5 ? [40, 80] : [80, 40], "size of orientation $orientation");
        $res = imagecreatefromstring($out);
        $points = ['tl' => [5, 5], 'tr' => [$w - 6, 5], 'bl' => [5, $h - 6], 'br' => [$w - 6, $h - 6]];
        $red = [];
        foreach ($points as $name => [$x, $y]) {
            $c = imagecolorsforindex($res, imagecolorat($res, $x, $y));
            if ($c['red'] > 180 && $c['blue'] < 90) $red[] = $name;
        }
        eq($red, [$corner], "orientation $orientation");
    }
});

finish();
