<?php
// Port of pages.test.mjs: page and collection rules against Rules directly. Lists are arrays here:
// the browser sends JSON, not form fields with made-up keys.
declare(strict_types=1);
require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/../public/wp-admin/lib/Rules.php';
require_once __DIR__ . '/../public/wp-admin/lib/Frontmatter.php';
require_once __DIR__ . '/../public/wp-admin/lib/Store.php';
require_once __DIR__ . '/../public/wp-admin/lib/GitHub.php';
require_once __DIR__ . '/../public/wp-admin/lib/Site.php';

function load(string $id): array
{
    return json_decode((string) file_get_contents(__DIR__ . "/fixtures/site/src/content/pages/$id.json"), true);
}

function coll(string $key): array
{
    return json_decode((string) file_get_contents(__DIR__ . '/../public/wp-admin/schema/collections.json'), true)[$key];
}

$ctx = ['imageExists' => static fn ($p) => in_array($p, ['hero/start.jpg', 'team.jpg'], true)];
$apply = static fn (array $page, array $input, ?array $c = null) => Rules::applyPageValues($page, $input, $c ?? $ctx);
$msgs = static fn (array $r) => implode("\n", array_map(static fn ($e) => "{$e['path']}: {$e['msg']}", $r['errors']));
$form = static fn (string $key, array $old, array $input) => Rules::applyEntryValues(coll($key), $old, $input, $ctx);

test('fixture pages satisfy the contract', function () use ($ctx) {
    foreach (['index', 'ueber-uns', '_global'] as $id) {
        eq(Rules::checkStructure(load($id)), [], $id);
        eq(Rules::validatePageValues(load($id), $ctx), [], $id);
    }
});

test('values change, structure does not', function () use ($apply) {
    $page = load('index');
    $r = $apply($page, ['hero' => ['h1' => 'Neu']]);
    eq($r['errors'], []);
    eq($r['page']['groups'][1]['fields'][1]['value'], 'Neu');
    eq(Rules::structureOf($r['page']), Rules::structureOf($page));
    eq($page['groups'][1]['fields'][1]['value'], 'Gut versorgt zu Hause –', 'input untouched');
});

test('unknown groups and fields are rejected', function () use ($apply, $msgs) {
    $page = load('index');
    has($msgs($apply($page, ['neu' => ['a' => 'x']])), 'unbekannte Gruppe');
    has($msgs($apply($page, ['hero' => ['neu' => 'x']])), 'unbekanntes Feld');
    has($msgs($apply($page, ['hero' => ['trust' => [['text' => 'x', 'neu' => 'y']]]])), 'unbekanntes Feld');
    has($msgs($apply($page, ['__proto__' => ['x' => '1']])), 'unbekannte Gruppe');
});

test('a client cannot change label, type or max through the values', function () use ($apply) {
    $r = $apply(load('index'), ['seo' => ['title' => ['label' => 'x', 'type' => 'richtext', 'max' => 9999, 'value' => 'y']]]);
    ok($r['errors']);
    eq($r['page']['groups'][0]['fields'][0]['type'], 'text');
    eq($r['page']['groups'][0]['fields'][0]['max'], 70);
});

test('required and max are enforced by characters, not bytes', function () use ($apply, $msgs) {
    $page = load('index');
    has($msgs($apply($page, ['seo' => ['title' => '']])), 'seo.title: Pflichtfeld');
    has($msgs($apply($page, ['seo' => ['title' => '   ']])), 'Pflichtfeld');
    eq($msgs($apply($page, ['seo' => ['title' => str_repeat('ü', 70)]])), '');
    has($msgs($apply($page, ['seo' => ['title' => str_repeat('ü', 71)]])), 'höchstens 70 Zeichen (jetzt 71)');
});

test('text and textarea take no HTML', function () use ($apply, $msgs) {
    $page = load('index');
    has($msgs($apply($page, ['hero' => ['pill' => '<b>x</b>']])), 'HTML ist hier nicht erlaubt');
    has($msgs($apply($page, ['seo' => ['description' => 'a <script>b']])), 'HTML');
    eq($msgs($apply($page, ['hero' => ['pill' => 'Preis < 5 €']])), '');
});

test('text is one line; textarea keeps line breaks', function () use ($apply) {
    $r = $apply(load('index'), ['hero' => ['pill' => "a\nb"], 'seo' => ['description' => "x\r\ny"]]);
    eq($r['page']['groups'][1]['fields'][0]['value'], 'a b');
    eq($r['page']['groups'][0]['fields'][1]['value'], "x\ny");
});

test('richtext is sanitised on save', function () use ($apply) {
    $r = $apply(load('index'), ['hero' => ['lead' => '<p onclick="x">a<script>b</script></p><img src=x>']]);
    eq($r['errors'], []);
    eq($r['page']['groups'][1]['fields'][3]['value'], '<p>a</p>');
});

test('tokens survive saving', function () use ($apply) {
    $r = $apply(load('index'), ['hero' => ['lead' => '<p>Tel {{phone}}</p>', 'pill' => 'Ruf {{phone}}']]);
    eq($r['errors'], []);
    eq($r['page']['groups'][1]['fields'][3]['value'], '<p>Tel {{phone}}</p>');
});

test('image fields need a library path and an alt text', function () use ($apply, $msgs) {
    $page = load('index');
    eq($msgs($apply($page, ['hero' => ['image' => ['value' => 'team.jpg', 'alt' => 'x']]])), '');
    has($msgs($apply($page, ['hero' => ['image' => ['value' => 'team.jpg', 'alt' => ' ']]])), 'Alternativtext fehlt');
    has($msgs($apply($page, ['hero' => ['image' => ['value' => 'fehlt.jpg', 'alt' => 'x']]])), 'nicht gefunden');
    foreach (['../secret.jpg', '/etc/passwd.jpg', 'a/../../b.jpg', '.hidden.jpg', 'x.svg', 'x.php', 'a\\b.jpg'] as $bad) {
        has($msgs($apply($page, ['hero' => ['image' => ['value' => $bad, 'alt' => 'x']]])), 'ungültiger Bildpfad', $bad);
    }
});

test('lists keep submitted order and respect min/max', function () use ($apply, $msgs) {
    $page = load('index');
    $r = $apply($page, ['hero' => ['trust' => [['text' => 'zwei'], ['text' => 'eins']]]]);
    eq($r['errors'], []);
    eq($r['page']['groups'][1]['fields'][5]['value'], [['text' => 'zwei'], ['text' => 'eins']]);
    has($msgs($apply($page, ['hero' => ['trust' => []]])), 'mindestens 1 Einträge');
    $five = array_map(static fn ($i) => ['text' => "t$i"], range(1, 5));
    has($msgs($apply($page, ['hero' => ['trust' => $five]])), 'höchstens 4 Einträge');
});

test('a list must be an array: an object with keys is refused', function () use ($apply, $msgs) {
    has($msgs($apply(load('index'), ['hero' => ['trust' => ['a' => ['text' => 'x']]]])), 'hero.trust: ungültige Liste');
    has($msgs($apply(load('index'), ['hero' => ['trust' => 'x']])), 'ungültige Liste');
    has($msgs($apply(load('index'), ['hero' => ['trust' => ['x']]])), 'hero.trust[1]: ungültiger Eintrag');
});

test('sub-fields are validated with their item number', function () use ($apply, $msgs) {
    $m = $msgs($apply(load('index'), ['cards' => ['items' => [['title' => '', 'text' => str_repeat('x', 121), 'photo' => ['value' => '', 'alt' => '']]]]]));
    has($m, 'cards.items[1].title: Pflichtfeld');
    has($m, 'cards.items[1].text: höchstens 120');
});

test('an image sub-field is stored as {value, alt}', function () use ($apply) {
    $r = $apply(load('index'), ['cards' => ['items' => [['title' => 'T', 'text' => '', 'photo' => ['value' => 'team.jpg', 'alt' => 'Alt', 'extra' => 'weg']]]]]);
    eq($r['errors'], []);
    eq($r['page']['groups'][2]['fields'][0]['value'], [['title' => 'T', 'text' => '', 'photo' => ['value' => 'team.jpg', 'alt' => 'Alt']]]);
    $empty = $apply(load('index'), ['cards' => ['items' => [['title' => 'T', 'text' => '', 'photo' => ['value' => '', 'alt' => '']]]]]);
    eq($empty['errors'], [], 'an optional image may stay empty');
    eq($empty['page']['groups'][2]['fields'][0]['value'][0]['photo'], ['value' => '', 'alt' => '']);
});

test('an image sub-field needs a valid path and an alt text', function () use ($apply, $msgs) {
    $item = static fn ($photo) => ['cards' => ['items' => [['title' => 'T', 'text' => '', 'photo' => $photo]]]];
    has($msgs($apply(load('index'), $item(['value' => 'team.jpg', 'alt' => '']))), 'cards.items[1].photo: Alternativtext fehlt');
    has($msgs($apply(load('index'), $item(['value' => '../x.jpg', 'alt' => 'a']))), 'ungültiger Bildpfad');
    has($msgs($apply(load('index'), $item(['value' => 'fehlt.jpg', 'alt' => 'a']))), 'nicht gefunden');
});

test('no image means value "" with alt "", top-level and in lists', function () use ($apply) {
    $top = $apply(load('index'), ['hero' => ['image' => ['value' => '', 'alt' => 'steht noch im Formular']]]);
    eq($top['errors'], []);
    eq($top['page']['groups'][1]['fields'][4]['value'], '');
    eq($top['page']['groups'][1]['fields'][4]['alt'], '');
    $list = $apply(load('index'), ['cards' => ['items' => [['title' => 'T', 'text' => '', 'photo' => ['value' => '', 'alt' => 'alt']]]]]);
    eq($list['errors'], []);
    eq($list['page']['groups'][2]['fields'][0]['value'][0]['photo'], ['value' => '', 'alt' => '']);
});

test('a set image needs a non-empty alt: the message says so and names the item', function () use ($apply) {
    $top = $apply(load('index'), ['hero' => ['image' => ['value' => 'team.jpg', 'alt' => '   ']]]);
    eq(count($top['errors']), 1);
    eq($top['errors'][0]['label'], 'Bild');
    eq($top['errors'][0]['msg'], Rules::MSG_ALT_REQUIRED);
    has(Rules::MSG_ALT_REQUIRED, 'Ist ein Bild gesetzt, muss der Alternativtext ausgefüllt sein');
    $items = [['title' => 'A', 'text' => '', 'photo' => ['value' => '', 'alt' => '']], ['title' => 'B', 'text' => '', 'photo' => ['value' => 'team.jpg', 'alt' => '']]];
    $list = $apply(load('index'), ['cards' => ['items' => $items]]);
    eq(count($list['errors']), 1);
    eq($list['errors'][0]['path'], 'cards.items[2].photo');
    eq($list['errors'][0]['label'], 'Karte 2 › Bild');
});

test('restoring a version with an old alt on an empty image clears the alt', function () {
    $old = load('index');
    $old['groups'][1]['fields'][4]['value'] = '';
    $old['groups'][1]['fields'][4]['alt'] = 'alt';
    $old['groups'][2]['fields'][0]['value'][0]['photo'] = ['value' => '', 'alt' => 'alt'];
    $m = Site::mergeOldValues(load('index'), $old);
    eq($m['groups'][1]['fields'][4]['alt'], '');
    eq($m['groups'][2]['fields'][0]['value'][0]['photo'], ['value' => '', 'alt' => '']);
});

test('restoring a revision keeps list images as {value, alt}', function () {
    $m = Site::mergeOldValues(load('index'), load('index'));
    eq($m['groups'][2]['fields'][0]['value'][0]['photo'], ['value' => 'team.jpg', 'alt' => 'Team auf einem Bild']);
});

test('finding 1: the four values that formed a script across fields are refused', function () use ($apply) {
    $r = $apply(load('_global'), ['contact' => ['phone' => 'ALNO GmbH</script a', 'email' => '+49 231 5467686>', 'hours' => '<img src=x onerror=x a', 'officeHours' => 'info@example.org>']]);
    eq(count($r['errors']), 4);
    foreach ($r['errors'] as $e) eq($e['msg'], Rules::MSG_NO_ANGLE);
});

test('contact group: no < or > at all, in textareas and list items too', function () use ($apply, $msgs) {
    $g = load('_global');
    has($msgs($apply($g, ['contact' => ['hours' => '8 < 22']])), 'Die Zeichen < und > sind');
    has($msgs($apply($g, ['contact' => ['hours' => '8 > 2']])), 'Die Zeichen < und > sind');
    has($msgs($apply($g, ['contact' => ['officeHours' => "Mo\n<Di"]])), 'Die Zeichen < und > sind');
    $list = $apply($g, ['contact' => ['hoursList' => [['time' => '9>']]]]);
    eq($list['errors'][0]['path'], 'contact.hoursList[1].time');
    eq($list['errors'][0]['msg'], Rules::MSG_NO_ANGLE);
    eq($msgs($apply($g, ['contact' => ['hours' => '8–22 Uhr', 'phone' => '+49 (0) 231 12']])), '');
});

test('other groups keep a harmless < but refuse an opened tag', function () use ($apply, $msgs) {
    $page = load('index');
    eq($msgs($apply($page, ['hero' => ['pill' => 'Preis < 5 €']])), '');
    has($msgs($apply($page, ['hero' => ['pill' => 'x</script a']])), 'HTML ist hier nicht erlaubt');
    has($msgs($apply($page, ['hero' => ['trust' => [['text' => '<img src=x a']]]])), 'hero.trust[1].text: HTML ist hier nicht erlaubt');
});

test('restoring an old version cannot bring < or > back into contact', function () use ($ctx) {
    $old = load('_global');
    $old['groups'][0]['fields'][0]['value'] = 'a</script b';
    $errors = Rules::validatePageValues(Site::mergeOldValues(load('_global'), $old), $ctx);
    ok(in_array(Rules::MSG_NO_ANGLE, array_column($errors, 'msg'), true));
});

test('richtext length is limited', function () use ($apply, $msgs) {
    eq($msgs($apply(load('index'), ['hero' => ['lead' => '<p>' . str_repeat('a', Rules::RICHTEXT_MAX - 7) . '</p>']])), '');
    $long = '<p>' . str_repeat('a', Rules::RICHTEXT_MAX) . '</p>';
    has($msgs($apply(load('index'), ['hero' => ['lead' => $long]])), 'hero.lead: höchstens 50000 Zeichen (jetzt 50007)');
});

test('tokens may have spaces inside, as on the site', function () use ($apply, $msgs, $ctx) {
    $c = $ctx + ['tokens' => ['phone', 'hours']];
    eq($msgs($apply(load('index'), ['hero' => ['pill' => 'Tel {{ phone }}']], $c)), '');
    has($msgs($apply(load('index'), ['hero' => ['pill' => 'Tel {{ fax }}']], $c)), 'unbekannter Platzhalter');
});

test('collections: an opened tag is refused in frontmatter text, the body has a length limit', function () use ($form) {
    $r = $form('blog', [], ['title' => 'x</script a', 'description' => 'D', 'date' => '2026-01-01']);
    has(implode(',', array_column($r['errors'], 'msg')), 'HTML ist hier nicht erlaubt');
    $b = $form('blog', [], ['title' => 'T', 'description' => 'D', 'date' => '2026-01-01', 'body' => str_repeat('a', Rules::BODY_MAX + 1)]);
    eq($b['errors'][0]['path'], 'body');
    has($b['errors'][0]['msg'], 'höchstens 200000 Zeichen');
    eq($form('blog', [], ['title' => 'T', 'description' => 'D', 'date' => '2026-01-01', 'body' => str_repeat('a', Rules::BODY_MAX)])['errors'], []);
});

test('broken structures are detected', function () {
    ok(Rules::checkStructure(['label' => 'x']));
    ok(Rules::checkStructure(['label' => 'x', 'groups' => [['id' => 'a', 'fields' => [['id' => 'b', 'type' => 'video']]]]]));
    ok(Rules::checkStructure(['label' => 'x', 'groups' => [['id' => 'a', 'fields' => [['id' => 'b', 'type' => 'text'], ['id' => 'b', 'type' => 'text']]]]]));
    ok(Rules::checkStructure(['label' => 'x', 'groups' => [['id' => 'a', 'fields' => [['id' => 'l', 'type' => 'list', 'fields' => [['id' => 'n', 'type' => 'list', 'fields' => []]]]]]]]), 'no nested lists');
});

test('old values are poured into the current structure', function () {
    $current = load('index');
    $old = load('index');
    $old['groups'][1]['fields'][1]['value'] = 'Alt';
    $old['groups'][1]['fields'][] = ['id' => 'weg', 'label' => 'Weg', 'type' => 'text', 'value' => 'x'];
    $current['groups'][1]['fields'][0]['label'] = 'Neue Beschriftung';
    $m = Site::mergeOldValues($current, $old);
    eq($m['groups'][1]['fields'][1]['value'], 'Alt');
    eq($m['groups'][1]['fields'][0]['label'], 'Neue Beschriftung');
    ok(!in_array('weg', array_column($m['groups'][1]['fields'], 'id'), true));
});

test('pages read as lines by field', function () {
    $lines = explode("\n", Site::pageLines(load('index')));
    foreach (['Erster Bildschirm › Überschrift (H1): Gut versorgt zu Hause –', 'Erster Bildschirm › Bild: hero/start.jpg (Alt: Testbild Startseite)', 'Erster Bildschirm › Punkt 2 › Text: Telefon {{hours}}', 'Karten › Karte 1 › Bild: team.jpg (Alt: Team auf einem Bild)'] as $l) {
        ok(in_array($l, $lines, true), $l);
    }
});

test('image references and tokens are found', function () {
    eq(array_column(Site::pageImageRefs(load('index')), 'path'), ['hero/start.jpg', 'team.jpg']);
    eq(Site::tokenKeys(load('_global')), ['phone', 'email', 'hours', 'officeHours']);
});

test('collections: required, max, dates, numbers, images', function () use ($form) {
    $r = $form('blog', [], ['title' => '', 'description' => str_repeat('x', 171), 'date' => '2026-02-31', 'image' => ['value' => 'team.jpg', 'alt' => '']]);
    $m = implode("\n", array_map(static fn ($e) => "{$e['path']}: {$e['msg']}", $r['errors']));
    has($m, 'title: Pflichtfeld');
    has($m, 'description: höchstens 170');
    has($m, 'date: ungültiges Datum');
    has($m, 'imageAlt: Alternativtext fehlt');
    has(implode(',', array_column($form('team', [], ['name' => 'N', 'role' => 'R', 'order' => 'abc'])['errors'], 'msg')), 'keine Zahl');
    $l = $form('leistungen', [], ['title' => 'a', 'metaTitle' => 'b', 'description' => 'c', 'teaser' => 'd', 'icon' => 'virus', 'order' => '1', 'payer' => 'e', 'highlights' => []]);
    $lm = implode(',', array_column($l['errors'], 'msg'));
    has($lm, 'ungültige Auswahl');
    has($lm, 'mindestens ein Eintrag');
});

test('collections: unknown frontmatter keys and key order are kept', function () use ($form) {
    $r = $form('team', [['name', 'A'], ['custom', 'bleibt'], ['role', 'B']], ['name' => 'A2', 'role' => 'B', 'hidden' => true]);
    eq($r['errors'], []);
    eq($r['entries'], [['name', 'A2'], ['custom', 'bleibt'], ['role', 'B'], ['hidden', true]]);
});

test('collections: image goes in as a path relative to the .md file', function () use ($form) {
    $map = [];
    foreach ($form('team', [], ['name' => 'A', 'role' => 'B', 'photo' => ['value' => 'team.jpg']])['entries'] as [$k, $v]) $map[$k] = $v;
    eq($map['photo'], '../../assets/img/team.jpg');
});

test('collections: raw HTML in the body is escaped, not stored as HTML', function () use ($form) {
    $r = $form('blog', [], ['title' => 'T', 'description' => 'D', 'date' => '2026-01-01', 'body' => "a <iframe src=x></iframe> b\n"]);
    eq($r['body'], 'a &lt;iframe src=x>&lt;/iframe> b');
});

test('collections: a body with an unsafe link is refused', function () use ($form) {
    $r = $form('blog', [], ['title' => 'T', 'description' => 'D', 'date' => '2026-01-01', 'body' => '[x](javascript:alert(1))']);
    eq(array_column($r['errors'], 'msg'), [Rules::MSG_UNSAFE_LINK]);
});

test('isImagePath accepts only clean relative image paths', function () {
    eq(Rules::isImagePath('team.jpg'), true);
    eq(Rules::isImagePath('uploads/ab12.webp'), true);
    foreach (['../team.jpg', 'a/../team.jpg', '/team.jpg', 'team.svg', 'team.jpg.php', '.team.jpg', 'a//b.jpg', 'a\\b.jpg', '', "a\0.jpg", 5, null] as $bad) eq(Rules::isImagePath($bad), false, (string) $bad);
});

test('slugs cannot carry a path', function () {
    eq(Rules::slugify('../../etc/passwd'), 'etc-passwd');
    eq(Rules::slugify('Über Größe'), 'ueber-groesse');
    eq(preg_match(Rules::SLUG_RE, 'a/b'), 0);
    eq(preg_match(Rules::SLUG_RE, "abc\n"), 0);
});
finish();
