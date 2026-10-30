// Markdown <-> HTML for the classic editor of blog/Leistungen bodies.
// Covers what the site's Markdown uses: headings (##–####), paragraphs, bold/italic, links, inline code,
// bullet and numbered lists (nested), blockquotes, horizontal rules, hard line breaks.
// Runs in the browser only; what gets stored is decided by rules.js on the server.
import { sanitizeHtml, safeHref, decodeEntities, MD_TAGS } from './rules.js';

const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');

// Constructs the Visuell tab cannot reproduce; files with them are edited in the Text tab only.
export function unsupportedMarkdown(md) {
  const s = String(md || '');
  const found = [];
  if (/^[ \t]*\|.*\|[ \t]*$/m.test(s)) found.push('Tabelle');
  if (hasInlineImage(s)) found.push('Bild im Text');
  if (/^[ \t]*(```|~~~)/m.test(s)) found.push('Codeblock');
  if (/<[a-zA-Z/!?]/.test(s.replace(/`[^`\n]*`/g, ''))) found.push('HTML');
  if (/^[ \t]*\[[^\]\n]+\]:[ \t]*\S/m.test(s)) found.push('Referenz-Link');
  if (hasSetextHeading(s)) found.push('Setext-Überschrift');
  if (/\]\([^)\n]*\s"[^"\n]*"\)/.test(s)) found.push('Link-Titel');
  if (/^[ \t]*(#|#{5,6})[ \t]/m.test(s)) found.push('Überschrift der Ebene 1, 5 oder 6');
  if (/^[ \t]*[-*+][ \t]+\[[ xX]\]/m.test(s)) found.push('Aufgabenliste');
  return found;
}

// A line of = or - directly under a line of text. `---` after a blank line is a rule, and after a
// list item it is not a heading the site uses.
function hasSetextHeading(s) {
  const lines = s.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (!/^(=+|-+)[ \t]*$/.test(lines[i])) continue;
    const prev = lines[i - 1].trimStart();
    if (prev && !/^[|>#*+-]/.test(prev)) return true;
  }
  return false;
}

// Alt texts may hold brackets and line breaks, so any `![` with a `](` after it counts.
function hasInlineImage(s) {
  const open = s.indexOf('![');
  return open !== -1 && s.includes('](', open);
}

// ---------- Markdown -> HTML ----------

function inline(src) {
  let s = String(src);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return `\u0000C${codes.length - 1}\u0000`; });
  const links = [];
  s = s.replace(/\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g, (m, text, url) => {
    links.push({ text, url }); return `\u0000L${links.length - 1}\u0000`;
  });
  s = escText(decodeEntities(s));
  s = s.replace(/\\([\\`*_{}\[\]()#+\-.!>&])/g, (m, c) => `\u0000E${c.charCodeAt(0)}\u0000`);
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*(?=\S)([\s\S]*?\S)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_(?=\S)([\s\S]*?\S)_(?![_\w])/g, '$1<em>$2</em>');
  s = s.replace(/( {2,}|\\)\n/g, '<br>');
  s = s.replace(/\u0000L(\d+)\u0000/g, (m, i) => {
    const { text, url } = links[i];
    const href = safeHref(url);
    const inner = inline(text);
    return href ? `<a href="${escAttr(href)}">${inner}</a>` : inner;
  });
  s = s.replace(/\u0000C(\d+)\u0000/g, (m, i) => `<code>${escText(codes[i])}</code>`);
  s = s.replace(/\u0000E(\d+)\u0000/g, (m, c) => escText(String.fromCharCode(Number(c))));
  return s;
}

const LIST_RE = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;

function parseBlocks(lines) {
  const out = [];
  let i = 0;
  const isBlank = (l) => /^\s*$/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    let m;
    if ((m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
      const level = Math.min(Math.max(m[1].length, 2), 4);
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
      i++; continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^\s{0,3}>/.test(line)) {
      const inner = [];
      while (i < lines.length && !isBlank(lines[i]) && /^\s{0,3}>/.test(lines[i])) {
        inner.push(lines[i].replace(/^\s{0,3}> ?/, '')); i++;
      }
      out.push(`<blockquote>${parseBlocks(inner)}</blockquote>`);
      continue;
    }
    if ((m = LIST_RE.exec(line))) {
      const [html, next] = parseList(lines, i, m[1].length);
      out.push(html); i = next; continue;
    }
    const para = [];
    while (i < lines.length && !isBlank(lines[i]) && !/^\s{0,3}(#{1,6}\s|>)/.test(lines[i]) && !LIST_RE.test(lines[i]) && !/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    out.push(`<p>${inline(para.map((l, k) => (k < para.length - 1 ? l.replace(/^\s+/, '') : l.trim())).join('\n'))}</p>`);
  }
  return out.join('\n');
}

function parseList(lines, start, indent) {
  const first = LIST_RE.exec(lines[start]);
  const ordered = /\d/.test(first[2]);
  const tag = ordered ? 'ol' : 'ul';
  const items = [];
  let i = start;
  while (i < lines.length) {
    const m = LIST_RE.exec(lines[i]);
    if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
    const text = [m[3]];
    const children = [];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s*$/.test(l)) {
        // A blank line ends the list unless the next line continues it.
        const n = lines[i + 1];
        const nm = n !== undefined ? LIST_RE.exec(n) : null;
        if (nm && nm[1].length >= indent) { i++; continue; }
        break;
      }
      const lm = LIST_RE.exec(l);
      if (lm && lm[1].length > indent) {
        const [sub, next] = parseList(lines, i, lm[1].length);
        children.push(sub); i = next; continue;
      }
      if (lm) break;
      if (/^\s+\S/.test(l)) { text.push(l.trim()); i++; continue; }
      break;
    }
    items.push(`<li>${inline(text.join('\n'))}${children.join('')}</li>`);
  }
  return [`<${tag}>${items.join('')}</${tag}>`, i];
}

export function markdownToHtml(md) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  return parseBlocks(lines);
}

// ---------- HTML -> Markdown ----------

// Parses sanitised HTML (allowed tags, no attributes except href) into a small tree.
function parseTree(htmlStr) {
  const root = { tag: '#root', children: [] };
  const stack = [root];
  const re = /<(\/?)([a-z0-9]+)((?:\s+href="[^"]*")?)\s*\/?>|([^<]+)/gi;
  let m;
  while ((m = re.exec(htmlStr))) {
    const top = stack[stack.length - 1];
    if (m[4] !== undefined) { top.children.push({ text: decodeEntities(m[4]) }); continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const idx = stack.map((n) => n.tag).lastIndexOf(tag);
      if (idx > 0) stack.length = idx;
      continue;
    }
    const node = { tag, children: [] };
    if (tag === 'a') { const h = /href="([^"]*)"/.exec(m[3]); node.href = h ? decodeEntities(h[1]) : ''; }
    top.children.push(node);
    if (tag !== 'br' && tag !== 'hr') stack.push(node);
  }
  return root;
}

const BLOCK = new Set(['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'hr']);

function escMdText(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/([*_`\[\]])/g, '\\$1')
    .replace(/</g, '&lt;');
}

function inlineMd(nodes) {
  let s = '';
  for (const n of nodes) {
    if (n.text !== undefined) { s += escMdText(n.text.replace(/\s+/g, ' ')); continue; }
    const inner = inlineMd(n.children || []);
    switch (n.tag) {
      case 'strong': case 'b': s += wrap(inner, '**'); break;
      case 'em': case 'i': s += wrap(inner, '*'); break;
      case 'code': s += '`' + textOf(n).replace(/`/g, '') + '`'; break;
      case 'a': s += n.href ? `[${inner}](${n.href.replace(/[()\s]/g, encodeURIComponent)})` : inner; break;
      case 'br': s += '  \n'; break;
      default: s += inner;
    }
  }
  return s;
}

function wrap(inner, mark) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner;
}

function textOf(n) {
  if (n.text !== undefined) return n.text;
  return (n.children || []).map(textOf).join('');
}

function blocksMd(nodes, out) {
  let inl = [];
  const flush = () => {
    const t = inlineMd(inl).trim();
    if (t) out.push(lineStartSafe(t));
    inl = [];
  };
  for (const n of nodes) {
    if (n.text !== undefined || !BLOCK.has(n.tag)) { inl.push(n); continue; }
    flush();
    switch (n.tag) {
      case 'p': { const t = inlineMd(n.children).trim(); if (t) out.push(lineStartSafe(t)); break; }
      case 'h2': case 'h3': case 'h4': {
        const t = inlineMd(n.children).replace(/\s*\n\s*/g, ' ').trim();
        if (t) out.push('#'.repeat(Number(n.tag[1])) + ' ' + t);
        break;
      }
      case 'hr': out.push('---'); break;
      case 'ul': case 'ol': out.push(listMd(n, 0)); break;
      case 'blockquote': {
        const inner = [];
        blocksMd(n.children, inner);
        out.push(inner.join('\n\n').split('\n').map((l) => (l ? '> ' + l : '>')).join('\n'));
        break;
      }
      default: blocksMd(n.children, out);
    }
  }
  flush();
}

// A paragraph must not accidentally start a heading, list or quote.
function lineStartSafe(t) {
  return t.split('\n').map((l) => l
    .replace(/^(\s*)(#{1,6}\s|>|[-+]\s)/, (m, sp, x) => `${sp}\\${x}`)
    .replace(/^(\s*\d+)([.)]\s)/, (m, n, x) => `${n}\\${x}`)).join('\n');
}

function listMd(n, depth) {
  const ordered = n.tag === 'ol';
  const pad = '  '.repeat(depth) + (ordered ? ' ' : '');
  const lines = [];
  let k = 1;
  for (const li of n.children) {
    if (li.tag !== 'li') continue;
    const inl = li.children.filter((c) => c.text !== undefined || !['ul', 'ol'].includes(c.tag));
    const subs = li.children.filter((c) => c.tag === 'ul' || c.tag === 'ol');
    const flat = [];
    for (const c of inl) {
      if (c.tag === 'p') flat.push(...c.children, { tag: 'br', children: [] });
      else flat.push(c);
    }
    while (flat.length && flat[flat.length - 1].tag === 'br') flat.pop();
    const text = inlineMd(flat).trim().replace(/ {2}\n/g, '  \n' + pad + '  ');
    const marker = ordered ? `${k++}.` : '-';
    lines.push(`${'  '.repeat(depth)}${marker} ${text}`);
    for (const s of subs) lines.push(listMd(s, depth + 1).replace(/^/gm, ordered ? ' ' : ''));
  }
  return lines.join('\n');
}

export function htmlToMarkdown(htmlStr) {
  const clean = sanitizeHtml(String(htmlStr ?? '').replace(/<div\b[^>]*>/gi, '<p>').replace(/<\/div>/gi, '</p>'), MD_TAGS);
  const out = [];
  blocksMd(parseTree(clean).children, out);
  return out.join('\n\n') + (out.length ? '\n' : '');
}
