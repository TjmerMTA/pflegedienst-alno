// Request/response helpers without a framework: body limits, form parsing, cookies, headers.

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length'] || 0);
    if (len > limit) { reject(new HttpError(413, 'Anfrage zu groß')); req.resume(); return; }
    const chunks = []; let size = 0; let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > limit) { done = true; reject(new HttpError(413, 'Anfrage zu groß')); req.resume(); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}

const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

// Turns ordered [name, value] pairs into nested objects: `f[hero][h1]=x` → { f: { hero: { h1: 'x' } } }.
// Keys keep their order of appearance (list items are ordered by it). `name[]` collects an array.
export function parseNested(pairs) {
  const root = Object.create(null);
  for (const [name, value] of pairs) {
    const m = /^([^\[\]]+)((?:\[[^\[\]]*\])*)$/.exec(name);
    if (!m) continue;
    const keys = [m[1], ...[...m[2].matchAll(/\[([^\[\]]*)\]/g)].map((x) => x[1])];
    if (keys.length > 8 || keys.some((k) => BAD_KEYS.has(k))) throw new HttpError(400, 'Ungültiges Formular');
    let o = root;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (i === keys.length - 1) {
        if (k === '') { if (!Array.isArray(o)) throw new HttpError(400, 'Ungültiges Formular'); o.push(value); }
        else { if (Array.isArray(o) || (o[k] !== undefined && typeof o[k] !== 'string')) throw new HttpError(400, 'Ungültiges Formular'); o[k] = value; }
        break;
      }
      if (k === '' || Array.isArray(o)) throw new HttpError(400, 'Ungültiges Formular');
      const wantArray = keys[i + 1] === '';
      if (o[k] === undefined) o[k] = wantArray ? [] : Object.create(null);
      else if (typeof o[k] !== 'object' || wantArray !== Array.isArray(o[k])) throw new HttpError(400, 'Ungültiges Formular');
      o = o[k];
    }
  }
  return root;
}

export async function readForm(req, limit = 4 * 1024 * 1024) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') throw new HttpError(415, 'Falscher Inhaltstyp');
  const buf = await readBody(req, limit);
  const params = new URLSearchParams(buf.toString('utf8'));
  if ([...params.keys()].length > 5000) throw new HttpError(400, 'Zu viele Felder');
  return parseNested([...params.entries()]);
}

// Minimal multipart/form-data parser for one or more files plus simple fields.
export async function readMultipart(req, limit) {
  const ct = String(req.headers['content-type'] || '');
  const m = /^multipart\/form-data;.*boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(ct);
  if (!m) throw new HttpError(415, 'Falscher Inhaltstyp');
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  const buf = await readBody(req, limit);
  const fields = Object.create(null); const files = [];
  let pos = buf.indexOf(boundary);
  if (pos < 0) throw new HttpError(400, 'Ungültiges Formular');
  while (true) {
    pos += boundary.length;
    if (buf.subarray(pos, pos + 2).toString() === '--') break;
    if (buf.subarray(pos, pos + 2).toString() !== '\r\n') throw new HttpError(400, 'Ungültiges Formular');
    pos += 2;
    const headEnd = buf.indexOf('\r\n\r\n', pos);
    if (headEnd < 0) throw new HttpError(400, 'Ungültiges Formular');
    const head = buf.subarray(pos, headEnd).toString('utf8');
    const next = buf.indexOf(Buffer.concat([Buffer.from('\r\n'), boundary]), headEnd + 4);
    if (next < 0) throw new HttpError(400, 'Ungültiges Formular');
    const data = buf.subarray(headEnd + 4, next);
    const disp = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(head);
    if (disp) {
      const name = /\bname="([^"]*)"/i.exec(disp[1])?.[1];
      const filename = /\bfilename="([^"]*)"/i.exec(disp[1])?.[1];
      if (name && !BAD_KEYS.has(name)) {
        if (filename !== undefined) files.push({ field: name, filename, data });
        else fields[name] = data.toString('utf8');
      }
    }
    pos = next + 2;
    if (files.length > 20) throw new HttpError(400, 'Zu viele Dateien');
  }
  return { fields, files };
}

export function parseCookies(req) {
  const out = Object.create(null);
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim(); const v = part.slice(i + 1).trim();
    if (k && !(k in out)) { try { out[k] = decodeURIComponent(v); } catch { out[k] = v; } }
  }
  return out;
}

export function cookie(name, value, { maxAge, secure, path = '/' } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Strict`;
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  if (secure) c += '; Secure';
  return c;
}

export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cache-Control': 'no-store',
};

export function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  const h = { ...SECURITY_HEADERS, ...headers };
  if (!h['Content-Type']) h['Content-Type'] = 'text/html; charset=utf-8';
  res.writeHead(status, h);
  res.end(body);
}

export function redirect(res, location, headers = {}) {
  send(res, 303, '', { Location: location, ...headers });
}

export function json(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}
