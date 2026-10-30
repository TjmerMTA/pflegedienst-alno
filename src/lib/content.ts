// Тексты и картинки страниц из src/content/pages/<id>.json — формат в docs/admin-content-format.md.
// Читается при сборке. Нет файла или поля — сборка падает с понятной ошибкой: структуру держит код,
// значения правит админка, и сайт обязан собраться с любым значением, которое она может сохранить.
import type { ImageMetadata } from 'astro';

type FieldType = 'text' | 'textarea' | 'richtext' | 'image' | 'list';
interface Field {
  id: string;
  label: string;
  type: FieldType;
  value: unknown;
  alt?: string;
  required?: boolean;
  fields?: Field[];
}
interface Group { id: string; label: string; fields: Field[] }
interface PageFile { label: string; url: string | null; order: number; groups: Group[] }

export interface Img { src: ImageMetadata; alt: string }
export interface Page {
  text(path: string): string;
  html(path: string): string;
  textHtml(path: string): string;
  img(path: string): Img | null;
  list<T = Record<string, string>>(path: string): T[];
}

const files = import.meta.glob<PageFile>('/src/content/pages/*.json', { eager: true, import: 'default' });
// Библиотека картинок: всё, что лежит в src/assets/img/ (в JSON — путь относительно этой папки)
const images = import.meta.glob<ImageMetadata>('/src/assets/img/**/*.{jpg,jpeg,png,webp}', { eager: true, import: 'default' });

const fail = (msg: string): never => { throw new Error(`[content] ${msg}`); };

// Экранирование текста для set:html — ровно настолько, насколько нужно: «<» и «&», с которого
// мог бы начаться HTML-символ. Так «Kosten & Finanzierung» и «geht's» выходят байт в байт
// как написанные прямо в разметке (обычное {выражение} дало бы &amp; и &#39;).
export const escText = (s: string) => s.replace(/</g, '&lt;').replace(/&(?=[#a-zA-Z0-9])/g, '&amp;');

// Richtext: только p br strong b em i a[href] ul ol li h2 h3, всё остальное вырезается.
// Разрешённые теги без атрибутов остаются как были, у <a> остаётся только безопасный href.
const ALLOWED = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'a', 'ul', 'ol', 'li', 'h2', 'h3']);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|template|noscript|textarea|title|select|svg|math)\b[\s\S]*?<\/\1\s*>/gi;

function safeHref(attrs: string): string {
  const m = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
  const href = (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim();
  // Схему проверяем после раскодирования сущностей и без пробелов: браузер делает так же
  const plain = href
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&colon;/gi, ':')
    .replace(/[\u0000- ]|&tab;|&newline;/gi, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(plain)?.[1].toLowerCase();
  if (!href || (scheme && !['http', 'https', 'mailto', 'tel'].includes(scheme))) return '';
  return href.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function sanitize(html: string): string {
  return html
    .replace(DROP_WITH_CONTENT, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|</g, (m, close: string, name: string, attrs: string) => {
      if (!name) return '&lt;';
      const tag = name.toLowerCase();
      if (!ALLOWED.has(tag)) return '';
      if (close) return tag === 'br' ? '' : `</${tag}>`;
      if (tag === 'a') {
        const href = safeHref(attrs);
        return href ? `<a href="${href}">` : '<a>';
      }
      return /^\s*\/?\s*$/.test(attrs) ? m : `<${tag}>`;
    });
}

// Токены {{key}} — значения поля key из группы contact в _global.json
let tokenMap: Map<string, string> | undefined;
function tokens(): Map<string, string> {
  if (!tokenMap) {
    const contact = load('_global').groups.find((g) => g.id === 'contact')
      ?? fail('src/content/pages/_global.json: group "contact" (token values) not found');
    tokenMap = new Map(contact.fields.filter((f) => f.type === 'text' || f.type === 'textarea').map((f) => [f.id, String(f.value)]));
  }
  return tokenMap;
}
function fillTokens(s: string, where: string, esc: (v: string) => string = (v) => v): string {
  return s.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (m, key: string) => {
    const v = tokens().get(key);
    // Неизвестный токен не валит сборку (его может сохранить админка) — остаётся как есть
    if (v === undefined) { console.warn(`[content] ${where}: unknown token ${m}, left as is`); return m; }
    return esc(v);
  });
}

function load(id: string): PageFile {
  const file = `src/content/pages/${id}.json`;
  const data = files[`/${file}`] ?? fail(`${file} not found (getPage('${id}'))`);
  if (!Array.isArray(data.groups)) fail(`${file}: "groups" must be an array`);
  return data;
}

const cache = new Map<string, Page>();

export function getPage(id: string): Page {
  const cached = cache.get(id);
  if (cached) return cached;
  const file = `src/content/pages/${id}.json`;
  const data = load(id);

  const field = (path: string, ...types: FieldType[]): Field => {
    const [groupId, fieldId, ...rest] = path.split('.');
    if (!groupId || !fieldId || rest.length) fail(`${file}: path "${path}" must be "group.field"`);
    const group = data.groups.find((g) => g.id === groupId) ?? fail(`${file}: group "${groupId}" not found (field "${path}")`);
    const f = group.fields.find((x) => x.id === fieldId) ?? fail(`${file}: field "${path}" not found`);
    if (!types.includes(f.type)) fail(`${file}: field "${path}" is "${f.type}", expected ${types.join(' or ')}`);
    return f;
  };
  const str = (v: unknown, f: Field, path: string): string => {
    if (v == null) v = '';
    if (typeof v !== 'string') fail(`${file}: value of "${path}" must be a string`);
    if (f.required && !(v as string).trim()) fail(`${file}: required field "${path}" is empty`);
    return v as string;
  };
  const textOf = (v: unknown, f: Field, path: string) => fillTokens(str(v, f, path), `${file} "${path}"`);
  const htmlOf = (v: unknown, f: Field, path: string) => sanitize(fillTokens(str(v, f, path), `${file} "${path}"`, escText));
  const imgOf = (v: unknown, alt: unknown, f: Field, path: string): Img | null => {
    const src = str(v, f, path);
    if (!src) return null;
    const meta = images[`/src/assets/img/${src}`] ?? fail(`${file}: image "${src}" of "${path}" not found in src/assets/img/`);
    return { src: meta, alt: alt == null ? '' : fillTokens(String(alt), `${file} "${path}" alt`) };
  };

  const page: Page = {
    text: (path) => { const f = field(path, 'text', 'textarea'); return textOf(f.value, f, path); },
    html: (path) => { const f = field(path, 'richtext'); return htmlOf(f.value, f, path); },
    // Текстовое поле как HTML для set:html — там, где текст раньше стоял прямо в разметке
    textHtml: (path) => escText(page.text(path)),
    img: (path) => { const f = field(path, 'image'); return imgOf(f.value, f.alt, f, path); },
    list: <T>(path: string): T[] => {
      const f = field(path, 'list');
      if (!Array.isArray(f.value)) fail(`${file}: value of "${path}" must be an array`);
      const subs = f.fields ?? fail(`${file}: list "${path}" has no "fields"`);
      return (f.value as Record<string, unknown>[]).map((item, i) => {
        const out: Record<string, string> = {};
        for (const s of subs) {
          const p = `${path}[${i}].${s.id}`;
          if (s.type === 'richtext') out[s.id] = htmlOf(item?.[s.id], s, p);
          else if (s.type === 'text' || s.type === 'textarea') out[s.id] = textOf(item?.[s.id], s, p);
          else fail(`${file}: sub-field type "${s.type}" in list "${path}" is not supported`);
        }
        return out as T;
      });
    },
  };
  cache.set(id, page);
  return page;
}

export const getGlobal = (): Page => getPage('_global');
