// Users (scrypt), sessions (random token, only its hash is stored), CSRF tokens, login lockout.
// Everything lives in ADMIN_DATA_DIR, never in the repository.
import crypto from 'node:crypto';
import path from 'node:path';
import { readJsonFile, writeJsonPrivate, createMutex } from './fsutil.js';

export const USERNAME_RE = /^[a-z][a-z0-9._-]{1,31}$/;
export const MIN_PASSWORD = 10;

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 };

function scrypt(password, salt, o) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize('NFC'), salt, o.keylen, { N: o.N, r: o.r, p: o.p, maxmem: o.maxmem }, (e, k) => (e ? reject(e) : resolve(k)));
  });
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(String(password), Buffer.from(salt, 'base64'), { N: Number(N), r: Number(r), p: Number(p), keylen: expected.length, maxmem: SCRYPT.maxmem });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

const tokenHash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

export function createAuth({ dataDir, sessionIdleMs = 8 * 3600e3, now = () => Date.now(), lockout = {} }) {
  const usersFile = path.join(dataDir, 'users.json');
  const sessionsFile = path.join(dataDir, 'sessions.json');
  const lock = createMutex();
  const L = { maxFails: 5, windowMs: 15 * 60e3, lockMs: 15 * 60e3, ipMax: 20, ...lockout };
  const fails = new Map(); // key -> { count, first, lockedUntil }
  // A dummy hash so that unknown users cost the same time as known ones.
  const dummy = hashPassword(crypto.randomBytes(16).toString('hex'));

  const loadUsers = async () => (await readJsonFile(usersFile, { users: {} })).users || {};
  const saveUsers = (users) => writeJsonPrivate(usersFile, { users });

  async function addUser(name, password, { lang = 'de' } = {}) {
    if (!USERNAME_RE.test(name)) throw new Error('Benutzername: 2–32 Zeichen, a–z, 0–9, . _ -, Anfang mit Buchstabe');
    if (String(password).length < MIN_PASSWORD) throw new Error(`Passwort: mindestens ${MIN_PASSWORD} Zeichen`);
    const hash = await hashPassword(password);
    return lock(async () => {
      const users = await loadUsers();
      if (users[name]) throw new Error(`Benutzer „${name}“ existiert bereits`);
      users[name] = { hash, lang, created: new Date(now()).toISOString() };
      await saveUsers(users);
    });
  }

  async function setPassword(name, password) {
    if (String(password).length < MIN_PASSWORD) throw new Error(`Passwort: mindestens ${MIN_PASSWORD} Zeichen`);
    const hash = await hashPassword(password);
    await lock(async () => {
      const users = await loadUsers();
      if (!users[name]) throw new Error(`Benutzer „${name}“ nicht gefunden`);
      users[name].hash = hash;
      await saveUsers(users);
    });
    // A new password ends all other sessions of this user.
    await lock(async () => {
      const s = await readJsonFile(sessionsFile, {});
      for (const [k, v] of Object.entries(s)) if (v.user === name) delete s[k];
      await writeJsonPrivate(sessionsFile, s);
    });
  }

  async function deleteUser(name) {
    await lock(async () => {
      const users = await loadUsers();
      if (!users[name]) throw new Error(`Benutzer „${name}“ nicht gefunden`);
      delete users[name];
      await saveUsers(users);
      const s = await readJsonFile(sessionsFile, {});
      for (const [k, v] of Object.entries(s)) if (v.user === name) delete s[k];
      await writeJsonPrivate(sessionsFile, s);
    });
  }

  async function getUser(name) {
    const users = await loadUsers();
    return users[name] ? { name, lang: users[name].lang || 'de', created: users[name].created } : null;
  }

  async function listUsers() {
    const users = await loadUsers();
    return Object.keys(users).sort().map((name) => ({ name, lang: users[name].lang || 'de', created: users[name].created }));
  }

  async function setLang(name, lang) {
    if (!['de', 'ru'].includes(lang)) throw new Error('Sprache');
    await lock(async () => {
      const users = await loadUsers();
      if (!users[name]) throw new Error('Benutzer');
      users[name].lang = lang;
      await saveUsers(users);
    });
  }

  // ---- lockout ----
  function entry(key) {
    const t = now();
    let e = fails.get(key);
    if (e && t - e.first > L.windowMs && (!e.lockedUntil || e.lockedUntil < t)) { fails.delete(key); e = null; }
    return e;
  }
  function lockedFor(key) {
    const e = entry(key);
    return e && e.lockedUntil && e.lockedUntil > now() ? e.lockedUntil - now() : 0;
  }
  function recordFail(key, max) {
    const t = now();
    const e = entry(key) || { count: 0, first: t, lockedUntil: 0 };
    e.count++;
    if (e.count >= max) e.lockedUntil = t + L.lockMs;
    fails.set(key, e);
  }

  // Returns { ok, user } or { ok: false, reason: 'invalid' | 'locked', retryMs }.
  async function login(name, password, ip) {
    const uname = String(name || '').trim().toLowerCase();
    const ukey = `u:${uname}`; const ikey = `ip:${ip}`;
    const locked = Math.max(lockedFor(ukey), lockedFor(ikey));
    if (locked) return { ok: false, reason: 'locked', retryMs: locked };
    const users = await loadUsers();
    const u = USERNAME_RE.test(uname) ? users[uname] : null;
    const ok = await verifyPassword(String(password || ''), u ? u.hash : await dummy);
    if (!u || !ok) {
      recordFail(ukey, L.maxFails);
      recordFail(ikey, L.ipMax);
      const now2 = Math.max(lockedFor(ukey), lockedFor(ikey));
      return now2 ? { ok: false, reason: 'locked', retryMs: now2 } : { ok: false, reason: 'invalid' };
    }
    fails.delete(ukey);
    return { ok: true, user: uname };
  }

  // ---- sessions ----
  async function createSession(user) {
    const token = crypto.randomBytes(32).toString('base64url');
    const csrf = crypto.randomBytes(24).toString('base64url');
    await lock(async () => {
      const s = await readJsonFile(sessionsFile, {});
      const t = now();
      for (const [k, v] of Object.entries(s)) if (t - v.seen > sessionIdleMs) delete s[k];
      s[tokenHash(token)] = { user, csrf, created: t, seen: t };
      await writeJsonPrivate(sessionsFile, s);
    });
    return { token, csrf };
  }

  async function getSession(token) {
    if (!token || typeof token !== 'string' || token.length > 200) return null;
    const key = tokenHash(token);
    const s = await readJsonFile(sessionsFile, {});
    const v = s[key];
    if (!v) return null;
    const t = now();
    if (t - v.seen > sessionIdleMs) { await destroySession(token); return null; }
    const users = await loadUsers();
    if (!users[v.user]) return null;
    if (t - v.seen > 60e3) {
      await lock(async () => {
        const s2 = await readJsonFile(sessionsFile, {});
        if (s2[key]) { s2[key].seen = t; await writeJsonPrivate(sessionsFile, s2); }
      });
    }
    return { user: v.user, csrf: v.csrf, lang: users[v.user].lang || 'de' };
  }

  async function destroySession(token) {
    if (!token) return;
    await lock(async () => {
      const s = await readJsonFile(sessionsFile, {});
      delete s[tokenHash(token)];
      await writeJsonPrivate(sessionsFile, s);
    });
  }

  return { addUser, setPassword, deleteUser, getUser, listUsers, setLang, login, createSession, getSession, destroySession, lockedFor };
}

export function csrfEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
