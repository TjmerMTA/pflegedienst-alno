import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPublisher, runCommand } from '../lib/publish.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'alno-publish-'));
const ok = 'node -e "0"';
const fail = 'node -e "process.exit(3)"';

test('a status file that cannot be written does not stop publishing', async (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'status.json')); // rename onto a folder fails
  const events = [];
  const marker = path.join(dir, 'deployed');
  const p = createPublisher({ siteDir: dir, dataDir: dir, buildCmd: ok, deployCmd: `node -e "require('fs').writeFileSync('${marker}','')"`, log: (e) => events.push(e) });
  const id = await p.request('x', 'u');
  await p.idle();
  assert.ok(fs.existsSync(marker), 'the deploy still ran');
  assert.equal((await p.job(id)).state, 'done');
  assert.ok(events.some((e) => e.event === 'status-write-failed'));
});

test('a red build still blocks the deploy when the status file cannot be written', async (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'status.json'));
  const marker = path.join(dir, 'deployed');
  const p = createPublisher({ siteDir: dir, dataDir: dir, buildCmd: fail, deployCmd: `node -e "require('fs').writeFileSync('${marker}','')"` });
  const id = await p.request('x', 'u');
  await p.idle();
  assert.equal(fs.existsSync(marker), false);
  assert.equal((await p.job(id)).state, 'failed');
});

test('a damaged status file does not block saving', async (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'status.json'), '{ kaputt');
  const p = createPublisher({ siteDir: dir, dataDir: dir, buildCmd: ok, deployCmd: ok });
  const id = await p.request('x', 'u');
  await p.idle();
  assert.equal((await p.job(id)).state, 'done');
});

test('a command that cannot start is a failed build, not a hang', async (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = await runCommand(ok, { cwd: path.join(dir, 'gibt-es-nicht'), timeoutMs: 5000, env: {} });
  assert.equal(r.ok, false);
  const p = createPublisher({ siteDir: path.join(dir, 'gibt-es-nicht'), dataDir: dir, buildCmd: ok, deployCmd: ok });
  const id = await p.request('x', 'u');
  await p.idle();
  assert.equal((await p.job(id)).state, 'failed');
});

test('a build over the time limit is killed and counts as failed', async () => {
  const r = await runCommand('node -e "setTimeout(()=>{},60000)"', { cwd: os.tmpdir(), timeoutMs: 200, env: {} });
  assert.equal(r.ok, false);
  assert.match(r.log, /Zeitlimit/);
});
