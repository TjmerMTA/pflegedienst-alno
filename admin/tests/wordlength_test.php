<?php
// A single unbroken word in a heading, button or label does not fit a narrow screen.
declare(strict_types=1);
require_once __DIR__ . '/harness.php';

const LONG = 'Donaudampfschifffahrtsgesellschaftskapitän'; // 42

test('what counts as one word', function () {
    eq(Rules::longWord(LONG), LONG);
    eq(Rules::longWord('Die ' . LONG . ' fährt'), LONG);
    eq(Rules::longWord(str_repeat('a', 30)), null, 'exactly 30 is allowed');
    eq(Rules::longWord(str_repeat('ä', 31)), str_repeat('ä', 31), 'counted in characters, not bytes');
    eq(Rules::longWord('Pflegeversicherungsleistungen-Beratungsgesprächstermin'), null, 'a hyphen can break');
    eq(Rules::longWord("Pflegeversicherungsleistungen\u{AD}Beratungsgesprächstermin"), null, 'a soft hyphen can break');
    eq(Rules::longWord('Pflegeversicherungsleistungen/Beratungsgesprächstermin'), null);
    eq(Rules::longWord('Pflegeversicherungsleistungen–Beratungsgesprächstermin'), null);
    ok(Rules::longWord("Pflegeversicherungsleistungen\u{A0}Beratungsgesprächstermin") !== null, 'a no-break space cannot');
    ok(Rules::longWord("Pflegeversicherungsleistungen\u{2011}Beratungsgesprächstermin") !== null, 'a no-break hyphen cannot');
});
test('addresses and tokens are not words', function () {
    foreach (['https://example.org/ein/sehr-langer-pfad/mit_vielen_zeichen_ohne_jede_moeglichkeit', 'mailto:sehr.lange.adresse.ohne.ende@pflegedienst-alno.de', '/ein_sehr_langer_pfad_ohne_jede_moeglichkeit_zu_trennen/', 'sehr.lange.adresse.ohne.ende.und.mehr@pflegedienst-alno.de', '{{officeHoursAndAVeryLongTokenNameThatGoesOnAndOn}}'] as $ok) eq(Rules::longWord($ok), null, $ok);
});

$e = new Env();
$admin = $e->as('admin');
test('a page: refused with a clear German message, on the right field, and nothing is committed', function () use ($e, $admin) {
    $p = $admin->get('page', ['id' => 'index'])['json'];
    $head = $e->git->head();
    $r = $admin->post('page', ['id' => 'index', 'hash' => $p['hash'], 'values' => ['hero' => ['h1' => 'Gut ' . LONG]]]);
    eq($r['status'], 422, $r['body']);
    eq($r['json']['errors'][0]['path'], 'hero.h1');
    has($r['json']['errors'][0]['msg'], 'ist mit 42 Zeichen zu lang (höchstens 30)');
    has($r['json']['errors'][0]['msg'], 'Bindestrich');
    eq($e->git->head(), $head);
});
test('a page: inside a list too', function () use ($admin) {
    $p = $admin->get('page', ['id' => 'index'])['json'];
    $r = $admin->post('page', ['id' => 'index', 'hash' => $p['hash'], 'values' => ['hero' => ['trust' => [['text' => LONG]]]]]);
    eq($r['status'], 422, $r['body']);
    eq($r['json']['errors'][0]['path'], 'hero.trust[1].text');
});
test('longer text may hold such a word: it wraps there', function () use ($admin) {
    $p = $admin->get('page', ['id' => 'index'])['json'];
    $r = $admin->post('page', ['id' => 'index', 'hash' => $p['hash'], 'values' => ['seo' => ['description' => 'Eine ' . LONG . ' im Fließtext.']]]);
    eq($r['status'], 200, $r['body']);
});
test('a post: title and tags', function () use ($admin) {
    $d = $admin->get('entry', ['type' => 'post', 'id' => 'erster-beitrag'])['json'];
    $r = $admin->post('entry', ['type' => 'post', 'id' => 'erster-beitrag', 'hash' => $d['hash'], 'values' => ['title' => LONG] + $d['values'], 'body' => $d['body']]);
    eq($r['status'], 422, $r['body']);
    eq($r['json']['errors'][0]['path'], 'title');
    $r = $admin->post('entry', ['type' => 'post', 'id' => 'erster-beitrag', 'hash' => $d['hash'], 'values' => ['tags' => [LONG]] + $d['values'], 'body' => $d['body']]);
    eq($r['status'], 422, $r['body']);
    eq($r['json']['errors'][0]['path'], 'tags');
});
finish();
