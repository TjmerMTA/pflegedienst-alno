// The admin application: routing, auth checks, CSRF, and the handlers behind every screen.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { sitePaths } from './config.js';
import { createAuth, csrfEqual, MIN_PASSWORD } from './auth.js';
import { createGit, REV_RE } from './git.js';
import { createPublisher } from './publish.js';
import { HttpError, readForm, readMultipart, parseCookies, cookie, send, redirect, json, SECURITY_HEADERS } from './http.js';
import { safeJoin, PathError, writeAtomic, sha, createMutex, SLUG_RE, slugify, readJsonFile, writeJsonPrivate } from './fsutil.js';
import { listPageFiles, checkStructure, applyValues, serializePage, mergeOldValues, validateValues, pageImageRefs, pageLines, tokenKeys, isImagePath, PAGE_ID_RE } from './pages.js';
import { COLLECTIONS, POST_TYPES, listEntries, readEntry, formValues, applyForm, serializeEntry, entryImageRefs } from './collections.js';
import { splitFrontmatter, parseFrontmatter } from './frontmatter.js';
import { unsupportedMarkdown } from './markdown.js';
import { listImages, processUpload, randomName, imageInfo, thumbnail, UploadError } from './media.js';
import { lineDiff, compact } from './diff.js';
import { translator } from './i18n.js';
import { html } from './html.js';
import { layout, loginPage, errorPage } from './views/layout.js';
import * as V from './views/screens.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, '..', 'public');
const STATIC = {
  'admin.css': [path.join(PUBLIC_DIR, 'admin.css'), 'text/css; charset=utf-8'],
  'admin.js': [path.join(PUBLIC_DIR, 'admin.js'), 'text/javascript; charset=utf-8'],
  'lib/sanitize.js': [path.join(here, 'sanitize.js'), 'text/javascript; charset=utf-8'],
  'lib/markdown.js': [path.join(here, 'markdown.js'), 'text/javascript; charset=utf-8'],
};
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const REV_FILE_RE = /^src\/content\/(?:pages\/_?[a-z0-9]+(?:-[a-z0-9]+)*\.json|(?:blog|leistungen|team)\/[a-z0-9]+(?:-[a-z0-9]+)*\.md)$/;

const SESSION_COOKIE = 'alno_session';
const LOGIN_COOKIE = 'alno_login';

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

  const imageExists = (p) => {
    if (!isImagePath(p)) return false;
    try { return fs.statSync(safeJoin(P.img, p)).isFile(); } catch { return false; }
  };

  // ------------------------------------------------------------------ helpers

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
    if (origin && origin !== 'null') return check(origin);
    if (origin === 'null') return false;
    if (req.headers.referer) return check(req.headers.referer);
    return true;
  }

  async function baseCtx(req, session, url) {
    const t = translator(session.lang);
    const [pages, status] = await Promise.all([listPageFiles(P.pages), publisher.snapshot()]);
    return { cfg, t, user: session.user, lang: session.lang, csrf: session.csrf, pages, status, path: url.pathname + url.search, menu: '', sub: '' };
  }

  function page(res, ctx, title, body, notices = [], status = 200) {
    send(res, status, layout(ctx, { title, body, notices }).toString());
  }

  function wantsJson(req) {
    return String(req.headers.accept || '').includes('application/json') || req.headers['x-requested-with'] === 'XMLHttpRequest';
  }

  async function jobNotice(ctx, jobId) {
    const { t } = ctx;
    const j = await publisher.job(jobId);
    if (j.state === 'done') return { type: 'success', message: t('notice.updated') };
    if (j.state === 'failed') return { type: 'error', message: j.phase === 'deploy' ? t('notice.deployfailed') : t('notice.buildfailed'), log: j.log };
    return { type: 'info', message: t('notice.saved'), job: jobId };
  }

  async function messageNotices(ctx, url) {
    const { t } = ctx;
    const m = url.searchParams.get('message');
    const job = Number(url.searchParams.get('job') || 0);
    const out = [];
    if (job > 0) out.push(await jobNotice(ctx, job));
    const map = { trashed: 'notice.trashed', untrashed: 'notice.untrashed', deleted: 'notice.deleted', restored: 'notice.restored', uploaded: 'notice.uploaded', mediasaved: 'notice.mediasaved', mediatrashed: 'notice.mediatrashed', profile: 'notice.profile', password: 'notice.password', nochange: 'notice.nochange' };
    if (m && map[m]) out.unshift({ type: m === 'nochange' ? 'info' : 'success', message: t(map[m]) });
    return out;
  }

  const errorItems = (ctx, errors) => errors.map((e) => `${e.label || e.path}: ${ctx.t.msg(e.msg)}`);

  async function moveFile(from, to) {
    await fsp.mkdir(path.dirname(to), { recursive: true });
    try { await fsp.rename(from, to); } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      await fsp.copyFile(from, to); await fsp.unlink(from);
    }
  }

  // ------------------------------------------------------------------ login

  async function loginForm(req, res, url, { error, status = 200, user = '' } = {}) {
    const t = translator('de');
    const token = crypto.randomBytes(24).toString('base64url');
    const users = await auth.listUsers();
    let info = null;
    if (url.searchParams.get('loggedout')) info = t('login.loggedout');
    if (url.searchParams.get('expired')) info = t('login.expired');
    if (!users.length) info = t('login.nousers');
    const redirectTo = safeRedirect(url.searchParams.get('redirect_to') || '');
    send(res, status, loginPage({ t, error, info, token, user, redirectTo }).toString(), {
      'Set-Cookie': cookie(LOGIN_COOKIE, token, { maxAge: 3600, secure: isHttps(req), path: '/wp-login.php' }),
    });
  }

  function safeRedirect(v) {
    return typeof v === 'string' && v.startsWith('/wp-admin/') && !v.includes('//') && !v.includes('\\') && !/[\r\n]/.test(v) ? v : '';
  }

  async function loginPost(req, res, url) {
    const t = translator('de');
    const form = await readForm(req, 64 * 1024);
    const cookies = parseCookies(req);
    if (!csrfEqual(String(form._login_nonce || ''), cookies[LOGIN_COOKIE] || '')) {
      return loginForm(req, res, url, { error: t('login.csrf'), status: 403 });
    }
    const ip = clientIp(req);
    const r = await auth.login(form.log, form.pwd, ip);
    if (!r.ok) {
      log({ event: 'login-failed', user: String(form.log || '').slice(0, 40), ip, reason: r.reason });
      if (r.reason === 'locked') return loginForm(req, res, url, { error: t('login.locked', { min: Math.ceil(r.retryMs / 60000) }), status: 429, user: String(form.log || '') });
      return loginForm(req, res, url, { error: t('login.invalid'), status: 401, user: String(form.log || '') });
    }
    const s = await auth.createSession(r.user);
    log({ event: 'login', user: r.user, ip });
    const to = safeRedirect(String(form.redirect_to || '')) || '/wp-admin/';
    redirect(res, to, { 'Set-Cookie': [cookie(SESSION_COOKIE, s.token, { maxAge: Math.round(cfg.sessionIdleMs / 1000) * 3, secure: isHttps(req) }), cookie(LOGIN_COOKIE, '', { maxAge: 0, path: '/wp-login.php' })] });
  }

  async function logout(req, res, session, token) {
    await auth.destroySession(token);
    log({ event: 'logout', user: session.user });
    redirect(res, '/wp-login.php?loggedout=true', { 'Set-Cookie': cookie(SESSION_COOKIE, '', { maxAge: 0, secure: isHttps(req) }) });
  }

  // ------------------------------------------------------------------ dashboard

  async function dashboard(req, res, ctx) {
    ctx.menu = 'dashboard'; ctx.sub = 'home';
    const [blog, leistungen, team, images] = await Promise.all([listEntries('blog', P.blog), listEntries('leistungen', P.leistungen), listEntries('team', P.team), listImages(P.img)]);
    let activity = [];
    if (await isRepo()) { try { activity = (await git.log(null, 8)); } catch {} }
    const counts = { pages: ctx.pages.filter((p) => p.id !== '_global').length, posts: blog.length, leistungen: leistungen.length, team: team.length, media: images.length };
    const firstPage = ctx.pages.find((p) => p.id === 'index') || ctx.pages.find((p) => p.id !== '_global');
    page(res, ctx, ctx.t('menu.dashboard'), V.dashboard(ctx, { counts, status: ctx.status, activity, firstPage }), await messageNotices(ctx, ctx.url));
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
    let pg;
    try { pg = JSON.parse(text); } catch (e) { return { id, file, text, hash: sha(text), page: null, structureErrors: [{ path: 'JSON', msg: e.message }] }; }
    return { id, file, text, hash: sha(text), page: pg, structureErrors: checkStructure(pg) };
  }

  async function globalTokens() {
    try { return tokenKeys(JSON.parse(await fsp.readFile(path.join(P.pages, '_global.json'), 'utf8'))); } catch { return []; }
  }

  async function pageEditScreen(res, ctx, loaded, { errors = [], notices = [], status = 200, pageObj, hash } = {}) {
    ctx.menu = loaded.id === '_global' ? 'settings' : 'pages';
    ctx.sub = loaded.id;
    const st = await fsp.stat(loaded.file);
    const body = V.pageEdit(ctx, {
      id: loaded.id, page: pageObj || loaded.page || { label: loaded.id, groups: [] }, errors, hash: hash || loaded.hash, modified: st.mtime,
      revCount: await revCount(rel(loaded.file)), tokens: await globalTokens(), structureErrors: loaded.structureErrors,
    });
    page(res, ctx, loaded.page?.label || loaded.id, body, notices, status);
  }

  async function savePage(req, res, ctx, form) {
    const id = String(form.post || '');
    return writeLock(async () => {
      const loaded = await loadPage(id);
      if (loaded.structureErrors.length) return pageEditScreen(res, ctx, loaded, { status: 422 });
      const tokens = id === '_global' ? tokenKeys(loaded.page) : await globalTokens();
      const { page: next, errors } = applyValues(loaded.page, form.f || {}, { imageExists, tokens });
      if (form._hash !== loaded.hash) {
        return pageEditScreen(res, ctx, loaded, { pageObj: next, notices: [{ type: 'warning', message: ctx.t('notice.conflict') }], status: 409 });
      }
      if (errors.length) {
        return pageEditScreen(res, ctx, loaded, { pageObj: next, errors, notices: [{ type: 'error', message: ctx.t('notice.errors'), items: errorItems(ctx, errors) }], status: 422 });
      }
      const out = serializePage(next);
      const base = `/wp-admin/post.php?post_type=page&post=${encodeURIComponent(id)}`;
      if (out === loaded.text) return redirect(res, `${base}&message=nochange`);
      await writeAndCommit(loaded.file, out, loaded.text, `Admin: ${next.label || id} aktualisiert`, ctx.user);
      const job = await publisher.request(`${next.label || id}`, ctx.user);
      log({ event: 'save', user: ctx.user, file: rel(loaded.file), job });
      redirect(res, `${base}&job=${job}`);
    });
  }

  // ------------------------------------------------------------------ collections

  function collOf(postType) {
    const coll = POST_TYPES[postType];
    if (!coll) throw new HttpError(404, 'not found');
    return coll;
  }
  const collDir = (coll) => P[COLLECTIONS[coll].dir];
  const menuOf = (coll) => ({ blog: 'posts', leistungen: 'leistungen', team: 'team' }[coll]);
  const trashDir = (coll) => path.join(cfg.dataDir, 'trash', coll);

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

  async function collectionList(req, res, ctx, coll) {
    const url = ctx.url;
    const view = ['publish', 'draft', 'trash'].includes(url.searchParams.get('post_status')) ? url.searchParams.get('post_status') : 'all';
    const search = String(url.searchParams.get('s') || '').trim().toLowerCase();
    let entries = await listEntries(coll, collDir(coll));
    const trash = COLLECTIONS[coll].canDelete ? await listTrash(coll) : [];
    const sortKey = (e) => (coll === 'blog' ? e.values.date || '' : String(Number(e.values.order ?? 100)).padStart(6, '0'));
    entries.sort((a, b) => (coll === 'blog' ? sortKey(b).localeCompare(sortKey(a)) : sortKey(a).localeCompare(sortKey(b))) || a.slug.localeCompare(b.slug));
    const counts = { all: entries.length, publish: entries.filter((e) => !e.values.draft).length, draft: entries.filter((e) => e.values.draft).length, trash: trash.length };
    if (view === 'publish') entries = entries.filter((e) => !e.values.draft);
    if (view === 'draft') entries = entries.filter((e) => e.values.draft);
    if (search) entries = entries.filter((e) => JSON.stringify(e.values).toLowerCase().includes(search) || e.slug.includes(search));
    ctx.menu = menuOf(coll); ctx.sub = 'all';
    page(res, ctx, ctx.t(`menu.${ctx.menu}`), V.collectionList(ctx, { coll, entries, trash, view, search, counts }), await messageNotices(ctx, url));
  }

  async function collectionEditScreen(res, ctx, coll, { slug, isNew, values, body, errors = [], notices = [], hash, status = 200 }) {
    ctx.menu = menuOf(coll); ctx.sub = isNew ? 'new' : 'all';
    let modified = null; let revs = 0;
    if (!isNew) {
      const file = path.join(collDir(coll), `${slug}.md`);
      try { modified = (await fsp.stat(file)).mtime; } catch {}
      revs = await revCount(rel(file));
    }
    const visualOff = COLLECTIONS[coll].body ? unsupportedMarkdown(body) : [];
    const title = (coll === 'team' ? values.name : values.title) || slug || '';
    page(res, ctx, title || ctx.t('edit.post.new'), V.collectionEdit(ctx, { coll, slug, isNew, values, body, errors, hash, modified, revCount: revs, visualOff }), notices, status);
  }

  async function collectionEdit(req, res, ctx, coll, slug) {
    if (!SLUG_RE.test(String(slug))) throw new HttpError(404, 'not found');
    let entry;
    try { entry = await readEntry(collDir(coll), slug); } catch (e) {
      if (e.code === 'ENOENT') throw new HttpError(404, 'not found');
      ctx.menu = menuOf(coll);
      return page(res, ctx, slug, html`<h1>${slug}</h1>`, [{ type: 'error', message: ctx.t('edit.unreadable', { err: e.message }) }], 422);
    }
    await collectionEditScreen(res, ctx, coll, { slug, isNew: false, values: formValues(coll, entry.entries), body: entry.body, hash: entry.hash, notices: await messageNotices(ctx, ctx.url) });
  }

  function newValues(coll) {
    const today = new Date().toISOString().slice(0, 10);
    const v = formValues(coll, coll === 'blog' ? [['date', { date: today }]] : []);
    return v;
  }

  // Values for re-showing a rejected form.
  function valuesFromForm(coll, entries, form) {
    const v = formValues(coll, entries);
    for (const f of COLLECTIONS[coll].fields) {
      const x = form[f.id];
      if (f.type === 'boolean') v[f.id] = x === 'on';
      else if (f.type === 'image') { v[f.id] = String(x?.value ?? ''); if (f.altKey) v[f.altKey] = String(x?.alt ?? ''); }
      else if (f.type === 'tags') v[f.id] = String(x ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      else if (f.type === 'strings') v[f.id] = x && typeof x === 'object' ? Object.entries(x).filter(([k]) => k !== '_').map(([, s]) => String(s)) : [];
      else v[f.id] = String(x ?? '');
    }
    return v;
  }

  async function saveEntry(req, res, ctx, coll, form) {
    const def = COLLECTIONS[coll];
    const dir = collDir(coll);
    const existing = String(form.post || '');
    const isNew = !existing;
    if (isNew && !def.canCreate) throw new HttpError(403, 'forbidden');
    return writeLock(async () => {
      let entry = null; let slug = existing;
      if (!isNew) {
        if (!SLUG_RE.test(existing)) throw new HttpError(404, 'not found');
        try { entry = await readEntry(dir, existing); } catch (e) { if (e.code === 'ENOENT') throw new HttpError(404, 'not found'); throw e; }
      }
      const oldEntries = entry ? entry.entries : [];
      const { entries, body, errors } = applyForm(coll, oldEntries, form, { imageExists });
      if (isNew) {
        const titleKey = def.fields.find((f) => f.box === 'title').id;
        slug = slugify(String(form.slug || '').trim() || String(form[titleKey] || ''));
        if (!SLUG_RE.test(slug)) errors.push({ path: 'slug', label: 'Permalink', msg: ctx.t('notice.slug') });
        else if (fs.existsSync(path.join(dir, `${slug}.md`))) errors.push({ path: 'slug', label: 'Permalink', msg: ctx.t('notice.exists') });
      }
      const show = (extra) => collectionEditScreen(res, ctx, coll, { slug, isNew, values: valuesFromForm(coll, oldEntries, form), body: typeof form.body === 'string' ? form.body : (entry?.body || ''), hash: entry?.hash, ...extra });
      if (!isNew && form._hash !== entry.hash) {
        return show({ hash: entry.hash, notices: [{ type: 'warning', message: ctx.t('notice.conflict') }], status: 409 });
      }
      if (errors.length) return show({ errors, notices: [{ type: 'error', message: ctx.t('notice.errors'), items: errorItems(ctx, errors) }], status: 422 });
      const file = path.join(dir, `${slug}.md`);
      const out = serializeEntry(coll, entries, body);
      const base = `/wp-admin/post.php?post_type=${def.postType}&post=${encodeURIComponent(slug)}`;
      if (entry && out === entry.text) return redirect(res, `${base}&message=nochange`);
      const title = new Map(entries).get(coll === 'team' ? 'name' : 'title');
      await writeAndCommit(file, out, entry ? entry.text : null, `Admin: ${isNew ? 'neu' : 'aktualisiert'} – ${title} (${def.dir}/${slug}.md)`, ctx.user);
      const job = await publisher.request(String(title), ctx.user);
      log({ event: isNew ? 'create' : 'save', user: ctx.user, file: rel(file), job });
      redirect(res, `${base}&job=${job}`);
    });
  }

  async function trashEntry(req, res, ctx, coll, form) {
    const def = COLLECTIONS[coll];
    if (!def.canDelete) throw new HttpError(403, 'forbidden');
    const slug = String(form.post || '');
    if (!SLUG_RE.test(slug)) throw new HttpError(404, 'not found');
    return writeLock(async () => {
      const file = path.join(collDir(coll), `${slug}.md`);
      let entry;
      try { entry = await readEntry(collDir(coll), slug); } catch (e) { if (e.code === 'ENOENT') throw new HttpError(404, 'not found'); entry = null; }
      const id = `${Date.now()}-${slug}`;
      const values = entry ? formValues(coll, entry.entries) : {};
      await moveFile(file, path.join(trashDir(coll), `${id}.md`));
      await writeJsonPrivate(path.join(trashDir(coll), `${id}.json`), { id, slug, coll, by: ctx.user, at: new Date().toISOString(), title: (coll === 'team' ? values.name : values.title) || slug });
      await commit([rel(file)], `Admin: in den Papierkorb – ${def.dir}/${slug}.md`, ctx.user);
      const job = await publisher.request(`Papierkorb: ${slug}`, ctx.user);
      log({ event: 'trash', user: ctx.user, file: rel(file), job });
      redirect(res, `/wp-admin/edit.php?post_type=${def.postType}&message=trashed&job=${job}`);
    });
  }

  async function untrashEntry(req, res, ctx, coll, form, permanently) {
    const def = COLLECTIONS[coll];
    if (!def.canDelete) throw new HttpError(403, 'forbidden');
    const id = String(form.trash_id || '');
    if (!/^\d+-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new HttpError(404, 'not found');
    return writeLock(async () => {
      const metaFile = path.join(trashDir(coll), `${id}.json`);
      const mdFile = path.join(trashDir(coll), `${id}.md`);
      const meta = await readJsonFile(metaFile, null);
      if (!meta || !SLUG_RE.test(meta.slug)) throw new HttpError(404, 'not found');
      if (permanently) {
        await fsp.rm(mdFile, { force: true }); await fsp.rm(metaFile, { force: true });
        log({ event: 'delete', user: ctx.user, id });
        return redirect(res, `/wp-admin/edit.php?post_type=${def.postType}&post_status=trash&message=deleted`);
      }
      const target = path.join(collDir(coll), `${meta.slug}.md`);
      if (fs.existsSync(target)) {
        return page(res, ctx, ctx.t('list.trash'), html``, [{ type: 'error', message: ctx.t('notice.exists') }], 409);
      }
      await moveFile(mdFile, target);
      await fsp.rm(metaFile, { force: true });
      await commit([rel(target)], `Admin: aus dem Papierkorb wiederhergestellt – ${def.dir}/${meta.slug}.md`, ctx.user);
      const job = await publisher.request(`Wiederhergestellt: ${meta.slug}`, ctx.user);
      log({ event: 'untrash', user: ctx.user, file: rel(target), job });
      redirect(res, `/wp-admin/post.php?post_type=${def.postType}&post=${encodeURIComponent(meta.slug)}&message=untrashed&job=${job}`);
    });
  }

  // ------------------------------------------------------------------ media

  const mediaMetaFile = path.join(cfg.dataDir, 'media.json');

  async function usages(imgPath) {
    const out = [];
    for (const p of await listPageFiles(P.pages)) {
      try {
        const pg = JSON.parse(await fsp.readFile(path.join(P.pages, `${p.id}.json`), 'utf8'));
        for (const r of pageImageRefs(pg)) if (r.path === imgPath) out.push({ title: pg.label || p.id, where: r.where, alt: r.alt, editUrl: `/wp-admin/post.php?post_type=page&post=${encodeURIComponent(p.id)}` });
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
          const v = formValues(coll, e.entries);
          for (const r of entryImageRefs(coll, e.entries)) if (r.path === imgPath) out.push({ title: (coll === 'team' ? v.name : v.title) || slug, where: r.where, alt: r.alt, editUrl: `/wp-admin/post.php?post_type=${def.postType}&post=${slug}` });
          if (e.body.includes(`assets/img/${imgPath}`)) out.push({ title: v.title || slug, where: 'Text', alt: '', editUrl: `/wp-admin/post.php?post_type=${def.postType}&post=${slug}` });
        } catch {}
      }
    }
    // Images the site's code imports directly (logo etc.) must not be deleted either.
    const code = await codeReferences(imgPath);
    for (const f of code) out.push({ title: 'Website-Code', where: f, alt: '', editUrl: '#' });
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

  async function mediaLibrary(req, res, ctx) {
    ctx.menu = 'media'; ctx.sub = 'library';
    const url = ctx.url;
    const search = String(url.searchParams.get('s') || '').trim().toLowerCase();
    let images = await listImages(P.img);
    if (search) images = images.filter((i) => i.path.toLowerCase().includes(search));
    const item = url.searchParams.get('item');
    let details = '';
    if (item) {
      const image = images.find((i) => i.path === item);
      if (!image) throw new HttpError(404, 'not found');
      const meta = await readJsonFile(mediaMetaFile, {});
      details = V.mediaDetails(ctx, { image, info: await imageInfo(safeJoin(P.img, item), cfg.siteDir), usedOn: await usages(item), defaultAlt: meta[item]?.alt || '' });
    }
    page(res, ctx, ctx.t('media.title'), html`${V.mediaLibrary(ctx, { images, selected: item, search })}${details}`, await messageNotices(ctx, url));
  }

  async function mediaPost(req, res, ctx, form) {
    const item = String(form.item || '');
    if (!isImagePath(item) || !imageExists(item)) throw new HttpError(404, 'not found');
    if (form.action === 'save-meta') {
      await writeLock(async () => {
        const meta = await readJsonFile(mediaMetaFile, {});
        const alt = String(form.alt || '').replace(/\s+/g, ' ').trim().slice(0, 300);
        if (alt) meta[item] = { alt }; else delete meta[item];
        await writeJsonPrivate(mediaMetaFile, meta);
      });
      return redirect(res, `/wp-admin/upload.php?item=${encodeURIComponent(item)}&message=mediasaved`);
    }
    if (form.action === 'delete') {
      return writeLock(async () => {
        if ((await usages(item)).length) throw new HttpError(409, ctx.t('media.delete.used'));
        const abs = safeJoin(P.img, item);
        await moveFile(abs, path.join(cfg.dataDir, 'trash', 'media', `${Date.now()}-${item.replace(/\//g, '__')}`));
        await commit([rel(abs)], `Admin: Bild gelöscht – ${item}`, ctx.user);
        log({ event: 'media-delete', user: ctx.user, file: item });
        redirect(res, '/wp-admin/upload.php?message=mediatrashed');
      });
    }
    throw new HttpError(400, 'bad request');
  }

  async function upload(req, res, ctx) {
    const { fields, files } = await readMultipart(req, cfg.uploadMaxBytes * 1.05 + 64 * 1024);
    if (!csrfEqual(String(fields._wpnonce || req.headers['x-wp-nonce'] || ''), ctx.csrf)) throw new HttpError(403, 'csrf');
    const done = []; const errors = [];
    for (const f of files.filter((x) => x.field === 'async-upload')) {
      try {
        const r = await processUpload(f.data, { maxBytes: cfg.uploadMaxBytes, siteDir: cfg.siteDir });
        const name = randomName(r.ext);
        await writeLock(async () => {
          const abs = path.join(P.uploads, name);
          await writeAtomic(abs, r.buffer);
          await commit([rel(abs)], `Admin: Bild hochgeladen – uploads/${name}`, ctx.user);
        });
        const p = `uploads/${name}`;
        log({ event: 'upload', user: ctx.user, file: p, original: String(f.filename).slice(0, 80), bytes: r.buffer.length });
        done.push({ path: p, name, width: r.width, height: r.height, original: f.filename });
      } catch (e) {
        if (!(e instanceof UploadError)) log({ event: 'upload-error', user: ctx.user, error: e.message });
        errors.push({ file: String(f.filename || '').slice(0, 120), msg: ctx.t.msg(e instanceof UploadError ? e.message : 'Das Bild konnte nicht verarbeitet werden') });
      }
    }
    if (!files.length) errors.push({ file: '', msg: ctx.t.msg('Leere Datei') });
    if (wantsJson(req)) return json(res, errors.length && !done.length ? 422 : 200, { files: done, errors });
    if (errors.length) {
      ctx.menu = 'media'; ctx.sub = 'new';
      return page(res, ctx, ctx.t('menu.media.new'), V.mediaNew(ctx), [{ type: 'error', message: errors.map((e) => `${e.file}: ${e.msg}`).join(' · ') }], 422);
    }
    redirect(res, done.length === 1 ? `/wp-admin/upload.php?item=${encodeURIComponent(done[0].path)}&message=uploaded` : '/wp-admin/upload.php?message=uploaded');
  }

  async function mediaFile(req, res, url) {
    const f = String(url.searchParams.get('f') || '');
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

  async function mediaJson(res) {
    const meta = await readJsonFile(mediaMetaFile, {});
    const images = (await listImages(P.img)).map((i) => ({ path: i.path, name: i.name, size: i.size, alt: meta[i.path]?.alt || '' }));
    json(res, 200, { images });
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

  function editUrlFor(file) {
    let m;
    if ((m = /^src\/content\/pages\/(.+)\.json$/.exec(file))) return `/wp-admin/post.php?post_type=page&post=${encodeURIComponent(m[1])}`;
    if ((m = /^src\/content\/(blog|leistungen|team)\/(.+)\.md$/.exec(file))) return `/wp-admin/post.php?post_type=${COLLECTIONS[m[1]].postType}&post=${encodeURIComponent(m[2])}`;
    return null;
  }

  async function revisions(req, res, ctx) {
    ctx.menu = 'revisions';
    const url = ctx.url;
    const file = url.searchParams.get('file');
    const repo = await isRepo();
    if (!file) {
      const files = repo ? (await git.recentFiles(['src/content'])).filter((f) => REV_FILE_RE.test(f.file)) : [];
      for (const f of files) f.title = await fileTitle(f.file);
      return page(res, ctx, ctx.t('rev.title'), V.revisionIndex(ctx, { files, isRepo: repo }), await messageNotices(ctx, url));
    }
    if (!REV_FILE_RE.test(file)) throw new HttpError(404, 'not found');
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
    const editUrl = fs.existsSync(path.join(cfg.siteDir, file)) ? editUrlFor(file) : null;
    page(res, ctx, ctx.t('rev.title'), V.revisionFile(ctx, { file, title: await fileTitle(file), editUrl, revs, selected, diff, same, isRepo: repo }), await messageNotices(ctx, url));
  }

  async function restoreRevision(req, res, ctx, form) {
    const file = String(form.file || ''); const rev = String(form.rev || '');
    if (!REV_FILE_RE.test(file) || !REV_RE.test(rev) || !(await isRepo())) throw new HttpError(404, 'not found');
    return writeLock(async () => {
      let old;
      try { old = (await git.show(rev, file)).toString('utf8'); } catch { throw new HttpError(404, 'not found'); }
      const abs = safeJoin(cfg.siteDir, file);
      let out;
      const fail = (items) => page(res, ctx, ctx.t('rev.title'), html`<p><a href="/wp-admin/revision.php?file=${encodeURIComponent(file)}">${ctx.t('err.back')}</a></p>`, [{ type: 'error', message: ctx.t('notice.errors'), items }], 422);
      if (file.endsWith('.json')) {
        let current;
        try { current = JSON.parse(await fsp.readFile(abs, 'utf8')); } catch { return fail([ctx.t('err.notfound')]); }
        let oldPage;
        try { oldPage = JSON.parse(old); } catch (e) { return fail([e.message]); }
        const merged = mergeOldValues(current, oldPage);
        const errors = validateValues(merged, { imageExists });
        if (errors.length) return fail(errorItems(ctx, errors));
        out = serializePage(merged);
      } else {
        try { parseFrontmatter(splitFrontmatter(old).fm); } catch (e) { return fail([e.message]); }
        out = old;
      }
      const previous = fs.existsSync(abs) ? await fsp.readFile(abs, 'utf8') : null;
      await writeAndCommit(abs, out, previous, `Admin: Revision ${rev.slice(0, 7)} wiederhergestellt – ${file}`, ctx.user);
      const job = await publisher.request(`Revision ${rev.slice(0, 7)}`, ctx.user);
      log({ event: 'restore', user: ctx.user, file, rev, job });
      const back = editUrlFor(file) || `/wp-admin/revision.php?file=${encodeURIComponent(file)}`;
      redirect(res, `${back}${back.includes('?') ? '&' : '?'}message=restored&job=${job}`);
    });
  }

  // ------------------------------------------------------------------ profile

  async function profilePost(req, res, ctx, form, token) {
    if (form.action === 'lang') {
      if (['de', 'ru'].includes(form.lang)) await auth.setLang(ctx.user, form.lang);
      return redirect(res, safeRedirect(String(form.back || '')) || '/wp-admin/');
    }
    const errors = [];
    if (['de', 'ru'].includes(form.lang)) await auth.setLang(ctx.user, form.lang);
    const t = translator(form.lang || ctx.lang);
    ctx.t = t;
    if (form.pass1 || form.pass2) {
      if (!(await auth.checkPassword(ctx.user, form.pass0))) errors.push(t('profile.password.wrong'));
      else if (form.pass1 !== form.pass2) errors.push(t('profile.password.mismatch'));
      else if (String(form.pass1).length < MIN_PASSWORD) errors.push(t('profile.password.help', { n: MIN_PASSWORD }));
      if (errors.length) {
        ctx.menu = 'profile';
        return page(res, ctx, t('profile.title'), V.profile(ctx, { user: ctx.user, lang: form.lang || ctx.lang, errors }), [], 422);
      }
      await auth.setPassword(ctx.user, form.pass1);
      const s = await auth.createSession(ctx.user);
      log({ event: 'password', user: ctx.user });
      return redirect(res, '/wp-admin/profile.php?message=password', { 'Set-Cookie': cookie(SESSION_COOKIE, s.token, { maxAge: Math.round(cfg.sessionIdleMs / 1000) * 3, secure: isHttps(req) }) });
    }
    redirect(res, '/wp-admin/profile.php?message=profile');
  }

  // ------------------------------------------------------------------ router

  async function route(req, res) {
    const url = new URL(req.url, 'http://admin.local');
    const p = url.pathname;
    const method = req.method;

    if (p === '/' || p === '/wp-admin') return redirect(res, '/wp-admin/');
    if (p.startsWith('/wp-admin/assets/')) {
      const s = STATIC[p.slice('/wp-admin/assets/'.length)];
      if (!s || method !== 'GET') throw new HttpError(404, 'not found');
      const body = await fsp.readFile(s[0]);
      return send(res, 200, body, { 'Content-Type': s[1], 'Cache-Control': 'no-cache' });
    }
    if (p === '/wp-login.php') {
      if (method === 'POST' && url.searchParams.get('action') === 'logout') {
        const token = parseCookies(req)[SESSION_COOKIE];
        const session = await auth.getSession(token);
        if (!session) return redirect(res, '/wp-login.php');
        const form = await readForm(req, 64 * 1024);
        if (!originOk(req) || !csrfEqual(String(form._wpnonce || ''), session.csrf)) throw new HttpError(403, 'csrf');
        return logout(req, res, session, token);
      }
      if (method === 'POST') { if (!originOk(req)) throw new HttpError(403, 'origin'); return loginPost(req, res, url); }
      if (method === 'GET') {
        if (await auth.getSession(parseCookies(req)[SESSION_COOKIE])) return redirect(res, '/wp-admin/');
        return loginForm(req, res, url);
      }
      throw new HttpError(405, 'method');
    }
    if (!p.startsWith('/wp-admin/')) throw new HttpError(404, 'not found');

    const token = parseCookies(req)[SESSION_COOKIE];
    const session = await auth.getSession(token);
    if (!session) {
      if (method === 'GET' && !p.includes('admin-ajax') && !p.includes('media-file')) {
        return redirect(res, `/wp-login.php?redirect_to=${encodeURIComponent(p + url.search)}${token ? '&expired=1' : ''}`);
      }
      throw new HttpError(401, 'login');
    }
    const ctx = await baseCtx(req, session, url);
    ctx.url = url;

    if (method === 'POST') {
      if (!originOk(req)) throw new HttpError(403, 'origin');
      if (p === '/wp-admin/async-upload.php') return upload(req, res, ctx);
      const form = await readForm(req);
      const nonceVal = String(form._wpnonce || req.headers['x-wp-nonce'] || '');
      if (!csrfEqual(nonceVal, session.csrf)) {
        log({ event: 'csrf-reject', user: session.user, path: p });
        throw new HttpError(403, 'csrf');
      }
      switch (p) {
        case '/wp-admin/post.php': {
          const pt = String(form.post_type || '');
          if (pt === 'page') {
            if (form.action === 'editpost') return savePage(req, res, ctx, form);
            throw new HttpError(400, 'bad request');
          }
          const coll = collOf(pt);
          switch (form.action) {
            case 'editpost': return saveEntry(req, res, ctx, coll, form);
            case 'trash': return trashEntry(req, res, ctx, coll, form);
            case 'untrash': return untrashEntry(req, res, ctx, coll, form, false);
            case 'delete': return untrashEntry(req, res, ctx, coll, form, true);
            default: throw new HttpError(400, 'bad request');
          }
        }
        case '/wp-admin/upload.php': return mediaPost(req, res, ctx, form);
        case '/wp-admin/revision.php': if (form.action === 'restore') return restoreRevision(req, res, ctx, form); throw new HttpError(400, 'bad request');
        case '/wp-admin/profile.php': return profilePost(req, res, ctx, form, token);
        default: throw new HttpError(404, 'not found');
      }
    }
    if (method !== 'GET') throw new HttpError(405, 'method');

    switch (p) {
      case '/wp-admin/':
      case '/wp-admin/index.php': return dashboard(req, res, ctx);
      case '/wp-admin/edit.php': {
        const pt = url.searchParams.get('post_type') || 'post';
        if (pt === 'page') {
          ctx.menu = 'pages'; ctx.sub = 'all';
          return page(res, ctx, ctx.t('menu.pages'), V.pageList(ctx, { pages: ctx.pages }), await messageNotices(ctx, url));
        }
        return collectionList(req, res, ctx, collOf(pt));
      }
      case '/wp-admin/post.php': {
        const pt = url.searchParams.get('post_type') || 'post';
        const id = url.searchParams.get('post') || '';
        if (pt === 'page') return pageEditScreen(res, ctx, await loadPage(id), { notices: await messageNotices(ctx, url) });
        return collectionEdit(req, res, ctx, collOf(pt), id);
      }
      case '/wp-admin/post-new.php': {
        const coll = collOf(url.searchParams.get('post_type') || 'post');
        if (!COLLECTIONS[coll].canCreate) throw new HttpError(404, 'not found');
        return collectionEditScreen(res, ctx, coll, { slug: '', isNew: true, values: newValues(coll), body: '' });
      }
      case '/wp-admin/upload.php': return mediaLibrary(req, res, ctx);
      case '/wp-admin/media-new.php': ctx.menu = 'media'; ctx.sub = 'new'; return page(res, ctx, ctx.t('menu.media.new'), V.mediaNew(ctx));
      case '/wp-admin/media-file': return mediaFile(req, res, url);
      case '/wp-admin/revision.php': return revisions(req, res, ctx);
      case '/wp-admin/profile.php': ctx.menu = 'profile'; return page(res, ctx, ctx.t('profile.title'), V.profile(ctx, { user: ctx.user, lang: ctx.lang }), await messageNotices(ctx, url));
      case '/wp-admin/admin-ajax.php': {
        const action = url.searchParams.get('action');
        if (action === 'status') {
          const st = await publisher.snapshot();
          const jobId = Number(url.searchParams.get('job') || 0);
          const out = { state: st.state, failed: !!st.lastError, lastBuild: st.lastBuild || null, lastDeploy: st.lastDeploy || null };
          if (jobId) {
            const j = await publisher.job(jobId);
            const n = await jobNotice(ctx, jobId);
            out.job = { state: j.state, notice: { type: n.type, message: n.message, log: n.log || '' } };
          }
          const bar = st.state !== 'idle' ? st.state : (st.lastError ? 'failed' : 'idle');
          out.bar = { state: bar, text: ctx.t(`bar.status.${bar}`) };
          return json(res, 200, out);
        }
        if (action === 'media') return mediaJson(res);
        throw new HttpError(400, 'bad request');
      }
      default: throw new HttpError(404, 'not found');
    }
  }

  async function handler(req, res) {
    try {
      if (!hostAllowed(req)) throw new HttpError(421, 'Host nicht erlaubt');
      await route(req, res);
    } catch (e) {
      let status = e instanceof HttpError ? e.status : e instanceof PathError ? 400 : 500;
      if (status === 500) log({ event: 'error', path: req.url, error: e.stack || e.message });
      const t = translator('de');
      const msg = status === 404 ? t('err.notfound') : status === 403 ? t('err.forbidden') : status === 401 ? t('login.expired') : status === 409 || status === 413 ? e.message : status === 500 ? t('err.server') : e.message;
      if (res.headersSent) { res.end(); return; }
      if (String(req.url).includes('admin-ajax') || wantsJson(req)) return json(res, status, { error: msg });
      send(res, status, errorPage(t, status, msg).toString());
    }
  }

  return { handler, auth, publisher, git, log, config: cfg };
}
