// The sanitiser behind the editor's preview and paste. The rules that count are the server's
// (lib/Rules.php, spec in admin/VALIDATION.md); both are held to the same recorded vectors.

// ---------------- text ----------------

// Everything YAML refuses as non-printable, plus line separators a parser would split on.
const NOT_PRINTABLE = new RegExp('[' + [[0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x9f], [0x2028, 0x2029], [0xfeff, 0xfeff], [0xfffe, 0xffff]]
  .map(([a, b]) => `\\u${a.toString(16).padStart(4, '0')}-\\u${b.toString(16).padStart(4, '0')}`).join('') + ']', 'g');
const wellFormed = (s) => (s.toWellFormed ? s.toWellFormed() : s);

// For multi-line content that keeps its own whitespace.
export function cleanBody(v) {
  return wellFormed(typeof v === 'string' ? v : '').replace(/\r\n?/g, '\n').replace(NOT_PRINTABLE, '');
}

export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .replace(/-$/, '');
}

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

export function itemImage(item, sub) {
  const v = item?.[sub.id];
  const value = v?.value ?? '';
  return { value, alt: value ? (v?.alt ?? '') : '' };
}
