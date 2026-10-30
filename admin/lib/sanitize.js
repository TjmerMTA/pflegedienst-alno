// Allow-list HTML sanitiser for richtext values (contract: p br strong b em i a[href] ul ol li h2 h3).
// Pure ESM without Node imports: the browser editor loads the same file.
//
// It tokenises the input, keeps allowed tags (dropping all their attributes except a safe href),
// drops the tags of everything else but keeps their text, and removes script/style/… with content.

export const PAGE_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'a', 'ul', 'ol', 'li', 'h2', 'h3'];
// Markdown bodies of blog/leistungen may use a few more block elements.
export const MD_TAGS = [...PAGE_TAGS, 'h4', 'blockquote', 'hr', 'code'];

const VOID = new Set(['br', 'hr']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'textarea', 'select', 'title', 'head']);

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

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

const TOKEN = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![^>]*>?|<\?[^>]*>?|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|</

export function sanitizeHtml(input, allowed = PAGE_TAGS) {
  const allow = new Set(allowed);
  const src = String(input ?? '');
  let out = '';
  let last = 0;
  const stack = [];
  let dropDepth = 0; let dropTag = null;
  TOKEN.lastIndex = 0;
  const re = new RegExp(TOKEN.source, 'g');
  let m;
  while ((m = re.exec(src))) {
    const text = src.slice(last, m.index);
    if (!dropDepth && text) out += escText(decodeEntities(text));
    last = re.lastIndex;
    if (m[0] === '<') { if (!dropDepth) out += '&lt;'; continue; }
    if (!m[2]) continue; // comment, doctype, processing instruction, CDATA
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (dropDepth) {
      if (tag === dropTag) dropDepth += closing ? -1 : 1;
      continue;
    }
    if (DROP_WITH_CONTENT.has(tag)) {
      if (!closing && !/\/\s*$/.test(m[3])) { dropDepth = 1; dropTag = tag; }
      continue;
    }
    if (!allow.has(tag)) continue;
    if (VOID.has(tag)) { if (!closing) out += `<${tag}>`; continue; }
    if (closing) {
      const i = stack.lastIndexOf(tag);
      if (i === -1) continue;
      while (stack.length > i) out += `</${stack.pop()}>`;
      continue;
    }
    if (tag === 'a') {
      const href = safeHref(getAttr(m[3], 'href'));
      out += href ? `<a href="${escAttr(href)}">` : '<a>';
    } else {
      out += `<${tag}>`;
    }
    stack.push(tag);
  }
  if (!dropDepth) out += escText(decodeEntities(src.slice(last)));
  while (stack.length) out += `</${stack.pop()}>`;
  // <a> without a usable href is just text.
  out = out.replace(/<a>([\s\S]*?)<\/a>/g, '$1');
  return out.trim();
}

// True when the string contains something that looks like an HTML tag (for text/textarea fields).
export function looksLikeHtml(s) {
  return /<\/?[a-zA-Z][^>]*>|<!--/.test(String(s));
}
