// The admin in the browser: session, hash router, calling the API, forms. Screens are rendered by
// views/*.js and wired up by behaviour.js; what is valid is decided by the server alone.
import { translator } from './i18n.js';
import { unsupportedMarkdown } from './markdown.js';
import { layout, loginPage, setupPage, errorScreen, notices } from './views/layout.js';
import * as V from './views/screens.js';
import { mount } from './behaviour.js';

const API = '/wp-admin/api.php';
const app = document.getElementById('app');
const SESSION_MAX_AGE = 60000;

let session = null;        // answer of GET session
let sessionAt = 0;
let loginNonce = '';
let siteUrl = 'https://pflegedienst-alno.de';
let setupChecks = null;
let t = translator('de');
let navSeq = 0;
let dirty = false;
let lastHash = location.hash;
let afterLogin = '';

// ---------------- API ----------------

class ApiError extends Error {
  constructor(status, data) {
    super(data?.message || data?.error || `HTTP ${status}`);
    this.status = status;
    this.data = data || {};
  }
}

async function call(url, init = {}) {
  let r;
  try {
    r = await fetch(url, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError(0, { error: 'network' });
  }
  const data = await r.json().catch(() => null);
  if (r.status === 401 && data?.error === 'login' && session) {
    session = null;
    afterLogin = location.hash;
    go('#/login?expired=1');
  }
  if (r.status === 503 && data?.error === 'setup') { session = null; go('#/setup'); }
  if (!r.ok) throw new ApiError(r.status, data);
  return data;
}

const query = (route, q = {}) => {
  const p = new URLSearchParams({ r: route });
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  return `${API}?${p}`;
};

const api = {
  get: (route, q) => call(query(route, q)),
  post: (route, data, headers = {}) => call(query(route), {
    method: 'POST', body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': session?.nonce || '', ...headers },
  }),
  // Upload errors are part of the answer: the screen shows them per file.
  upload: async (formData, stage) => {
    const r = await fetch(query('media/upload', { stage: stage ? 1 : undefined }), { method: 'POST', body: formData, credentials: 'same-origin', headers: { 'X-WP-Nonce': session?.nonce || '' } });
    const data = await r.json().catch(() => ({ message: `HTTP ${r.status}` }));
    if (r.status === 401) { session = null; afterLogin = location.hash; go('#/login?expired=1'); }
    return data;
  },
};

async function loadSession() {
  const r = await fetch(query('session'), { credentials: 'same-origin' });
  const data = await r.json().catch(() => ({}));
  sessionAt = Date.now();
  if (r.ok) {
    session = data;
    t = translator(data.lang);
    document.documentElement.lang = t.lang;
    return 'ok';
  }
  session = null;
  t = translator('de');
  loginNonce = data.loginNonce || '';
  siteUrl = data.siteUrl || siteUrl;
  setupChecks = data.checks || null;
  return data.error === 'setup' ? 'setup' : 'login';
}

// ---------------- navigation ----------------

function go(hash) {
  dirty = false; // only a click on a link asks; the app navigates after it has saved
  if (hash === location.hash) { render(); return; }
  location.hash = hash;
}

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const i = h.indexOf('?');
  return { path: i < 0 ? h : h.slice(0, i), q: Object.fromEntries(new URLSearchParams(i < 0 ? '' : h.slice(i + 1))) };
}

const addParams = (hash, params) => {
  const extra = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return extra ? `${hash}${hash.includes('?') ? '&' : '?'}${extra}` : hash;
};

const MESSAGES = {
  trashed: 'notice.trashed', untrashed: 'notice.untrashed', deleted: 'notice.deleted', restored: 'notice.restored', uploaded: 'notice.uploaded', mediasaved: 'notice.mediasaved',
  mediatrashed: 'notice.mediatrashed', profile: 'notice.profile', password: 'notice.password', nochange: 'notice.nochange', useradded: 'notice.useradded', usersaved: 'notice.usersaved',
  userdeleted: 'notice.userdeleted', retention: 'notice.retention', 'anfrage-status': 'notice.anfrage.status', 'anfrage-trashed': 'notice.anfrage.trashed',
  'anfrage-restored': 'notice.anfrage.restored', 'anfrage-deleted': 'notice.anfrage.deleted',
};

function urlNotices(q) {
  const out = [];
  if (MESSAGES[q.message]) out.push({ type: q.message === 'nochange' ? 'info' : 'success', message: t(MESSAGES[q.message]) });
  if (/^[0-9a-f]{40}$/.test(q.job || '')) out.push({ type: 'info', message: t(q.post_type === 'page' ? 'notice.saved' : 'notice.saved.entry'), job: q.job });
  return out;
}

const ctx = (menu = '', sub = '') => ({
  t, user: session.user, menu, sub, pages: session.pages, status: session.status, isAdmin: session.admin, canAnfragen: session.anfragen, newAnfragen: session.newAnfragen,
  cfg: { siteUrl: session.siteUrl, uploadMaxBytes: session.uploadMaxBytes, actionsUrl: session.actionsUrl },
});

function show(seq, c, title, body, list = []) {
  if (seq !== navSeq) return;
  document.body.className = '';
  document.title = `${title} ‹ ${t('admin.title')}`;
  dirty = false;
  app.innerHTML = layout(c, { body, notices: list });
  mount(app, { api, t, go, statusChanged: () => { sessionAt = 0; } });
  window.scrollTo(0, 0);
}

function showBare(seq, title, content) {
  if (seq !== navSeq) return;
  document.body.className = 'login';
  document.title = `${title} ‹ ${t('admin.title')}`;
  dirty = false;
  app.innerHTML = content;
  app.querySelector('input:not([type=hidden])')?.focus();
}

// A notice on the screen as it is, for what went wrong without leaving it.
function flash(type, message, items) {
  document.querySelectorAll('#wpbody-content > .notice.js-flash').forEach((n) => n.remove());
  const holder = document.createElement('div');
  holder.innerHTML = notices([{ type, message, items }], t).join('');
  const el = holder.firstElementChild;
  el.classList.add('js-flash');
  document.getElementById('wpbody-content')?.prepend(el);
  window.scrollTo(0, 0);
}

function errorText(e) {
  const code = e.data?.error;
  const map = {
    network: 'err.network', forbidden: 'err.forbidden', not_found: 'err.notfound', too_large: 'err.toolarge', conflict: 'notice.conflict', exists: 'notice.exists', in_use: 'media.delete.used',
    too_short: 'err.pwshort', too_long: 'err.pwlong', bad_name: 'err.badname', wrong_password: 'profile.password.wrong', self: 'err.self', retention: 'err.retention', server: 'err.server', data_dir: 'err.datadir',
  };
  if (code === 'forbidden' && e.message !== 'csrf') return t('err.denied');
  if (code === 'locked') return t('err.locked', { n: e.data.retryMinutes });
  if (map[code]) return t(map[code], { n: 10 });
  return t.msg(e.message) || t('err.server');
}

const errorItems = (errors) => (errors || []).map((x) => `${t.label(x.label || x.path)}: ${t.msg(x.msg)}`);

// ---------------- screens ----------------

async function screenPageEdit(seq, id, q, over = {}) {
  const d = over.d || await api.get('page', { id });
  const isGlobal = id === '_global';
  const c = ctx(isGlobal ? 'settings' : 'pages', isGlobal ? '' : id);
  const title = isGlobal ? t('edit.settings') : d.page.label;
  show(seq, c, title, V.pageEdit(c, { id, page: d.page, revCount: d.revisions, tokens: d.tokens, structureErrors: d.structureErrors, errors: over.errors }), over.notices || urlNotices(q));
  state.editing = { kind: 'page', id, d };
}

function entryScreen(seq, d, q, over = {}) {
  const coll = d.def.key;
  const isNew = !d.slug;
  const c = ctx({ blog: 'posts', leistungen: 'leistungen', team: 'team' }[coll], isNew ? 'new' : 'all');
  const values = over.values || d.values;
  const body = over.body ?? d.body;
  const slug = over.slug ?? d.slug;
  show(seq, c, values[d.def.fields.find((f) => f.box === 'title').id] || t('edit.titleph'), V.collectionEdit(c, { def: d.def, slug, isNew, values, body, errors: over.errors, revCount: d.revisions, visualOff: d.def.body ? unsupportedMarkdown(body) : [] }), over.notices || urlNotices(q));
  state.editing = { kind: 'entry', d, isNew };
}

const state = { editing: null };

const screens = {
  async '/'(seq, q) {
    const d = await api.get('dashboard');
    const c = ctx('dashboard', 'home');
    show(seq, c, t('menu.dashboard'), V.dashboard(c, d), urlNotices(q));
  },
  async '/edit.php'(seq, q) {
    if ((q.post_type || 'post') === 'page') {
      const d = await api.get('pages');
      const c = ctx('pages', 'all');
      show(seq, c, t('menu.pages'), V.pageList(c, d), urlNotices(q));
      return;
    }
    const d = await api.get('entries', { type: q.post_type || 'post', status: q.post_status, s: q.s });
    const c = ctx({ blog: 'posts', leistungen: 'leistungen', team: 'team' }[d.def.key], 'all');
    show(seq, c, t({ blog: 'menu.posts', leistungen: 'menu.leistungen', team: 'menu.team' }[d.def.key]), V.collectionList(c, d), urlNotices(q));
  },
  async '/post.php'(seq, q) {
    if (q.post_type === 'page') { await screenPageEdit(seq, q.post, q); return; }
    entryScreen(seq, await api.get('entry', { type: q.post_type, id: q.post }), q);
  },
  async '/post-new.php'(seq, q) {
    entryScreen(seq, await api.get('entry/new', { type: q.post_type || 'post' }), q);
  },
  async '/upload.php'(seq, q) {
    const c = ctx('media', 'library');
    if (q.item) {
      const d = await api.get('media/item', { path: q.item });
      show(seq, c, d.image.name, V.mediaDetails(c, d), urlNotices(q));
      return;
    }
    const d = await api.get('media', { s: q.s });
    show(seq, c, t('media.title'), V.mediaLibrary(c, { images: d.images, search: q.s }), urlNotices(q));
  },
  async '/media-new.php'(seq, q) {
    const c = ctx('media', 'new');
    show(seq, c, t('menu.media.new'), V.mediaNew(c), urlNotices(q));
  },
  async '/revision.php'(seq, q) {
    const c = ctx('revisions');
    if (q.file) {
      const d = await api.get('revisions/file', { file: q.file, rev: q.rev });
      show(seq, c, t('rev.for', { title: d.title }), V.revisionFile(c, d), urlNotices(q));
      return;
    }
    show(seq, c, t('rev.title'), V.revisionIndex(c, await api.get('revisions')), urlNotices(q));
  },
  async '/profile.php'(seq, q) {
    const c = ctx('profile');
    show(seq, c, t('profile.title'), V.profile(c, { user: session.user, lang: t.lang }), urlNotices(q));
  },
  async '/users.php'(seq, q) {
    const c = ctx('users', 'all');
    const d = await api.get('users');
    show(seq, c, t('users.title'), V.userList(c, { users: d.users, me: session.user }), urlNotices(q));
  },
  async '/user-new.php'(seq, q) {
    const c = ctx('users', 'new');
    show(seq, c, t('users.add'), V.userNew(c), urlNotices(q));
  },
  async '/user-edit.php'(seq, q) {
    const c = ctx('users', 'all');
    const u = (await api.get('users')).users.find((x) => x.name === q.user);
    if (!u) throw new ApiError(404, { error: 'not_found' });
    show(seq, c, t('users.edit', { name: u.name }), V.userEdit(c, { u }), urlNotices(q));
  },
  async '/anfragen.php'(seq, q) {
    const c = ctx('anfragen');
    if (q.id) {
      const d = await api.get('anfragen/item', { id: q.id });
      show(seq, c, t('anfragen.title'), V.anfrageDetail(c, d), urlNotices(q));
      return;
    }
    const d = await api.get('anfragen', { view: q.view });
    session.newAnfragen = d.counts.neu;
    show(seq, c, t('anfragen.title'), V.anfragenList(c, d), urlNotices(q));
  },
};

async function render() {
  const seq = ++navSeq;
  const { path, q } = parseHash();
  lastHash = location.hash;
  state.editing = null;
  try {
    if (path === '/setup' || !session || Date.now() - sessionAt > SESSION_MAX_AGE) {
      const s = await loadSession();
      if (seq !== navSeq) return;
      if (s === 'setup') { showBare(seq, t('setup.title'), setupPage({ t, checks: setupChecks })); return; }
      if (s === 'login') {
        if (path !== '/login' && path !== '/') afterLogin = location.hash;
        const info = q.loggedout ? t('login.loggedout') : q.expired ? t('login.expired') : q.setup ? t('login.setupdone') : '';
        showBare(seq, t('login.title'), loginPage({ t, info, siteUrl }));
        return;
      }
    }
    if (path === '/login' || path === '/setup') { go('#/'); return; }
    const screen = screens[path];
    if (!screen) throw new ApiError(404, { error: 'not_found' });
    await screen(seq, q);
  } catch (e) {
    if (seq !== navSeq || !session) return;
    const c = ctx();
    show(seq, c, t('err.title'), errorScreen(t, errorText(e)));
  }
}

// ---------------- forms ----------------

// Names like f[group][list][key][sub][value] become nested objects; a `[_]` marks a list, whose
// members come in the order of the page.
function collect(form) {
  const root = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled || el.type === 'submit' || el.type === 'button') continue;
    const parts = el.name.replace(/\]/g, '').split('[');
    let node = root;
    parts.slice(0, -1).forEach((p) => { node = (node[p] ??= {}); });
    const last = parts[parts.length - 1];
    if (el.type === 'checkbox') node[last] = el.checked;
    else if (el.dataset.commaList !== undefined) node[last] = el.value.split(',').map((s) => s.trim()).filter(Boolean);
    else node[last] = el.value;
  }
  const lists = (v) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    if ('_' in v) return Object.entries(v).filter(([k]) => k !== '_').map(([, x]) => lists(x));
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, lists(x)]));
  };
  return lists(root);
}

function setBusy(form, on) {
  form.querySelectorAll('button[type=submit]').forEach((b) => { b.disabled = on; });
  form.querySelector('#publishing-action')?.classList.toggle('is-busy', on);
}

async function savePost(form) {
  const ed = state.editing;
  if (!ed) return;
  const seq = navSeq;
  const data = collect(form);
  setBusy(form, true);
  try {
    if (ed.kind === 'page') {
      const r = await api.post('page', { id: ed.id, hash: ed.d.hash, values: data.f || {} });
      const base = `#/post.php?post_type=page&post=${encodeURIComponent(ed.id)}`;
      sessionAt = 0;
      go(addParams(base, { message: r.unchanged ? 'nochange' : '', job: r.job }));
      return;
    }
    const { slug, body, ...values } = data;
    const r = await api.post('entry', { type: ed.d.def.postType, id: ed.d.slug, hash: ed.d.hash, slug, body, values });
    sessionAt = 0;
    go(addParams(`#/post.php?post_type=${ed.d.def.postType}&post=${encodeURIComponent(r.id)}`, { message: r.unchanged ? 'nochange' : '', job: r.job }));
  } catch (e) {
    if (seq !== navSeq) return;
    setBusy(form, false);
    const invalid = e.status === 422 && e.data.error === 'validation';
    const conflict = e.status === 409 && e.data.error === 'conflict' && e.data.hash;
    if (!invalid && !conflict) { flash('error', errorText(e)); return; }
    const list = conflict ? [{ type: 'warning', message: t('notice.conflict') }] : [{ type: 'error', message: t('notice.errors'), items: errorItems(e.data.errors) }];
    const errors = e.data.errors || [];
    if (ed.kind === 'page') {
      const d = { ...ed.d, hash: e.data.hash || ed.d.hash, page: e.data.page || ed.d.page };
      await screenPageEdit(seq, ed.id, {}, { d, errors, notices: list });
    } else {
      const { slug, body, ...values } = data;
      entryScreen(seq, { ...ed.d, hash: e.data.hash || ed.d.hash }, {}, { values, body, slug, errors, notices: list });
    }
  }
}

// «Endgültig löschen» asks by asking twice, not with a browser dialog.
function armed(form) {
  if (form.dataset.confirm === undefined || form.dataset.armed) return true;
  const b = form.querySelector('button[type=submit]');
  const label = b.textContent;
  form.dataset.armed = '1';
  b.textContent = t('confirm.again');
  setTimeout(() => { delete form.dataset.armed; b.textContent = label; }, 5000);
  return false;
}

async function submitApi(form) {
  if (!armed(form)) return;
  const then = form.dataset.then;
  try {
    setBusy(form, true);
    const r = await api.post(form.dataset.api, collect(form));
    sessionAt = 0;
    if (then === 'logout') { session = null; afterLogin = ''; go('#/login?loggedout=true'); return; }
    if (then === 'reload') { await loadSession(); render(); return; }
    if (then === 'entry') { go(addParams(`#/post.php?post_type=${form.dataset.type}&post=${encodeURIComponent(r.id)}`, { message: 'untrashed', job: r.job })); return; }
    if (then === 'restored') {
      const base = r.edit ? V.editUrl(r.edit) : `#/revision.php?file=${encodeURIComponent(form.elements.file.value)}`;
      go(addParams(base, { message: 'restored', job: r.job }));
      return;
    }
    go(addParams(form.dataset.next, { job: r.job }));
  } catch (e) {
    setBusy(form, false);
    const items = errorItems(e.data?.errors);
    flash('error', items.length ? t('notice.errors') : errorText(e), items);
  }
}

async function submitLogin(form) {
  const user = form.elements.user.value;
  const seq = navSeq;
  try {
    setBusy(form, true);
    await call(query('login'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Login-Nonce': loginNonce }, body: JSON.stringify({ user, password: form.elements.password.value }) });
    await loadSession();
    const to = afterLogin;
    afterLogin = '';
    go(to && !to.startsWith('#/login') ? to : '#/');
  } catch (e) {
    const code = e.data?.error;
    const error = code === 'locked' ? t('login.locked', { min: e.data.retryMinutes }) : code === 'slow' ? t('login.slow', { n: e.data.retrySeconds }) : code === 'invalid' ? t('login.invalid') : code === 'forbidden' ? t('login.csrf') : errorText(e);
    if (code === 'forbidden') await loadSession();
    showBare(seq, t('login.title'), loginPage({ t, error, user, siteUrl }));
  }
}

async function submitSetup(form) {
  const v = collect(form);
  const seq = navSeq;
  const fail = (error) => showBare(seq, t('setup.title'), setupPage({ t, checks: setupChecks, error }));
  if (v.password !== v.password2) { fail(t('profile.password.mismatch')); return; }
  try {
    setBusy(form, true);
    await call(query('setup'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Login-Nonce': loginNonce }, body: JSON.stringify({ token: v.token, user: v.user, password: v.password }) });
    go('#/login?setup=1');
  } catch (e) {
    fail(e.data?.error === 'token' ? t('setup.token.bad', { why: e.message === 'token' ? '' : e.message }) : errorText(e));
  }
}

async function submitProfile(form) {
  const v = collect(form);
  try {
    setBusy(form, true);
    if (v.lang !== t.lang) await api.post('profile/lang', { lang: v.lang });
    let message = 'profile';
    if (v.pass1 || v.pass0) {
      if (v.pass1 !== v.pass2) throw new ApiError(422, { message: t('profile.password.mismatch') });
      await api.post('profile/password', { current: v.pass0, password: v.pass1 });
      message = 'password';
    }
    await loadSession();
    go(`#/profile.php?message=${message}`);
  } catch (e) {
    setBusy(form, false);
    flash('error', errorText(e));
  }
}

document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form.id === 'post') { e.preventDefault(); savePost(form); return; }
  if (form.dataset.api) { e.preventDefault(); submitApi(form); return; }
  if (form.dataset.login !== undefined) { e.preventDefault(); submitLogin(form); return; }
  if (form.dataset.setup !== undefined) { e.preventDefault(); submitSetup(form); return; }
  if (form.dataset.profile !== undefined) { e.preventDefault(); submitProfile(form); return; }
  if (form.dataset.get) {
    e.preventDefault();
    const p = new URLSearchParams();
    for (const [k, v] of new FormData(form)) if (v !== '') p.set(k, v);
    go(`${form.dataset.get}${String(p) ? `?${p}` : ''}`);
  }
});

// Unsaved input is not lost by a click on the menu.
document.addEventListener('input', (e) => { if (e.target.closest('#post')) dirty = true; });
window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
window.addEventListener('hashchange', () => {
  if (location.hash === lastHash) return;
  if (!location.hash.startsWith('#/') && location.hash !== '') return;
  if (dirty && !window.confirm(t('edit.leave'))) { history.replaceState(null, '', lastHash); return; }
  render();
});

render();
