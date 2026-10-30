// Защита публичного сайта при сборке: Markdown без сырого HTML и опасных ссылок, CSP с хешами для .htaccess.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeScheme } from './safe-url.mjs';

// Тело статьи правит админка, а движок отдаёт сырой HTML и любые ссылки как есть. Сырой HTML выходит
// текстом — как в админке (Rules::sanitizeMarkdown), но здесь это не зависит от того, откуда пришёл файл.
export const safeMarkdown = {
  name: 'alno-safe-markdown',
  raw(node, ctx) { ctx.replaceNode(node, { type: 'text', value: node.value }); },
  element: {
    filter: ['a'],
    visit(node, ctx) { if (!safeScheme(String(node.properties?.href ?? ''))) ctx.setProperty(node, 'href', undefined); },
  },
};

const sha256 = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

// Хеши инлайновых <script> и <style>. Внешние скрипты идут по 'self', а JSON-LD — данные: браузер их
// не исполняет, и CSP их не касается
export function inlineHashes(html) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(([, attrs]) => !/\bsrc\s*=/i.test(attrs) && !/\btype\s*=\s*["']?application\/(ld\+)?json/i.test(attrs))
    .map(([, , text]) => sha256(text));
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map(([, text]) => sha256(text));
  return { scripts, styles };
}

const GA = {
  script: ['https://www.googletagmanager.com'],
  connect: ['https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com'],
  img: ['https://*.google-analytics.com', 'https://*.googletagmanager.com'],
};

// style-src-attr: 'unsafe-inline' только для атрибутов style: иконки (Icon.astro) и Рехнер. Значения в них
// задаёт код, а блоки <style> остаются под хешами
export function buildPolicy({ scripts = [], styles = [], connect = [], ga = false }) {
  const list = (...parts) => parts.flat().join(' ');
  return [
    "default-src 'none'",
    `script-src ${list("'self'", scripts, ga ? GA.script : [])}`,
    `style-src ${list("'self'", styles)}`,
    "style-src-attr 'unsafe-inline'",
    `img-src ${list("'self'", 'data:', ga ? GA.img : [])}`,
    "font-src 'self'",
    `connect-src ${list("'self'", connect, ga ? GA.connect : [])}`,
    'frame-src https://www.openstreetmap.org',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

// Что нужно политике, читается из готовых страниц: так она всегда совпадает с тем, что уйдёт на сервер
export function policyFor(pages) {
  const scripts = new Set(), styles = new Set(), connect = new Set();
  let ga = false;
  for (const html of pages) {
    const found = inlineHashes(html);
    found.scripts.forEach((h) => scripts.add(h));
    found.styles.forEach((h) => styles.add(h));
    for (const [, origin] of html.matchAll(/\bdata-endpoint="(https?:\/\/[^"/]+)/g)) connect.add(origin);
    ga ||= html.includes('id="consent"');
  }
  return buildPolicy({ scripts: [...scripts].sort(), styles: [...styles].sort(), connect: [...connect].sort(), ga });
}

const htmlFiles = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? htmlFiles(path) : path.endsWith('.html') ? [path] : [];
});

export function hardening() {
  return {
    name: 'alno-hardening',
    hooks: {
      'astro:config:setup': ({ config }) => {
        const plugins = config.markdown.processor?.options?.hastPlugins;
        // Другой движок Markdown — другой API: лучше упасть, чем тихо потерять защиту
        if (!plugins) throw new Error('[hardening] markdown processor has no hastPlugins: Markdown would stay unsanitized');
        plugins.push(safeMarkdown);
      },
      'astro:build:done': ({ dir }) => {
        const root = fileURLToPath(dir);
        const file = join(root, '.htaccess');
        const template = readFileSync(file, 'utf8');
        // Ровно одна метка: вторая, например в комментарии, оставила бы сайт без политики
        if (template.split('__CSP__').length !== 2) throw new Error('[hardening] public/.htaccess must contain __CSP__ exactly once');
        const policy = policyFor(htmlFiles(root).map((path) => readFileSync(path, 'utf8')));
        writeFileSync(file, template.replace('__CSP__', policy));
      },
    },
  };
}
