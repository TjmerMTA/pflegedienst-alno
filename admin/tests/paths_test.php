<?php
// Port of paths.test.mjs. There is no site folder on this server any more: what can be reached is
// the data folder and the repository, and every id and path has to stay inside what it names.
declare(strict_types=1);
require_once __DIR__ . '/harness.php';

$e = new Env();
$c = $e->as('admin');
$e->store->write('geheim.jpg', 'secret');
$e->store->write('geheim.md', "---\nname: x\n---\n");

test('media/file and media/item cannot read outside the library', function () use ($c, $e) {
    foreach (['../../../../geheim.jpg', '/etc/passwd', '....//....//geheim.jpg', '../../content/pages/index.json', '../team.jpg', 'team.jpg/', "team.jpg\0.png", 'hero/../team.jpg'] as $f) {
        eq($c->get('media/file', ['path' => $f])['status'], 404, $f);
        eq($c->get('media/item', ['path' => $f])['status'], 404, $f);
    }
    eq($c->raw('GET', '/wp-admin/api.php?r=media/file&path=..%2F..%2F..%2F..%2Fgeheim.jpg')['status'], 404);
    eq($c->raw('GET', '/wp-admin/api.php?r=media/file&path=..%252F..%252Fgeheim.jpg')['status'], 404);
    eq($c->raw('GET', '/wp-admin/api.php?r=media/file&path[]=team.jpg')['status'], 404, 'array');
    eq($c->get('media/file', ['path' => 'team.jpg'])['status'], 200);
});

test('nothing but api.php and cron.php is an entry point', function () {
    $root = WP_ROOT . '/wp-admin';
    eq(array_map('basename', glob("$root/*.php")), ['api.php', 'cron.php']);
    foreach (['lib', 'schema'] as $dir) has((string) file_get_contents("$root/$dir/.htaccess"), 'Require all denied', $dir);
    has((string) file_get_contents("$root/.htaccess"), 'Options -Indexes');
});

test('edit screens refuse path-like ids', function () use ($c) {
    foreach (['../../../geheim', '..%2F..%2Fgeheim', 'index/../_global', 'a.b', '.git', '', "index\n"] as $id) {
        eq($c->get('page', ['id' => $id])['status'], 404, $id);
        eq($c->get('entry', ['type' => 'team', 'id' => $id])['status'], 404, $id);
    }
    $head = $c->get('pages')['status'];
    eq($c->post('page', ['id' => '../../../geheim', 'hash' => 'x', 'values' => []])['status'], 404);
    eq($c->post('entry', ['type' => 'team', 'id' => '../../../geheim', 'values' => ['name' => 'x', 'role' => 'y']])['status'], 404);
    eq($c->post('entry/trash', ['type' => 'team', 'id' => '../../../geheim'])['status'], 404);
    eq($c->get('entries', ['type' => '../x'])['status'], 404);
});

test('new posts cannot escape through the permalink', function () use ($c, $e) {
    $r = $c->post('entry', ['type' => 'post', 'id' => '', 'slug' => '../../../boese', 'values' => ['title' => 'T', 'description' => 'D', 'date' => '2026-01-01'], 'body' => 'x']);
    eq($r['status'], 200, $r['body']);
    eq($r['json']['id'], 'boese');
    ok($e->git->read('src/content/blog/boese.md') !== null);
    eq($e->git->changed($r['json']['job']), ['src/content/blog/boese.md']);
});

test('a permalink that leaves nothing usable is refused', function () use ($c) {
    $r = $c->post('entry', ['type' => 'post', 'id' => '', 'slug' => '///', 'values' => ['title' => '???', 'description' => 'D', 'date' => '2026-01-01'], 'body' => 'x']);
    eq($r['status'], 422);
    eq($r['json']['errors'][0]['path'], 'slug');
    eq($r['json']['errors'][0]['msg'], Rules::MSG_SLUG_INVALID);
});

test('revisions accept only content files and hex revisions', function () use ($c, $e) {
    $head = $e->git->head();
    foreach (['../../etc/passwd', '.git/config', 'deploy.sh', 'package.json', 'src/content/../../deploy.sh', 'src/content/pages/../../../deploy.sh', 'src/assets/img/team.jpg'] as $f) {
        eq($c->get('revisions/file', ['file' => $f])['status'], 404, $f);
        eq($c->post('revisions/restore', ['file' => $f, 'rev' => 'abcdef1'])['status'], 404, $f);
    }
    $f = 'src/content/team/max-muster.md';
    foreach (['--help', 'HEAD', 'HEAD~1', 'abc', '../x', '$(id)', ''] as $rev) {
        eq($c->post('revisions/restore', ['file' => $f, 'rev' => $rev])['status'], 404, $rev);
    }
    eq($c->get('revisions/file', ['file' => $f, 'rev' => '../x'])['status'], 404);
    eq($e->git->head(), $head);
});

test('trash ids cannot leave the trash folder', function () use ($c, $e) {
    foreach (['../../users', '1-../../x', '../users', '1-a/../../../config'] as $id) {
        eq($c->post('entry/delete', ['type' => 'team', 'trashId' => $id])['status'], 404, $id);
        eq($c->post('entry/untrash', ['type' => 'team', 'trashId' => $id])['status'], 404, $id);
    }
    ok(is_file("$e->data/users.json"));
    ok(is_file("$e->data/config.json"));
});

test('a trash record cannot point somewhere else', function () use ($c, $e) {
    $e->store->writeJson('trash/team/1-evil.json', ['id' => '1-evil', 'slug' => '../../../deploy', 'coll' => 'team']);
    $e->store->write('trash/team/1-evil.md', 'x');
    eq($c->post('entry/untrash', ['type' => 'team', 'trashId' => '1-evil'])['status'], 404);
    $e->store->delete('trash/team/1-evil.json');
    $e->store->delete('trash/team/1-evil.md');
});

test('media actions refuse paths outside the library', function () use ($c, $e) {
    foreach (['../../content/pages/index.json', '../../../deploy.sh', '/etc/passwd', '../geheim.jpg'] as $item) {
        eq($c->post('media/delete', ['path' => $item])['status'], 404, $item);
        eq($c->post('media/meta', ['path' => $item, 'alt' => 'x'])['status'], 404, $item);
    }
    ok(is_file("$e->data/geheim.jpg"));
});

test('image values cannot point outside the library', function () use ($c, $e) {
    $r = saveEntry($c, 'team', 'max-muster', function (array &$v) { $v['photo'] = ['value' => '../../../geheim.jpg', 'alt' => 'x']; });
    eq($r['status'], 422);
    eq($r['json']['errors'][0]['msg'], Rules::MSG_BAD_IMAGE);
    hasNot((string) $e->git->read('src/content/team/max-muster.md'), 'geheim');
});
finish();
