// Markdown collections (contract section 2): blog, leistungen, team.
// Field lists mirror src/content.config.ts. Unknown frontmatter keys are kept as they are.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { splitFrontmatter, parseFrontmatter, buildMarkdownFile } from './frontmatter.js';
import { sanitizeMarkdown } from './markdown.js';
import { looksLikeHtml } from './sanitize.js';
import { isImagePath } from './pages.js';
import { SLUG_RE, sha } from './fsutil.js';

export const ICONS = ['heart', 'shield', 'hands', 'cross', 'home', 'calendar', 'users', 'euro', 'check', 'arrow', 'chat', 'award', 'clipboard', 'star', 'car', 'info', 'phone', 'mail', 'pin', 'clock'];

// box: where the field is shown on the edit screen ('title' | 'main' | 'side').
export const COLLECTIONS = {
  blog: {
    dir: 'blog', postType: 'post', canCreate: true, canDelete: true, body: true, urlPrefix: '/blog/',
    fields: [
      { id: 'title', type: 'text', label: 'Titel (H1 und Meta Title)', required: true, box: 'title' },
      { id: 'description', type: 'textarea', label: 'Meta Description', required: true, max: 170, box: 'main', group: 'seo' },
      { id: 'date', type: 'date', label: 'Veröffentlicht am', required: true, box: 'side', group: 'publish' },
      { id: 'updated', type: 'date', label: 'Aktualisiert am', box: 'side', group: 'publish' },
      { id: 'draft', type: 'boolean', label: 'Entwurf – nicht auf der Website zeigen', box: 'side', group: 'publish' },
      { id: 'author', type: 'text', label: 'Autor', placeholder: 'Team Pflegedienst ALNO', box: 'main', group: 'more' },
      { id: 'tags', type: 'tags', label: 'Schlagwörter', help: 'Durch Kommas trennen', box: 'side', group: 'tags' },
      { id: 'image', type: 'image', label: 'Beitragsbild', altKey: 'imageAlt', box: 'side', group: 'image' },
    ],
  },
  leistungen: {
    dir: 'leistungen', postType: 'leistung', canCreate: false, canDelete: false, body: true, urlPrefix: '/leistungen/',
    fields: [
      { id: 'title', type: 'text', label: 'Name der Leistung', required: true, box: 'title' },
      { id: 'metaTitle', type: 'text', label: 'Meta Title', required: true, max: 70, box: 'main', group: 'seo' },
      { id: 'description', type: 'textarea', label: 'Meta Description', required: true, max: 170, box: 'main', group: 'seo' },
      { id: 'teaser', type: 'textarea', label: 'Kurztext (Karte auf der Startseite)', required: true, box: 'main', group: 'card' },
      { id: 'icon', type: 'select', label: 'Symbol', required: true, options: ICONS, box: 'side', group: 'attrs' },
      { id: 'order', type: 'number', label: 'Reihenfolge', required: true, box: 'side', group: 'attrs' },
      { id: 'payer', type: 'text', label: 'Wer bezahlt?', required: true, box: 'main', group: 'card' },
      { id: 'highlights', type: 'strings', label: 'Leistungspunkte', itemLabel: 'Punkt', required: true, box: 'main', group: 'card' },
    ],
  },
  team: {
    dir: 'team', postType: 'team', canCreate: true, canDelete: true, body: false, url: '/ueber-uns/',
    fields: [
      { id: 'name', type: 'text', label: 'Name', required: true, box: 'title' },
      { id: 'role', type: 'text', label: 'Funktion', required: true, box: 'main', group: 'person' },
      { id: 'description', type: 'textarea', label: 'Beschreibung', box: 'main', group: 'person' },
      { id: 'order', type: 'number', label: 'Reihenfolge', placeholder: '100', box: 'side', group: 'attrs' },
      { id: 'hidden', type: 'boolean', label: 'Auf der Website ausblenden', box: 'side', group: 'attrs' },
      { id: 'photo', type: 'image', label: 'Foto', box: 'side', group: 'image' },
    ],
  },
};

export const POST_TYPES = { post: 'blog', leistung: 'leistungen', team: 'team' };

const IMG_PREFIX = '../../assets/img/';
const chars = (s) => Array.from(String(s ?? '')).length;

export function imgFromFrontmatter(v) {
  if (typeof v !== 'string' || !v) return '';
  return v.startsWith(IMG_PREFIX) ? v.slice(IMG_PREFIX.length) : '';
}

function dateStr(v) {
  if (v && typeof v === 'object' && v.date) return v.date;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return '';
}

// Values as the edit form shows them.
export function formValues(coll, entries) {
  const map = new Map(entries);
  const v = {};
  for (const f of COLLECTIONS[coll].fields) {
    const raw = map.get(f.id);
    switch (f.type) {
      case 'date': v[f.id] = dateStr(raw); break;
      case 'boolean': v[f.id] = raw === true; break;
      case 'number': v[f.id] = raw === null || raw === undefined ? '' : String(raw); break;
      case 'tags': case 'strings': v[f.id] = Array.isArray(raw) ? raw.map((x) => (x && x.date ? x.date : String(x ?? ''))) : []; break;
      case 'image':
        v[f.id] = imgFromFrontmatter(raw);
        v[`${f.id}__raw`] = raw ?? '';
        if (f.altKey) v[f.altKey] = typeof map.get(f.altKey) === 'string' ? map.get(f.altKey) : '';
        break;
      default: v[f.id] = raw === null || raw === undefined ? '' : (raw.date ? raw.date : String(raw));
    }
  }
  return v;
}

export async function readEntry(dir, slug) {
  if (!SLUG_RE.test(slug)) throw new Error('Ungültiger Name');
  const file = path.join(dir, `${slug}.md`);
  const text = await fsp.readFile(file, 'utf8');
  const { fm, body } = splitFrontmatter(text);
  const entries = parseFrontmatter(fm);
  return { slug, file, text, hash: sha(text), entries, body: body.replace(/^\n+/, '') };
}

export async function listEntries(coll, dir) {
  let names = [];
  try { names = await fsp.readdir(dir); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.md')) continue;
    const slug = n.slice(0, -3);
    if (!SLUG_RE.test(slug)) continue;
    try {
      const e = await readEntry(dir, slug);
      const stat = await fsp.stat(e.file);
      out.push({ slug, values: formValues(coll, e.entries), mtime: stat.mtime });
    } catch (err) {
      out.push({ slug, error: err.message, values: {} });
    }
  }
  return out;
}

function clean(s, multiline) {
  let v = typeof s === 'string' ? s : '';
  v = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (!multiline) v = v.replace(/\n+/g, ' ');
  return v.trim();
}

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Builds new frontmatter entries from the form. Returns { entries, body, errors }.
export function applyForm(coll, oldEntries, input, ctx = {}) {
  const def = COLLECTIONS[coll];
  const errors = [];
  const err = (f, msg) => errors.push({ path: f.id, label: f.label, msg });
  const next = new Map(oldEntries);
  const set = (k, v) => { if (v === undefined) next.delete(k); else next.set(k, v); };
  for (const f of def.fields) {
    const raw = input[f.id];
    switch (f.type) {
      case 'text': case 'textarea': case 'select': {
        const v = clean(raw, f.type === 'textarea');
        if (f.required && !v) { err(f, 'Pflichtfeld'); break; }
        if (f.max && chars(v) > f.max) err(f, `höchstens ${f.max} Zeichen (jetzt ${chars(v)})`);
        if (looksLikeHtml(v)) err(f, 'HTML ist hier nicht erlaubt');
        if (f.type === 'select' && v && !f.options.includes(v)) err(f, 'ungültige Auswahl');
        set(f.id, v || undefined);
        break;
      }
      case 'date': {
        const v = clean(raw);
        if (!v) { if (f.required) err(f, 'Pflichtfeld'); set(f.id, undefined); break; }
        if (!validDate(v)) { err(f, 'ungültiges Datum'); break; }
        set(f.id, { date: v });
        break;
      }
      case 'number': {
        const v = clean(raw);
        if (!v) { if (f.required) err(f, 'Pflichtfeld'); set(f.id, undefined); break; }
        if (!/^-?\d{1,6}(\.\d{1,3})?$/.test(v)) { err(f, 'keine Zahl'); break; }
        set(f.id, Number(v));
        break;
      }
      case 'boolean': {
        const v = raw === 'on' || raw === '1' || raw === true;
        // Keep the key if it was there before, otherwise only write `true`.
        set(f.id, v ? true : (next.has(f.id) ? false : undefined));
        break;
      }
      case 'tags': {
        const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(',')).map((x) => clean(x)).filter(Boolean);
        const uniq = [...new Set(list)];
        if (uniq.some((t) => looksLikeHtml(t) || chars(t) > 60)) err(f, 'ungültiges Schlagwort');
        set(f.id, uniq.length || next.has(f.id) ? uniq : undefined);
        break;
      }
      case 'strings': {
        const items = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.entries(raw).filter(([k]) => k !== '_').map(([, x]) => x) : (typeof raw === 'string' && raw ? [raw] : []));
        const list = items.map((x) => clean(typeof x === 'object' ? x?.text : x)).filter(Boolean);
        if (f.required && !list.length) err(f, 'mindestens ein Eintrag');
        if (list.some(looksLikeHtml)) err(f, 'HTML ist hier nicht erlaubt');
        set(f.id, list);
        break;
      }
      case 'image': {
        const o = raw && typeof raw === 'object' ? raw : { value: raw };
        const v = clean(o.value ?? '');
        if (!v) {
          // A path the library cannot show (outside src/assets/img) is not the user's removal.
          if (next.get(f.id) && !imgFromFrontmatter(next.get(f.id))) break;
          set(f.id, undefined);
          if (f.altKey) set(f.altKey, undefined);
          break;
        }
        if (!isImagePath(v)) { err(f, 'ungültiger Bildpfad'); break; }
        if (ctx.imageExists && !ctx.imageExists(v)) { err(f, `Bild „${v}“ nicht gefunden`); break; }
        set(f.id, IMG_PREFIX + v);
        if (f.altKey) {
          const alt = clean(o.alt ?? '');
          if (!alt) err({ id: f.altKey, label: `${f.label}: Alternativtext` }, 'Pflichtfeld, wenn ein Bild gesetzt ist');
          set(f.altKey, alt || undefined);
        }
        break;
      }
    }
  }
  // Order: keys in the order of the old file, new keys in schema order.
  const order = [...oldEntries.map(([k]) => k)];
  for (const f of def.fields) { if (!order.includes(f.id)) order.push(f.id); if (f.altKey && !order.includes(f.altKey)) order.push(f.altKey); }
  const entries = order.filter((k) => next.has(k)).map((k) => [k, next.get(k)]);
  const body = def.body ? sanitizeMarkdown(typeof input.body === 'string' ? input.body : '').replace(/\s+$/, '') : '';
  return { entries, body, errors };
}

export function serializeEntry(coll, entries, body) {
  const flow = COLLECTIONS[coll].fields.filter((f) => f.type === 'tags').map((f) => f.id);
  return buildMarkdownFile(entries, body, flow);
}

export function entryImageRefs(coll, entries) {
  const map = new Map(entries);
  const out = [];
  for (const f of COLLECTIONS[coll].fields) {
    if (f.type !== 'image') continue;
    const p = imgFromFrontmatter(map.get(f.id));
    if (p) out.push({ path: p, alt: f.altKey ? (map.get(f.altKey) || '') : '', where: f.label });
  }
  return out;
}

export function titleOf(coll, values) {
  return coll === 'team' ? values.name : values.title;
}
