// Build → deploy queue. One run at a time; saves made during a run are collected and published by
// exactly one follow-up run. The deploy command only runs after a green build, so a broken change
// never reaches the live site.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { readJsonFile, writeJsonPrivate } from './fsutil.js';

const TAIL = 48 * 1024;

export function runCommand(cmd, { cwd, timeoutMs, env }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = '';
    // The command comes from the server's environment (ADMIN_BUILD_CMD / ADMIN_DEPLOY_CMD), never from a request.
    const child = spawn('/bin/sh', ['-c', cmd], { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const add = (d) => { out += d.toString('utf8'); if (out.length > TAIL * 2) out = out.slice(-TAIL); };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5000).unref();
    }, timeoutMs);
    child.on('error', (e) => { add(`\n${e.message}\n`); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) out += `\n[Abgebrochen: Zeitlimit von ${Math.round(timeoutMs / 1000)} s überschritten]\n`;
      resolve({ ok: code === 0 && !timedOut, code, signal, durationMs: Date.now() - started, log: out.slice(-TAIL) });
    });
  });
}

export function createPublisher({ siteDir, dataDir, buildCmd, deployCmd, gitPush, git, buildTimeoutMs = 900e3, log = () => {} }) {
  const statusFile = path.join(dataDir, 'status.json');
  let status = null;
  let running = null;
  let pendingReasons = [];

  async function load() {
    if (status) return status;
    status = await readJsonFile(statusFile, null) || { seq: 0, state: 'idle', history: [] };
    if (status.state !== 'idle') {
      // The admin was stopped during a run: nothing was deployed by us after that point.
      status.history.unshift({ id: status.seq, from: status.runningFrom ?? status.seq, upTo: status.seq, at: new Date().toISOString(), ok: false, phase: 'build', log: 'Unterbrochen: der Admin wurde während der Aktualisierung beendet.' });
      status.state = 'idle';
      status.lastError = status.history[0];
    }
    status.history = status.history || [];
    return status;
  }
  const save = () => writeJsonPrivate(statusFile, status);

  async function request(reason, user) {
    await load();
    status.seq++;
    const id = status.seq;
    pendingReasons.push({ id, reason, user });
    await save();
    kick();
    return id;
  }

  function kick() {
    if (running) return;
    running = loop().finally(() => {
      running = null;
      if (pendingReasons.length) kick();
    });
  }

  async function loop() {
    while (pendingReasons.length) {
      const batch = pendingReasons; pendingReasons = [];
      const from = batch[0].id; const upTo = batch[batch.length - 1].id;
      const run = { from, upTo, at: new Date().toISOString(), reasons: batch.map((b) => `${b.reason} (${b.user})`), ok: false, phase: 'build' };
      status.state = 'building'; status.runningFrom = from; status.runningUpTo = upTo;
      await save();
      const commit = git ? await git.head() : null;
      run.commit = commit;
      const b = await runCommand(buildCmd, { cwd: siteDir, timeoutMs: buildTimeoutMs, env: {} });
      run.build = { ok: b.ok, code: b.code, durationMs: b.durationMs };
      status.lastBuild = { at: new Date().toISOString(), ok: b.ok, durationMs: b.durationMs, commit };
      log({ event: 'build', ok: b.ok, durationMs: b.durationMs, from, upTo });
      if (!b.ok) {
        run.log = b.log;
        finish(run);
        await save();
        continue;
      }
      if (gitPush && git) {
        try { await git.push(); run.push = { ok: true }; } catch (e) { run.push = { ok: false, error: e.message }; log({ event: 'push', ok: false, error: e.message }); }
      }
      run.phase = 'deploy';
      status.state = 'deploying';
      await save();
      const d = await runCommand(deployCmd, { cwd: siteDir, timeoutMs: buildTimeoutMs, env: {} });
      status.lastDeploy = { at: new Date().toISOString(), ok: d.ok, durationMs: d.durationMs, commit };
      log({ event: 'deploy', ok: d.ok, durationMs: d.durationMs, from, upTo });
      run.deploy = { ok: d.ok, code: d.code, durationMs: d.durationMs };
      run.ok = d.ok;
      if (!d.ok) run.log = d.log;
      else run.phase = 'done';
      finish(run);
      await save();
    }
    status.state = 'idle';
    delete status.runningFrom; delete status.runningUpTo;
    await save();
  }

  function finish(run) {
    status.done = run.upTo;
    status.history.unshift(run);
    status.history = status.history.slice(0, 30);
    if (!run.ok) status.lastError = run;
    else status.lastError = null;
  }

  // State of one save: 'queued' | 'building' | 'deploying' | 'done' | 'failed'.
  async function job(id) {
    await load();
    const run = status.history.find((r) => id >= r.from && id <= r.upTo);
    if (run) return { id, state: run.ok ? 'done' : 'failed', phase: run.phase, log: run.log || '', at: run.at };
    if (status.state !== 'idle' && id >= status.runningFrom && id <= status.runningUpTo) return { id, state: status.state };
    if (id > 0 && id <= status.seq) return { id, state: 'queued' };
    return { id, state: 'unknown' };
  }

  async function snapshot() {
    await load();
    return structuredClone(status);
  }

  return { request, job, snapshot, async idle() { while (running) await running; } };
}
