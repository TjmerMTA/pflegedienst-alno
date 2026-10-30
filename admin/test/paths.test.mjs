import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { safeJoin, PathError, slugify, SLUG_RE } from '../lib/fsutil.js';
import { parseNested } from '../lib/http.js';
import { isImagePath } from '../lib/pages.js';
import { makeSite, startApp, Client, PASSWORD } from './helpers.mjs';

let site; let srv; let c; let nonce;
before(async () => {
  site = makeSite();
  srv = await startApp(site);
  await srv.app.auth.addUser('tester', PASSWORD);
  c = new Client(srv.base);
  await c.login();
  nonce = await c.nonce();
  fs.writeFileSync(path.join(site.root, 'geheim.jpg'), 'secret');
  fs.writeFileSync(path.join(site.root, 'geheim.md'), '---\nname: x\n---\n');
});
after(async () => { await srv.close(); fs.rmSync(site.root, { recursive: true, force: true }); });

test('safeJoin refuses everything that leaves the base', () => {
  const base = site.siteDir;
  for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'a/./b', 'a//b', '.git/config', 'a/.env', 'a\\..\\b', 'x\0.jpg', '', 'C:/x']) {
    assert.throws(() => safeJoin(base, bad), PathError, JSON.stringify(bad));
  }
  assert.ok(safeJoin(base, 'src/content').endsWith('src/content'));
});

test('safeJoin refuses symlinks pointing outside', () => {
  const link = path.join(site.siteDir, 'src/assets/img/link.jpg');
  fs.symlinkSync(path.join(site.root, 'geheim.jpg'), link);
  assert.throws(() => safeJoin(path.join(site.siteDir, 'src/assets/img'), 'link.jpg'), PathError);
  fs.unlinkSync(link);
});

test('isImagePath accepts only clean relative image paths', () => {
  assert.equal(isImagePath('team.jpg'), true);
  assert.equal(isImagePath('uploads/ab12.webp'), true);
  for (const bad of ['../team.jpg', 'a/../team.jpg', '/team.jpg', 'team.svg', 'team.jpg.php', '.team.jpg', 'a//b.jpg', 'a\\b.jpg', '']) assert.equal(isImagePath(bad), false, bad);
});

test('media-file cannot read outside the library', async () => {
  for (const f of ['../../../../geheim.jpg', '..%2F..%2F..%2F..%2Fgeheim.jpg', '/etc/passwd', '....//....//geheim.jpg', '../../content/pages/index.json']) {
    const r = await c.get(`/wp-admin/media-file?f=${f}`);
    assert.equal(r.status, 404, f);
  }
  assert.equal((await c.get('/wp-admin/media-file?f=team.jpg')).status, 200);
});

test('a symlink in the library is not served', async () => {
  const link = path.join(site.siteDir, 'src/assets/img/link.jpg');
  fs.symlinkSync(path.join(site.root, 'geheim.jpg'), link);
  assert.equal((await c.get('/wp-admin/media-file?f=link.jpg')).status, 404);
  fs.unlinkSync(link);
});

test('static assets are an allow-list', async () => {
  assert.equal((await c.get('/wp-admin/assets/admin.css')).status, 200);
  for (const p of ['/wp-admin/assets/../lib/auth.js', '/wp-admin/assets/lib/auth.js', '/wp-admin/assets/%2e%2e/server.js', '/wp-admin/assets/lib/app.js']) {
    const r = await c.get(p);
    assert.notEqual(r.status, 200, p);
  }
});

test('edit screens refuse path-like ids', async () => {
  for (const id of ['../../../geheim', '..%2F..%2Fgeheim', 'index/../_global', 'a.b', '.git']) {
    assert.equal((await c.get(`/wp-admin/post.php?post_type=page&post=${id}`)).status, 404, id);
    assert.equal((await c.get(`/wp-admin/post.php?post_type=team&post=${id}`)).status, 404, id);
  }
  const r = await c.post('/wp-admin/post.php', { _wpnonce: nonce, action: 'editpost', post_type: 'team', post: '../../../geheim', name: 'x', role: 'y' });
  assert.equal(r.status, 404);
  const t = await c.post('/wp-admin/post.php', { _wpnonce: nonce, action: 'trash', post_type: 'team', post: '../../../geheim' });
  assert.equal(t.status, 404);
  assert.ok(fs.existsSync(path.join(site.root, 'geheim.md')));
});

test('new posts cannot escape through the permalink', async () => {
  const r = await c.post('/wp-admin/post.php', { _wpnonce: nonce, action: 'editpost', post_type: 'post', post: '', title: 'T', description: 'D', date: '2026-01-01', slug: '../../../boese', body: 'x' });
  assert.equal(r.status, 303, 'slugify makes it harmless');
  assert.ok(fs.existsSync(path.join(site.siteDir, 'src/content/blog/boese.md')));
  assert.equal(fs.existsSync(path.join(site.root, 'boese.md')), false);
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd');
  assert.equal(slugify('Über Größe'), 'ueber-groesse');
  assert.equal(SLUG_RE.test('a/b'), false);
});

test('revisions accept only content files and hex revisions', async () => {
  for (const f of ['../../etc/passwd', '.git/config', 'deploy.sh', 'package.json', 'src/content/../../deploy.sh', 'src/content/pages/../../../deploy.sh', 'src/assets/img/team.jpg']) {
    assert.equal((await c.get(`/wp-admin/revision.php?file=${encodeURIComponent(f)}`)).status, 404, f);
    assert.equal((await c.post('/wp-admin/revision.php', { _wpnonce: nonce, action: 'restore', file: f, rev: 'abcdef1' })).status, 404, f);
  }
  const f = 'src/content/team/max-muster.md';
  for (const rev of ['--help', 'HEAD', 'HEAD~1', 'abc', '../x', '$(id)']) {
    assert.equal((await c.post('/wp-admin/revision.php', { _wpnonce: nonce, action: 'restore', file: f, rev })).status, 404, rev);
  }
});

test('trash ids cannot leave the trash folder', async () => {
  for (const id of ['../../users', '1-../../x', '../users']) {
    assert.equal((await c.post('/wp-admin/post.php', { _wpnonce: nonce, action: 'delete', post_type: 'team', trash_id: id })).status, 404, id);
  }
  assert.ok(fs.existsSync(path.join(site.dataDir, 'users.json')));
});

test('media actions refuse paths outside the library', async () => {
  for (const item of ['../../content/pages/index.json', '../../../deploy.sh', '/etc/passwd']) {
    assert.equal((await c.post('/wp-admin/upload.php', { _wpnonce: nonce, action: 'delete', item })).status, 404, item);
  }
});

test('image values in forms cannot point outside the library', async () => {
  const r = await c.post('/wp-admin/post.php', { _wpnonce: nonce, action: 'editpost', post_type: 'team', post: 'max-muster', _hash: 'x', name: 'M', role: 'R', 'photo[value]': '../../../geheim.jpg' });
  assert.notEqual(r.status, 303);
  assert.doesNotMatch(fs.readFileSync(path.join(site.siteDir, 'src/content/team/max-muster.md'), 'utf8'), /geheim/);
});

test('form parser refuses prototype pollution', () => {
  assert.throws(() => parseNested([['__proto__[x]', '1']]));
  assert.throws(() => parseNested([['f[__proto__][x]', '1']]));
  assert.throws(() => parseNested([['f[constructor][prototype]', '1']]));
  assert.equal({}.x, undefined);
});

test('form parser keeps order and nesting', () => {
  const o = parseNested([['f[g][b][t]', '1'], ['f[g][a][t]', '2'], ['n', '3']]);
  assert.deepEqual(Object.keys(o.f.g), ['b', 'a']);
  assert.equal(o.n, '3');
});

test('a foreign Host header is refused (DNS rebinding)', async () => {
  const port = new URL(srv.base).port;
  const status = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/wp-login.php', headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(status, 421);
});
