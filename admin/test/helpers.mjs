// Test helpers: a throw-away copy of the fixture site in a temp git repo and a tiny cookie-aware client.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.js';
import { createApp } from '../lib/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE = path.join(here, 'fixtures', 'site');
export const FAKE_BUILD = `node ${JSON.stringify(path.join(here, 'fake-build.mjs'))}`;
export const FAKE_DEPLOY = `node ${JSON.stringify(path.join(here, 'fake-deploy.mjs'))}`;
export const PASSWORD = 'test-passwort-123';

export function makeSite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alno-admin-test-'));
  const siteDir = path.join(root, 'site');
  const dataDir = path.join(root, 'data');
  fs.cpSync(FIXTURE, siteDir, { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: siteDir, stdio: 'pipe' }).toString();
  g('init', '-q', '-b', 'main');
  g('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.org', 'add', '-A');
  g('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.org', 'commit', '-qm', 'Fixture');
  return { root, siteDir, dataDir, git: g, deployLog: path.join(root, 'deploy.log'), buildLog: path.join(root, 'build.log') };
}

export async function startApp(site, env = {}) {
  process.env.FAKE_DEPLOY_LOG = site.deployLog;
  process.env.FAKE_BUILD_LOG = site.buildLog;
  const cfg = loadConfig({
    ADMIN_SITE_DIR: site.siteDir, ADMIN_DATA_DIR: site.dataDir, ADMIN_BUILD_CMD: FAKE_BUILD, ADMIN_DEPLOY_CMD: FAKE_DEPLOY,
    ADMIN_SITE_URL: 'https://site.example', ...env,
  });
  const app = createApp(cfg);
  const server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { app, cfg, server, base, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}

export class Client {
  constructor(base) { this.base = base; this.cookies = new Map(); }

  store(res) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i); const v = pair.slice(i + 1);
      if (v) this.cookies.set(k, v); else this.cookies.delete(k);
    }
  }

  headers(extra = {}) {
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    return { ...(cookie ? { Cookie: cookie } : {}), ...extra };
  }

  async get(p, headers) {
    const res = await fetch(this.base + p, { redirect: 'manual', headers: this.headers(headers) });
    this.store(res);
    res.text_ = await res.text();
    return res;
  }

  async post(p, body, headers = {}) {
    const res = await fetch(this.base + p, {
      method: 'POST', redirect: 'manual', body: new URLSearchParams(body).toString(),
      headers: this.headers({ 'Content-Type': 'application/x-www-form-urlencoded', ...headers }),
    });
    this.store(res);
    res.text_ = await res.text();
    return res;
  }

  async login(user = 'tester', pass = PASSWORD) {
    const form = await this.get('/wp-login.php');
    const nonce = /name="_login_nonce" value="([^"]+)"/.exec(form.text_)?.[1];
    return this.post('/wp-login.php', { log: user, pwd: pass, _login_nonce: nonce, redirect_to: '' });
  }

  async nonce() {
    const r = await this.get('/wp-admin/profile.php');
    return /data-nonce="([^"]+)"/.exec(r.text_)?.[1];
  }

  // Sends the real edit form back with changes applied, like a browser would.
  async editForm(p) {
    const r = await this.get(p);
    return { res: r, fields: formFields(r.text_) };
  }
}

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Reads inputs/textareas of the #post form as ordered [name, value] pairs.
export function formFields(page) {
  const m = /<form[^>]*id="post"[^>]*>([\s\S]*?)<\/form>/.exec(page);
  if (!m) return [];
  const body = m[1].replace(/<template[\s\S]*?<\/template>/g, '');
  const out = [];
  const re = /<input\b[^>]*>|<textarea\b[^>]*>([\s\S]*?)<\/textarea>|<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g;
  let t;
  while ((t = re.exec(body))) {
    if (t[2]) { const sel = /<option value="([^"]*)" selected/.exec(t[3]); out.push([t[2], sel ? decode(sel[1]) : '']); continue; }
    const name = /\bname="([^"]+)"/.exec(t[0])?.[1];
    if (!name) continue;
    if (t[0].startsWith('<textarea')) { out.push([decode(name), decode(t[1] ?? '')]); continue; }
    if (/type="checkbox"/.test(t[0]) && !/\bchecked\b/.test(t[0])) continue;
    out.push([decode(name), decode(/\bvalue="([^"]*)"/.exec(t[0])?.[1] ?? '')]);
  }
  return out;
}

export function setField(fields, name, value) {
  const f = fields.find(([k]) => k === name);
  if (!f) throw new Error(`no field ${name}`);
  f[1] = value;
  return fields;
}

export const read = (site, rel) => fs.readFileSync(path.join(site.siteDir, rel), 'utf8');
export const deploys = (site) => (fs.existsSync(site.deployLog) ? fs.readFileSync(site.deployLog, 'utf8').trim().split('\n').filter(Boolean).length : 0);
