// Markdown collections on disk (contract section 2). The field lists live in schema/collections.json
// and mirror src/content.config.ts; what is valid is decided in rules.js.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitFrontmatter, parseFrontmatter, buildMarkdownFile } from './frontmatter.js';
import { SLUG_RE, imgFromFrontmatter } from '../public/js/rules.js';
import { sha } from './fsutil.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const COLLECTIONS = JSON.parse(fs.readFileSync(path.join(here, '..', 'schema', 'collections.json'), 'utf8'));
export const POST_TYPES = Object.fromEntries(Object.values(COLLECTIONS).map((c) => [c.postType, c.key]));

function dateStr(v) {
  if (v && typeof v === 'object' && v.date) return v.date;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return '';
}

// Frontmatter as the API hands it out; the same shape comes back on save.
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
      case 'image': {
        const alt = f.altKey ? map.get(f.altKey) : '';
        v[f.id] = { value: imgFromFrontmatter(raw), alt: typeof alt === 'string' ? alt : '' };
        break;
      }
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
