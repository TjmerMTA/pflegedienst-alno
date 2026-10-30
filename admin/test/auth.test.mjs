import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createAuth, hashPassword, verifyPassword } from '../lib/auth.js';
import { makeSite, startApp, Client, PASSWORD, deploys } from './helpers.mjs';

let site; let srv;
before(async () => {
  site = makeSite();
  srv = await startApp(site);
  await srv.app.auth.addUser('tester', PASSWORD);
});
after(async () => { await srv.app.publisher.idle(); await srv.close(); fs.rmSync(site.root, { recursive: true, force: true }); });

test('passwords are stored as salted scrypt hashes', async () => {
  const a = await hashPassword('geheim-geheim');
  const b = await hashPassword('geheim-geheim');
  assert.match(a, /^scrypt\$/);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('geheim-geheim', a), true);
  assert.equal(await verifyPassword('falsch', a), false);
  const raw = fs.readFileSync(path.join(site.dataDir, 'users.json'), 'utf8');
  assert.ok(!raw.includes(PASSWORD));
  assert.equal(fs.statSync(path.join(site.dataDir, 'users.json')).mode & 0o077, 0, 'users.json is private');
});

test('short passwords and odd names are refused', async () => {
  await assert.rejects(srv.app.auth.addUser('kurz', '123'), /mindestens/);
  await assert.rejects(srv.app.auth.addUser('../evil', PASSWORD), /Benutzername/);
});

test('admin pages need a login', async () => {
  const c = new Client(srv.base);
  const r = await c.get('/wp-admin/edit.php?post_type=page');
  assert.equal(r.status, 303);
  assert.match(r.headers.get('location'), /^\/wp-login\.php\?redirect_to=/);
  assert.equal((await c.get('/wp-admin/admin-ajax.php?action=media')).status, 401);
  assert.equal((await c.get('/wp-admin/media-file?f=team.jpg')).status, 401);
});

test('login sets a HttpOnly SameSite=Strict cookie; no Secure on plain http', async () => {
  const c = new Client(srv.base);
  const r = await c.login();
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/wp-admin/');
  const ck = r.headers.getSetCookie().find((x) => x.startsWith('alno_session='));
  assert.match(ck, /HttpOnly/);
  assert.match(ck, /SameSite=Strict/);
  assert.doesNotMatch(ck, /Secure/);
  assert.equal((await c.get('/wp-admin/')).status, 200);
});

test('behind https the cookie is Secure', async (t) => {
  const srv2 = await startApp(site, { ADMIN_TRUST_PROXY: '1' });
  t.after(() => srv2.close());
  const c = new Client(srv2.base);
  const form = await c.get('/wp-login.php');
  const nonce = /name="_login_nonce" value="([^"]+)"/.exec(form.text_)[1];
  const r = await c.post('/wp-login.php', { log: 'tester', pwd: PASSWORD, _login_nonce: nonce }, { 'X-Forwarded-Proto': 'https' });
  assert.match(r.headers.getSetCookie().find((x) => x.startsWith('alno_session=')), /; Secure/);
});

test('the session token is not stored in clear text', async () => {
  const c = new Client(srv.base);
  await c.login();
  const token = decodeURIComponent(c.cookies.get('alno_session'));
  assert.ok(!fs.readFileSync(path.join(site.dataDir, 'sessions.json'), 'utf8').includes(token));
});

test('logout needs the CSRF token and ends the session', async () => {
  const c = new Client(srv.base);
  await c.login();
  assert.equal((await c.post('/wp-login.php?action=logout', {})).status, 403);
  assert.equal((await c.get('/wp-admin/')).status, 200);
  const r = await c.post('/wp-login.php?action=logout', { _wpnonce: await c.nonce() });
  assert.equal(r.status, 303);
  assert.equal((await c.get('/wp-admin/')).status, 303);
});

test('open redirects after login are refused', async () => {
  const c = new Client(srv.base);
  const form = await c.get('/wp-login.php');
  const nonce = /name="_login_nonce" value="([^"]+)"/.exec(form.text_)[1];
  const r = await c.post('/wp-login.php', { log: 'tester', pwd: PASSWORD, _login_nonce: nonce, redirect_to: 'https://evil.example/' });
  assert.equal(r.headers.get('location'), '/wp-admin/');
  const c2 = new Client(srv.base);
  const f2 = await c2.get('/wp-login.php');
  const n2 = /name="_login_nonce" value="([^"]+)"/.exec(f2.text_)[1];
  const r2 = await c2.post('/wp-login.php', { log: 'tester', pwd: PASSWORD, _login_nonce: n2, redirect_to: '/wp-admin//evil.example' });
  assert.equal(r2.headers.get('location'), '/wp-admin/');
});

test('login form has its own CSRF token', async () => {
  const c = new Client(srv.base);
  await c.get('/wp-login.php');
  assert.equal((await c.post('/wp-login.php', { log: 'tester', pwd: PASSWORD, _login_nonce: 'falsch' })).status, 403);
});

test('lockout: five wrong passwords lock the account, even for the right password', async () => {
  const c = new Client(srv.base);
  await srv.app.auth.addUser('opfer', PASSWORD);
  for (let i = 0; i < 4; i++) assert.equal((await c.login('opfer', 'falsch')).status, 401);
  assert.equal((await c.login('opfer', 'falsch')).status, 429);
  const r = await c.login('opfer', PASSWORD);
  assert.equal(r.status, 429);
  assert.equal(c.cookies.has('alno_session'), false);
  assert.match(r.text_, /Zu viele fehlgeschlagene/);
});

test('lockout ends after the lock time; success resets the counter', async () => {
  let t = 1_000_000;
  const auth = createAuth({ dataDir: site.dataDir + '-lock', now: () => t });
  await auth.addUser('anna', PASSWORD);
  for (let i = 0; i < 5; i++) await auth.login('anna', 'x', '1.1.1.1');
  assert.equal((await auth.login('anna', PASSWORD, '1.1.1.1')).reason, 'locked');
  t += 16 * 60e3;
  assert.equal((await auth.login('anna', PASSWORD, '1.1.1.1')).ok, true);
  for (let i = 0; i < 4; i++) await auth.login('anna', 'x', '1.1.1.1');
  assert.equal((await auth.login('anna', PASSWORD, '1.1.1.1')).ok, true);
  for (let i = 0; i < 4; i++) await auth.login('anna', 'x', '1.1.1.1');
  assert.equal((await auth.login('anna', PASSWORD, '1.1.1.1')).ok, true, 'counter starts over after success');
  fs.rmSync(site.dataDir + '-lock', { recursive: true, force: true });
});

test('one address cannot try many accounts', async () => {
  const auth = createAuth({ dataDir: site.dataDir + '-ip', lockout: { ipMax: 3 } });
  await auth.addUser('bert', PASSWORD);
  for (const u of ['a1', 'a2', 'a3']) await auth.login(u, 'x', '2.2.2.2');
  assert.equal((await auth.login('bert', PASSWORD, '2.2.2.2')).reason, 'locked');
  assert.equal((await auth.login('bert', PASSWORD, '3.3.3.3')).ok, true);
  fs.rmSync(site.dataDir + '-ip', { recursive: true, force: true });
});

test('unknown users and wrong passwords answer alike', async () => {
  const c = new Client(srv.base);
  await srv.app.auth.addUser('echt', PASSWORD);
  const a = await c.login('echt', 'falsch');
  const b = await c.login('gibtsnicht', 'falsch');
  assert.equal(a.status, b.status);
  assert.match(b.text_, /Benutzername oder Passwort ist falsch/);
});

test('session expires when idle; a new password ends other sessions', async () => {
  let t = 5_000_000;
  const auth = createAuth({ dataDir: site.dataDir + '-s', sessionIdleMs: 1000, now: () => t });
  await auth.addUser('cara', PASSWORD);
  const s = await auth.createSession('cara');
  assert.equal((await auth.getSession(s.token)).user, 'cara');
  t += 2000;
  assert.equal(await auth.getSession(s.token), null);
  const s2 = await auth.createSession('cara');
  await auth.setPassword('cara', 'ein-neues-passwort');
  assert.equal(await auth.getSession(s2.token), null);
  fs.rmSync(site.dataDir + '-s', { recursive: true, force: true });
});

test('CSRF: every changing route refuses a request without the token', async () => {
  const c = new Client(srv.base);
  await c.login();
  const before_ = fs.readFileSync(path.join(site.siteDir, 'src/content/team/max-muster.md'), 'utf8');
  const routes = [
    ['/wp-admin/post.php', { action: 'editpost', post_type: 'page', post: 'index' }],
    ['/wp-admin/post.php', { action: 'editpost', post_type: 'team', post: 'max-muster', name: 'X', role: 'Y' }],
    ['/wp-admin/post.php', { action: 'trash', post_type: 'team', post: 'max-muster' }],
    ['/wp-admin/upload.php', { action: 'save-meta', item: 'team.jpg', alt: 'x' }],
    ['/wp-admin/upload.php', { action: 'delete', item: 'unbenutzt.webp' }],
    ['/wp-admin/revision.php', { action: 'restore', file: 'src/content/team/max-muster.md', rev: 'abcdef1' }],
    ['/wp-admin/profile.php', { action: 'lang', lang: 'ru' }],
  ];
  for (const [p, body] of routes) {
    assert.equal((await c.post(p, body)).status, 403, `${p} ${body.action}`);
    assert.equal((await c.post(p, { ...body, _wpnonce: 'falsch' })).status, 403, `${p} ${body.action} wrong token`);
  }
  assert.equal(fs.readFileSync(path.join(site.siteDir, 'src/content/team/max-muster.md'), 'utf8'), before_);
  assert.equal(deploys(site), 0);
  const fd = new FormData();
  fd.append('async-upload', new Blob([Buffer.from('x')]), 'a.jpg');
  const r = await fetch(`${srv.base}/wp-admin/async-upload.php`, { method: 'POST', body: fd, headers: c.headers() });
  assert.equal(r.status, 403);
});

test('CSRF: another user\'s token does not work', async () => {
  const a = new Client(srv.base); const b = new Client(srv.base);
  await a.login();
  await b.login();
  const r = await a.post('/wp-admin/profile.php', { action: 'lang', lang: 'ru', _wpnonce: await b.nonce() });
  assert.equal(r.status, 403);
});

test('cross-site Origin and foreign Host are refused', async () => {
  const c = new Client(srv.base);
  await c.login();
  const nonce = await c.nonce();
  const r = await c.post('/wp-admin/profile.php', { action: 'lang', lang: 'de', _wpnonce: nonce }, { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  const ok = await c.post('/wp-admin/profile.php', { action: 'lang', lang: 'de', _wpnonce: nonce }, { Origin: srv.base });
  assert.equal(ok.status, 303);
});

test('security headers are set', async () => {
  const c = new Client(srv.base);
  const r = await c.get('/wp-login.php');
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});
