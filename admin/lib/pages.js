// Page files src/content/pages/<id>.json (contract section 1).
// The structure (groups, field ids, types, labels, min/max) belongs to the code; the admin only
// changes values. applyValues() therefore starts from the file on disk and copies in values only.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { sanitizeHtml, looksLikeHtml, PAGE_TAGS } from './sanitize.js';

export const FIELD_TYPES = ['text', 'textarea', 'richtext', 'image', 'list'];
export const PAGE_ID_RE = /^_?[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

const chars = (s) => Array.from(String(s ?? '')).length;

export class ValidationError extends Error {
  constructor(errors) {
    super(errors.map((e) => `${e.path}: ${e.msg}`).join('; '));
    this.errors = errors;
  }
}

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

// Checks that a page object has the shape the contract describes. Returns a list of errors.
export function checkStructure(page) {
  const errs = [];
  const err = (p, msg) => errs.push({ path: p, msg });
  if (!page || typeof page !== 'object' || Array.isArray(page)) return [{ path: '', msg: 'kein Objekt' }];
  if (typeof page.label !== 'string') err('label', 'fehlt');
  if (!Array.isArray(page.groups)) { err('groups', 'fehlt'); return errs; }
  const gids = new Set();
  page.groups.forEach((g, gi) => {
    const gp = `groups[${gi}]`;
    if (!g || typeof g.id !== 'string' || !g.id) { err(gp, 'Gruppe ohne id'); return; }
    if (gids.has(g.id)) err(gp, `Gruppen-id „${g.id}“ doppelt`);
    gids.add(g.id);
    if (!Array.isArray(g.fields)) { err(g.id, 'fields fehlt'); return; }
    checkFields(g.fields, g.id, err, true);
  });
  return errs;
}

function checkFields(fields, prefix, err, allowList) {
  const ids = new Set();
  for (const f of fields) {
    if (!f || typeof f.id !== 'string' || !f.id) { err(prefix, 'Feld ohne id'); continue; }
    const p = `${prefix}.${f.id}`;
    if (ids.has(f.id)) err(p, 'Feld-id doppelt');
    ids.add(f.id);
    if (!FIELD_TYPES.includes(f.type) || (f.type === 'list' && !allowList)) { err(p, `unbekannter Typ „${f.type}“`); continue; }
    if (f.type === 'list') {
      if (!Array.isArray(f.fields)) err(p, 'list ohne fields');
      else checkFields(f.fields, p, err, false);
    }
  }
}

// Structure fingerprint: everything except values. Two pages with the same fingerprint differ
// only in values (list items excepted, which are values).
export function structureOf(page) {
  const strip = (f) => {
    const { value, alt, ...rest } = f;
    if (f.type === 'list') rest.fields = (f.fields || []).map(strip);
    return rest;
  };
  const { groups, ...top } = page;
  return JSON.stringify({ ...top, groups: (groups || []).map((g) => ({ ...g, fields: (g.fields || []).map(strip) })) });
}

// Where the alt text of an image sub-field inside a list item lives. The contract gives `alt` to
// top-level image fields; for list items we keep whatever shape the file uses ({value, alt} object
// or a sibling `<id>Alt` key) and default to the sibling key.
function itemImage(item, sub) {
  const v = item?.[sub.id];
  if (v && typeof v === 'object') return { value: v.value ?? v.src ?? '', alt: v.alt ?? '', shape: 'object' };
  return { value: v ?? '', alt: item?.[`${sub.id}Alt`] ?? '', shape: 'sibling' };
}

export function readItemImage(item, sub) { return itemImage(item, sub); }

// Copies submitted values into a clone of `page`. `input` is { groupId: { fieldId: … } } as produced
// by the form parser. Returns { page, errors }. Never adds or removes groups or fields.
export function applyValues(page, input, ctx = {}) {
  const errors = [];
  const out = structuredClone(page);
  const known = new Set(out.groups.map((g) => g.id));
  for (const gid of Object.keys(input || {})) if (!known.has(gid)) errors.push({ path: gid, msg: 'unbekannte Gruppe' });
  for (const g of out.groups) {
    const gin = input?.[g.id];
    if (gin === undefined) continue; // group not submitted: values stay as they are
    if (typeof gin !== 'object' || Array.isArray(gin)) { errors.push({ path: g.id, msg: 'ungültige Daten' }); continue; }
    const fids = new Set(g.fields.map((f) => f.id));
    for (const k of Object.keys(gin)) if (!fids.has(k)) errors.push({ path: `${g.id}.${k}`, msg: 'unbekanntes Feld' });
    for (const f of g.fields) {
      if (!(f.id in gin)) continue;
      setFieldValue(f, gin[f.id], `${g.id}.${f.id}`, errors);
    }
  }
  if (structureOf(out) !== structureOf(page)) errors.push({ path: '', msg: 'Struktur verändert' });
  errors.push(...validateValues(out, ctx));
  return { page: out, errors };
}

function normText(v, multiline) {
  let s = typeof v === 'string' ? v : '';
  s = s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (!multiline) s = s.replace(/\n+/g, ' ');
  return s.trim();
}

function setFieldValue(f, v, p, errors) {
  switch (f.type) {
    case 'text': case 'textarea':
      if (typeof v !== 'string') { errors.push({ path: p, msg: 'ungültiger Wert' }); return; }
      f.value = normText(v, f.type === 'textarea');
      return;
    case 'richtext':
      if (typeof v !== 'string') { errors.push({ path: p, msg: 'ungültiger Wert' }); return; }
      f.value = sanitizeHtml(v, PAGE_TAGS);
      return;
    case 'image': {
      const o = typeof v === 'string' ? { value: v } : v;
      if (!o || typeof o !== 'object') { errors.push({ path: p, msg: 'ungültiger Wert' }); return; }
      f.value = normText(o.value ?? '', false);
      f.alt = normText(o.alt ?? f.alt ?? '', false);
      return;
    }
    case 'list': {
      const items = Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : (v === '' ? [] : null));
      if (!items) { errors.push({ path: p, msg: 'ungültige Liste' }); return; }
      const old = Array.isArray(f.value) ? f.value : [];
      f.value = items.map((item, i) => {
        const res = {};
        if (!item || typeof item !== 'object') { errors.push({ path: `${p}[${i + 1}]`, msg: 'ungültiger Eintrag' }); return res; }
        const subIds = new Set(f.fields.map((s) => s.id));
        for (const k of Object.keys(item)) if (!subIds.has(k)) errors.push({ path: `${p}[${i + 1}].${k}`, msg: 'unbekanntes Feld' });
        for (const sub of f.fields) {
          const sv = item[sub.id];
          if (sub.type === 'image') {
            const o = typeof sv === 'string' ? { value: sv } : (sv || {});
            const shape = old.length ? itemImage(old[0], sub).shape : 'sibling';
            const value = normText(o.value ?? '', false); const alt = normText(o.alt ?? '', false);
            if (shape === 'object') res[sub.id] = { value, alt };
            else { res[sub.id] = value; res[`${sub.id}Alt`] = alt; }
          } else if (sub.type === 'richtext') {
            res[sub.id] = sanitizeHtml(typeof sv === 'string' ? sv : '', PAGE_TAGS);
          } else {
            res[sub.id] = normText(sv, sub.type === 'textarea');
          }
        }
        return res;
      });
      return;
    }
  }
}

function checkValue(f, value, alt, p, ctx, errors) {
  const err = (msg) => errors.push({ path: p, msg, label: f.label });
  if (f.type === 'image') {
    if (typeof value !== 'string') return err('ungültiger Wert');
    if (!value) { if (f.required) err('Pflichtfeld'); return; }
    if (!isImagePath(value)) return err('ungültiger Bildpfad');
    if (ctx.imageExists && !ctx.imageExists(value)) return err(`Bild „${value}“ nicht gefunden`);
    if (typeof alt !== 'string' || !alt.trim()) return err('Alternativtext fehlt');
    if (chars(alt) > 300) err('Alternativtext zu lang');
    return;
  }
  if (typeof value !== 'string') return err('ungültiger Wert');
  const plain = f.type === 'richtext' ? value.replace(/<[^>]*>/g, '').trim() : value.trim();
  if (f.required && !plain) err('Pflichtfeld');
  if (f.max && (f.type === 'text' || f.type === 'textarea') && chars(value) > f.max) err(`höchstens ${f.max} Zeichen (jetzt ${chars(value)})`);
  if ((f.type === 'text' || f.type === 'textarea') && looksLikeHtml(value)) err('HTML ist hier nicht erlaubt');
  if (f.type === 'text' && value.includes('\n')) err('nur eine Zeile');
  if (f.type === 'richtext' && sanitizeHtml(value, PAGE_TAGS) !== value.trim()) err('nicht erlaubtes HTML');
}

export function isImagePath(v) {
  return typeof v === 'string' && IMAGE_RE.test(v) && !v.includes('\\') && !v.includes('\0')
    && v.split('/').every((s) => s && s !== '.' && s !== '..' && !s.startsWith('.')) && !v.startsWith('/');
}

// Validates all values of a page object (also used on restore and in tests).
export function validateValues(page, ctx = {}) {
  const errors = [];
  for (const g of page.groups || []) {
    for (const f of g.fields || []) {
      const p = `${g.id}.${f.id}`;
      if (f.type === 'list') {
        const items = f.value;
        if (!Array.isArray(items)) { errors.push({ path: p, msg: 'ungültige Liste', label: f.label }); continue; }
        if (f.min !== undefined && items.length < f.min) errors.push({ path: p, msg: `mindestens ${f.min} Einträge`, label: f.label });
        if (f.max !== undefined && items.length > f.max) errors.push({ path: p, msg: `höchstens ${f.max} Einträge`, label: f.label });
        items.forEach((item, i) => {
          for (const sub of f.fields || []) {
            const sp = `${p}[${i + 1}].${sub.id}`;
            if (sub.type === 'image') {
              const im = itemImage(item, sub);
              checkValue(sub, im.value, im.alt, sp, ctx, errors);
            } else checkValue(sub, item?.[sub.id] ?? '', null, sp, ctx, errors);
          }
        });
        continue;
      }
      checkValue(f, f.value ?? '', f.alt, p, ctx, errors);
    }
  }
  return errors;
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
        const subIds = new Set(f.fields.flatMap((s) => (s.type === 'image' ? [s.id, `${s.id}Alt`] : [s.id])));
        f.value = of.value.map((item) => Object.fromEntries(Object.entries(item || {}).filter(([k]) => subIds.has(k))));
        for (const item of f.value) for (const s of f.fields) if (!(s.id in item)) item[s.id] = '';
      } else {
        f.value = of.value;
        if (f.type === 'image') f.alt = of.alt ?? '';
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
            if (im.value) refs.push({ path: im.value, alt: im.alt, where: `${g.label} › ${f.label} ${i + 1}` });
          });
        }
      }
    }
  }
  return refs;
}

// Token keys available as {{key}}: fields of group `contact` in _global.json.
export function tokenKeys(globalPage) {
  const g = (globalPage?.groups || []).find((x) => x.id === 'contact');
  return g ? g.fields.filter((f) => f.type !== 'list' && f.type !== 'image').map((f) => f.id) : [];
}
