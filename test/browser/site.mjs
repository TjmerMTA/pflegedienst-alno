// Сборка на временной копии и раздача dist. Копия лежит рядом с проектом: node_modules находятся
// поиском вверх по папкам, а настоящие контент и dist тесты не трогают.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative } from 'node:path';

const astro = join(dirname(createRequire(import.meta.url).resolve('astro/package.json')), 'bin/astro.mjs');

export function copySite() {
  const root = mkdtempSync(join(process.cwd(), '.tmp-site-'));
  for (const item of ['src', 'public', 'astro.config.mjs', 'package.json', 'tsconfig.json']) {
    if (existsSync(item)) cpSync(item, join(root, item), { recursive: true });
  }
  return root;
}

export function build(root, env = {}) {
  const run = spawnSync(process.execPath, [astro, 'build'], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`сборка упала:\n${(run.stdout + run.stderr).slice(-1500)}`);
  return join(root, 'dist');
}

export const pagesOf = (dist) => {
  const walk = (d) => readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.html') ? [p] : [];
  });
  return walk(dist).map((p) => `/${relative(dist, p)}`.replace(/index\.html$/, '')).sort();
};

// Строки Header always set из .htaccess: так проверяется ровно то, что уйдёт на Apache
export const htaccessHeaders = (dist) => Object.fromEntries(
  [...readFileSync(join(dist, '.htaccess'), 'utf8').matchAll(/^\s*Header always set (\S+) "(.*)"\s*$/gm)].map((m) => [m[1], m[2]]),
);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };

export async function serve(dist, headers = {}) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    if (req.method === 'POST') { req.resume(); res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); return; }
    let file = join(dist, path, path.endsWith('/') ? 'index.html' : '');
    const found = file.startsWith(dist) && existsSync(file) && statSync(file).isFile();
    if (!found) { res.statusCode = 404; file = join(dist, '404.html'); }
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

// Ход Рехнера: шаги и элементы, которые скрипт строит строками HTML. Сетка и подсказки живут
// только на своём шаге, поэтому after(имя) вызывается после каждого действия, а не в конце
export async function walkRechner(page, base, after = async () => {}) {
  const step = async (name, action) => { await action(); await after(name); };
  await page.open(`${base}/pflege-rechner/`);
  await page.evaluate(`localStorage.clear()`);
  await page.open(`${base}/pflege-rechner/`);
  await after('старт');
  await step('режим Pflegegeld', () => page.click('.mode[data-mode="geld"]'));
  await step('режим Kombi', () => page.click('.mode[data-mode="kombi"]'));
  await step('Pflegegrad', () => page.click('.pg[data-pg="3"]'));
  await step('шаг 2', () => page.click('#to2'));
  await step('категории', () => page.click('#chips .chip'));
  await step('услуга: сетка', () => page.click('.svc'));
  await step('ячейка', () => page.click('.cell'));
  await step('пресет', () => page.click('[data-preset="0"]'));
  await step('в план', () => page.click('#add'));
  await step('шаг 3', () => page.click('#to3'));
  await step('вкладка Entlastung', () => page.click('.tab[data-tab="ent"]'));
  await step('часы', () => page.evaluate(`(() => { const r = document.querySelector('#e-hours'); r.value = 5; r.dispatchEvent(new Event('input')); })()`));
}

// Формы: пустая отправка показывает сообщения об ошибках, поля и подписи уже в странице
export async function walkForms(page, base, path) {
  await page.open(`${base}${path}`);
  await page.evaluate(`document.querySelectorAll('form').forEach((f) => f.requestSubmit())`);
}

