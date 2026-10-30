// Frontmatter of the Markdown collections: a small, strict YAML subset.
// Supported: `key: scalar` (plain, "double", 'single'), `key: [a, b]`, and block lists (`key:` + `  - item`).
// Anything else throws, so a file the admin does not understand is never rewritten half-parsed.

export class FrontmatterError extends Error {}

export function splitFrontmatter(text) {
  const s = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(s);
  if (!m) return { fm: '', body: s, hasFm: false };
  return { fm: m[1], body: s.slice(m[0].length), hasFm: true };
}

function unquote(v, lineNo) {
  if (v.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(v)) throw new FrontmatterError(`Zeile ${lineNo}: Anführungszeichen nicht geschlossen`);
    try { return JSON.parse(v.replace(/\\'/g, "'")); } catch { throw new FrontmatterError(`Zeile ${lineNo}: ungültige Zeichenkette`); }
  }
  if (v.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(v)) throw new FrontmatterError(`Zeile ${lineNo}: Anführungszeichen nicht geschlossen`);
    return v.slice(1, -1).replace(/''/g, "'");
  }
  return null;
}

function scalar(raw, lineNo) {
  const v = raw.trim();
  const q = unquote(v, lineNo);
  if (q !== null) return q;
  if (/^[|>]/.test(v) || /^[&*!%@`]/.test(v)) throw new FrontmatterError(`Zeile ${lineNo}: nicht unterstütztes YAML`);
  const comment = v.search(/\s#/);
  const plain = (comment === -1 ? v : v.slice(0, comment)).trimEnd();
  if (plain === '' || plain === '~' || plain === 'null') return null;
  if (plain === 'true') return true;
  if (plain === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(plain)) return Number(plain);
  if (/^\d{4}-\d{2}-\d{2}$/.test(plain)) return { date: plain };
  return plain;
}

function splitFlow(inner, lineNo) {
  const items = [];
  let cur = ''; let q = null;
  for (const ch of inner) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    // A quote opens a string only at the start of an item: «it's» is a plain word.
    if ((ch === '"' || ch === "'") && !cur.trim()) { q = ch; cur += ch; continue; }
    if (ch === '[' || ch === '{') throw new FrontmatterError(`Zeile ${lineNo}: verschachtelte Listen werden nicht unterstützt`);
    if (ch === ',') { items.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (q) throw new FrontmatterError(`Zeile ${lineNo}: Anführungszeichen nicht geschlossen`);
  if (cur.trim()) items.push(cur);
  return items.map((s) => scalar(s, lineNo));
}

// Returns an ordered list of [key, value]; dates are { date: 'YYYY-MM-DD' }.
export function parseFrontmatter(fm) {
  const lines = String(fm).split('\n');
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(#.*)?$/.test(line)) continue;
    const m = /^([A-Za-z_][\w-]*):(?:\s+([\s\S]*)|\s*)$/.exec(line);
    if (!m) throw new FrontmatterError(`Zeile ${i + 1}: nicht unterstütztes YAML`);
    const key = m[1];
    const rest = (m[2] ?? '').trim();
    if (entries.some(([k]) => k === key)) throw new FrontmatterError(`Zeile ${i + 1}: Schlüssel „${key}“ doppelt`);
    if (rest.startsWith('[')) {
      if (!/\]\s*(#.*)?$/.test(rest)) throw new FrontmatterError(`Zeile ${i + 1}: Liste nicht geschlossen`);
      entries.push([key, splitFlow(rest.replace(/\]\s*(#.*)?$/, '').slice(1), i + 1)]);
      continue;
    }
    if (rest === '' || rest.startsWith('#')) {
      const items = [];
      while (i + 1 < lines.length && /^\s+-(\s|$)/.test(lines[i + 1])) {
        i++;
        items.push(scalar(lines[i].replace(/^\s+-\s?/, ''), i + 1));
      }
      if (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) throw new FrontmatterError(`Zeile ${i + 2}: nicht unterstütztes YAML`);
      entries.push([key, items.length ? items : null]);
      continue;
    }
    entries.push([key, scalar(rest, i + 1)]);
  }
  return entries;
}

function quoteIfNeeded(s) {
  const str = String(s);
  if (str === '') return '""';
  const risky = /^[\s\-?:,\[\]{}#&*!|>'"%@`]/.test(str) || /:(\s|$)|\s#|\n|\t|\s$/.test(str)
    || /^(true|false|null|~|yes|no|on|off|y|n)$/i.test(str) || /^\d{4}-\d{1,2}-\d{1,2}/.test(str)
    || (str.trim() !== '' && !Number.isNaN(Number(str))) || /^[-+]?[\d_]+(\.\d*)?$/.test(str) || /^[-+]?\.(inf|nan)$/i.test(str);
  return risky ? JSON.stringify(str) : str;
}

function fmtScalar(v, inFlow) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (typeof v === 'object' && v.date) return v.date;
  const q = quoteIfNeeded(v);
  return inFlow && q[0] !== '"' && /[,\[\]{}'"]/.test(q) ? JSON.stringify(String(v)) : q;
}

// `flowKeys`: arrays written as `key: [a, b]` (like the site's `tags`), all others as block lists.
export function stringifyFrontmatter(entries, flowKeys = []) {
  const out = [];
  for (const [key, v] of entries) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      if (!v.length) { out.push(`${key}: []`); continue; }
      if (flowKeys.includes(key)) { out.push(`${key}: [${v.map((x) => fmtScalar(x, true)).join(', ')}]`); continue; }
      out.push(`${key}:`);
      for (const item of v) out.push(`  - ${fmtScalar(item)}`);
      continue;
    }
    out.push(`${key}: ${fmtScalar(v)}`);
  }
  return out.join('\n');
}

export function buildMarkdownFile(entries, body, flowKeys) {
  const b = String(body ?? '').replace(/\r\n?/g, '\n').replace(/^\n+/, '').trimEnd();
  return `---\n${stringifyFrontmatter(entries, flowKeys)}\n---\n${b ? '\n' + b + '\n' : ''}`;
}
