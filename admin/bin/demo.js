#!/usr/bin/env node
// Runs the admin against a throw-away copy of the test fixtures, with a fake build and a fake deploy.
// Nothing is published and the real repository is not touched. `npm run admin:demo`
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.js';
import { createApp } from '../lib/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const test = path.join(here, '..', 'test');
const root = process.env.ADMIN_DEMO_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'alno-admin-demo-'));
const siteDir = path.join(root, 'site');
const dataDir = path.join(root, 'data');
const git = (...a) => execFileSync('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@example.org', ...a], { cwd: siteDir, stdio: 'pipe' });

if (!fs.existsSync(siteDir)) {
  fs.cpSync(path.join(test, 'fixtures', 'site'), siteDir, { recursive: true });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'Demo: Ausgangsstand');
}
process.env.FAKE_DEPLOY_LOG = path.join(root, 'deploy.log');
process.env.FAKE_BUILD_MS ||= '1500';

const cfg = loadConfig({
  ADMIN_SITE_DIR: siteDir, ADMIN_DATA_DIR: dataDir, ADMIN_PORT: process.env.ADMIN_PORT || '4400',
  ADMIN_BUILD_CMD: `node ${JSON.stringify(path.join(test, 'fake-build.mjs'))}`,
  ADMIN_DEPLOY_CMD: `node ${JSON.stringify(path.join(test, 'fake-deploy.mjs'))}`,
});
const app = createApp(cfg);
const password = process.env.ADMIN_DEMO_PASSWORD || crypto.randomBytes(9).toString('base64url');
if (!(await app.auth.getUser('demo'))) await app.auth.addUser('demo', password);
else await app.auth.setPassword('demo', password);

http.createServer(app.handler).listen(cfg.port, cfg.host, () => {
  console.log(`ALNO Admin (Demo): http://${cfg.host}:${cfg.port}/wp-admin/`);
  console.log(`  Benutzer: demo   Passwort: ${password}`);
  console.log(`  Ordner:   ${root}  (Build und Deploy sind nur Attrappen)`);
});
