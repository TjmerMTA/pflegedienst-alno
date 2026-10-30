// The server of the admin: a JSON API (documented in admin/API.md) plus the static UI from public/.
// Nothing here renders HTML, and what is valid is decided in public/js/rules.js. To move to another
// backend, reimplement API.md and VALIDATION.md; public/ stays as it is.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { sitePaths } from './config.js';
import { createAuth, csrfEqual, MIN_PASSWORD } from './auth.js';
import { createGit } from './git.js';
import { createPublisher } from './publish.js';
import { HttpError, readJson, readMultipart, parseCookies, cookie, send, json, SECURITY_HEADERS } from './http.js';
import { safeJoin, PathError, writeAtomic, sha, createMutex, readJsonFile, writeJsonPrivate } from './fsutil.js';
import { listPageFiles, serializePage, mergeOldValues, pageImageRefs, pageLines, tokenKeys } from './pages.js';
import { COLLECTIONS, POST_TYPES, listEntries, readEntry, formValues, serializeEntry, entryImageRefs } from './collections.js';
import { splitFrontmatter, parseFrontmatter } from './frontmatter.js';
import { listImages, processUpload, randomName, imageInfo, thumbnail, UploadError } from './media.js';
import { lineDiff, compact } from './diff.js';
import {
  applyPageValues, applyEntryValues, checkStructure, validatePageValues, isImagePath,
  slugify, MSG, PAGE_ID_RE, SLUG_RE, REV_RE, REV_FILE_RE,
} from '../public/js/rules.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, '..', 'public');
const STATIC_TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8' };
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const SESSION_COOKIE = 'alno_session';
const LOGIN_COOKIE = 'alno_login';
const API = '/wp-admin/api/';

export function createApp(cfg, { now } = {}) {
  const P = sitePaths(cfg.siteDir);
  const auth = createAuth({ dataDir: cfg.dataDir, sessionIdleMs: cfg.sessionIdleMs, now });
  const git = createGit(cfg.siteDir);
  const logFile = path.join(cfg.dataDir, 'logs', 'admin.log');
  const writeLock = createMutex();
  fs.mkdirSync(path.join(cfg.dataDir, 'logs'), { recursive: true, mode: 0o700 });

  function log(entry) {
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n';
    fsp.appendFile(logFile, line, { mode: 0o600 }).catch(() => {});
  }

  const publisher = createPublisher({
    siteDir: cfg.siteDir, dataDir: cfg.dataDir, buildCmd: cfg.buildCmd, deployCmd: cfg.deployCmd,
    gitPush: cfg.gitPush, git, buildTimeoutMs: cfg.buildTimeoutMs, log,
  });

  let isRepoCache = null;
  const isRepo = async () => (isRepoCache ??= await git.isRepo());
  const rel = (abs) => path.relative(cfg.siteDir, abs).split(path.sep).join('/');

  async function commit(paths, message, user) {
    if (!(await isRepo())) return null;
    return git.commit(paths, message, user);
  }

  // Writes and commits as one step: if the commit fails the file goes back to what it was, so the
  // working tree never holds a change that was neither committed nor published.
  async function writeAndCommit(file, data, previous, message, user) {
    await writeAtomic(file, data);
    try {
      await commit([rel(file)], message, user);
    } catch (e) {
      if (previous === null) await fsp.rm(file, { force: true });
      else await writeAtomic(file, previous);
      throw e;
    }
  }

  async function moveFile(from, to) {
    await fsp.mkdir(path.dirname(to), { recursive: true });
    try { await fsp.rename(from, to); } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      await fsp.copyFile(from, to); await fsp.unlink(from);
    }
  }

  // The same for moving a file in or out of the site: `tracked` is whichever side lies in the repo.
  async function moveAndCommit(from, to, tracked, message, user) {
    await moveFile(from, to);
    try {
      await commit([rel(tracked)], message, user);
    } catch (e) {
      await moveFile(to, from);
      throw e;
    }
  }

  const imageExists = (p) => {
    if (!isImagePath(p)) return false;
    try { return fs.statSync(safeJoin(P.img, p)).isFile(); } catch { return false; }
  };

  // ------------------------------------------------------------------ request helpers

  function clientIp(req) {
    if (cfg.trustProxy) {
      const real = req.headers['x-real-ip'];
      if (real) return String(real).trim();
      const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1];
    }
    return req.socket.remoteAddress || '?';
  }

  function isHttps(req) {
    return cfg.cookieSecure || req.socket.encrypted || (cfg.trustProxy && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
  }

  function hostAllowed(req) {
    const host = String(req.headers.host || '').toLowerCase();
    if (!host) return false;
    if (cfg.allowedHosts.includes(host)) return true;
    const port = req.socket.localPort;
    return ['127.0.0.1', 'localhost', '[::1]'].some((h) => host === `${h}:${port}` || (port === 80 && host === h));
  }

  function originOk(req) {
    const origin = req.headers.origin;
    const host = String(req.headers.host || '').toLowerCase();
    const check = (v) => {
      try { return new URL(v).host.toLowerCase() === host; } catch { return false; }
    };
    if (origin === 'null') return false;
    if (origin) return check(origin);
    if (req.headers.referer) return check(req.headers.referer);
    return true;
  }

  const sessionMaxAge = () => Math.round(cfg.sessionIdleMs / 1000) * 3;
  const sessionCookie = (req, token) => cookie(SESSION_COOKIE, token, { maxAge: sessionMaxAge(), secure: isHttps(req) });

  // ------------------------------------------------------------------ session

  async function session(req, res, s) {
    if (!s) {
      const token = crypto.randomBytes(24).toString('base64url');
      res.setHeader('Set-Cookie', cookie(LOGIN_COOKIE, token, { maxAge: 3600, secure: isHttps(req), path: API }));
      return json(res, 401, { error: 'login', loginNonce: token, hasUsers: (await auth.listUsers()).length > 0 });
    }
    const [pages, status] = await Promise.all([listPageFiles(P.pages), publisher.snapshot()]);
    json(res, 200, {
      user: s.user, lang: s.lang, nonce: s.csrf, siteUrl: cfg.siteUrl, uploadMaxBytes: cfg.uploadMaxBytes,
      pages: pages.map((p) => ({ id: p.id, label: p.label })),
      status: { state: status.state, failed: !!status.lastError },
    });
  }

  async function login(req, res) {
    const body = await readJson(req, 64 * 1024);
    const cookies = parseCookies(req);
    if (!csrfEqual(String(req.headers['x-login-nonce'] || ''), cookies[LOGIN_COOKIE] || '')) throw new HttpError(403, 'csrf');
    const ip = clientIp(req);
    const r = await auth.login(body.user, body.password, ip);
    if (!r.ok) {
      log({ event: 'login-failed', user: String(body.user || '').slice(0, 40), ip, reason: r.reason });
      if (r.reason === 'locked') return json(res, 429, { error: 'locked', retryMinutes: Math.ceil(r.retryMs / 60000) });
      return json(res, 401, { error: 'invalid' });
    }
    const s = await auth.createSession(r.user);
    log({ event: 'login', user: r.user, ip });
    res.setHeader('Set-Cookie', [sessionCookie(req, s.token), cookie(LOGIN_COOKIE, '', { maxAge: 0, path: API })]);
    json(res, 200, { ok: true });
  }

  // ------------------------------------------------------------------ dashboard

  async function dashboard(res) {
    const [pages, blog, leistungen, team, images, status] = await Promise.all([
      listPageFiles(P.pages), listEntries('blog', P.blog), listEntries('leistungen', P.leistungen), listEntries('team', P.team), listImages(P.img), publisher.snapshot(),
    ]);
    let activity = [];
    if (await isRepo()) { try { activity = await git.log(null, 8); } catch {} }
    const first = pages.find((p) => p.id === 'index') || pages.find((p) => p.id !== '_global');
    json(res, 200, {
      counts: { pages: pages.filter((p) => p.id !== '_global').length, posts: blog.length, leistungen: leistungen.length, team: team.length, media: images.length },
      status, activity, firstPage: first ? { id: first.id } : null,
    });
  }

  // ------------------------------------------------------------------ pages

  async function revCount(relPath) {
    if (!(await isRepo())) return 0;
    try { return (await git.log(relPath, 500)).length; } catch { return 0; }
  }

  async function loadPage(id) {
    if (!PAGE_ID_RE.test(String(id))) throw new HttpError(404, 'not found');
    const file = path.join(P.pages, `${id}.json`);
    let text;
    try { text = await fsp.readFile(file, 'utf8'); } catch { throw new HttpError(404, 'not found'); }
    let page;
    try { page = JSON.parse(text); } catch (e) { return { id, file, text, hash: sha(text), page: null, structureErrors: [{ path: 'JSON', msg: e.message }] }; }
    return { id, file, text, hash: sha(text), page, structureErrors: checkStructure(page) };
  }

  async function globalTokens() {
    try { return tokenKeys(JSON.parse(await fsp.readFile(path.join(P.pages, '_global.json'), 'utf8'))); } catch { return []; }
  }

  async function getPage(res, id) {
    const p = await loadPage(id);
    const st = await fsp.stat(p.file);
    json(res, 200, { id, page: p.page, hash: p.hash, modified: st.mtime, revisions: await revCount(rel(p.file)), tokens: await globalTokens(), structureErrors: p.structureErrors });
  }

  async function savePage(res, s, body) {
    const id = String(body.id || '');
    return writeLock(async () => {
      const loaded = await loadPage(id);
      if (loaded.structureErrors.length) return json(res, 422, { error: 'structure', structureErrors: loaded.structureErrors });
      const tokens = id === '_global' ? tokenKeys(loaded.page) : await globalTokens();
      const { page: next, errors } = applyPageValues(loaded.page, body.values || {}, { imageExists, tokens });
      if (body.hash !== loaded.hash) return json(res, 409, { error: 'conflict', hash: loaded.hash, page: next });
      if (errors.length) return json(res, 422, { error: 'validation', errors, page: next });
      const out = serializePage(next);
      if (out === loaded.text) return json(res, 200, { ok: true, unchanged: true });
      await writeAndCommit(loaded.file, out, loaded.text, `Admin: ${next.label || id} aktualisiert`, s.user);
      const job = await publisher.request(next.label || id, s.user);
      log({ event: 'save', user: s.user, file: rel(loaded.file), job });
      json(res, 200, { ok: true, job });
    });
  }

  // ------------------------------------------------------------------ collections

  function collOf(postType) {
    const coll = POST_TYPES[postType];
    if (!coll) throw new HttpError(404, 'not found');
    return coll;
  }
  const collDir = (coll) => P[COLLECTIONS[coll].dir];
  const trashDir = (coll) => path.join(cfg.dataDir, 'trash', coll);
  const titleOf = (coll, values) => (coll === 'team' ? values.name : values.title);

  async function listTrash(coll) {
    let names = [];
    try { names = await fsp.readdir(trashDir(coll)); } catch {}
    const out = [];
    for (const n of names.filter((x) => x.endsWith('.json'))) {
      const meta = await readJsonFile(path.join(trashDir(coll), n), null);
      if (meta) out.push(meta);
    }
    return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  async function getEntries(res, url) {
    const coll = collOf(url.searchParams.get('type') || 'post');
    const raw = url.searchParams.get('status');
    const view = ['publish', 'draft', 'trash'].includes(raw) ? raw : 'all';
    const search = String(url.searchParams.get('s') || '').trim().toLowerCase();
    let entries = await listEntries(coll, collDir(coll));
    const trash = COLLECTIONS[coll].canDelete ? await listTrash(coll) : [];
    const sortKey = (e) => (coll === 'blog' ? e.values.date || '' : String(Number(e.values.order ?? 100)).padStart(6, '0'));
    entries.sort((a, b) => (coll === 'blog' ? sortKey(b).localeCompare(sortKey(a)) : sortKey(a).localeCompare(sortKey(b))) || a.slug.localeCompare(b.slug));
    const counts = { all: entries.length, publish: entries.filter((e) => !e.values.draft).length, draft: entries.filter((e) => e.values.draft).length, trash: trash.length };
    if (view === 'publish') entries = entries.filter((e) => !e.values.draft);
    if (view === 'draft') entries = entries.filter((e) => e.values.draft);
    if (search) entries = entries.filter((e) => JSON.stringify(e.values).toLowerCase().includes(search) || e.slug.includes(search));
    json(res, 200, { def: COLLECTIONS[coll], entries, trash, view, search, counts });
  }

  async function getEntry(res, url) {
    const coll = collOf(url.searchParams.get('type') || 'post');
    const slug = String(url.searchParams.get('id') || '');
    if (!SLUG_RE.test(slug)) throw new HttpError(404, 'not found');
    let entry;
    try { entry = await readEntry(collDir(coll), slug); } catch (e) {
      if (e.code === 'ENOENT') throw new HttpError(404, 'not found');
      return json(res, 422, { error: 'unreadable', message: e.message });
    }
    const file = path.join(collDir(coll), `${slug}.md`);
    json(res, 200, {
      def: COLLECTIONS[coll], slug, values: formValues(coll, entry.entries), body: entry.body, hash: entry.hash,
      modified: (await fsp.stat(file)).mtime, revisions: await revCount(rel(file)),
    });
  }

  function newEntry(res, url) {
    const coll = collOf(url.searchParams.get('type') || 'post');
    if (!COLLECTIONS[coll].canCreate) throw new HttpError(404, 'not found');
    const today = new Date().toISOString().slice(0, 10);
    json(res, 200, { def: COLLECTIONS[coll], slug: '', values: formValues(coll, coll === 'blog' ? [['date', { date: today }]] : []), body: '' });
  }

  async function saveEntry(res, s, body) {
    const coll = collOf(String(body.type || ''));
    const def = COLLECTIONS[coll];
    const dir = collDir(coll);
    const existing = String(body.id || '');
    const isNew = !existing;
    if (isNew && !def.canCreate) throw new HttpError(403, 'forbidden');
    const input = { ...(body.values || {}), body: body.body };
    return writeLock(async () => {
      let entry = null; let slug = existing;
      if (!isNew) {
        if (!SLUG_RE.test(existing)) throw new HttpError(404, 'not found');
        try { entry = await readEntry(dir, existing); } catch (e) { if (e.code === 'ENOENT') throw new HttpError(404, 'not found'); throw e; }
      }
      const oldEntries = entry ? entry.entries : [];
      const { entries, body: md, errors } = applyEntryValues(def, oldEntries, input, { imageExists, oldBody: entry?.body });
      if (isNew) {
        const titleKey = def.fields.find((f) => f.box === 'title').id;
        slug = slugify(String(body.slug || '').trim() || String(input[titleKey] || ''));
        if (!SLUG_RE.test(slug)) errors.push({ path: 'slug', label: 'Permalink', msg: MSG.slugInvalid });
        else if (fs.existsSync(path.join(dir, `${slug}.md`))) errors.push({ path: 'slug', label: 'Permalink', msg: MSG.slugTaken });
      }
      if (!isNew && body.hash !== entry.hash) return json(res, 409, { error: 'conflict', hash: entry.hash });
      if (errors.length) return json(res, 422, { error: 'validation', errors });
      const file = path.join(dir, `${slug}.md`);
      const out = serializeEntry(coll, entries, md);
      if (entry && out === entry.text) return json(res, 200, { ok: true, id: slug, unchanged: true });
      const title = new Map(entries).get(coll === 'team' ? 'name' : 'title');
      await writeAndCommit(file, out, entry ? entry.text : null, `Admin: ${isNew ? 'neu' : 'aktualisiert'} – ${title} (${def.dir}/${slug}.md)`, s.user);
      const job = await publisher.request(String(title), s.user);
      log({ event: isNew ? 'create' : 'save', user: s.user, file: rel(file), job });
      json(res, 200, { ok: true, id: slug, job });
    });
  }

  async function trashEntry(res, s, body) {
    const coll = collOf(String(body.type || ''));
    const def = COLLECTIONS[coll];
    if (!def.canDelete) throw new HttpError(403, 'forbidden');
    const slug = String(body.id || '');
    if (!SLUG_RE.test(slug)) throw new HttpError(404, 'not found');
    return writeLock(async () => {
      const file = path.join(collDir(coll), `${slug}.md`);
      let entry = null;
      try { entry = await readEntry(collDir(coll), slug); } catch (e) { if (e.code === 'ENOENT') throw new HttpError(404, 'not found'); }
      const id = `${Date.now()}-${slug}`;
      const values = entry ? formValues(coll, entry.entries) : {};
      await moveAndCommit(file, path.join(trashDir(coll), `${id}.md`), file, `Admin: in den Papierkorb – ${def.dir}/${slug}.md`, s.user);
      await writeJsonPrivate(path.join(trashDir(coll), `${id}.json`), { id, slug, coll, by: s.user, at: new Date().toISOString(), title: titleOf(coll, values) || slug });
      const job = await publisher.request(`Papierkorb: ${slug}`, s.user);
      log({ event: 'trash', user: s.user, file: rel(file), job });
      json(res, 200, { ok: true, job });
    });
  }

  async function fromTrash(res, s, body, permanently) {
    const coll = collOf(String(body.type || ''));
    const def = COLLECTIONS[coll];
    if (!def.canDelete) throw new HttpError(403, 'forbidden');
    const id = String(body.trashId || '');
    if (!/^\d+-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new HttpError(404, 'not found');
    return writeLock(async () => {
      const metaFile = path.join(trashDir(coll), `${id}.json`);
      const mdFile = path.join(trashDir(coll), `${id}.md`);
      const meta = await readJsonFile(metaFile, null);
      if (!meta || !SLUG_RE.test(meta.slug)) throw new HttpError(404, 'not found');
      if (permanently) {
        await fsp.rm(mdFile, { force: true }); await fsp.rm(metaFile, { force: true });
        log({ event: 'delete', user: s.user, id });
        return json(res, 200, { ok: true });
      }
      const target = path.join(collDir(coll), `${meta.slug}.md`);
      if (fs.existsSync(target)) return json(res, 409, { error: 'exists', message: MSG.slugTaken });
      await moveAndCommit(mdFile, target, target, `Admin: aus dem Papierkorb wiederhergestellt – ${def.dir}/${meta.slug}.md`, s.user);
      await fsp.rm(metaFile, { force: true });
      const job = await publisher.request(`Wiederhergestellt: ${meta.slug}`, s.user);
      log({ event: 'untrash', user: s.user, file: rel(target), job });
      json(res, 200, { ok: true, id: meta.slug, job });
    });
  }

  // ------------------------------------------------------------------ media

  const mediaMetaFile = path.join(cfg.dataDir, 'media.json');

  async function usages(imgPath) {
    const out = [];
    for (const p of await listPageFiles(P.pages)) {
      try {
        const pg = JSON.parse(await fsp.readFile(path.join(P.pages, `${p.id}.json`), 'utf8'));
        for (const r of pageImageRefs(pg)) if (r.path === imgPath) out.push({ title: pg.label || p.id, where: r.where, alt: r.alt, edit: { type: 'page', id: p.id } });
      } catch {}
    }
    for (const coll of Object.keys(COLLECTIONS)) {
      const def = COLLECTIONS[coll];
      let names = [];
      try { names = await fsp.readdir(collDir(coll)); } catch {}
      for (const n of names.filter((x) => x.endsWith('.md'))) {
        const slug = n.slice(0, -3);
        if (!SLUG_RE.test(slug)) continue;
        try {
          const e = await readEntry(collDir(coll), slug);
          const title = titleOf(coll, formValues(coll, e.entries)) || slug;
          const edit = { type: def.postType, id: slug };
          for (const r of entryImageRefs(coll, e.entries)) if (r.path === imgPath) out.push({ title, where: r.where, alt: r.alt, edit });
          if (e.body.includes(`assets/img/${imgPath}`)) out.push({ title, where: 'Text', alt: '', edit });
        } catch {}
      }
    }
    // Images the site's code imports directly (logo etc.) must not be deleted either.
    for (const f of await codeReferences(imgPath)) out.push({ title: 'Website-Code', where: f, alt: '', edit: null });
    return out;
  }

  async function codeReferences(imgPath) {
    const found = [];
    const needle = `assets/img/${imgPath}`;
    async function walk(dir) {
      let ents = [];
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) { if (abs !== P.img && abs !== P.pages) await walk(abs); continue; }
        if (!/\.(astro|ts|js|mjs|css|md|mdx|json)$/.test(e.name)) continue;
        if (abs.startsWith(P.blog) || abs.startsWith(P.leistungen) || abs.startsWith(P.team)) continue;
        try { if ((await fsp.readFile(abs, 'utf8')).includes(needle)) found.push(rel(abs)); } catch {}
      }
    }
    await walk(path.join(cfg.siteDir, 'src'));
    return found;
  }

  async function getMedia(res, url) {
    const search = String(url.searchParams.get('s') || '').trim().toLowerCase();
    const meta = await readJsonFile(mediaMetaFile, {});
    let images = await listImages(P.img);
    if (search) images = images.filter((i) => i.path.toLowerCase().includes(search));
    json(res, 200, { images: images.map((i) => ({ ...i, alt: meta[i.path]?.alt || '' })) });
  }

  async function getMediaItem(res, url) {
    const item = String(url.searchParams.get('path') || '');
    if (!isImagePath(item) || !imageExists(item)) throw new HttpError(404, 'not found');
    const image = (await listImages(P.img)).find((i) => i.path === item);
    if (!image) throw new HttpError(404, 'not found');
    const meta = await readJsonFile(mediaMetaFile, {});
    json(res, 200, { image, info: await imageInfo(safeJoin(P.img, item), cfg.siteDir), usedOn: await usages(item), alt: meta[item]?.alt || '' });
  }

  async function saveMediaMeta(res, body) {
    const item = String(body.path || '');
    if (!isImagePath(item) || !imageExists(item)) throw new HttpError(404, 'not found');
    await writeLock(async () => {
      const meta = await readJsonFile(mediaMetaFile, {});
      const alt = String(body.alt || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (alt) meta[item] = { alt }; else delete meta[item];
      await writeJsonPrivate(mediaMetaFile, meta);
    });
    json(res, 200, { ok: true });
  }

  async function deleteMedia(res, s, body) {
    const item = String(body.path || '');
    if (!isImagePath(item) || !imageExists(item)) throw new HttpError(404, 'not found');
    return writeLock(async () => {
      if ((await usages(item)).length) return json(res, 409, { error: 'in_use' });
      const abs = safeJoin(P.img, item);
      await moveAndCommit(abs, path.join(cfg.dataDir, 'trash', 'media', `${Date.now()}-${item.replace(/\//g, '__')}`), abs, `Admin: Bild gelöscht – ${item}`, s.user);
      log({ event: 'media-delete', user: s.user, file: item });
      json(res, 200, { ok: true });
    });
  }

  async function upload(req, res, s) {
    const { files } = await readMultipart(req, cfg.uploadMaxBytes * 1.05 + 64 * 1024);
    const done = []; const errors = [];
    for (const f of files.filter((x) => x.field === 'file')) {
      try {
        const r = await processUpload(f.data, { maxBytes: cfg.uploadMaxBytes, siteDir: cfg.siteDir });
        const name = randomName(r.ext);
        await writeLock(() => writeAndCommit(path.join(P.uploads, name), r.buffer, null, `Admin: Bild hochgeladen – uploads/${name}`, s.user));
        const p = `uploads/${name}`;
        log({ event: 'upload', user: s.user, file: p, original: String(f.filename).slice(0, 80), bytes: r.buffer.length });
        done.push({ path: p, name, width: r.width, height: r.height });
      } catch (e) {
        if (!(e instanceof UploadError)) log({ event: 'upload-error', user: s.user, error: e.message });
        errors.push({ file: String(f.filename || '').slice(0, 120), msg: e instanceof UploadError ? e.message : 'Das Bild konnte nicht verarbeitet werden' });
      }
    }
    if (!files.length) errors.push({ file: '', msg: 'Leere Datei' });
    json(res, errors.length && !done.length ? 422 : 200, { files: done, errors });
  }

  async function mediaFile(res, url) {
    const f = String(url.searchParams.get('path') || '');
    if (!isImagePath(f)) throw new HttpError(404, 'not found');
    let abs;
    try { abs = safeJoin(P.img, f); } catch { throw new HttpError(404, 'not found'); }
    if (!fs.existsSync(abs)) throw new HttpError(404, 'not found');
    const headers = { ...SECURITY_HEADERS, 'Content-Security-Policy': "default-src 'none'", 'Cache-Control': 'private, max-age=300' };
    if (url.searchParams.get('thumb')) {
      try {
        const buf = await thumbnail(abs, path.join(cfg.dataDir, 'cache', 'thumbs'), cfg.siteDir);
        res.writeHead(200, { ...headers, 'Content-Type': 'image/webp' }); return res.end(buf);
      } catch {}
    }
    const ext = f.split('.').pop().toLowerCase();
    res.writeHead(200, { ...headers, 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(abs).pipe(res);
  }

  // ------------------------------------------------------------------ revisions

  async function fileTitle(file) {
    try {
      if (file.endsWith('.json')) return JSON.parse(await fsp.readFile(path.join(cfg.siteDir, file), 'utf8')).label || file;
      const coll = file.split('/')[2];
      const { fm } = splitFrontmatter(await fsp.readFile(path.join(cfg.siteDir, file), 'utf8'));
      const m = new Map(parseFrontmatter(fm));
      return String(m.get(coll === 'team' ? 'name' : 'title') || file);
    } catch { return file.split('/').pop(); }
  }

  function editTarget(file) {
    let m;
    if ((m = /^src\/content\/pages\/(.+)\.json$/.exec(file))) return { type: 'page', id: m[1] };
    if ((m = /^src\/content\/(blog|leistungen|team)\/(.+)\.md$/.exec(file))) return { type: COLLECTIONS[m[1]].postType, id: m[2] };
    return null;
  }

  async function getRevisions(res) {
    const repo = await isRepo();
    const files = repo ? (await git.recentFiles(['src/content'])).filter((f) => REV_FILE_RE.test(f.file)) : [];
    for (const f of files) f.title = await fileTitle(f.file);
    json(res, 200, { isRepo: repo, files });
  }

  async function getRevisionFile(res, url) {
    const file = String(url.searchParams.get('file') || '');
    if (!REV_FILE_RE.test(file)) throw new HttpError(404, 'not found');
    const repo = await isRepo();
    const revs = repo ? await git.log(file, 100) : [];
    const revParam = url.searchParams.get('rev');
    if (revParam && !REV_RE.test(revParam)) throw new HttpError(404, 'not found');
    const selected = revParam ? revs.find((r) => r.hash.startsWith(revParam)) : (revs[1] || revs[0]);
    let diff = []; let same = false;
    if (selected) {
      let oldText = '';
      try { oldText = (await git.show(selected.hash, file)).toString('utf8'); } catch {}
      let cur = '';
      try { cur = await fsp.readFile(path.join(cfg.siteDir, file), 'utf8'); } catch {}
      // Page files are compared field by field; formatting of the JSON is not a change.
      if (file.endsWith('.json')) {
        try { oldText = pageLines(JSON.parse(oldText)); cur = pageLines(JSON.parse(cur)); } catch {}
      }
      same = oldText === cur;
      diff = compact(lineDiff(cur, oldText), file.endsWith('.json') ? 1 : 3);
    }
    const edit = fs.existsSync(path.join(cfg.siteDir, file)) ? editTarget(file) : null;
    json(res, 200, { isRepo: repo, file, title: await fileTitle(file), edit, revs, selected: selected || null, diff, same });
  }

  // A restored version goes through the same rules as a save: an old revision is not trusted.
  async function restoreRevision(res, s, body) {
    const file = String(body.file || ''); const rev = String(body.rev || '');
    if (!REV_FILE_RE.test(file) || !REV_RE.test(rev) || !(await isRepo())) throw new HttpError(404, 'not found');
    return writeLock(async () => {
      let old;
      try { old = (await git.show(rev, file)).toString('utf8'); } catch { throw new HttpError(404, 'not found'); }
      const abs = safeJoin(cfg.siteDir, file);
      const previous = fs.existsSync(abs) ? await fsp.readFile(abs, 'utf8') : null;
      const refuse = (errors) => json(res, 422, { error: 'validation', errors });
      let out;
      if (file.endsWith('.json')) {
        if (previous === null) throw new HttpError(404, 'not found');
        let merged;
        try { merged = mergeOldValues(JSON.parse(previous), JSON.parse(old)); } catch (e) { return refuse([{ path: file, msg: e.message }]); }
        const errors = validatePageValues(merged, { imageExists, tokens: await globalTokens() });
        if (errors.length) return refuse(errors);
        out = serializePage(merged);
      } else {
        const coll = file.split('/')[2];
        let parts;
        try { parts = splitFrontmatter(old); parts.entries = parseFrontmatter(parts.fm); } catch (e) { return refuse([{ path: file, msg: e.message }]); }
        const oldBody = parts.body.replace(/^\n+/, '');
        const r = applyEntryValues(COLLECTIONS[coll], parts.entries, { ...formValues(coll, parts.entries), body: oldBody }, { imageExists, oldBody });
        if (r.errors.length) return refuse(r.errors);
        out = serializeEntry(coll, r.entries, r.body);
      }
      await writeAndCommit(abs, out, previous, `Admin: Revision ${rev.slice(0, 7)} wiederhergestellt – ${file}`, s.user);
      const job = await publisher.request(`Revision ${rev.slice(0, 7)}`, s.user);
      log({ event: 'restore', user: s.user, file, rev, job });
      json(res, 200, { ok: true, job, edit: editTarget(file) });
    });
  }

  // ------------------------------------------------------------------ profile, status

  async function setPassword(req, res, s, body) {
    if (!(await auth.checkPassword(s.user, body.current))) return json(res, 422, { error: 'wrong_password' });
    if (String(body.password || '').length < MIN_PASSWORD) return json(res, 422, { error: 'too_short', min: MIN_PASSWORD });
    await auth.setPassword(s.user, body.password);
    const next = await auth.createSession(s.user);
    log({ event: 'password', user: s.user });
    res.setHeader('Set-Cookie', sessionCookie(req, next.token));
    json(res, 200, { ok: true });
  }

  async function status(res, url) {
    const st = await publisher.snapshot();
    const out = { state: st.state, failed: !!st.lastError, lastBuild: st.lastBuild || null, lastDeploy: st.lastDeploy || null };
    const jobId = Number(url.searchParams.get('job') || 0);
    if (jobId) out.job = await publisher.job(jobId);
    json(res, 200, out);
  }

  // ------------------------------------------------------------------ routing

  async function api(req, res, url) {
    const name = url.pathname.slice(API.length);
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE];
    const s = await auth.getSession(token);

    if (req.method === 'POST') {
      if (!originOk(req)) throw new HttpError(403, 'origin');
      if (name === 'login') return login(req, res);
      if (!s) throw new HttpError(401, 'login');
      if (!csrfEqual(String(req.headers['x-wp-nonce'] || ''), s.csrf)) {
        log({ event: 'csrf-reject', user: s.user, path: name });
        throw new HttpError(403, 'csrf');
      }
      if (name === 'media/upload') return upload(req, res, s);
      const body = await readJson(req);
      switch (name) {
        case 'logout':
          await auth.destroySession(token);
          log({ event: 'logout', user: s.user });
          res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, '', { maxAge: 0, secure: isHttps(req) }));
          return json(res, 200, { ok: true });
        case 'page': return savePage(res, s, body);
        case 'entry': return saveEntry(res, s, body);
        case 'entry/trash': return trashEntry(res, s, body);
        case 'entry/untrash': return fromTrash(res, s, body, false);
        case 'entry/delete': return fromTrash(res, s, body, true);
        case 'media/meta': return saveMediaMeta(res, body);
        case 'media/delete': return deleteMedia(res, s, body);
        case 'revisions/restore': return restoreRevision(res, s, body);
        case 'profile/lang':
          if (!['de', 'ru'].includes(body.lang)) throw new HttpError(400, 'bad request');
          await auth.setLang(s.user, body.lang);
          return json(res, 200, { ok: true });
        case 'profile/password': return setPassword(req, res, s, body);
        default: throw new HttpError(404, 'not found');
      }
    }
    if (req.method !== 'GET') throw new HttpError(405, 'method');
    if (name === 'session') return session(req, res, s);
    if (!s) throw new HttpError(401, 'login');
    switch (name) {
      case 'dashboard': return dashboard(res);
      case 'pages': return json(res, 200, { pages: await listPageFiles(P.pages) });
      case 'page': return getPage(res, url.searchParams.get('id') || '');
      case 'entries': return getEntries(res, url);
      case 'entry': return getEntry(res, url);
      case 'entry/new': return newEntry(res, url);
      case 'media': return getMedia(res, url);
      case 'media/item': return getMediaItem(res, url);
      case 'media/file': return mediaFile(res, url);
      case 'revisions': return getRevisions(res);
      case 'revisions/file': return getRevisionFile(res, url);
      case 'status': return status(res, url);
      default: throw new HttpError(404, 'not found');
    }
  }

  // Static files carry no data: index.html is the same for everyone and asks the API who is logged in.
  async function assets(res, rest) {
    let file;
    try { file = safeJoin(PUBLIC_DIR, rest); } catch { throw new HttpError(404, 'not found'); }
    const type = STATIC_TYPES[path.extname(file)];
    if (!type) throw new HttpError(404, 'not found');
    let body;
    try { body = await fsp.readFile(file); } catch { throw new HttpError(404, 'not found'); }
    send(res, 200, body, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://admin.local');
    const p = url.pathname;
    if (p.startsWith(API)) return api(req, res, url);
    if (req.method !== 'GET') throw new HttpError(405, 'method');
    if (p === '/' || p === '/wp-admin') { res.writeHead(303, { ...SECURITY_HEADERS, Location: '/wp-admin/' }); return res.end(); }
    if (p.startsWith('/wp-admin/assets/')) return assets(res, p.slice('/wp-admin/assets/'.length));
    if (p === '/wp-login.php' || p.startsWith('/wp-admin/')) return assets(res, 'index.html');
    throw new HttpError(404, 'not found');
  }

  async function handler(req, res) {
    try {
      if (!hostAllowed(req)) throw new HttpError(421, 'Host nicht erlaubt');
      await route(req, res);
    } catch (e) {
      const status_ = e instanceof HttpError ? e.status : e instanceof PathError ? 400 : 500;
      if (status_ === 500) log({ event: 'error', path: req.url, error: e.stack || e.message });
      if (res.headersSent) { res.end(); return; }
      const message = status_ === 500 ? 'server' : e.message;
      json(res, status_, { error: { 401: 'login', 403: 'forbidden', 404: 'not_found', 413: 'too_large', 500: 'server' }[status_] || 'bad_request', message });
    }
  }

  return { handler, auth, publisher, git, log, config: cfg };
}
