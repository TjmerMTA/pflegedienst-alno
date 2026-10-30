import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeSite, FAKE_BUILD, FAKE_DEPLOY } from './helpers.mjs';

const admin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let site; let env;
before(() => {
  site = makeSite();
  env = { ...process.env, ADMIN_SITE_DIR: site.siteDir, ADMIN_DATA_DIR: site.dataDir, ADMIN_BUILD_CMD: FAKE_BUILD, ADMIN_DEPLOY_CMD: FAKE_DEPLOY };
});
after(() => fs.rmSync(site.root, { recursive: true, force: true }));

const user = (args, input = '') => spawnSync('node', [path.join(admin, 'bin/user.js'), ...args], { env, input, encoding: 'utf8' });

test('admin:user add stores a hash, never the password', () => {
  const r = user(['add', 'klara', '--lang=ru'], 'ein-langes-passwort\nein-langes-passwort\n');
  assert.equal(r.status, 0, r.stderr);
  const raw = fs.readFileSync(path.join(site.dataDir, 'users.json'), 'utf8');
  assert.ok(!raw.includes('ein-langes-passwort'));
  assert.match(JSON.parse(raw).users.klara.hash, /^scrypt\$/);
  assert.equal(JSON.parse(raw).users.klara.lang, 'ru');
  assert.match(user(['list']).stdout, /^klara\tru\t/m);
});

test('admin:user refuses bad input', () => {
  assert.equal(user(['add', 'kurz'], 'abc\nabc\n').status, 1);
  assert.equal(user(['add', 'zwei'], 'ein-langes-passwort\nanderes-passwort-x\n').status, 1);
  assert.equal(user(['add', '../boese'], 'ein-langes-passwort\nein-langes-passwort\n').status, 1);
  assert.equal(user(['add', 'klara'], 'ein-langes-passwort\nein-langes-passwort\n').status, 1, 'already exists');
  assert.doesNotMatch(user(['list']).stdout, /kurz|zwei|boese/);
});

test('admin:user passwd and delete', () => {
  assert.equal(user(['add', 'tim'], 'ein-langes-passwort\nein-langes-passwort\n').status, 0);
  const a = JSON.parse(fs.readFileSync(path.join(site.dataDir, 'users.json'), 'utf8')).users.tim.hash;
  assert.equal(user(['passwd', 'tim'], 'noch-ein-passwort\nnoch-ein-passwort\n').status, 0);
  assert.notEqual(JSON.parse(fs.readFileSync(path.join(site.dataDir, 'users.json'), 'utf8')).users.tim.hash, a);
  assert.equal(user(['delete', 'tim']).status, 0);
  assert.doesNotMatch(user(['list']).stdout, /tim/);
});

test('the server refuses a data folder inside the site', () => {
  const r = spawnSync('node', [path.join(admin, 'server.js')], { env: { ...env, ADMIN_DATA_DIR: path.join(site.siteDir, 'daten') }, encoding: 'utf8', timeout: 5000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /außerhalb/);
});

test('the server starts from the environment and serves the login page', async (t) => {
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => resolve(p)); }); });
  const child = spawn('node', [path.join(admin, 'server.js')], { env: { ...env, ADMIN_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('/wp-admin/')) resolve(); });
    child.on('exit', (c) => reject(new Error(`exit ${c}`)));
  });
  const r = await fetch(`http://127.0.0.1:${port}/wp-login.php`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /id="loginform"/);
});
