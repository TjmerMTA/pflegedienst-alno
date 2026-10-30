// Настоящий Chrome без зависимостей: DevTools Protocol через встроенный WebSocket.
// Браузер — из CHROME_PATH, иначе стандартные пути macOS и Linux.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PATHS = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
const TIMEOUT = 20000;

const timed = (promise, what) => {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Chrome: нет ответа за ${TIMEOUT} мс: ${what}`)), TIMEOUT); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
};

export async function launch() {
  const path = PATHS.find((p) => p && existsSync(p));
  if (!path) throw new Error('Chrome не найден: задайте CHROME_PATH');
  const profile = mkdtempSync(join(tmpdir(), 'alno-chrome-'));
  const proc = spawn(path, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await timed(new Promise((resolve) => {
    let log = '';
    proc.stderr.on('data', (d) => { log += d; const m = /DevTools listening on (ws:\S+)/.exec(log); if (m) resolve(m[1]); });
  }), 'запуск');

  const ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    } else listeners.forEach((fn) => fn(msg));
  };
  const send = (method, params = {}, sessionId) => timed(new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  }), method);

  async function newPage({ width = 1280, height = 900 } = {}) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const call = (method, params) => send(method, params, sessionId);
    // Копятся за все переходы: нарушения CSP, ошибки скриптов и заголовков. Сетевые сбои сюда не входят
    const problems = [];
    const listener = (msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.exceptionThrown') problems.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && msg.params.entry.source !== 'network') problems.push(`${msg.params.entry.source}: ${msg.params.entry.text}`);
    };
    listeners.add(listener);
    await call('Page.enable');
    await call('Runtime.enable');
    await call('Log.enable');
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (exceptionDetails) throw new Error(`${expression.slice(0, 80)}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
      return result.value;
    };
    return {
      problems,
      evaluate,
      open: async (url) => {
        const loaded = timed(new Promise((resolve) => {
          const once = (msg) => { if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired') { listeners.delete(once); resolve(); } };
          listeners.add(once);
        }), `загрузка ${url}`);
        await call('Page.navigate', { url });
        await loaded;
      },
      click: (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('нет элемента ' + ${JSON.stringify(selector)}); el.click(); })()`),
      close: async () => { listeners.delete(listener); await send('Target.closeTarget', { targetId }); },
    };
  }

  return {
    newPage,
    close: async () => {
      ws.close();
      proc.kill();
      await new Promise((resolve) => { proc.once('exit', resolve); setTimeout(resolve, 2000); });
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
