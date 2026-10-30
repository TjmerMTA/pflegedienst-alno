// Media library = every jpg/jpeg/png/webp under src/assets/img/ (contract section 3).
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { IMAGE_RE } from './pages.js';

export const MAX_SIDE = 2400;
export const MAX_PIXELS = 80e6;

let sharpMod = null;
// sharp comes with astro; look in the admin first, then in the edited site.
export async function loadSharp(siteDir) {
  if (sharpMod) return sharpMod;
  const tries = [import.meta.url, siteDir ? path.join(siteDir, 'package.json') : null].filter(Boolean);
  for (const from of tries) {
    try {
      const req = createRequire(from);
      const p = req.resolve('sharp');
      const m = await import(p.startsWith('/') ? 'file://' + p : p);
      sharpMod = m.default || m;
      return sharpMod;
    } catch {}
  }
  throw new Error('sharp ist nicht installiert (npm install im Website-Ordner ausführen)');
}

export async function listImages(imgDir) {
  const out = [];
  async function walk(dir, rel) {
    let ents = [];
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else if (e.isFile() && IMAGE_RE.test(e.name)) {
        const st = await fsp.stat(path.join(dir, e.name));
        out.push({ path: r, name: e.name, size: st.size, mtime: st.mtime });
      }
    }
  }
  await walk(imgDir, '');
  out.sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));
  return out;
}

// Type by content, not by name or the browser's claim.
export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export class UploadError extends Error {}

// Checks and re-encodes an upload. Returns { buffer, ext, width, height }.
export async function processUpload(buf, { maxBytes, siteDir }) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new UploadError('Leere Datei');
  if (buf.length > maxBytes) throw new UploadError(`Datei zu groß (höchstens ${Math.round(maxBytes / 1048576)} MB)`);
  const head = buf.subarray(0, 512).toString('latin1').trimStart().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<?xml') || head.includes('<svg')) throw new UploadError('SVG ist nicht erlaubt');
  const type = sniffImage(buf);
  if (!type) throw new UploadError('Nur JPG, PNG oder WebP');
  const sharp = await loadSharp(siteDir);
  let meta;
  try {
    meta = await sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).metadata();
  } catch {
    throw new UploadError('Die Datei ist kein lesbares Bild');
  }
  if (meta.format !== type) throw new UploadError('Dateiinhalt passt nicht zum Bildformat');
  if ((meta.pages || 1) > 1) throw new UploadError('Animierte Bilder sind nicht erlaubt');
  let img = sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: 'error' })
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true });
  if (type === 'jpeg') img = img.jpeg({ quality: 84, mozjpeg: true });
  else if (type === 'png') img = img.png({ compressionLevel: 9 });
  else img = img.webp({ quality: 84 });
  let out;
  try {
    out = await img.toBuffer({ resolveWithObject: true });
  } catch {
    throw new UploadError('Das Bild konnte nicht verarbeitet werden');
  }
  return { buffer: out.data, ext: type === 'jpeg' ? 'jpg' : type, width: out.info.width, height: out.info.height };
}

export function randomName(ext) {
  return `${crypto.randomBytes(8).toString('hex')}.${ext}`;
}

export async function imageInfo(file, siteDir) {
  try {
    const sharp = await loadSharp(siteDir);
    const m = await sharp(file).metadata();
    return { width: m.width, height: m.height, format: m.format };
  } catch {
    return {};
  }
}

// Small cached preview for the grid (falls back to the original).
export async function thumbnail(file, cacheDir, siteDir) {
  const st = await fsp.stat(file);
  const key = crypto.createHash('sha1').update(`${file}:${st.mtimeMs}:${st.size}`).digest('hex');
  const out = path.join(cacheDir, `${key}.webp`);
  try { return await fsp.readFile(out); } catch {}
  const sharp = await loadSharp(siteDir);
  const buf = await sharp(file, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width: 360, height: 360, fit: 'cover' }).webp({ quality: 70 }).toBuffer();
  await fsp.mkdir(cacheDir, { recursive: true });
  await fsp.writeFile(out, buf);
  return buf;
}
