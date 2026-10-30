// wp-admin frame: admin bar, left menu, notices. Own markup and icons in the WordPress manner.
import { html, raw } from '../html.js';

const ICON_PATHS = {
  dashboard: 'M3 13a7 7 0 1 1 14 0h-2a5 5 0 1 0-10 0zm6.3-.7 3.2-4.6 1 .7-3.2 4.6a1.2 1.2 0 1 1-1-.7z',
  posts: 'M4 15.5 4.6 12l8-8 2.9 2.9-8 8zM13.6 3l1-1 2.9 2.9-1 1z',
  leistungen: 'M8 3h4v5h5v4h-5v5H8v-5H3V8h5z',
  media: 'M3 4h14v12H3zm2 2v6.5l3-3 2.5 2.5 2-2 2.5 2.5V6zm8 1.2a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z',
  pages: 'M5 2h7l4 4v12H5zm6 1.5V7h3.5zM7 10h7v1.2H7zm0 2.6h7v1.2H7zm0 2.6h5v1.2H7z',
  team: 'M7 9.5a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm6.5 0a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zM1.5 16c0-3 2.5-5 5.5-5s5.5 2 5.5 5zm11.6 0c0-1.6-.6-3-1.6-4 .6-.3 1.3-.5 2-.5 2.5 0 4.5 1.8 4.5 4.5z',
  settings: 'M10 6.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8zM8.6 1.5h2.8l.4 2.3 1.5.7 2-1.3 2 2-1.4 2 .7 1.5 2.3.4v2.8l-2.3.4-.7 1.5 1.4 2-2 2-2-1.4-1.5.7-.4 2.3H8.6l-.4-2.3-1.5-.7-2 1.4-2-2 1.4-2-.7-1.5-2.3-.4V8.6l2.3-.4.7-1.5-1.4-2 2-2 2 1.3 1.5-.7z',
  revisions: 'M10 3a7 7 0 1 1-6.6 9.3l1.9-.6A5 5 0 1 0 6.5 6.5L8.5 8.5H3V3l2 2A7 7 0 0 1 10 3zm-.8 3h1.6v3.7l2.6 2.6-1.1 1.1-3.1-3.1z',
  profile: 'M10 10a3.8 3.8 0 1 1 0-7.6A3.8 3.8 0 0 1 10 10zm-7 7.5c0-3.6 3.1-6 7-6s7 2.4 7 6z',
  logo: 'M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm0 1.6a6.9 6.9 0 1 1 0 13.8 6.9 6.9 0 0 1 0-13.8zM9.2 5.5h1.6l3.4 9h-1.8l-.8-2.2H8.4l-.8 2.2H5.8zm.8 2.3-1.1 3h2.2z',
  home: 'M10 2.5 18 9h-2.5v8.5h-4v-5h-3v5h-4V9H2z',
  plus: 'M9 4h2v5h5v2h-5v5H9v-5H4V9h5z',
  collapse: 'M13 4v12L5 10z',
  anfragen: 'M2 4h16v12H2zm2 1.8 6 4.4 6-4.4zm-.3 1.6V14.300h12.600V7.400L10 12z',
  users: 'M10 9.500a3.300 3.300 0 1 1 0-6.600 3.300 3.300 0 0 1 0 6.600zM4 17c0-3.300 2.600-5.500 6-5.500s6 2.200 6 5.500z',
};

export function icon(name, cls = 'dashicon') {
  return raw(`<svg class="${cls}" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="${ICON_PATHS[name] || ''}"/></svg>`);
}

function menuItem(ctx, { key, href, label, iconName, subs = [], badge }) {
  const current = ctx.menu === key;
  return html`<li class="menu-top${current ? ' current' : ''}${subs.length ? ' has-submenu' : ''}">
    <a href="${href}" class="menu-top-link"${current ? raw(' aria-current="page"') : ''}>${icon(iconName)}<span class="menu-name">${label}${badge ? html` <span class="awaiting-mod">${badge}</span>` : ''}</span></a>
    ${subs.length ? html`<ul class="submenu">${subs.map((s) => html`<li${ctx.menu === key && ctx.sub === s.key ? raw(' class="current"') : ''}><a href="${s.href}">${s.label}</a></li>`)}</ul>` : ''}
  </li>`;
}

export function notices(list, t) {
  return (list || []).map((n) => html`<div class="notice notice-${n.type || 'success'}${n.job ? ' js-job' : ''}"${n.job ? html` data-job="${n.job}"` : ''} role="${n.type === 'error' ? 'alert' : 'status'}">
    <p class="notice-text">${n.htmlMessage ? raw(n.htmlMessage) : n.message}</p>
    ${n.items?.length ? html`<ul class="notice-items">${n.items.map((i) => html`<li>${i}</li>`)}</ul>` : ''}
    ${n.url ? html`<p><a href="${n.url}" target="_blank" rel="noopener">${t('notice.details')}</a></p>` : ''}
  </div>`);
}

export function barState(st) {
  if (st.unknown) return 'unknown';
  if (st.state && st.state !== 'idle') return st.state;
  return st.failed ? 'failed' : 'idle';
}

export function layout(ctx, { body, notices: ns = [] }) {
  const { t, user, cfg } = ctx;
  const pages = (ctx.pages || []).filter((p) => p.id !== '_global');
  const st = ctx.status || {};
  const state = barState(st);
  const menu = [
    { key: 'dashboard', href: '#/', label: t('menu.dashboard'), iconName: 'dashboard', subs: [{ key: 'home', href: '#/', label: t('menu.dashboard.home') }] },
    { key: 'posts', href: '#/edit.php?post_type=post', label: t('menu.posts'), iconName: 'posts', subs: [
      { key: 'all', href: '#/edit.php?post_type=post', label: t('menu.posts.all') },
      { key: 'new', href: '#/post-new.php?post_type=post', label: t('menu.posts.new') }] },
    { key: 'leistungen', href: '#/edit.php?post_type=leistung', label: t('menu.leistungen'), iconName: 'leistungen', subs: [
      { key: 'all', href: '#/edit.php?post_type=leistung', label: t('menu.leistungen.all') }] },
    { key: 'media', href: '#/upload.php', label: t('menu.media'), iconName: 'media', subs: [
      { key: 'library', href: '#/upload.php', label: t('menu.media.library') },
      { key: 'new', href: '#/media-new.php', label: t('menu.media.new') }] },
    { key: 'pages', href: '#/edit.php?post_type=page', label: t('menu.pages'), iconName: 'pages', subs: [
      { key: 'all', href: '#/edit.php?post_type=page', label: t('menu.pages.all') },
      ...pages.map((p) => ({ key: p.id, href: `#/post.php?post_type=page&post=${encodeURIComponent(p.id)}`, label: p.label }))] },
    { key: 'team', href: '#/edit.php?post_type=team', label: t('menu.team'), iconName: 'team', subs: [
      { key: 'all', href: '#/edit.php?post_type=team', label: t('menu.team.all') },
      { key: 'new', href: '#/post-new.php?post_type=team', label: t('menu.team.new') }] },
    ...((ctx.pages || []).some((p) => p.id === '_global') ? [{ key: 'settings', href: '#/post.php?post_type=page&post=_global', label: t('menu.settings'), iconName: 'settings' }] : []),
    ...(ctx.canAnfragen ? [{ key: 'anfragen', href: '#/anfragen.php', label: t('menu.anfragen'), iconName: 'anfragen', badge: ctx.newAnfragen }] : []),
    { key: 'revisions', href: '#/revision.php', label: t('menu.revisions'), iconName: 'revisions' },
    ...(ctx.isAdmin ? [{ key: 'users', href: '#/users.php', label: t('menu.users'), iconName: 'users', subs: [
      { key: 'all', href: '#/users.php', label: t('menu.users.all') },
      { key: 'new', href: '#/user-new.php', label: t('menu.users.new') }] }] : []),
    { key: 'profile', href: '#/profile.php', label: t('menu.profile'), iconName: 'profile' },
  ];
  return html`<a class="skip-link js-skip" href="#wpbody-content">${t('admin.skip')}</a>
<div id="wpadminbar" role="navigation">
  <ul class="ab-left">
    <li class="ab-logo"><a href="#/" title="${t('admin.title')}">${icon('logo', 'ab-icon')}</a></li>
    <li class="ab-site"><a href="${cfg.siteUrl}/" target="_blank" rel="noopener">${icon('home', 'ab-icon')}<span>${t('site.name')}</span></a>
      <ul class="ab-sub"><li><a href="${cfg.siteUrl}/" target="_blank" rel="noopener">${t('bar.visit')}</a></li></ul></li>
    <li class="ab-new"><a href="#/post-new.php?post_type=post">${icon('plus', 'ab-icon')}<span>${t('bar.new')}</span></a>
      <ul class="ab-sub">
        <li><a href="#/post-new.php?post_type=post">${t('bar.new.post')}</a></li>
        <li><a href="#/post-new.php?post_type=team">${t('bar.new.team')}</a></li>
        <li><a href="#/media-new.php">${t('bar.new.media')}</a></li>
      </ul></li>
    <li class="ab-status state-${state}" id="ab-status"><a href="#/" class="ab-status-link"><span class="ab-dot"></span><span class="ab-status-text">${t(`bar.status.${state}`)}</span></a></li>
  </ul>
  <ul class="ab-right">
    <li class="ab-account"><a href="#/profile.php">${t('bar.hello', { name: user })}<span class="ab-avatar">${String(user).slice(0, 1).toUpperCase()}</span></a>
      <ul class="ab-sub">
        <li><a href="#/profile.php">${t('bar.profile')}</a></li>
        <li><form class="ab-form" data-api="profile/lang" data-then="reload"><input type="hidden" name="lang" value="${t.lang === 'ru' ? 'de' : 'ru'}"><button type="submit">${t('bar.lang')}</button></form></li>
        <li><form class="ab-form" data-api="logout" data-then="logout"><button type="submit">${t('bar.logout')}</button></form></li>
      </ul></li>
  </ul>
</div>
<div id="adminmenuwrap"><ul id="adminmenu">${menu.map((m) => menuItem(ctx, m))}</ul></div>
<div id="wpcontent"><div id="wpbody" role="main"><div id="wpbody-content" class="wrap" tabindex="-1">
${notices(ns, t)}
${body}
</div></div>
<div id="wpfooter"><p>${t('admin.title')} · ${t('site.name')}</p></div>
</div>`;
}

// Login screen.
export function loginPage({ t, error, info, user = '' }) {
  return html`<div id="login">
  <h1 class="login-logo"><a href="#/login">${icon('logo', 'login-icon')}<span>${t('site.name')}</span></a></h1>
  ${error ? html`<div id="login_error" class="notice notice-error" role="alert"><p>${error}</p></div>` : ''}
  ${info ? html`<div class="notice notice-info message"><p>${info}</p></div>` : ''}
  <form id="loginform" data-login novalidate>
    <p><label for="user_login">${t('login.user')}</label>
    <input type="text" name="user" id="user_login" class="input" value="${user}" autocomplete="username" autocapitalize="off" spellcheck="false" required autofocus></p>
    <p><label for="user_pass">${t('login.pass')}</label>
    <input type="password" name="password" id="user_pass" class="input" autocomplete="current-password" required></p>
    <p class="submit"><button type="submit" class="button button-primary button-large">${t('login.submit')}</button></p>
  </form>
  <p class="login-back"><a href="/">${t('login.back')}</a></p>
</div>`;
}

// First start: the token proves that this is the owner of the repository.
export function setupPage({ t, checks, error }) {
  const row = (label, ok, value) => html`<tr><th scope="row">${label}</th><td><span class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'}</span> ${value}</td></tr>`;
  const c = checks || {};
  return html`<div id="login" class="setup">
  <h1 class="login-logo"><a href="#/setup">${icon('logo', 'login-icon')}<span>${t('site.name')}</span></a></h1>
  ${error ? html`<div id="login_error" class="notice notice-error" role="alert"><p>${error}</p></div>` : ''}
  <div class="notice notice-info message"><p>${t('setup.lead')}</p></div>
  <table class="form-table setup-checks"><tbody>
    ${row('PHP', c.phpOk, c.php)}
    ${row(t('setup.check.http'), c.curl, c.curl ? 'OK' : t('setup.check.missing'))}
    ${row('mbstring', c.mbstring, c.mbstring ? 'OK' : t('setup.check.missing'))}
    ${row('fileinfo', c.fileinfo, c.fileinfo ? 'OK' : t('setup.check.missing'))}
    ${row(t('setup.check.image'), !!c.imageEngine, c.imageEngine || t('setup.check.missing'))}
    ${row('WebP', c.webp, c.webp ? 'OK' : t('setup.check.nowebp'))}
    ${row(t('setup.check.data'), c.dataOutside !== false, c.dataOutside === false ? t('setup.check.datainside') : 'OK')}
    <tr><th scope="row">${t('setup.check.limits')}</th><td>upload_max_filesize ${c.uploadMax} · post_max_size ${c.postMax} · memory_limit ${c.memory}</td></tr>
  </tbody></table>
  <form id="loginform" data-setup novalidate>
    <p><label for="setup_token">${t('setup.token')}</label>
    <input type="password" name="token" id="setup_token" class="input" autocomplete="off" required></p>
    <p class="description">${t('setup.token.help')}</p>
    <p><label for="setup_user">${t('setup.user')}</label>
    <input type="text" name="user" id="setup_user" class="input" autocomplete="username" autocapitalize="off" spellcheck="false" required></p>
    <p><label for="setup_pass">${t('setup.pass')}</label>
    <input type="password" name="password" id="setup_pass" class="input" autocomplete="new-password" required></p>
    <p class="description">${t('profile.password.help', { n: 10 })}</p>
    <p><label for="setup_pass2">${t('setup.pass2')}</label>
    <input type="password" name="password2" id="setup_pass2" class="input" autocomplete="new-password" required></p>
    <p class="submit"><button type="submit" class="button button-primary button-large">${t('setup.submit')}</button></p>
  </form>
</div>`;
}

export function errorScreen(t, message) {
  return html`<div class="wp-die-message"><p>${message}</p><p><a href="#/">${t('err.back')}</a></p></div>`;
}
