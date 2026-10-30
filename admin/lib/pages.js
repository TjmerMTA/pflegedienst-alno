// Page files src/content/pages/<id>.json on disk (contract section 1). What is valid is decided in
// rules.js; here is reading them and what can be derived from a page.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PAGE_ID_RE, checkStructure, itemImage } from '../public/js/rules.js';

export async function listPageFiles(pagesDir) {
  let names = [];
  try { names = await fsp.readdir(pagesDir); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -5);
    if (!PAGE_ID_RE.test(id)) continue;
    const file = path.join(pagesDir, name);
    try {
      const page = JSON.parse(await fsp.readFile(file, 'utf8'));
      const stat = await fsp.stat(file);
      out.push({ id, label: page.label || id, url: page.url ?? null, order: Number(page.order ?? 999), mtime: stat.mtime, structureErrors: checkStructure(page) });
    } catch (e) {
      out.push({ id, label: id, url: null, order: 9999, error: e.message, structureErrors: [] });
    }
  }
  out.sort((a, b) => (a.id === '_global') - (b.id === '_global') || a.order - b.order || a.label.localeCompare(b.label));
  return out;
}

// For «Wiederherstellen»: values of an old version, poured into the current structure. Fields that
// no longer exist are ignored; new fields keep their current value.
export function mergeOldValues(current, old) {
  const out = structuredClone(current);
  for (const g of out.groups) {
    const og = (old.groups || []).find((x) => x.id === g.id);
    if (!og) continue;
    for (const f of g.fields) {
      const of = (og.fields || []).find((x) => x.id === f.id && x.type === f.type);
      if (!of) continue;
      if (f.type === 'list') {
        if (!Array.isArray(of.value)) continue;
        f.value = of.value.map((item) => Object.fromEntries(f.fields.map((s) => [s.id, s.type === 'image' ? itemImage(item, s) : (item?.[s.id] ?? '')])));
      } else {
        f.value = of.value;
        if (f.type === 'image') f.alt = of.value ? (of.alt ?? '') : '';
      }
    }
  }
  return out;
}

export function serializePage(page) {
  return JSON.stringify(page, null, 2) + '\n';
}

// Every image path referenced in a page (for «verwendet auf»).
export function pageImageRefs(page) {
  const refs = [];
  for (const g of page.groups || []) {
    for (const f of g.fields || []) {
      if (f.type === 'image' && f.value) refs.push({ path: f.value, alt: f.alt || '', where: `${g.label} › ${f.label}` });
      if (f.type === 'list' && Array.isArray(f.value)) {
        for (const sub of f.fields || []) {
          if (sub.type !== 'image') continue;
          f.value.forEach((item, i) => {
            const im = itemImage(item, sub);
            if (im.value) refs.push({ path: im.value, alt: im.alt, where: `${g.label} › ${f.itemLabel || f.label} ${i + 1}` });
          });
        }
      }
    }
  }
  return refs;
}

// A page as readable lines («Gruppe › Feld: Wert») for the revision comparison: what changed for
// the editor, without the JSON around it.
export function pageLines(page) {
  const lines = [];
  const show = (s) => String(s ?? '').replace(/\n/g, ' ⏎ ');
  const img = (v, alt) => (v ? `${v} (Alt: ${alt ?? ''})` : '—');
  for (const g of page.groups || []) {
    for (const f of g.fields || []) {
      const p = `${g.label} › ${f.label}`;
      if (f.type === 'image') lines.push(`${p}: ${img(f.value, f.alt)}`);
      else if (f.type === 'list') {
        (Array.isArray(f.value) ? f.value : []).forEach((item, i) => {
          for (const sub of f.fields || []) {
            const q = `${g.label} › ${f.itemLabel || f.label} ${i + 1} › ${sub.label}`;
            if (sub.type === 'image') { const im = itemImage(item, sub); lines.push(`${q}: ${img(im.value, im.alt)}`); }
            else lines.push(`${q}: ${show(item?.[sub.id])}`);
          }
        });
      } else lines.push(`${p}: ${show(f.value)}`);
    }
  }
  return lines.join('\n');
}

// Token keys available as {{key}}: fields of group `contact` in _global.json.
export function tokenKeys(globalPage) {
  const g = (globalPage?.groups || []).find((x) => x.id === 'contact');
  return g ? g.fields.filter((f) => f.type !== 'list' && f.type !== 'image').map((f) => f.id) : [];
}
