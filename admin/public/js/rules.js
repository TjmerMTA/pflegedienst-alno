// Every validation and sanitising rule of the admin, in one place. The written spec is
// admin/VALIDATION.md; admin/test/vectors/rules.json holds input/output pairs that any
// reimplementation (a PHP backend, for one) has to reproduce.
//
// Pure ESM without Node imports: the server validates with it, the browser editor uses the
// sanitiser to preview. The server's answer is the only one that counts.

export const LIMITS = {
  FORM_MAX_BYTES: 1024 * 1024, // request body of a save
  RICHTEXT_MAX: 50000,
  BODY_MAX: 200000,
  ALT_MAX: 300,
  TAG_MAX: 60,
  SLUG_MAX: 80,
  IMAGE_MAX_SIDE: 2400,
  IMAGE_MAX_PIXELS: 80e6,
};

// The German messages. Russian users get them translated in the browser (i18n.js).
export const MSG = {
  required: 'Pflichtfeld',
  invalid: 'ungültiger Wert',
  tooLong: (max, now) => `höchstens ${max} Zeichen (jetzt ${now})`,
  noHtml: 'HTML ist hier nicht erlaubt',
  badHtml: 'nicht erlaubtes HTML',
  oneLine: 'nur eine Zeile',
  noAngle: 'Die Zeichen < und > sind in den Kontaktdaten nicht erlaubt.',
  altRequired: 'Alternativtext fehlt: Ist ein Bild gesetzt, muss der Alternativtext ausgefüllt sein.',
  altTooLong: 'Alternativtext zu lang',
  badImage: 'ungültiger Bildpfad',
  imageMissing: (p) => `Bild „${p}“ nicht gefunden`,
  badToken: (t) => `unbekannter Platzhalter {{${t}}}`,
  unknownGroup: 'unbekannte Gruppe',
  unknownField: 'unbekanntes Feld',
  badList: 'ungültige Liste',
  badItem: 'ungültiger Eintrag',
  minItems: (n) => `mindestens ${n} Einträge`,
  maxItems: (n) => `höchstens ${n} Einträge`,
  minOne: 'mindestens ein Eintrag',
  structure: 'Struktur verändert',
  badDate: 'ungültiges Datum',
  badNumber: 'keine Zahl',
  badChoice: 'ungültige Auswahl',
  badTag: 'ungültiges Schlagwort',
  slugInvalid: 'Ungültiger Permalink: nur a–z, 0–9 und Bindestriche.',
  slugTaken: 'Unter diesem Namen gibt es bereits einen Eintrag.',
  unsafeLink: 'Der Text enthält eine unsichere Link-Adresse (javascript:, vbscript: oder data:).',
};

const chars = (s) => Array.from(String(s ?? '')).length;

// ---------------- text ----------------

// Everything YAML refuses as non-printable, plus line separators a parser would split on.
const NOT_PRINTABLE = new RegExp('[' + [[0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x9f], [0x2028, 0x2029], [0xfeff, 0xfeff], [0xfffe, 0xffff]]
  .map(([a, b]) => `\\u${a.toString(16).padStart(4, '0')}-\\u${b.toString(16).padStart(4, '0')}`).join('') + ']', 'g');
const wellFormed = (s) => (s.toWellFormed ? s.toWellFormed() : s);

// For multi-line content that keeps its own whitespace.
export function cleanBody(v) {
  return wellFormed(typeof v === 'string' ? v : '').replace(/\r\n?/g, '\n').replace(NOT_PRINTABLE, '');
}

export function cleanText(v, multiline = false) {
  const s = cleanBody(v);
  return (multiline ? s : s.replace(/\n+/g, ' ')).trim();
}

// True when a plain text value could open a tag. A complete tag is not needed: the site may join
// several fields into one string, so `</script a` in one field can be finished by `>` in the next.
// A `<` before a space or a digit («Preis < 5 €») is harmless.
export function looksLikeHtml(s) {
  return /<[a-zA-Z/!?{]/.test(String(s));
}

// ---------------- names and paths ----------------

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PAGE_ID_RE = /^_?[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
export const REV_FILE_RE = /^src\/content\/(?:pages\/_?[a-z0-9]+(?:-[a-z0-9]+)*\.json|(?:blog|leistungen|team)\/[a-z0-9]+(?:-[a-z0-9]+)*\.md)$/;
export const REV_RE = /^[0-9a-f]{7,40}$/;
export const USERNAME_RE = /^[a-z][a-z0-9._-]{1,31}$/;

export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, LIMITS.SLUG_MAX)
    .replace(/-$/, '');
}

export function isImagePath(v) {
  return typeof v === 'string' && IMAGE_RE.test(v) && !v.includes('\\') && !v.includes('\0')
    && v.split('/').every((s) => s && s !== '.' && s !== '..' && !s.startsWith('.')) && !v.startsWith('/');
}

export function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Type by content, never by name or the browser's claim. `bytes` is a Uint8Array.
export function sniffImage(bytes) {
  if (!bytes || bytes.length < 12) return null;
  const at = (i, list) => list.every((b, k) => bytes[i + k] === b);
  if (at(0, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'webp';
  return null;
}

// ---------------- HTML ----------------

export const PAGE_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'a', 'ul', 'ol', 'li', 'h2', 'h3'];
// The editor's preview of Markdown bodies also shows these.
export const MD_TAGS = [...PAGE_TAGS, 'h4', 'blockquote', 'hr', 'code'];

const VOID = new Set(['br', 'hr']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'textarea', 'select', 'title', 'head']);

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', colon: ':', tab: '\t', newline: '\n' };

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTITY[e.toLowerCase()] ?? m;
  });
}

function escText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) {
  return escText(s).replace(/"/g, '&quot;');
}

// Links: http(s), mailto, tel, site-relative paths and anchors. Everything else (javascript:, data:, …) goes.
export function safeHref(href) {
  const v = decodeEntities(String(href || '')).replace(/[\u0000- \u007f-\u009f]/g, '');
  if (!v) return null;
  if (/^(https?:|mailto:|tel:)/i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null;
  if (v.startsWith('//')) return null;
  if (/^[/#?]/.test(v) || /^[\w.-]/.test(v)) return v;
  return null;
}

function getAttr(attrs, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = re.exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}

const isAlpha = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isNameChar = (c) => isAlpha(c) || (c >= 48 && c <= 57) || c === 45;

// Index of the `>` ending a tag, skipping quoted attribute values; -1 if the tag never ends.
function tagEnd(src, from) {
  let quote = 0;
  for (let i = from; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (quote) { if (c === quote) quote = 0; }
    else if (c === 34 || c === 39) quote = c;
    else if (c === 62) return i;
  }
  return -1;
}

// A single pass over the input, so hostile markup costs linear time. Once a tag turns out never to
// end, everything after it is plain text: no later `<` can open a tag either.
export function sanitizeHtml(input, allowed = PAGE_TAGS) {
  const allow = new Set(allowed);
  const src = String(input ?? '');
  let out = '';
  let pos = 0;
  const stack = [];
  const open = Object.create(null);
  let dropTag = null; let dropDepth = 0;
  const text = (t) => { if (!dropTag && t) out += escText(decodeEntities(t)); };
  const skipTo = (marker, from) => {
    const e = src.indexOf(marker, from);
    return e === -1 ? src.length : e + marker.length;
  };
  while (pos < src.length) {
    const lt = src.indexOf('<', pos);
    if (lt === -1) { text(src.slice(pos)); break; }
    text(src.slice(pos, lt));
    if (src.startsWith('<!--', lt)) { pos = skipTo('-->', lt + 4); continue; }
    if (src.startsWith('<![CDATA[', lt)) { pos = skipTo(']]>', lt + 9); continue; }
    const next = src.charCodeAt(lt + 1);
    if (next === 33 || next === 63) { pos = skipTo('>', lt + 2); continue; }
    const closing = next === 47;
    const nameStart = lt + (closing ? 2 : 1);
    if (!isAlpha(src.charCodeAt(nameStart))) {
      if (!dropTag) out += '&lt;';
      pos = lt + 1;
      continue;
    }
    let nameEnd = nameStart + 1;
    while (isNameChar(src.charCodeAt(nameEnd))) nameEnd++;
    const end = tagEnd(src, nameEnd);
    if (end === -1) { text(src.slice(lt)); break; }
    const tag = src.slice(nameStart, nameEnd).toLowerCase();
    const attrs = src.slice(nameEnd, end);
    pos = end + 1;
    if (dropTag) {
      if (tag === dropTag) { dropDepth += closing ? -1 : 1; if (!dropDepth) dropTag = null; }
      continue;
    }
    if (DROP_WITH_CONTENT.has(tag)) {
      if (!closing && !/\/\s*$/.test(attrs)) { dropTag = tag; dropDepth = 1; }
      continue;
    }
    if (!allow.has(tag)) continue;
    if (VOID.has(tag)) { if (!closing) out += `<${tag}>`; continue; }
    if (closing) {
      if (!open[tag]) continue;
      for (;;) {
        const top = stack.pop();
        open[top.tag]--;
        if (top.shown) out += `</${top.tag}>`;
        if (top.tag === tag) break;
      }
      continue;
    }
    // <a> without a usable href is just text.
    const href = tag === 'a' ? safeHref(getAttr(attrs, 'href')) : null;
    const shown = tag !== 'a' || !!href;
    if (shown) out += href ? `<a href="${escAttr(href)}">` : `<${tag}>`;
    stack.push({ tag, shown });
    open[tag] = (open[tag] || 0) + 1;
  }
  while (stack.length) { const top = stack.pop(); if (top.shown) out += `</${top.tag}>`; }
  return out.trim();
}

// ---------------- Markdown ----------------

// Nothing is deleted from a Markdown body: raw HTML in Markdown needs a literal `<` before a letter,
// `/`, `!` or `?`, so turning exactly those into `&lt;` leaves no raw HTML at all, wherever the
// renderer thinks code spans begin. The reader sees the characters that were typed.
export function sanitizeMarkdown(md) {
  return cleanBody(md).replace(/<(?=[a-zA-Z/!?])/g, '&lt;');
}

// Whether the text anywhere names an active URL scheme, after the decoding a Markdown renderer does
// (entities, backslash escapes). Deliberately not limited to link positions: those depend on the
// renderer (references inside quotes or lists, line breaks), and such an address has no place in
// the site's texts. «data: 5» in a sentence is fine: a URL has no space after the colon.
export function hasUnsafeLink(md) {
  const decoded = decodeEntities(String(md)).replace(/\\/g, '').replace(/[\n\r\t]/g, '');
  return /(?:^|[^a-z0-9+.-])(?:javascript|vbscript|data):(?=\S)/i.test(decoded);
}

// ---------------- page files ----------------

export const FIELD_TYPES = ['text', 'textarea', 'richtext', 'image', 'list'];

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

// Structure fingerprint: everything except values.
export function structureOf(page) {
  const strip = (f) => {
    const { value, alt, ...rest } = f;
    if (f.type === 'list') rest.fields = (f.fields || []).map(strip);
    return rest;
  };
  const { groups, ...top } = page;
  return JSON.stringify({ ...top, groups: (groups || []).map((g) => ({ ...g, fields: (g.fields || []).map(strip) })) });
}

// An image sub-field of a list item is stored as item[id] = { value, alt }: the same keys as a
// top-level image field. «No image» is value "" with alt "", wherever the image sits.
export function itemImage(item, sub) {
  const v = item?.[sub.id];
  const value = v?.value ?? '';
  return { value, alt: value ? (v?.alt ?? '') : '' };
}

function setFieldValue(f, v, p, errors) {
  switch (f.type) {
    case 'text': case 'textarea':
      if (typeof v !== 'string') { errors.push({ path: p, msg: MSG.invalid }); return; }
      f.value = cleanText(v, f.type === 'textarea');
      return;
    case 'richtext':
      if (typeof v !== 'string') { errors.push({ path: p, msg: MSG.invalid }); return; }
      f.value = sanitizeHtml(cleanBody(v), PAGE_TAGS);
      return;
    case 'image': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) { errors.push({ path: p, msg: MSG.invalid }); return; }
      f.value = cleanText(v.value);
      f.alt = f.value ? cleanText(v.alt) : '';
      return;
    }
    case 'list': {
      if (!Array.isArray(v)) { errors.push({ path: p, msg: MSG.badList }); return; }
      const subIds = new Set(f.fields.map((s) => s.id));
      f.value = v.map((item, i) => {
        const res = {};
        if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.push({ path: `${p}[${i + 1}]`, msg: MSG.badItem }); return res; }
        for (const k of Object.keys(item)) if (!subIds.has(k)) errors.push({ path: `${p}[${i + 1}].${k}`, msg: MSG.unknownField });
        for (const sub of f.fields) {
          const sv = item[sub.id];
          if (sub.type === 'image') {
            const value = cleanText(sv?.value);
            res[sub.id] = { value, alt: value ? cleanText(sv?.alt) : '' };
          } else if (sub.type === 'richtext') res[sub.id] = sanitizeHtml(cleanBody(sv), PAGE_TAGS);
          else res[sub.id] = cleanText(sv, sub.type === 'textarea');
        }
        return res;
      });
      return;
    }
  }
}

// `contact`: values of the group contact end up in JSON-LD and, as tokens, on every page.
function checkValue(f, value, alt, p, ctx, errors, label = f.label, contact = false) {
  const err = (msg) => errors.push({ path: p, msg, label });
  if (f.type === 'image') {
    if (typeof value !== 'string') return err(MSG.invalid);
    if (!value) { if (f.required) err(MSG.required); return; }
    if (!isImagePath(value)) return err(MSG.badImage);
    if (ctx.imageExists && !ctx.imageExists(value)) return err(MSG.imageMissing(value));
    if (typeof alt !== 'string' || !alt.trim()) return err(MSG.altRequired);
    if (chars(alt) > LIMITS.ALT_MAX) err(MSG.altTooLong);
    return;
  }
  if (typeof value !== 'string') return err(MSG.invalid);
  if (f.type === 'richtext' && chars(value) > LIMITS.RICHTEXT_MAX) err(MSG.tooLong(LIMITS.RICHTEXT_MAX, chars(value)));
  const plain = f.type === 'richtext' ? value.replace(/<[^>]*>/g, '').trim() : value.trim();
  if (f.required && !plain) err(MSG.required);
  if (f.max && (f.type === 'text' || f.type === 'textarea') && chars(value) > f.max) err(MSG.tooLong(f.max, chars(value)));
  if (f.type === 'text' || f.type === 'textarea') {
    if (contact && /[<>]/.test(value)) err(MSG.noAngle);
    else if (looksLikeHtml(value)) err(MSG.noHtml);
  }
  if (f.type === 'text' && value.includes('\n')) err(MSG.oneLine);
  if (f.type === 'richtext' && sanitizeHtml(value, PAGE_TAGS) !== value.trim()) err(MSG.badHtml);
  if (ctx.tokens?.length) {
    for (const m of value.matchAll(/\{\{([^{}]*)\}\}/g)) if (!ctx.tokens.includes(m[1].trim())) err(MSG.badToken(m[1]));
  }
}

// Validates all values of a page object. ctx: { imageExists(path), tokens: [...] }.
export function validatePageValues(page, ctx = {}) {
  const errors = [];
  for (const g of page.groups || []) {
    const contact = g.id === 'contact';
    for (const f of g.fields || []) {
      const p = `${g.id}.${f.id}`;
      if (f.type === 'list') {
        const items = f.value;
        if (!Array.isArray(items)) { errors.push({ path: p, msg: MSG.badList, label: f.label }); continue; }
        if (f.min !== undefined && items.length < f.min) errors.push({ path: p, msg: MSG.minItems(f.min), label: f.label });
        if (f.max !== undefined && items.length > f.max) errors.push({ path: p, msg: MSG.maxItems(f.max), label: f.label });
        items.forEach((item, i) => {
          for (const sub of f.fields || []) {
            const sp = `${p}[${i + 1}].${sub.id}`;
            const label = `${f.itemLabel || f.label} ${i + 1} › ${sub.label}`;
            if (sub.type === 'image') {
              const im = itemImage(item, sub);
              checkValue(sub, im.value, im.alt, sp, ctx, errors, label);
            } else checkValue(sub, item?.[sub.id] ?? '', null, sp, ctx, errors, label, contact);
          }
        });
        continue;
      }
      checkValue(f, f.value ?? '', f.alt, p, ctx, errors, f.label, contact);
    }
  }
  return errors;
}

// Copies submitted values into a clone of `page`. `input` is { groupId: { fieldId: value } }.
// Returns { page, errors }. Never adds or removes groups or fields; a group that is not sent keeps
// its values.
export function applyPageValues(page, input, ctx = {}) {
  const errors = [];
  const out = structuredClone(page);
  const known = new Set(out.groups.map((g) => g.id));
  for (const gid of Object.keys(input || {})) if (!known.has(gid)) errors.push({ path: gid, msg: MSG.unknownGroup });
  for (const g of out.groups) {
    const gin = input?.[g.id];
    if (gin === undefined) continue;
    if (!gin || typeof gin !== 'object' || Array.isArray(gin)) { errors.push({ path: g.id, msg: MSG.invalid }); continue; }
    const fids = new Set(g.fields.map((f) => f.id));
    for (const k of Object.keys(gin)) if (!fids.has(k)) errors.push({ path: `${g.id}.${k}`, msg: MSG.unknownField });
    for (const f of g.fields) if (f.id in gin) setFieldValue(f, gin[f.id], `${g.id}.${f.id}`, errors);
  }
  if (structureOf(out) !== structureOf(page)) errors.push({ path: '', msg: MSG.structure });
  errors.push(...validatePageValues(out, ctx));
  return { page: out, errors };
}

// ---------------- Markdown collections ----------------

const IMG_PREFIX = '../../assets/img/';

export function imgFromFrontmatter(v) {
  return typeof v === 'string' && v.startsWith(IMG_PREFIX) ? v.slice(IMG_PREFIX.length) : '';
}

// Builds new frontmatter from submitted values. `def` is the collection from schema/collections.json,
// `oldEntries` the old frontmatter as [key, value] pairs (unknown keys are kept), dates are
// { date: 'YYYY-MM-DD' }. Returns { entries, body, errors }.
export function applyEntryValues(def, oldEntries, input, ctx = {}) {
  const errors = [];
  const err = (f, msg) => errors.push({ path: f.id, label: f.label, msg });
  const next = new Map(oldEntries);
  const set = (k, v) => { if (v === undefined) next.delete(k); else next.set(k, v); };
  for (const f of def.fields) {
    const raw = input[f.id];
    switch (f.type) {
      case 'text': case 'textarea': case 'select': {
        const v = cleanText(raw, f.type === 'textarea');
        if (f.required && !v) { err(f, MSG.required); break; }
        if (f.max && chars(v) > f.max) err(f, MSG.tooLong(f.max, chars(v)));
        if (looksLikeHtml(v)) err(f, MSG.noHtml);
        if (f.type === 'select' && v && !f.options.includes(v)) err(f, MSG.badChoice);
        set(f.id, v || undefined);
        break;
      }
      case 'date': {
        const v = cleanText(raw);
        if (!v) { if (f.required) err(f, MSG.required); set(f.id, undefined); break; }
        if (!validDate(v)) { err(f, MSG.badDate); break; }
        set(f.id, { date: v });
        break;
      }
      case 'number': {
        const v = cleanText(typeof raw === 'number' ? String(raw) : raw);
        if (!v) { if (f.required) err(f, MSG.required); set(f.id, undefined); break; }
        if (!/^-?\d{1,6}(\.\d{1,3})?$/.test(v)) { err(f, MSG.badNumber); break; }
        set(f.id, Number(v));
        break;
      }
      case 'boolean':
        // Keep the key if it was there before, otherwise only write `true`.
        set(f.id, raw === true ? true : (next.has(f.id) ? false : undefined));
        break;
      case 'tags': {
        const list = (Array.isArray(raw) ? raw : []).map((x) => cleanText(x)).filter(Boolean);
        const uniq = [...new Set(list)];
        if (uniq.some((t) => looksLikeHtml(t) || chars(t) > LIMITS.TAG_MAX)) err(f, MSG.badTag);
        set(f.id, uniq.length || next.has(f.id) ? uniq : undefined);
        break;
      }
      case 'strings': {
        const list = (Array.isArray(raw) ? raw : []).map((x) => cleanText(x)).filter(Boolean);
        if (f.required && !list.length) err(f, MSG.minOne);
        if (list.some(looksLikeHtml)) err(f, MSG.noHtml);
        set(f.id, list);
        break;
      }
      case 'image': {
        const v = cleanText(raw?.value);
        if (!v) {
          // A path the library cannot show (outside src/assets/img) is not the user's removal.
          if (next.get(f.id) && !imgFromFrontmatter(next.get(f.id))) break;
          set(f.id, undefined);
          if (f.altKey) set(f.altKey, undefined);
          break;
        }
        if (!isImagePath(v)) { err(f, MSG.badImage); break; }
        if (ctx.imageExists && !ctx.imageExists(v)) { err(f, MSG.imageMissing(v)); break; }
        set(f.id, IMG_PREFIX + v);
        if (f.altKey) {
          const alt = cleanText(raw?.alt);
          if (!alt) err({ id: f.altKey, label: f.label }, MSG.altRequired);
          set(f.altKey, alt || undefined);
        }
        break;
      }
    }
  }
  // Order: keys in the order of the old file, new keys in schema order.
  const order = oldEntries.map(([k]) => k);
  for (const f of def.fields) {
    if (!order.includes(f.id)) order.push(f.id);
    if (f.altKey && !order.includes(f.altKey)) order.push(f.altKey);
  }
  const entries = order.filter((k) => next.has(k)).map((k) => [k, next.get(k)]);
  // A collection without a body in the admin (team) keeps whatever text its file has.
  let body = ctx.oldBody ?? '';
  if (def.body) {
    body = sanitizeMarkdown(input.body).trimEnd();
    if (chars(body) > LIMITS.BODY_MAX) errors.push({ path: 'body', label: 'Inhalt', msg: MSG.tooLong(LIMITS.BODY_MAX, chars(body)) });
    if (hasUnsafeLink(body)) errors.push({ path: 'body', label: 'Inhalt', msg: MSG.unsafeLink });
  }
  return { entries, body, errors };
}
