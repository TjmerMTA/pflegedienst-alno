<?php
// What the browser client relies on: the shape of the JSON and the limits, over HTTP.
declare(strict_types=1);
require_once __DIR__ . '/harness.php';

const INDEX = 'src/content/pages/index.json';
$e = new Env();
$c = $e->as('redakteurin');
$field = static fn (array $page, string $g, string $f) => array_column(array_column($page['groups'], null, 'id')[$g]['fields'], null, 'id')[$f];
$unchanged = function (callable $fn) use ($e): array {
    $head = $e->git->head();
    $r = $fn();
    eq($e->git->head(), $head, 'nothing committed');
    return $r;
};

test('session: what the client starts from', function () use ($c) {
    $s = $c->get('session')['json'];
    eq(array_keys($s), ['user', 'lang', 'admin', 'anfragen', 'nonce', 'siteUrl', 'actionsUrl', 'uploadMaxBytes', 'pages', 'status', 'newAnfragen']);
    eq($s['user'], 'redakteurin');
    eq($s['siteUrl'], 'https://pflegedienst-alno.de');
    eq($s['actionsUrl'], 'https://github.com/' . GitHub::REPO . '/actions');
    eq(array_keys($s['pages'][0]), ['id', 'label']);
});

test('pages: sorted, _global last', function () use ($c) {
    $ids = array_column($c->get('pages')['json']['pages'], 'id');
    eq(end($ids), '_global');
    eq($ids[0], 'index');
});

test('page: the file as it is, its hash, its revisions, the tokens', function () use ($c, $e) {
    $p = $c->get('page', ['id' => 'index'])['json'];
    eq($p['id'], 'index');
    eq($p['hash'], $e->git->files()[INDEX]);
    eq($p['page'], json_decode((string) $e->git->read(INDEX), true));
    eq($p['tokens'], ['phone', 'email', 'hours', 'officeHours']);
    eq($p['structureErrors'], []);
    eq($p['revisions'], 1);
});

test('list values are arrays in the file and in the answer', function () use ($c, $field) {
    $p = $c->get('page', ['id' => 'index'])['json']['page'];
    $trust = $field($p, 'hero', 'trust')['value'];
    ok(is_array($trust) && array_is_list($trust));
    eq($trust[0], ['text' => 'Alle Kassen']);
});

test('an empty list stays [] in JSON', function () use ($c, $e) {
    $r = savePage($c, 'index', function (array &$v) { $v['cards']['items'] = []; });
    eq($r['status'], 200, $r['body']);
    has((string) $e->git->read(INDEX), '"value": []');
    $raw = $c->get('page', ['id' => 'index'])['body'];
    has($raw, '"value":[]');
    eq(savePage($c, 'index', function (array &$v) { $v['cards']['items'] = [['title' => 'Karte eins', 'text' => 'Text der Karte', 'photo' => ['value' => 'team.jpg', 'alt' => 'Team auf einem Bild']]]; })['status'], 200);
});

test('a list sent as an object is refused', function () use ($c, $unchanged) {
    $r = $unchanged(fn () => savePage($c, 'index', function (array &$v) { $v['hero']['trust'] = ['a' => ['text' => 'x']]; }));
    eq($r['status'], 422);
    eq($r['json']['errors'][0], ['path' => 'hero.trust', 'msg' => Rules::MSG_BAD_LIST]);
});

test('an image sub-field is {value, alt}; a bare string is no image', function () use ($c, $unchanged, $field) {
    $p = $c->get('page', ['id' => 'index'])['json']['page'];
    eq($field($p, 'cards', 'items')['value'][0]['photo'], ['value' => 'team.jpg', 'alt' => 'Team auf einem Bild']);
    $r = savePage($c, 'index', function (array &$v) { $v['cards']['items'][0]['photo'] = 'team.jpg'; });
    eq($r['status'], 200, $r['body']);
    $p = $c->get('page', ['id' => 'index'])['json']['page'];
    eq($field($p, 'cards', 'items')['value'][0]['photo'], ['value' => '', 'alt' => '']);
    savePage($c, 'index', function (array &$v) { $v['cards']['items'][0]['photo'] = ['value' => 'team.jpg', 'alt' => 'Team auf einem Bild']; });
});

test('«no image» is "" and "": top-level and in a list', function () use ($c, $e, $field) {
    $r = savePage($c, 'index', function (array &$v) {
        $v['hero']['image'] = ['value' => '', 'alt' => 'bleibt nicht'];
        $v['cards']['items'][0]['photo'] = ['value' => '', 'alt' => 'bleibt nicht'];
    });
    eq($r['status'], 200, $r['body']);
    $file = json_decode((string) $e->git->read(INDEX), true);
    $image = $field($file, 'hero', 'image');
    eq([$image['value'], $image['alt']], ['', '']);
    eq($field($file, 'cards', 'items')['value'][0]['photo'], ['value' => '', 'alt' => '']);
    hasNot((string) $e->git->read(INDEX), 'bleibt nicht');
    savePage($c, 'index', function (array &$v) {
        $v['hero']['image'] = ['value' => 'hero/start.jpg', 'alt' => 'Testbild Startseite'];
        $v['cards']['items'][0]['photo'] = ['value' => 'team.jpg', 'alt' => 'Team auf einem Bild'];
    });
});

test('a set image needs alt: page, list item, entry', function () use ($c, $unchanged) {
    foreach (['', '   ', "\n"] as $alt) {
        $r = $unchanged(fn () => savePage($c, 'index', function (array &$v) use ($alt) { $v['hero']['image']['alt'] = $alt; }));
        eq($r['status'], 422);
        eq($r['json']['errors'][0]['msg'], Rules::MSG_ALT_REQUIRED, show($alt));
    }
    $r = $unchanged(fn () => savePage($c, 'index', function (array &$v) { $v['cards']['items'][0]['photo']['alt'] = ''; }));
    eq($r['json']['errors'][0]['msg'], Rules::MSG_ALT_REQUIRED);
    eq($r['json']['errors'][0]['path'], 'cards.items[1].photo');
    $r = $unchanged(fn () => saveEntry($c, 'post', 'erster-beitrag', function (array &$v) { $v['image']['alt'] = ' '; }));
    eq($r['status'], 422);
    eq($r['json']['errors'][0]['msg'], Rules::MSG_ALT_REQUIRED);
    eq($r['json']['errors'][0]['path'], 'imageAlt');
});

test('an image with a path outside or missing is refused, a team photo has no alt to give', function () use ($c, $e) {
    eq(savePage($c, 'index', function (array &$v) { $v['hero']['image']['value'] = 'fehlt.jpg'; })['json']['errors'][0]['msg'], Rules::msgImageMissing('fehlt.jpg'));
    $r = saveEntry($c, 'team', 'max-muster', function (array &$v) { $v['photo'] = ['value' => 'team.jpg', 'alt' => '']; });
    eq($r['status'], 200, $r['body']);
    has((string) $e->git->read('src/content/team/max-muster.md'), "\nphoto: ../../assets/img/team.jpg\n");
});

test('< and > are refused in the plain fields of group contact, lists included', function () use ($c, $unchanged) {
    foreach ([['phone', '0231 < 1'], ['email', 'a>b'], ['hours', '<'], ['officeHours', "Mo\n>Di"]] as [$f, $bad]) {
        $r = $unchanged(fn () => savePage($c, '_global', function (array &$v) use ($f, $bad) { $v['contact'][$f] = $bad; }));
        eq($r['status'], 422, $f);
        eq($r['json']['errors'][0]['msg'], Rules::MSG_NO_ANGLE, $f);
        eq($r['json']['errors'][0]['path'], "contact.$f");
    }
    $r = $unchanged(fn () => savePage($c, '_global', function (array &$v) { $v['contact']['hoursList'] = [['time' => 'ok'], ['time' => '9 > 5']]; }));
    eq($r['status'], 422);
    eq($r['json']['errors'][0]['path'], 'contact.hoursList[2].time');
    eq($r['json']['errors'][0]['msg'], Rules::MSG_NO_ANGLE);
});

test('the same characters are fine elsewhere, and in the richtext of the same file', function () use ($c) {
    eq(savePage($c, '_global', function (array &$v) { $v['footer']['note'] = '<p>a &lt; b</p>'; })['status'], 200);
    eq(savePage($c, 'index', function (array &$v) { $v['hero']['pill'] = 'Preis < 5 €'; })['status'], 200);
});

test('a body over 1 MB is refused, the limit is exact', function () use ($c, $e, $unchanged) {
    $pad = static fn (int $bytes) => '{"lang":"de","pad":"' . str_repeat('a', $bytes - 22) . '"}';
    $h = ['Content-Type: application/json', 'X-WP-Nonce: ' . $c->nonce];
    eq(strlen($pad(1048576)), 1048576);
    eq($c->raw('POST', '/wp-admin/api.php?r=profile/lang', $pad(1048576), $h)['status'], 200, 'exactly 1 MB');
    eq($c->raw('POST', '/wp-admin/api.php?r=profile/lang', $pad(1048577), $h)['status'], 413);
    $r = $unchanged(fn () => $c->post('page', ['id' => 'index', 'hash' => 'x', 'values' => ['hero' => ['lead' => str_repeat('a', 1048577)]]]));
    eq($r['status'], 413);
    eq($r['json'], ['error' => 'too_large', 'message' => 'Anfrage zu groß']);
});

test('richtext limit: 50,000 characters pass, one more does not', function () use ($c, $unchanged, $field) {
    $ok = '<p>' . str_repeat('ä', Rules::RICHTEXT_MAX - 7) . '</p>';
    eq(Rules::chars($ok), 50000);
    eq(savePage($c, 'index', function (array &$v) use ($ok) { $v['hero']['lead'] = $ok; })['status'], 200);
    $long = '<p>' . str_repeat('ä', Rules::RICHTEXT_MAX - 6) . '</p>';
    $r = $unchanged(fn () => savePage($c, 'index', function (array &$v) use ($long) { $v['hero']['lead'] = $long; }));
    eq($r['status'], 422);
    eq($r['json']['errors'][0]['msg'], 'höchstens 50000 Zeichen (jetzt 50001)');
    eq($r['json']['errors'][0]['path'], 'hero.lead');
    savePage($c, 'index', function (array &$v) { $v['hero']['lead'] = '<p>kurz</p>'; });
});

test('body limit: 200,000 characters pass, one more does not', function () use ($c, $unchanged) {
    $ok = str_repeat('ä', Rules::BODY_MAX);
    eq(saveEntry($c, 'post', 'zweiter-beitrag', function (array &$v, string &$b) use ($ok) { $b = $ok; })['status'], 200);
    $r = $unchanged(fn () => saveEntry($c, 'post', 'zweiter-beitrag', function (array &$v, string &$b) use ($ok) { $b = $ok . 'ä'; }));
    eq($r['status'], 422);
    eq($r['json']['errors'][0], ['path' => 'body', 'label' => 'Inhalt', 'msg' => 'höchstens 200000 Zeichen (jetzt 200001)']);
});

test('a body with an unsafe link is refused, not rewritten', function () use ($c, $unchanged) {
    $r = $unchanged(fn () => saveEntry($c, 'post', 'zweiter-beitrag', function (array &$v, string &$b) { $b = '[x](javascript:alert(1))'; }));
    eq($r['status'], 422);
    eq($r['json']['errors'][0]['msg'], Rules::MSG_UNSAFE_LINK);
});

test('a body with raw HTML is stored escaped, every tag-opening <', function () use ($c, $e) {
    $r = saveEntry($c, 'post', 'zweiter-beitrag', function (array &$v, string &$b) { $b = "a <script>x</script> b < 5\n"; });
    eq($r['status'], 200, $r['body']);
    has((string) $e->git->read('src/content/blog/zweiter-beitrag.md'), 'a &lt;script>x&lt;/script> b < 5');
});

test('team save keeps the body it does not show', function () use ($c, $e) {
    $f = 'src/content/team/max-muster.md';
    $e->git->push([$f => "---\nname: Max Muster\nrole: Verwaltung\norder: 2\n---\n\nEin Text.\n\nZweiter Absatz.\n"], 'Mit Text');
    $entry = $c->get('entry', ['type' => 'team', 'id' => 'max-muster'])['json'];
    $v = $entry['values'];
    $v['role'] = 'Leitung';
    $r = $c->post('entry', ['type' => 'team', 'id' => 'max-muster', 'hash' => $entry['hash'], 'values' => $v, 'body' => 'der Client schickt hier nichts Gültiges']);
    eq($r['status'], 200, $r['body']);
    $text = (string) $e->git->read($f);
    has($text, "\nrole: Leitung\n");
    has($text, "\n\nEin Text.\n\nZweiter Absatz.\n");
    hasNot($text, 'der Client');
});

test('entry: values, body, hash; the schema travels with it', function () use ($c, $e) {
    $r = $c->get('entry', ['type' => 'post', 'id' => 'erster-beitrag'])['json'];
    eq($r['slug'], 'erster-beitrag');
    eq($r['hash'], $e->git->files()['src/content/blog/erster-beitrag.md']);
    eq($r['def']['postType'], 'post');
    eq($r['values']['date'], '2026-09-10');
    eq($r['values']['tags'], ['Test', 'Beispiel']);
    eq($r['values']['image'], ['value' => 'team.jpg', 'alt' => 'Bild zum Beitrag']);
    eq($r['values']['draft'], false);
    ok(strncmp($r['body'], 'Ein Absatz', 10) === 0, $r['body']);
});

test('dates, numbers and booleans come back in the form they went in', function () use ($c, $e) {
    $r = $c->post('entry', ['type' => 'team', 'id' => '', 'slug' => 'zahlen', 'values' => ['name' => 'Z', 'role' => 'R', 'order' => 5, 'hidden' => true]]);
    eq($r['status'], 200, $r['body']);
    has((string) $e->git->read('src/content/team/zahlen.md'), "order: 5\nhidden: true\n");
    $v = $c->get('entry', ['type' => 'team', 'id' => 'zahlen'])['json']['values'];
    eq($v['order'], '5');
    eq($v['hidden'], true);
});

test('errors have one shape', function () use ($c) {
    $r = $c->get('page', ['id' => 'gibtsnicht']);
    eq($r['json'], ['error' => 'not_found', 'message' => '']);
    $r = savePage($c, 'index', function (array &$v) { $v['seo']['title'] = ''; });
    eq(array_keys($r['json']), ['error', 'message', 'errors', 'page']);
    eq(array_keys($r['json']['errors'][0]), ['path', 'msg', 'label']);
});

test('a save with no values at all is no change', function () use ($c) {
    $p = $c->get('page', ['id' => 'index'])['json'];
    $r = $c->post('page', ['id' => 'index', 'hash' => $p['hash']]);
    eq($r['status'], 200, $r['body']);
    eq($r['json']['unchanged'], true);
});
finish();
