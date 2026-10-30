<?php
declare(strict_types=1);
require_once __DIR__ . '/harness.php';

$e = new Env();
test('session without login asks for login', function () use ($e) {
    $r = $e->client()->get('session');
    eq($r['status'], 401, $r['body']);
    eq($r['json']['error'], 'login');
    ok($r['json']['loginNonce']);
});
$c = $e->as('admin');
foreach (['dashboard', 'pages', 'media', 'revisions', 'status', 'users', 'anfragen'] as $route) {
    test("GET $route", function () use ($c, $route) { $r = $c->get($route); eq($r['status'], 200, $r['body']); });
}
test('GET page, entries, entry', function () use ($c) {
    $r = $c->get('page', ['id' => 'index']); eq($r['status'], 200, $r['body']);
    $r = $c->get('entries', ['type' => 'post']); eq($r['status'], 200, $r['body']); ok(count($r['json']['entries']) === 2, $r['body']);
    $r = $c->get('entry', ['type' => 'post', 'id' => 'erster-beitrag']); eq($r['status'], 200, $r['body']);
});
test('save a page: one commit, author the user, committer the bot', function () use ($c, $e) {
    $p = $c->get('page', ['id' => 'index'])['json'];
    $values = [];
    foreach ($p['page']['groups'] as $g) foreach ($g['fields'] as $f) {
        if ($f['type'] === 'image') $values[$g['id']][$f['id']] = ['value' => $f['value'], 'alt' => $f['alt'] ?? ''];
        else $values[$g['id']][$f['id']] = $f['value'];
    }
    $first = array_key_first($values); $k = null;
    foreach ($p['page']['groups'][0]['fields'] as $f) if ($f['type'] === 'text') { $k = $f['id']; break; }
    $values[$first][$k] = 'Geänderter Text';
    $r = $c->post('page', ['id' => 'index', 'hash' => $p['hash'], 'values' => $values]);
    eq($r['status'], 200, $r['body']);
    $commit = $e->git->commit($r['json']['job']);
    eq($commit['author']['name'], 'admin');
    eq($commit['committer']['name'], 'alno-admin-bot');
    has((string) $e->git->read('src/content/pages/index.json'), 'Geänderter Text');
    $st = $c->get('status', ['commit' => $r['json']['job']]);
    eq($st['json']['state'], 'queued', $st['body']);
});
finish();
