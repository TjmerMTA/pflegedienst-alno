// Screens. Each returns the inner HTML of the admin frame; the router wraps it in layout().
import { html, raw } from '../html.js';
import { formatDate } from '../i18n.js';
import { textInput, textArea, editor, imagePicker, pageField, listField, stringList, idOf, thumbUrl } from './fields.js';
import { icon } from './layout.js';
import { COLLECTIONS } from '../collections.js';

const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const nonce = (ctx) => html`<input type="hidden" name="_wpnonce" value="${ctx.csrf}">`;

function errorMap(errors) {
  const m = new Map();
  for (const e of errors || []) {
    if (!m.has(e.path)) m.set(e.path, []);
    m.get(e.path).push(e.msg);
  }
  return m;
}

function postbox(ctx, { id, title, body, closed, cls = '' }) {
  return html`<div class="postbox${closed ? ' closed' : ''} ${cls}" id="${id}">
    <div class="postbox-header"><h2 class="hndle">${title}</h2>
      <button type="button" class="handlediv" aria-expanded="${closed ? 'false' : 'true'}" title="${ctx.t('edit.toggle')}"><span class="toggle-indicator" aria-hidden="true"></span></button></div>
    <div class="inside">${body}</div>
  </div>`;
}

// ---------------- Dashboard ----------------

export function dashboard(ctx, { counts, status, activity, firstPage }) {
  const { t } = ctx;
  const lang = t.lang;
  const stateKey = status.state && status.state !== 'idle' ? status.state : 'idle';
  const lb = status.lastBuild; const ld = status.lastDeploy; const le = status.lastError;
  return html`<h1 class="wp-heading-inline">${t('menu.dashboard')}</h1>
  <div id="welcome-panel" class="welcome-panel">
    <div class="welcome-panel-content">
      <div class="welcome-panel-header"><h2>${t('dash.welcome')}</h2><p>${t('dash.welcome.lead')}</p></div>
      <div class="welcome-panel-column-container">
        <div class="welcome-panel-column"><h3>${t('dash.start')}</h3>
          ${firstPage ? html`<a class="button button-primary button-hero" href="/wp-admin/post.php?post_type=page&post=${encodeURIComponent(firstPage.id)}">${t('dash.start.pages')}</a>` : html`<a class="button button-primary button-hero" href="/wp-admin/edit.php?post_type=page">${t('menu.pages.all')}</a>`}</div>
        <div class="welcome-panel-column"><h3>${t('dash.next')}</h3><ul>
          <li><a href="/wp-admin/post-new.php?post_type=post">${icon('posts', 'welcome-icon')}${t('dash.next.post')}</a></li>
          <li><a href="/wp-admin/post-new.php?post_type=team">${icon('team', 'welcome-icon')}${t('dash.next.team')}</a></li>
          <li><a href="${ctx.cfg.siteUrl}/" target="_blank" rel="noopener">${icon('home', 'welcome-icon')}${t('dash.next.view')}</a></li></ul></div>
        <div class="welcome-panel-column"><h3>${t('dash.more')}</h3><ul>
          <li><a href="/wp-admin/upload.php">${icon('media', 'welcome-icon')}${t('dash.more.media')}</a></li>
          <li><a href="/wp-admin/post.php?post_type=page&post=_global">${icon('settings', 'welcome-icon')}${t('dash.more.settings')}</a></li>
          <li><a href="/wp-admin/revision.php">${icon('revisions', 'welcome-icon')}${t('dash.more.revisions')}</a></li></ul></div>
      </div>
    </div>
  </div>
  <div id="dashboard-widgets" class="metabox-holder columns-2">
    <div class="postbox-container">
      ${postbox(ctx, { id: 'site-status', title: t('dash.status'), body: html`
        <table class="status-table"><tbody>
          <tr><th>${t('dash.status.state')}</th><td><span class="status-pill state-${stateKey}" id="dash-state">${t(`state.${stateKey}`)}</span></td></tr>
          <tr><th>${t('dash.status.lastbuild')}</th><td>${lb ? html`${formatDate(lb.at, lang)} — <span class="${lb.ok ? 'ok' : 'bad'}">${lb.ok ? t('dash.status.ok') : t('dash.status.failed')}</span> (${Math.round(lb.durationMs / 1000)} s)` : t('dash.status.never')}</td></tr>
          <tr><th>${t('dash.status.lastdeploy')}</th><td>${ld ? html`${formatDate(ld.at, lang)} — <span class="${ld.ok ? 'ok' : 'bad'}">${ld.ok ? t('dash.status.ok') : t('dash.status.failed')}</span>` : t('dash.status.never')}</td></tr>
        </tbody></table>
        <h3 class="status-sub">${t('dash.status.error')}</h3>
        ${le ? html`<div class="notice notice-error inline"><p>${formatDate(le.at, lang)}: ${le.phase === 'deploy' ? t('notice.deployfailed') : t('notice.buildfailed')}</p>
          ${le.reasons?.length ? html`<ul class="notice-items">${le.reasons.map((r) => html`<li>${r}</li>`)}</ul>` : ''}
          ${le.log ? html`<details class="notice-log"><summary>${t('notice.details')}</summary><pre>${le.log}</pre></details>` : ''}</div>` : html`<p class="ok">${t('dash.status.noerror')}</p>`}` })}
    </div>
    <div class="postbox-container">
      ${postbox(ctx, { id: 'dashboard_right_now', title: t('dash.glance'), body: html`<ul class="glance">
        <li><a href="/wp-admin/edit.php?post_type=page">${icon('pages', 'glance-icon')}${t('dash.glance.pages', { n: counts.pages })}</a></li>
        <li><a href="/wp-admin/edit.php?post_type=post">${icon('posts', 'glance-icon')}${t('dash.glance.posts', { n: counts.posts })}</a></li>
        <li><a href="/wp-admin/edit.php?post_type=leistung">${icon('leistungen', 'glance-icon')}${t('dash.glance.leistungen', { n: counts.leistungen })}</a></li>
        <li><a href="/wp-admin/edit.php?post_type=team">${icon('team', 'glance-icon')}${t('dash.glance.team', { n: counts.team })}</a></li>
        <li><a href="/wp-admin/upload.php">${icon('media', 'glance-icon')}${t('dash.glance.media', { n: counts.media })}</a></li></ul>` })}
      ${postbox(ctx, { id: 'dashboard_activity', title: t('dash.activity'), body: activity.length ? html`<ul class="activity">${activity.map((a) => html`<li><span class="activity-date">${formatDate(a.date, lang)}</span> <strong>${a.author}</strong>: ${a.subject}</li>`)}</ul>` : html`<p>${t('dash.activity.none')}</p>` })}
    </div>
  </div>`;
}

// ---------------- Pages list ----------------

export function pageList(ctx, { pages }) {
  const { t } = ctx;
  const rows = pages.map((p) => {
    const editUrl = `/wp-admin/post.php?post_type=page&post=${encodeURIComponent(p.id)}`;
    const title = p.id === '_global' ? `${p.label} — ${t('list.settings')}` : p.label;
    return html`<tr${p.id === '_global' ? raw(' class="row-settings"') : ''}>
      <td class="title column-title column-primary"><strong><a class="row-title" href="${editUrl}">${title}</a></strong>
        ${p.error ? html`<p class="field-error">${t('list.unreadable')}: ${p.error}</p>` : ''}
        <div class="row-actions"><span class="edit"><a href="${editUrl}">${t('list.edit')}</a> | </span>
        ${p.url ? html`<span class="view"><a href="${ctx.cfg.siteUrl}${p.url}" target="_blank" rel="noopener">${t('list.view')}</a> | </span>` : ''}
        <span class="revisions"><a href="/wp-admin/revision.php?file=${encodeURIComponent(`src/content/pages/${p.id}.json`)}">${t('list.revisions')}</a></span></div></td>
      <td class="column-url">${p.url ? html`<code>${p.url}</code>` : '—'}</td>
      <td class="column-date">${p.mtime ? formatDate(p.mtime, t.lang) : ''}</td>
    </tr>`;
  });
  return html`<h1 class="wp-heading-inline">${t('menu.pages')}</h1><hr class="wp-header-end">
  <div class="tablenav top"><div class="tablenav-pages"><span class="displaying-num">${t('list.items', { n: pages.length })}</span></div></div>
  <table class="wp-list-table widefat fixed striped table-view-list pages">
    <thead><tr><th scope="col" class="column-title column-primary">${t('list.title')}</th><th scope="col" class="column-url">${t('list.url')}</th><th scope="col" class="column-date">${t('list.modified')}</th></tr></thead>
    <tbody>${rows.length ? rows : html`<tr class="no-items"><td colspan="3">${t('list.nopages')}</td></tr>`}</tbody>
  </table>`;
}

// ---------------- Page edit ----------------

function publishBox(ctx, { modified, revCount, revUrl, buttonLabel, extra, status, trashForm }) {
  const { t } = ctx;
  return postbox(ctx, { id: 'submitdiv', title: t('edit.publish'), body: html`
    <div class="submitbox"><div class="misc-pub-section">${t('edit.status')} <strong>${status || t('edit.status.published')}</strong></div>
      ${modified ? html`<div class="misc-pub-section">${t('edit.modified')} <strong>${formatDate(modified, t.lang)}</strong></div>` : ''}
      ${revUrl ? html`<div class="misc-pub-section misc-pub-revisions">${icon('revisions', 'misc-icon')}<a href="${revUrl}">${t('edit.revisions', { n: revCount })}</a></div>` : ''}
      ${extra || ''}
      <div id="major-publishing-actions">
        ${trashForm ? html`<div id="delete-action"><button type="submit" form="trash-form" class="button-link submitdelete">${t('edit.totrash')}</button></div>` : ''}
        <div id="publishing-action"><span class="spinner"></span><button type="submit" class="button button-primary button-large" id="publish">${buttonLabel || t('edit.update')}</button></div>
        <div class="clear"></div>
      </div></div>` });
}

export function pageEdit(ctx, { id, page, errors = [], hash, modified, revCount, tokens, structureErrors }) {
  const { t } = ctx;
  const errs = errorMap(errors);
  const isGlobal = id === '_global';
  const heading = isGlobal ? t('edit.settings') : t('edit.page', { title: page.label });
  const view = page.url ? html` <a class="page-title-action" href="${ctx.cfg.siteUrl}${page.url}" target="_blank" rel="noopener">${t('edit.view')}</a>` : '';
  if (structureErrors?.length) {
    return html`<h1 class="wp-heading-inline">${heading}</h1><hr class="wp-header-end">
      <div class="notice notice-error"><p>${t('edit.structure')}</p><ul class="notice-items">${structureErrors.map((e) => html`<li>${e.path}: ${e.msg}</li>`)}</ul></div>`;
  }
  const boxes = page.groups.map((g, gi) => postbox(ctx, {
    id: `group-${idOf(g.id)}`, title: g.label, closed: gi > 0 && !errors.some((e) => e.path.startsWith(g.id + '.')) && page.groups.length > 4,
    body: g.fields.map((f) => {
      const name = `f[${g.id}][${f.id}]`;
      const fid = idOf(`f-${g.id}-${f.id}`);
      const errPath = `${g.id}.${f.id}`;
      if (f.type === 'list') return listField(ctx, f, { name, id: fid, value: f.value, errPath, errors: errs });
      return pageField(ctx, f, { name, id: fid, value: f.value ?? '', alt: f.alt ?? '', errPath, errors: errs });
    }),
  }));
  const revUrl = `/wp-admin/revision.php?file=${encodeURIComponent(`src/content/pages/${id}.json`)}`;
  return html`<h1 class="wp-heading-inline">${heading}</h1>${view}<hr class="wp-header-end">
  <form method="post" action="/wp-admin/post.php" id="post" class="js-edit-form" novalidate>
    ${nonce(ctx)}<input type="hidden" name="action" value="editpost"><input type="hidden" name="post_type" value="page">
    <input type="hidden" name="post" value="${id}"><input type="hidden" name="_hash" value="${hash}">
    <div id="poststuff"><div id="post-body" class="metabox-holder columns-2">
      <div id="post-body-content"><div id="normal-sortables">${boxes}</div></div>
      <div id="postbox-container-1" class="postbox-container">
        ${publishBox(ctx, { modified, revCount, revUrl })}
        ${tokens.length ? postbox(ctx, { id: 'tokensdiv', title: t('edit.tokens'), body: html`<p class="description">${t('edit.tokens.help')}</p><ul class="token-list">${tokens.map((k) => html`<li><code>{{${k}}}</code></li>`)}</ul>` }) : ''}
        ${page.url ? postbox(ctx, { id: 'previewdiv', title: t('edit.preview'), body: html`<p><a href="${ctx.cfg.siteUrl}${page.url}" target="_blank" rel="noopener">${t('edit.view')}</a></p><p class="description">${t('edit.preview.help')}</p>` }) : ''}
      </div>
    </div></div>
  </form>
  ${mediaModal(ctx)}`;
}

// ---------------- Collections ----------------

export function collectionList(ctx, { coll, entries, trash, view, search, counts }) {
  const { t } = ctx;
  const def = COLLECTIONS[coll];
  const pt = def.postType;
  const base = `/wp-admin/edit.php?post_type=${pt}`;
  const heading = { blog: t('menu.posts'), leistungen: t('menu.leistungen'), team: t('menu.team') }[coll];
  const views = [];
  if (coll === 'blog') {
    views.push([`${base}`, t('list.all'), counts.all, view === 'all'], [`${base}&post_status=publish`, t('list.published'), counts.publish, view === 'publish'], [`${base}&post_status=draft`, t('list.drafts'), counts.draft, view === 'draft']);
  } else views.push([base, t('list.all'), counts.all, view === 'all']);
  if (def.canDelete) views.push([`${base}&post_status=trash`, t('list.trash'), counts.trash, view === 'trash']);
  const cols = {
    blog: [['title', t('list.title')], ['author', t('list.author')], ['tags', t('list.tags')], ['date', t('list.date')]],
    leistungen: [['title', t('list.title')], ['icon', t('list.icon')], ['payer', t('list.payer')], ['order', t('list.order')]],
    team: [['photo', t('list.photo')], ['title', t('list.name')], ['role', t('list.role')], ['order', t('list.order')]],
  }[coll];
  const head = html`<tr>${cols.map(([k, l]) => html`<th scope="col" class="column-${k}${k === 'title' ? ' column-primary' : ''}">${l}</th>`)}</tr>`;
  let rows;
  if (view === 'trash') {
    rows = trash.map((e) => html`<tr><td class="column-title column-primary" colspan="${cols.length}"><strong>${e.title || e.slug}</strong> <span class="post-state">— ${e.slug}</span>
      <p class="description">${t('list.deletedby', { user: e.by, date: formatDate(e.at, t.lang) })}</p>
      <div class="row-actions visible">
        <form method="post" action="/wp-admin/post.php" class="inline-form">${nonce(ctx)}<input type="hidden" name="post_type" value="${pt}"><input type="hidden" name="action" value="untrash"><input type="hidden" name="trash_id" value="${e.id}"><button type="submit" class="button-link">${t('list.restore')}</button></form> |
        <form method="post" action="/wp-admin/post.php" class="inline-form">${nonce(ctx)}<input type="hidden" name="post_type" value="${pt}"><input type="hidden" name="action" value="delete"><input type="hidden" name="trash_id" value="${e.id}"><button type="submit" class="button-link link-delete">${t('list.delete')}</button></form>
      </div></td></tr>`);
  } else {
    rows = entries.map((e) => {
      const v = e.values;
      const editUrl = `/wp-admin/post.php?post_type=${pt}&post=${encodeURIComponent(e.slug)}`;
      const title = (coll === 'team' ? v.name : v.title) || e.slug;
      const url = def.urlPrefix ? `${def.urlPrefix}${e.slug}/` : def.url;
      const state = coll === 'blog' && v.draft ? t('list.draft') : coll === 'team' && v.hidden ? t('list.hidden') : '';
      const cell = (k) => {
        switch (k) {
          case 'title': return html`<td class="title column-title column-primary"><strong><a class="row-title" href="${editUrl}">${title}</a>${state ? html` <span class="post-state">— ${state}</span>` : ''}</strong>
            ${e.error ? html`<p class="field-error">${t('list.unreadable')}: ${e.error}</p>` : ''}
            <div class="row-actions"><span class="edit"><a href="${editUrl}">${t('list.edit')}</a></span>
            ${def.canDelete ? html` | <span class="trash"><form method="post" action="/wp-admin/post.php" class="inline-form">${nonce(ctx)}<input type="hidden" name="post_type" value="${pt}"><input type="hidden" name="action" value="trash"><input type="hidden" name="post" value="${e.slug}"><button type="submit" class="button-link link-delete">${t('list.trash')}</button></form></span>` : ''}
            ${url && !(coll === 'blog' && v.draft) ? html` | <span class="view"><a href="${ctx.cfg.siteUrl}${url}" target="_blank" rel="noopener">${t('list.view')}</a></span>` : ''}
            | <span class="revisions"><a href="/wp-admin/revision.php?file=${encodeURIComponent(`src/content/${def.dir}/${e.slug}.md`)}">${t('list.revisions')}</a></span></div></td>`;
          case 'author': return html`<td class="column-author">${v.author || 'Team Pflegedienst ALNO'}</td>`;
          case 'tags': return html`<td class="column-tags">${(v.tags || []).join(', ') || '—'}</td>`;
          case 'date': return html`<td class="column-date">${v.draft ? t('list.draft') : t('list.published')}<br>${v.date ? formatDate(v.date + 'T12:00:00', t.lang, false) : ''}</td>`;
          case 'icon': return html`<td class="column-icon"><code>${v.icon}</code></td>`;
          case 'payer': return html`<td class="column-payer">${v.payer}</td>`;
          case 'order': return html`<td class="column-order">${v.order ?? ''}</td>`;
          case 'role': return html`<td class="column-role">${v.role}</td>`;
          case 'photo': return html`<td class="column-photo">${v.photo ? html`<img src="${thumbUrl(v.photo)}" alt="" class="list-thumb">` : html`<span class="list-thumb empty">${icon('profile')}</span>`}</td>`;
          default: return html`<td></td>`;
        }
      };
      return html`<tr>${cols.map(([k]) => cell(k))}</tr>`;
    });
  }
  return html`<h1 class="wp-heading-inline">${heading}</h1>${def.canCreate ? html` <a href="/wp-admin/post-new.php?post_type=${pt}" class="page-title-action">${t('list.addnew')}</a>` : ''}<hr class="wp-header-end">
  <ul class="subsubsub">${views.map(([href, label, n, cur], i) => html`<li><a href="${href}"${cur ? raw(' class="current" aria-current="page"') : ''}>${label} <span class="count">(${n})</span></a>${i < views.length - 1 ? ' |' : ''}</li>`)}</ul>
  ${view !== 'trash' ? html`<form method="get" action="/wp-admin/edit.php" class="search-form"><p class="search-box"><input type="hidden" name="post_type" value="${pt}"><input type="search" name="s" value="${search || ''}" aria-label="${t('list.search')}"><button type="submit" class="button">${t('list.search')}</button></p></form>` : ''}
  <div class="tablenav top"><div class="tablenav-pages"><span class="displaying-num">${t('list.items', { n: view === 'trash' ? trash.length : entries.length })}</span></div></div>
  <table class="wp-list-table widefat fixed striped table-view-list posts coll-${coll}">
    <thead>${head}</thead>
    <tbody>${rows.length ? rows : html`<tr class="no-items"><td colspan="${cols.length}">${view === 'trash' ? t('list.trash.empty') : t('list.empty')}</td></tr>`}</tbody>
  </table>`;
}

const GROUP_LABEL = { seo: 'edit.group.seo', card: 'edit.group.card', more: 'edit.group.more', person: 'edit.group.person', tags: 'edit.group.tags', attrs: 'edit.group.attrs' };

function collField(ctx, f, values, errs) {
  const id = `fm-${f.id}`;
  const e = errs.get(f.id);
  const v = values[f.id];
  switch (f.type) {
    case 'text': return textInput(ctx, { name: f.id, id, label: f.label, value: v, max: f.max, required: f.required, help: f.help, placeholder: f.placeholder, errs: e });
    case 'textarea': return textArea(ctx, { name: f.id, id, label: f.label, value: v, max: f.max, required: f.required, help: f.help, errs: e });
    case 'number': return html`<div class="field${e ? ' has-error' : ''}"><label for="${id}">${f.label}${f.required ? raw(' <span class="req">*</span>') : ''}</label><input type="number" id="${id}" name="${f.id}" value="${v}" step="1" class="small-text"${f.placeholder ? html` placeholder="${f.placeholder}"` : ''}>${e ? html`<p class="field-error">${e.map(ctx.t.msg).join(' · ')}</p>` : ''}</div>`;
    case 'date': return html`<div class="field${e ? ' has-error' : ''}"><label for="${id}">${f.label}${f.required ? raw(' <span class="req">*</span>') : ''}</label><input type="date" id="${id}" name="${f.id}" value="${v}">${e ? html`<p class="field-error">${e.map(ctx.t.msg).join(' · ')}</p>` : ''}</div>`;
    case 'boolean': return html`<div class="field field-check"><label><input type="checkbox" name="${f.id}" value="on"${v ? raw(' checked') : ''}> ${f.label}</label></div>`;
    case 'select': return html`<div class="field${e ? ' has-error' : ''}"><label for="${id}">${f.label}</label><select id="${id}" name="${f.id}">${f.options.map((o) => html`<option value="${o}"${o === v ? raw(' selected') : ''}>${o}</option>`)}</select>${e ? html`<p class="field-error">${e.map(ctx.t.msg).join(' · ')}</p>` : ''}</div>`;
    case 'tags': return html`<div class="field${e ? ' has-error' : ''}"><label for="${id}">${f.label}</label><input type="text" id="${id}" name="${f.id}" value="${(v || []).join(', ')}" class="large-text"><p class="description">${f.help}</p>${e ? html`<p class="field-error">${e.map(ctx.t.msg).join(' · ')}</p>` : ''}</div>`;
    case 'strings': return stringList(ctx, f, { name: f.id, id, value: v, errs: e });
    case 'image': return imagePicker(ctx, { name: `${f.id}[value]`, altName: `${f.id}[alt]`, id, label: f.label, value: v, alt: f.altKey ? values[f.altKey] : '', withAlt: !!f.altKey, errs: e, altErrs: f.altKey ? errs.get(f.altKey) : null });
    default: return '';
  }
}

export function collectionEdit(ctx, { coll, slug, isNew, values, body, errors = [], hash, modified, revCount, visualOff }) {
  const { t } = ctx;
  const def = COLLECTIONS[coll];
  const errs = errorMap(errors);
  const pt = def.postType;
  const heading = isNew ? t(coll === 'team' ? 'edit.team.new' : 'edit.post.new') : t({ blog: 'edit.post', leistungen: 'edit.leistung', team: 'edit.team' }[coll]);
  const url = def.urlPrefix ? `${def.urlPrefix}${slug || ''}/` : def.url;
  const titleField = def.fields.find((f) => f.box === 'title');
  const titleErr = errs.get(titleField.id);
  const groups = (box) => {
    const out = new Map();
    for (const f of def.fields.filter((x) => x.box === box)) {
      if (!out.has(f.group)) out.set(f.group, []);
      out.get(f.group).push(f);
    }
    return [...out.entries()];
  };
  const mainBoxes = groups('main').map(([g, fs]) => postbox(ctx, { id: `box-${g}`, title: t(GROUP_LABEL[g]), body: fs.map((f) => collField(ctx, f, values, errs)) }));
  const side = groups('side');
  const publishFields = side.find(([g]) => g === 'publish');
  const otherSide = side.filter(([g]) => g !== 'publish').map(([g, fs]) => postbox(ctx, {
    id: `box-${g}`, title: g === 'image' ? fs[0].label : t(GROUP_LABEL[g]),
    body: fs.map((f) => collField(ctx, f, values, errs)),
  }));
  const status = isNew ? t('edit.status.new') : coll === 'blog' && values.draft ? t('edit.status.draft') : coll === 'team' && values.hidden ? t('list.hidden') : t('edit.status.published');
  const relFile = `src/content/${def.dir}/${slug}.md`;
  return html`<h1 class="wp-heading-inline">${heading}</h1>${!isNew && url && !(coll === 'blog' && values.draft) ? html` <a class="page-title-action" href="${ctx.cfg.siteUrl}${url}" target="_blank" rel="noopener">${t('edit.view')}</a>` : ''}
  <hr class="wp-header-end">
  <form method="post" action="/wp-admin/post.php" id="post" class="js-edit-form" novalidate>
    ${nonce(ctx)}<input type="hidden" name="action" value="editpost"><input type="hidden" name="post_type" value="${pt}">
    <input type="hidden" name="post" value="${isNew ? '' : slug}"><input type="hidden" name="_hash" value="${hash || ''}">
    <div id="poststuff"><div id="post-body" class="metabox-holder columns-2">
      <div id="post-body-content">
        <div id="titlediv"${titleErr ? raw(' class="has-error"') : ''}>
          <label class="screen-reader-text" for="title">${titleField.label}</label>
          <input type="text" name="${titleField.id}" id="title" value="${values[titleField.id] ?? ''}" placeholder="${t('edit.titleph')}" autocomplete="off" class="js-title${isNew ? ' js-slug-source' : ''}" required>
          ${titleErr ? html`<p class="field-error">${titleErr.map(t.msg).join(' · ')}</p>` : ''}
          ${url ? html`<div id="edit-slug-box">${t('edit.permalink')} <span class="permalink-base">${ctx.cfg.siteUrl}${def.urlPrefix || url}</span>${isNew && def.urlPrefix ? html`<input type="text" name="slug" id="post_name" value="${slug || ''}" class="js-slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" required>/` : html`${def.urlPrefix ? html`<strong>${slug}</strong>/` : ''}`}
            ${isNew && !def.urlPrefix ? html`<input type="hidden" name="slug" value="${slug || ''}" class="js-slug">` : ''}${errs.get('slug') ? html`<p class="field-error">${errs.get('slug').join(' · ')}</p>` : ''}</div>` : ''}
        </div>
        ${def.body ? html`<div id="postdivrich" class="postarea">${editor(ctx, { name: 'body', id: 'content', value: body, format: 'markdown', visualOff, tall: true })}</div>` : ''}
        <div id="normal-sortables">${mainBoxes}</div>
      </div>
      <div id="postbox-container-1" class="postbox-container">
        ${publishBox(ctx, {
          modified, revCount,
          revUrl: isNew ? null : `/wp-admin/revision.php?file=${encodeURIComponent(relFile)}`,
          buttonLabel: isNew ? t('edit.publishbtn') : t('edit.update'), status,
          extra: publishFields ? html`<div class="misc-pub-section misc-pub-fields">${publishFields[1].map((f) => collField(ctx, f, values, errs))}</div>` : '',
          trashForm: !isNew && def.canDelete,
        })}
        ${otherSide}
      </div>
    </div></div>
  </form>
  ${!isNew && def.canDelete ? html`<form method="post" action="/wp-admin/post.php" id="trash-form">${nonce(ctx)}<input type="hidden" name="post_type" value="${pt}"><input type="hidden" name="action" value="trash"><input type="hidden" name="post" value="${slug}"></form>` : ''}
  ${mediaModal(ctx)}`;
}

// ---------------- Media ----------------

export function uploader(ctx, { compact } = {}) {
  const { t } = ctx;
  return html`<div class="uploader${compact ? ' compact' : ''}" data-uploader>
    <div class="drag-drop-area">
      <p class="drag-drop-info">${t('media.drop')}</p><p>${t('media.or')}</p>
      <form method="post" action="/wp-admin/async-upload.php" enctype="multipart/form-data" class="upload-form">
        <input type="hidden" name="_wpnonce" value="${ctx.csrf}">
        <label class="button button-hero browser">${t('media.select')}<input type="file" name="async-upload" accept="image/jpeg,image/png,image/webp" multiple class="screen-reader-text js-upload-input"></label>
        <noscript><button type="submit" class="button">${t('media.select')}</button></noscript>
      </form>
    </div>
    <p class="max-upload-size">${t('media.limits', { mb: Math.round(ctx.cfg.uploadMaxBytes / 1048576), px: 2400 })}</p>
    <ul class="upload-progress" aria-live="polite"></ul>
  </div>`;
}

export function mediaLibrary(ctx, { images, selected, search }) {
  const { t } = ctx;
  return html`<h1 class="wp-heading-inline">${t('media.title')}</h1> <a href="/wp-admin/media-new.php" class="page-title-action js-toggle-uploader">${t('media.add')}</a><hr class="wp-header-end">
  <div class="media-uploader-inline" hidden>${uploader(ctx)}</div>
  <div class="media-toolbar wp-filter"><form method="get" action="/wp-admin/upload.php" class="media-search"><input type="search" name="s" value="${search || ''}" placeholder="${t('media.filter')}" class="js-media-filter" aria-label="${t('media.filter')}"></form>
    <span class="displaying-num">${t('list.items', { n: images.length })}</span></div>
  <ul class="attachments media-grid">${images.length ? images.map((im) => html`<li class="attachment${selected === im.path ? ' selected' : ''}" data-path="${im.path}"><a href="/wp-admin/upload.php?item=${encodeURIComponent(im.path)}" title="${im.path}" class="attachment-preview"><img src="${thumbUrl(im.path)}" alt="" loading="lazy"><span class="attachment-name">${im.path}</span></a></li>`) : html`<li class="no-media">${t('media.empty')}</li>`}</ul>`;
}

export function mediaDetails(ctx, { image, info, usedOn, defaultAlt }) {
  const { t } = ctx;
  return html`<div class="media-modal-backdrop static"></div><div class="media-modal static" role="dialog" aria-labelledby="media-details-title">
    <div class="media-modal-header"><h2 id="media-details-title">${t('media.details')}</h2><a href="/wp-admin/upload.php" class="media-modal-close" aria-label="${t('media.close')}">×</a></div>
    <div class="media-modal-content attachment-details">
      <div class="attachment-media-view"><img src="/wp-admin/media-file?f=${encodeURIComponent(image.path)}" alt="" class="details-image"></div>
      <div class="attachment-info">
        <div class="details">
          <p><strong>${t('media.file')}:</strong> ${image.name}</p>
          <p><strong>${t('media.path')}:</strong> <code>${image.path}</code></p>
          <p><strong>${t('media.uploaded')}:</strong> ${formatDate(image.mtime, t.lang)}</p>
          <p><strong>${t('media.size')}:</strong> ${fmtSize(image.size)}</p>
          ${info.width ? html`<p><strong>${t('media.dims')}:</strong> ${info.width} × ${info.height} px</p>` : ''}
        </div>
        <form method="post" action="/wp-admin/upload.php" class="settings">${nonce(ctx)}<input type="hidden" name="action" value="save-meta"><input type="hidden" name="item" value="${image.path}">
          <label for="attachment-alt">${t('media.defaultalt')}</label>
          <textarea id="attachment-alt" name="alt" rows="2" class="large-text">${defaultAlt || ''}</textarea>
          <p class="description">${t('media.defaultalt.help')}</p>
          <p><button type="submit" class="button button-primary">${t('media.save')}</button></p>
        </form>
        <h3>${t('media.usedon')}</h3>
        ${usedOn.length ? html`<ul class="used-on">${usedOn.map((u) => html`<li><a href="${u.editUrl}">${u.title}</a> <span class="description">— ${u.where}${u.alt ? html` · Alt: „${u.alt}“` : ''}</span></li>`)}</ul>` : html`<p class="description">${t('media.unused')}</p>`}
        <div class="actions">${usedOn.length ? html`<p class="description">${t('media.delete.used')}</p>` : html`<form method="post" action="/wp-admin/upload.php">${nonce(ctx)}<input type="hidden" name="action" value="delete"><input type="hidden" name="item" value="${image.path}"><button type="submit" class="button-link link-delete">${t('media.delete')}</button></form>`}</div>
      </div>
    </div></div>`;
}

export function mediaNew(ctx) {
  return html`<h1>${ctx.t('menu.media.new')}</h1>${uploader(ctx)}`;
}

// The «Bild ersetzen» modal used by image fields. Filled by admin.js.
export function mediaModal(ctx) {
  const { t } = ctx;
  return html`<div class="media-modal-wrap" id="media-modal" hidden>
    <div class="media-modal-backdrop js-modal-close"></div>
    <div class="media-modal" role="dialog" aria-modal="true" aria-labelledby="media-modal-title">
      <div class="media-modal-header"><h2 id="media-modal-title">${t('modal.title')}</h2><button type="button" class="media-modal-close js-modal-close" aria-label="${t('media.close')}">×</button></div>
      <div class="media-router" role="tablist"><button type="button" class="media-menu-item" data-tab="upload" role="tab">${t('modal.upload')}</button><button type="button" class="media-menu-item active" data-tab="library" role="tab">${t('modal.library')}</button></div>
      <div class="media-modal-content">
        <div class="media-tab media-tab-upload" hidden>${uploader(ctx, { compact: true })}</div>
        <div class="media-tab media-tab-library">
          <div class="media-toolbar"><input type="search" class="js-modal-filter" placeholder="${t('media.filter')}" aria-label="${t('media.filter')}"></div>
          <div class="media-library-wrap"><ul class="attachments modal-grid"></ul>
            <aside class="media-sidebar"><div class="media-sidebar-inner" hidden><img alt="" class="sidebar-thumb"><p class="sidebar-name"></p><p class="sidebar-meta description"></p></div></aside></div>
        </div>
      </div>
      <div class="media-frame-toolbar"><button type="button" class="button button-primary button-large js-modal-choose" disabled>${t('modal.choose')}</button></div>
    </div>
  </div>`;
}

// ---------------- Revisions ----------------

export function revisionIndex(ctx, { files, isRepo }) {
  const { t } = ctx;
  if (!isRepo) return html`<h1>${t('rev.title')}</h1><div class="notice notice-warning"><p>${t('rev.nogit')}</p></div>`;
  return html`<h1 class="wp-heading-inline">${t('rev.title')}</h1><hr class="wp-header-end"><p>${t('rev.lead')}</p>
  <table class="wp-list-table widefat fixed striped"><thead><tr><th class="column-primary">${t('rev.file')}</th><th>${t('rev.last')}</th><th class="num">${t('rev.count')}</th></tr></thead>
  <tbody>${files.length ? files.map((f) => html`<tr><td class="column-primary"><strong><a class="row-title" href="/wp-admin/revision.php?file=${encodeURIComponent(f.file)}">${f.title}</a></strong><br><code class="description">${f.file}</code></td><td>${formatDate(f.date, t.lang)} ${t('rev.by', { author: f.author })}<br><span class="description">${f.subject}</span></td><td class="num">${f.count}</td></tr>`) : html`<tr class="no-items"><td colspan="3">${t('rev.none')}</td></tr>`}</tbody></table>`;
}

export function revisionFile(ctx, { file, title, editUrl, revs, selected, diff, same, isRepo }) {
  const { t } = ctx;
  if (!isRepo) return html`<h1>${t('rev.title')}</h1><div class="notice notice-warning"><p>${t('rev.nogit')}</p></div>`;
  return html`<h1 class="wp-heading-inline">${t('rev.for', { title })}</h1><hr class="wp-header-end">
  ${editUrl ? html`<p><a href="${editUrl}">${t('rev.back')}</a></p>` : ''}
  <div class="revisions-wrap">
    <ol class="revisions-list">${revs.length ? revs.map((r, i) => html`<li class="${selected && selected.hash === r.hash ? 'current' : ''}">
      <a href="/wp-admin/revision.php?file=${encodeURIComponent(file)}&rev=${r.hash}"><span class="rev-date">${formatDate(r.date, t.lang)}</span> <span class="rev-author">${t('rev.by', { author: r.author })}</span>${i === 0 ? html` <span class="post-state">— ${t('rev.current')}</span>` : ''}<br><span class="description">${r.subject}</span></a></li>`) : html`<li>${t('rev.none')}</li>`}</ol>
    <div class="revisions-diff">${selected ? html`<h2>${t('rev.compare')}: ${formatDate(selected.date, t.lang)} ${t('rev.by', { author: selected.author })}</h2>
      ${same ? html`<p class="description">${t('rev.same')}</p>` : html`
        <table class="diff"><tbody>${diff.map((d) => html`<tr class="diff-${d.op}"><td class="diff-sign">${d.op === 'add' ? '+' : d.op === 'del' ? '−' : ''}</td><td class="diff-line">${d.text}</td></tr>`)}</tbody></table>
        <p class="diff-legend"><span class="diff-del">− ${t('rev.current')}</span> <span class="diff-add">+ ${formatDate(selected.date, t.lang)}</span></p>
        <form method="post" action="/wp-admin/revision.php">${nonce(ctx)}<input type="hidden" name="action" value="restore"><input type="hidden" name="file" value="${file}"><input type="hidden" name="rev" value="${selected.hash}">
          <p><button type="submit" class="button button-primary">${t('rev.restore')}</button></p><p class="description">${t('rev.restore.note')}</p></form>`}` : ''}</div>
  </div>`;
}

// ---------------- Profile ----------------

export function profile(ctx, { user, lang, errors = [] }) {
  const { t } = ctx;
  return html`<h1>${t('profile.title')}</h1>
  <form method="post" action="/wp-admin/profile.php" class="profile-form">${nonce(ctx)}<input type="hidden" name="action" value="profile">
    <table class="form-table"><tbody>
      <tr><th scope="row">${t('profile.user')}</th><td><input type="text" value="${user}" disabled class="regular-text"></td></tr>
      <tr><th scope="row"><label for="lang">${t('profile.lang')}</label></th><td><select name="lang" id="lang"><option value="de"${lang === 'de' ? raw(' selected') : ''}>Deutsch</option><option value="ru"${lang === 'ru' ? raw(' selected') : ''}>Русский</option></select></td></tr>
    </tbody></table>
    <h2>${t('profile.password')}</h2>
    ${errors.length ? html`<div class="notice notice-error inline"><p>${errors.join(' ')}</p></div>` : ''}
    <table class="form-table"><tbody>
      <tr><th scope="row"><label for="pass0">${t('profile.password.current')}</label></th><td><input type="password" name="pass0" id="pass0" class="regular-text" autocomplete="current-password"></td></tr>
      <tr><th scope="row"><label for="pass1">${t('profile.password.new')}</label></th><td><input type="password" name="pass1" id="pass1" class="regular-text" autocomplete="new-password"><p class="description">${t('profile.password.help', { n: 10 })}</p></td></tr>
      <tr><th scope="row"><label for="pass2">${t('profile.password.repeat')}</label></th><td><input type="password" name="pass2" id="pass2" class="regular-text" autocomplete="new-password"></td></tr>
    </tbody></table>
    <p class="submit"><button type="submit" class="button button-primary">${t('profile.save')}</button></p>
  </form>`;
}
