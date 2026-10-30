// File helpers: path containment, atomic writes, content hashes.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export class PathError extends Error {}

// Resolves `rel` inside `base` and refuses anything that leaves it (.., absolute paths, NUL bytes,
// symlinks pointing outside). Returns the absolute path.
export function safeJoin(base, rel) {
  if (typeof rel !== 'string' || rel === '' || rel.includes('\0') || rel.includes('\\')) throw new PathError('Ungültiger Pfad');
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) throw new PathError('Ungültiger Pfad');
  const parts = rel.split('/');
  if (parts.some((p) => p === '..' || p === '.' || p === '' || p.startsWith('.'))) throw new PathError('Ungültiger Pfad');
  const baseAbs = path.resolve(base);
  const abs = path.resolve(baseAbs, rel);
  if (abs !== baseAbs && !abs.startsWith(baseAbs + path.sep)) throw new PathError('Ungültiger Pfad');
  // If it exists, its real location must still be inside the real base.
  try {
    const realBase = fs.realpathSync(baseAbs);
    const real = fs.realpathSync(abs);
    if (real !== realBase && !real.startsWith(realBase + path.sep)) throw new PathError('Ungültiger Pfad');
  } catch (e) {
    if (e instanceof PathError) throw e;
  }
  return abs;
}

// Slug for a file name: lower-case a–z, 0–9 and single dashes.
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

export async function writeAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    const fh = await fsp.open(tmp, 'wx', 0o644);
    try {
      await fh.writeFile(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsp.rename(tmp, file);
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

export function sha(data) {
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

export async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

export async function writeJsonPrivate(file, obj) {
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeAtomic(file, JSON.stringify(obj, null, 2) + '\n');
  await fsp.chmod(file, 0o600);
}

// Simple promise mutex: one critical section at a time.
export function createMutex() {
  let tail = Promise.resolve();
  return function run(fn) {
    const p = tail.then(() => fn());
    tail = p.then(() => {}, () => {});
    return p;
  };
}
