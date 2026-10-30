// Request/response helpers without a framework: body limits, JSON, multipart, cookies, headers.
import { LIMITS } from '../public/js/rules.js';

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

// Requests that change something carry JSON: a foreign page cannot send that with a plain form.
export async function readJson(req, limit = LIMITS.FORM_MAX_BYTES) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'Falscher Inhaltstyp');
  const buf = await readBody(req, limit);
  try {
    const data = JSON.parse(buf.toString('utf8'), (k, v) => {
      if (BAD_KEYS.has(k)) throw new HttpError(400, 'Ungültige Daten');
      return v;
    });
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Ungültige Daten');
    return data;
  } catch (e) {
    throw e instanceof HttpError ? e : new HttpError(400, 'Ungültige Daten');
  }
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

export function json(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}
