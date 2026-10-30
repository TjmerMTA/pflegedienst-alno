// Screens. Each returns the inner HTML of the admin frame; the router wraps it in layout().
import { html, raw } from '../html.js';
import { formatDate } from '../i18n.js';
import { textInput, textArea, editor, imagePicker, pageField, listField, stringList, idOf, thumbUrl, fileUrl } from './fields.js';
import { icon } from './layout.js';

export const editUrl = (e) => `#/post.php?post_type=${e.type}&post=${encodeURIComponent(e.id)}`;
const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

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

// The endpoint's storage limit: from here on files are refused, at 110 % whole enquiries.
export function anfragenWarning(ctx, w) {
  const { t } = ctx;
  if (!w) return '';
  return html`<div class="notice notice-warning" role="alert"><p>${t('anfragen.full', { used: w.usedMb, limit: w.limitMb })} <a href="#/anfragen.php">${t('anfragen.full.link')}</a></p></div>`;
}

export function dashboard(ctx, { counts, runs, activity, firstPage, anfragenWarning: warning }) {
  const { t } = ctx;
  const lang = t.lang;
  const latest = runs.latest;
  const done = runs.finished;
  const stateKey = latest && (latest.state === 'queued' || latest.state === 'running') ? latest.state : 'idle';
  const failed = done && done.state === 'failed' ? done : null;
  return html`<h1 class="wp-heading-inline">${t('menu.dashboard')}</h1>
  ${anfragenWarning(ctx, warning)}
  <div id="welcome-panel" class="welcome-panel">
    <div class="welcome-panel-content">
      <div class="welcome-panel-header"><h2>${t('dash.welcome')}</h2><p>${t('dash.welcome.lead')}</p></div>
      <div class="welcome-panel-column-container">
        <div class="welcome-panel-column"><h3>${t('dash.start')}</h3>
          ${firstPage ? html`<a class="button button-primary button-hero" href="#/post.php?post_type=page&post=${encodeURIComponent(firstPage.id)}">${t('dash.start.pages')}</a>` : html`<a class="button button-primary button-hero" href="#/edit.php?post_type=page">${t('menu.pages.all')}</a>`}</div>
        <div class="welcome-panel-column"><h3>${t('dash.next')}</h3><ul>
          <li><a href="#/post-new.php?post_type=post">${icon('posts', 'welcome-icon')}${t('dash.next.post')}</a></li>
          <li><a href="#/post-new.php?post_type=team">${icon('team', 'welcome-icon')}${t('dash.next.team')}</a></li>
          <li><a href="${ctx.cfg.siteUrl}/" target="_blank" rel="noopener">${icon('home', 'welcome-icon')}${t('dash.next.view')}</a></li></ul></div>
        <div class="welcome-panel-column"><h3>${t('dash.more')}</h3><ul>
          <li><a href="#/upload.php">${icon('media', 'welcome-icon')}${t('dash.more.media')}</a></li>
          ${ctx.pages.some((p) => p.id === '_global') ? html`<li><a href="#/post.php?post_type=page&post=_global">${icon('settings', 'welcome-icon')}${t('dash.more.settings')}</a></li>` : ''}
          <li><a href="#/revision.php">${icon('revisions', 'welcome-icon')}${t('dash.more.revisions')}</a></li></ul></div>
      </div>
    </div>
  </div>
  <div id="dashboard-widgets" class="metabox-holder columns-2">
    <div class="postbox-container">
      ${postbox(ctx, { id: 'site-status', title: t('dash.status'), body: html`
        <table class="status-table"><tbody>
          <tr><th>${t('dash.status.state')}</th><td><span class="status-pill state-${stateKey}" id="dash-state">${t(`state.${stateKey}`)}</span></td></tr>
          <tr><th>${t('dash.status.lastrun')}</th><td>${done ? html`${formatDate(done.at, lang)} — <span class="${done.state === 'done' ? 'ok' : 'bad'}">${done.state === 'done' ? t('dash.status.ok') : t('dash.status.failed')}</span>${done.url ? html` · <a href="${done.url}" target="_blank" rel="noopener">${t('dash.status.log')}</a>` : ''}` : t('dash.status.never')}</td></tr>
        </tbody></table>
        <h3 class="status-sub">${t('dash.status.error')}</h3>
        ${failed ? html`<div class="notice notice-error inline"><p>${formatDate(failed.at, lang)}: ${failed.phase === 'deploy' ? t('notice.deployfailed') : t('notice.buildfailed')}</p>
          ${failed.url ? html`<p><a href="${failed.url}" target="_blank" rel="noopener">${t('notice.details')}</a></p>` : ''}</div>` : html`<p class="ok">${t('dash.status.noerror')}</p>`}` })}
    </div>
    <div class="postbox-container">
      ${postbox(ctx, { id: 'dashboard_right_now', title: t('dash.glance'), body: html`<ul class="glance">
        <li><a href="#/edit.php?post_type=page">${icon('pages', 'glance-icon')}${t('dash.glance.pages', { n: counts.pages })}</a></li>
        <li><a href="#/edit.php?post_type=post">${icon('posts', 'glance-icon')}${t('dash.glance.posts', { n: counts.posts })}</a></li>
        <li><a href="#/edit.php?post_type=leistung">${icon('leistungen', 'glance-icon')}${t('dash.glance.leistungen', { n: counts.leistungen })}</a></li>
        <li><a href="#/edit.php?post_type=team">${icon('team', 'glance-icon')}${t('dash.glance.team', { n: counts.team })}</a></li>
        <li><a href="#/upload.php">${icon('media', 'glance-icon')}${t('dash.glance.media', { n: counts.media })}</a></li></ul>` })}
      ${postbox(ctx, { id: 'dashboard_activity', title: t('dash.activity'), body: activity.length ? html`<ul class="activity">${activity.map((a) => html`<li><span class="activity-date">${formatDate(a.date, lang)}</span> <strong>${a.author}</strong>: ${a.subject}</li>`)}</ul>` : html`<p>${t('dash.activity.none')}</p>` })}
    </div>
  </div>`;
}

// ---------------- Pages list ----------------

export function pageList(ctx, { pages }) {
  const { t } = ctx;
  const rows = pages.map((p) => {
    const editUrl = `#/post.php?post_type=page&post=${encodeURIComponent(p.id)}`;
    const title = p.id === '_global' ? `${p.label} — ${t('list.settings')}` : p.label;
    return html`<tr${p.id === '_global' ? raw(' class="row-settings"') : ''}>
      <td class="title column-title column-primary"><strong><a class="row-title" href="${editUrl}">${title}</a></strong>
        ${p.error ? html`<p class="field-error">${t('list.unreadable')}: ${p.error}</p>` : ''}
        <div class="row-actions"><span class="edit"><a href="${editUrl}">${t('list.edit')}</a> | </span>
        ${p.url ? html`<span class="view"><a href="${ctx.cfg.siteUrl}${p.url}" target="_blank" rel="noopener">${t('list.view')}</a> | </span>` : ''}
        <span class="revisions"><a href="#/revision.php?file=${encodeURIComponent(`src/content/pages/${p.id}.json`)}">${t('list.revisions')}</a></span></div></td>
      <td class="column-url">${p.url ? html`<code>${p.url}</code>` : '—'}</td>
    </tr>`;
  });
  return html`<h1 class="wp-heading-inline">${t('menu.pages')}</h1><hr class="wp-header-end">
  <div class="tablenav top"><div class="tablenav-pages"><span class="displaying-num">${t('list.items', { n: pages.length })}</span></div></div>
  <table class="wp-list-table widefat fixed striped table-view-list pages">
    <thead><tr><th scope="col" class="column-title column-primary">${t('list.title')}</th><th scope="col" class="column-url">${t('list.url')}</th></tr></thead>
    <tbody>${rows.length ? rows : html`<tr class="no-items"><td colspan="2">${t('list.nopages')}</td></tr>`}</tbody>
  </table>`;
}

// ---------------- Page edit ----------------

function publishBox(ctx, { revCount, revUrl, buttonLabel, extra, status, trashForm }) {
  const { t } = ctx;
  return postbox(ctx, { id: 'submitdiv', title: t('edit.publish'), body: html`
    <div class="submitbox"><div class="misc-pub-section">${t('edit.status')} <strong>${status || t('edit.status.published')}</strong></div>
      ${revUrl ? html`<div class="misc-pub-section misc-pub-revisions">${icon('revisions', 'misc-icon')}<a href="${revUrl}">${t('edit.revisions', { n: revCount })}</a></div>` : ''}
      ${extra || ''}
      <div id="major-publishing-actions">
        ${trashForm ? html`<div id="delete-action"><button type="submit" form="trash-form" class="button-link submitdelete">${t('edit.totrash')}</button></div>` : ''}
        <div id="publishing-action"><span class="spinner"></span><button type="submit" class="button button-primary button-large" id="publish">${buttonLabel || t('edit.update')}</button></div>
        <div class="clear"></div>
      </div></div>` });
}

export function pageEdit(ctx, { id, page, errors = [], revCount, tokens, structureErrors }) {
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
  const revUrl = `#/revision.php?file=${encodeURIComponent(`src/content/pages/${id}.json`)}`;
  return html`<h1 class="wp-heading-inline">${heading}</h1>${view}<hr class="wp-header-end">
  <form id="post" class="js-edit-form" novalidate>
    <div id="poststuff"><div id="post-body" class="metabox-holder columns-2">
      <div id="post-body-content"><div id="normal-sortables">${boxes}</div></div>
      <div id="postbox-container-1" class="postbox-container">
        ${publishBox(ctx, { revCount, revUrl })}
        ${tokens.length ? postbox(ctx, { id: 'tokensdiv', title: t('edit.tokens'), body: html`<p class="description">${t('edit.tokens.help')}</p><ul class="token-list">${tokens.map((k) => html`<li><code>{{${k}}}</code></li>`)}</ul>` }) : ''}
        ${page.url ? postbox(ctx, { id: 'previewdiv', title: t('edit.preview'), body: html`<p><a href="${ctx.cfg.siteUrl}${page.url}" target="_blank" rel="noopener">${t('edit.view')}</a></p><p class="description">${t('edit.preview.help')}</p>` }) : ''}
      </div>
    </div></div>
  </form>
  ${mediaModal(ctx)}`;
}

// ---------------- Collections ----------------

export function collectionList(ctx, { def, entries, trash, view, search, counts }) {
  const { t } = ctx;
  const coll = def.key;
  const pt = def.postType;
  const base = `#/edit.php?post_type=${pt}`;
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
        <form class="inline-form" data-api="entry/untrash" data-then="entry" data-type="${pt}" data-message="untrashed"><input type="hidden" name="type" value="${pt}"><input type="hidden" name="trashId" value="${e.id}"><button type="submit" class="button-link">${t('list.restore')}</button></form> |
        <form class="inline-form" data-api="entry/delete" data-confirm data-next="#/edit.php?post_type=${pt}&post_status=trash&message=deleted"><input type="hidden" name="type" value="${pt}"><input type="hidden" name="trashId" value="${e.id}"><button type="submit" class="button-link link-delete">${t('list.delete')}</button></form>
      </div></td></tr>`);
  } else {
    rows = entries.map((e) => {
      const v = e.values;
      const editUrl = `#/post.php?post_type=${pt}&post=${encodeURIComponent(e.slug)}`;
      const title = (coll === 'team' ? v.name : v.title) || e.slug;
      const url = def.urlPrefix ? `${def.urlPrefix}${e.slug}/` : def.url;
      const state = coll === 'blog' && v.draft ? t('list.draft') : coll === 'team' && v.hidden ? t('list.hidden') : '';
      const cell = (k) => {
        switch (k) {
          case 'title': return html`<td class="title column-title column-primary"><strong><a class="row-title" href="${editUrl}">${title}</a>${state ? html` <span class="post-state">— ${state}</span>` : ''}</strong>
            ${e.error ? html`<p class="field-error">${t('list.unreadable')}: ${e.error}</p>` : ''}
            <div class="row-actions"><span class="edit"><a href="${editUrl}">${t('list.edit')}</a></span>
            ${def.canDelete ? html` | <span class="trash"><form class="inline-form" data-api="entry/trash" data-next="#/edit.php?post_type=${pt}&message=trashed"><input type="hidden" name="type" value="${pt}"><input type="hidden" name="id" value="${e.slug}"><button type="submit" class="button-link link-delete">${t('list.trash')}</button></form></span>` : ''}
            ${url && !(coll === 'blog' && v.draft) ? html` | <span class="view"><a href="${ctx.cfg.siteUrl}${url}" target="_blank" rel="noopener">${t('list.view')}</a></span>` : ''}
            | <span class="revisions"><a href="#/revision.php?file=${encodeURIComponent(`src/content/${def.dir}/${e.slug}.md`)}">${t('list.revisions')}</a></span></div></td>`;
          case 'author': return html`<td class="column-author">${v.author || 'Team Pflegedienst ALNO'}</td>`;
          case 'tags': return html`<td class="column-tags">${(v.tags || []).join(', ') || '—'}</td>`;
          case 'date': return html`<td class="column-date">${v.draft ? t('list.draft') : t('list.published')}<br>${v.date ? formatDate(v.date + 'T12:00:00', t.lang, false) : ''}</td>`;
          case 'icon': return html`<td class="column-icon"><code>${v.icon}</code></td>`;
          case 'payer': return html`<td class="column-payer">${v.payer}</td>`;
          case 'order': return html`<td class="column-order">${v.order ?? ''}</td>`;
          case 'role': return html`<td class="column-role">${v.role}</td>`;
          case 'photo': return html`<td class="column-photo">${v.photo?.value ? html`<img src="${thumbUrl(v.photo.value)}" alt="" class="list-thumb">` : html`<span class="list-thumb empty">${icon('profile')}</span>`}</td>`;
          default: return html`<td></td>`;
        }
      };
      return html`<tr>${cols.map(([k]) => cell(k))}</tr>`;
    });
  }
  return html`<h1 class="wp-heading-inline">${heading}</h1>${def.canCreate ? html` <a href="#/post-new.php?post_type=${pt}" class="page-title-action">${t('list.addnew')}</a>` : ''}<hr class="wp-header-end">
  <ul class="subsubsub">${views.map(([href, label, n, cur], i) => html`<li><a href="${href}"${cur ? raw(' class="current" aria-current="page"') : ''}>${label} <span class="count">(${n})</span></a>${i < views.length - 1 ? ' |' : ''}</li>`)}</ul>
  ${view !== 'trash' ? html`<form class="search-form" data-get="#/edit.php"><p class="search-box"><input type="hidden" name="post_type" value="${pt}"><input type="search" name="s" value="${search || ''}" aria-label="${t('list.search')}"><button type="submit" class="button">${t('list.search')}</button></p></form>` : ''}
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
    case 'boolean': return html`<div class="field field-check"><label><input type="checkbox" name="${f.id}"${v ? raw(' checked') : ''}> ${f.label}</label></div>`;
    case 'select': return html`<div class="field${e ? ' has-error' : ''}"><label for="${id}">${f.label}</label><select id="${id}" name="${f.id}">${f.options.map((o) => html`<option value="${o}"${o === v ? raw(' selected') : ''}>${o}</option>`)}</select>${e ? html`<p class="field-error">${e.map(ctx.t.msg).join(' · ')}</p>` : ''}</div>`;
    case 'tags': return html`<div class="field${e ? ' has-error' : ''}"><label for="${id}">${f.label}</label><input type="text" id="${id}" name="${f.id}" value="${(v || []).join(', ')}" class="large-text" data-comma-list><p class="description">${f.help}</p>${e ? html`<p class="field-error">${e.map(ctx.t.msg).join(' · ')}</p>` : ''}</div>`;
    case 'strings': return stringList(ctx, f, { name: f.id, id, value: v, errs: e });
    case 'image': return imagePicker(ctx, { name: `${f.id}[value]`, altName: `${f.id}[alt]`, id, label: f.label, value: v?.value, alt: v?.alt, withAlt: !!f.altKey, errs: e, altErrs: f.altKey ? errs.get(f.altKey) : null });
    default: return '';
  }
}

export function collectionEdit(ctx, { def, slug, isNew, values, body, errors = [], revCount, visualOff }) {
  const { t } = ctx;
  const coll = def.key;
  const errs = errorMap(errors);
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
  <form id="post" class="js-edit-form" novalidate>
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
          revCount,
          revUrl: isNew ? null : `#/revision.php?file=${encodeURIComponent(relFile)}`,
          buttonLabel: isNew ? t('edit.publishbtn') : t('edit.update'), status,
          extra: publishFields ? html`<div class="misc-pub-section misc-pub-fields">${publishFields[1].map((f) => collField(ctx, f, values, errs))}</div>` : '',
          trashForm: !isNew && def.canDelete,
        })}
        ${otherSide}
      </div>
    </div></div>
  </form>
  ${!isNew && def.canDelete ? html`<form id="trash-form" data-api="entry/trash" data-next="#/edit.php?post_type=${def.postType}&message=trashed"><input type="hidden" name="type" value="${def.postType}"><input type="hidden" name="id" value="${slug}"></form>` : ''}
  ${mediaModal(ctx)}`;
}

// ---------------- Media ----------------

export function uploader(ctx, { compact } = {}) {
  const { t } = ctx;
  return html`<div class="uploader${compact ? ' compact' : ''}" data-uploader>
    <div class="drag-drop-area">
      <p class="drag-drop-info">${t('media.drop')}</p><p>${t('media.or')}</p>
      <div class="upload-form"><label class="button button-hero browser">${t('media.select')}<input type="file" accept="image/jpeg,image/png,image/webp" multiple class="screen-reader-text js-upload-input"></label></div>
    </div>
    <p class="max-upload-size">${t('media.limits', { mb: Math.round(ctx.cfg.uploadMaxBytes / 1048576), px: 2400 })}</p>
    <ul class="upload-progress" aria-live="polite"></ul>
  </div>`;
}

export function mediaLibrary(ctx, { images, selected, search }) {
  const { t } = ctx;
  return html`<h1 class="wp-heading-inline">${t('media.title')}</h1> <a href="#/media-new.php" class="page-title-action js-toggle-uploader">${t('media.add')}</a><hr class="wp-header-end">
  <div class="media-uploader-inline" hidden>${uploader(ctx)}</div>
  <div class="media-toolbar wp-filter"><form class="media-search" data-get="#/upload.php"><input type="search" name="s" value="${search || ''}" placeholder="${t('media.filter')}" class="js-media-filter" aria-label="${t('media.filter')}"></form>
    <span class="displaying-num">${t('list.items', { n: images.length })}</span></div>
  <ul class="attachments media-grid">${images.length ? images.map((im) => html`<li class="attachment${selected === im.path ? ' selected' : ''}" data-path="${im.path}"><a href="#/upload.php?item=${encodeURIComponent(im.path)}" title="${im.path}" class="attachment-preview"><img src="${thumbUrl(im.path)}" alt="" loading="lazy"><span class="attachment-name">${im.path}</span>${im.pending ? html`<span class="attachment-pending">${t('media.pending.short')}</span>` : ''}</a></li>`) : html`<li class="no-media">${t('media.empty')}</li>`}</ul>`;
}

export function mediaDetails(ctx, { image, info, usedOn, alt: defaultAlt }) {
  const { t } = ctx;
  return html`<div class="media-modal-backdrop static"></div><div class="media-modal static" role="dialog" aria-labelledby="media-details-title">
    <div class="media-modal-header"><h2 id="media-details-title">${t('media.details')}</h2><a href="#/upload.php" class="media-modal-close" aria-label="${t('media.close')}">×</a></div>
    <div class="media-modal-content attachment-details">
      <div class="attachment-media-view"><img src="${fileUrl(image.path)}" alt="" class="details-image"></div>
      <div class="attachment-info">
        <div class="details">
          <p><strong>${t('media.file')}:</strong> ${image.name}</p>
          <p><strong>${t('media.path')}:</strong> <code>${image.path}</code></p>
          <p><strong>${t('media.size')}:</strong> ${fmtSize(image.size)}</p>
          ${info.width ? html`<p><strong>${t('media.dims')}:</strong> ${info.width} × ${info.height} px</p>` : ''}
          ${image.pending ? html`<p class="description">${t('media.pending')}</p>` : ''}
        </div>
        <form class="settings" data-api="media/meta" data-next="#/upload.php?item=${encodeURIComponent(image.path)}&message=mediasaved"><input type="hidden" name="path" value="${image.path}">
          <label for="attachment-alt">${t('media.defaultalt')}</label>
          <textarea id="attachment-alt" name="alt" rows="2" class="large-text">${defaultAlt || ''}</textarea>
          <p class="description">${t('media.defaultalt.help')}</p>
          <p><button type="submit" class="button button-primary">${t('media.save')}</button></p>
        </form>
        <h3>${t('media.usedon')}</h3>
        ${usedOn.length ? html`<ul class="used-on">${usedOn.map((u) => html`<li>${u.edit ? html`<a href="${editUrl(u.edit)}">${u.title}</a>` : u.title} <span class="description">— ${u.where}${u.alt ? html` · Alt: „${u.alt}“` : ''}</span></li>`)}</ul>` : html`<p class="description">${t('media.unused')}</p>`}
        <div class="actions">${usedOn.length ? html`<p class="description">${t('media.delete.used')}</p>` : html`<form data-api="media/delete" data-confirm data-next="#/upload.php?message=mediatrashed"><input type="hidden" name="path" value="${image.path}"><button type="submit" class="button-link link-delete">${t('media.delete')}</button></form>`}</div>
      </div>
    </div></div>`;
}

export function mediaNew(ctx) {
  return html`<h1>${ctx.t('menu.media.new')}</h1>${uploader(ctx)}`;
}

// The «Bild ersetzen» modal used by image fields. Filled by behaviour.js.
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

export function revisionIndex(ctx, { files }) {
  const { t } = ctx;
  return html`<h1 class="wp-heading-inline">${t('rev.title')}</h1><hr class="wp-header-end"><p>${t('rev.lead')}</p>
  <table class="wp-list-table widefat fixed striped"><thead><tr><th class="column-primary">${t('rev.file')}</th><th>${t('rev.last')}</th><th class="num">${t('rev.count')}</th></tr></thead>
  <tbody>${files.length ? files.map((f) => html`<tr><td class="column-primary"><strong><a class="row-title" href="#/revision.php?file=${encodeURIComponent(f.file)}">${f.title}</a></strong><br><code class="description">${f.file}</code></td><td>${formatDate(f.date, t.lang)} ${t('rev.by', { author: f.author })}<br><span class="description">${f.subject}</span></td><td class="num">${f.count}</td></tr>`) : html`<tr class="no-items"><td colspan="3">${t('rev.none')}</td></tr>`}</tbody></table>`;
}

export function revisionFile(ctx, { file, title, edit, revs, selected, diff, same }) {
  const { t } = ctx;
  return html`<h1 class="wp-heading-inline">${t('rev.for', { title })}</h1><hr class="wp-header-end">
  ${edit ? html`<p><a href="${editUrl(edit)}">${t('rev.back')}</a></p>` : ''}
  <div class="revisions-wrap">
    <ol class="revisions-list">${revs.length ? revs.map((r, i) => html`<li class="${selected && selected.hash === r.hash ? 'current' : ''}">
      <a href="#/revision.php?file=${encodeURIComponent(file)}&rev=${r.hash}"><span class="rev-date">${formatDate(r.date, t.lang)}</span> <span class="rev-author">${t('rev.by', { author: r.author })}</span>${i === 0 ? html` <span class="post-state">— ${t('rev.current')}</span>` : ''}<br><span class="description">${r.subject}</span></a></li>`) : html`<li>${t('rev.none')}</li>`}</ol>
    <div class="revisions-diff">${selected ? html`<h2>${t('rev.compare')}: ${formatDate(selected.date, t.lang)} ${t('rev.by', { author: selected.author })}</h2>
      ${same ? html`<p class="description">${t('rev.same')}</p>` : html`
        <table class="diff"><tbody>${diff.map((d) => html`<tr class="diff-${d.op}"><td class="diff-sign">${d.op === 'add' ? '+' : d.op === 'del' ? '−' : ''}</td><td class="diff-line">${d.text}</td></tr>`)}</tbody></table>
        <p class="diff-legend"><span class="diff-del">− ${t('rev.current')}</span> <span class="diff-add">+ ${formatDate(selected.date, t.lang)}</span></p>
        <form data-api="revisions/restore" data-then="restored"><input type="hidden" name="file" value="${file}"><input type="hidden" name="rev" value="${selected.hash}">
          <p><button type="submit" class="button button-primary">${t('rev.restore')}</button></p><p class="description">${t('rev.restore.note')}</p></form>`}` : ''}</div>
  </div>`;
}

// ---------------- Profile ----------------

export function profile(ctx, { user, lang }) {
  const { t } = ctx;
  return html`<h1>${t('profile.title')}</h1>
  <form class="profile-form" data-profile novalidate>
    <table class="form-table"><tbody>
      <tr><th scope="row">${t('profile.user')}</th><td><input type="text" value="${user}" disabled class="regular-text"></td></tr>
      <tr><th scope="row"><label for="lang">${t('profile.lang')}</label></th><td><select name="lang" id="lang"><option value="de"${lang === 'de' ? raw(' selected') : ''}>Deutsch</option><option value="ru"${lang === 'ru' ? raw(' selected') : ''}>Русский</option></select></td></tr>
    </tbody></table>
    <h2>${t('profile.password')}</h2>
    <table class="form-table"><tbody>
      <tr><th scope="row"><label for="pass0">${t('profile.password.current')}</label></th><td><input type="password" name="pass0" id="pass0" class="regular-text" autocomplete="current-password"></td></tr>
      <tr><th scope="row"><label for="pass1">${t('profile.password.new')}</label></th><td><input type="password" name="pass1" id="pass1" class="regular-text" autocomplete="new-password"><p class="description">${t('profile.password.help', { n: 10 })}</p></td></tr>
      <tr><th scope="row"><label for="pass2">${t('profile.password.repeat')}</label></th><td><input type="password" name="pass2" id="pass2" class="regular-text" autocomplete="new-password"></td></tr>
    </tbody></table>
    <p class="submit"><button type="submit" class="button button-primary">${t('profile.save')}</button></p>
  </form>`;
}

// ---------------- Users ----------------

export function userList(ctx, { users, me }) {
  const { t } = ctx;
  return html`<h1 class="wp-heading-inline">${t('users.title')}</h1> <a href="#/user-new.php" class="page-title-action">${t('users.add')}</a><hr class="wp-header-end">
  <table class="wp-list-table widefat fixed striped table-view-list users">
    <thead><tr><th scope="col" class="column-primary">${t('users.name')}</th><th scope="col">${t('users.role')}</th><th scope="col">${t('users.anfragen')}</th><th scope="col" class="column-date">${t('users.created')}</th></tr></thead>
    <tbody>${users.map((u) => html`<tr><td class="column-primary"><strong><a class="row-title" href="#/user-edit.php?user=${encodeURIComponent(u.name)}">${u.name}</a></strong>${u.name === me ? html` <span class="post-state">— ${t('users.you')}</span>` : ''}
      <div class="row-actions"><span class="edit"><a href="#/user-edit.php?user=${encodeURIComponent(u.name)}">${t('list.edit')}</a></span>
      ${u.name === me ? '' : html` | <span class="trash"><form class="inline-form" data-api="users/delete" data-confirm data-next="#/users.php?message=userdeleted"><input type="hidden" name="name" value="${u.name}"><button type="submit" class="button-link link-delete">${t('list.delete')}</button></form></span>`}</div></td>
      <td>${u.admin ? t('users.role.admin') : t('users.role.editor')}</td><td>${u.anfragen ? t('users.yes') : t('users.no')}</td><td class="column-date">${u.created ? formatDate(u.created, t.lang, false) : ''}</td></tr>`)}</tbody>
  </table>`;
}

export function userNew(ctx) {
  const { t } = ctx;
  return html`<h1>${t('users.add')}</h1>
  <form class="profile-form" data-api="users/add" data-next="#/users.php?message=useradded" novalidate>
    <table class="form-table"><tbody>
      <tr><th scope="row"><label for="u-name">${t('users.name')}</label></th><td><input type="text" name="name" id="u-name" class="regular-text" autocomplete="off" autocapitalize="off" spellcheck="false"><p class="description">${t('users.name.help')}</p></td></tr>
      <tr><th scope="row"><label for="u-pass">${t('login.pass')}</label></th><td><input type="password" name="password" id="u-pass" class="regular-text" autocomplete="new-password"><p class="description">${t('profile.password.help', { n: 10 })}</p></td></tr>
      <tr><th scope="row"><label for="u-lang">${t('profile.lang')}</label></th><td><select name="lang" id="u-lang"><option value="de">Deutsch</option><option value="ru">Русский</option></select></td></tr>
      <tr><th scope="row">${t('users.role')}</th><td><label><input type="checkbox" name="admin"> ${t('users.role.admin.help')}</label></td></tr>
      <tr><th scope="row">${t('users.anfragen')}</th><td><label><input type="checkbox" name="anfragen"> ${t('users.anfragen.help')}</label></td></tr>
    </tbody></table>
    <p class="submit"><button type="submit" class="button button-primary">${t('users.add')}</button></p>
  </form>`;
}

export function userEdit(ctx, { u }) {
  const { t } = ctx;
  return html`<h1>${t('users.edit', { name: u.name })}</h1>
  <form class="profile-form" data-api="users/update" data-next="#/users.php?message=usersaved" novalidate>
    <input type="hidden" name="name" value="${u.name}">
    <table class="form-table"><tbody>
      <tr><th scope="row">${t('users.role')}</th><td>${u.admin ? t('users.role.admin') : t('users.role.editor')}</td></tr>
      ${u.admin ? '' : html`<tr><th scope="row">${t('users.anfragen')}</th><td><label><input type="checkbox" name="anfragen"${u.anfragen ? raw(' checked') : ''}> ${t('users.anfragen.help')}</label></td></tr>`}
      <tr><th scope="row"><label for="u-pass">${t('profile.password.new')}</label></th><td><input type="password" name="password" id="u-pass" class="regular-text" autocomplete="new-password"><p class="description">${t('users.password.help')}</p></td></tr>
    </tbody></table>
    <p class="submit"><button type="submit" class="button button-primary">${t('profile.save')}</button></p>
  </form>`;
}

// ---------------- Anfragen ----------------
// Every value in a submission came from a stranger. html`` escapes all of them; nothing here uses raw().

const FORM_LABELS = { beratung: 'form.beratung', rueckruf: 'form.rueckruf', erstbegutachtung: 'form.erstbegutachtung', rechner: 'form.rechner', rechnertermin: 'form.rechnertermin', karriere: 'form.karriere', ausbildung: 'form.ausbildung' };
const FIELD_LABELS = {
  leistung: 'Leistung', name: 'Name', phone: 'Telefon', email: 'E-Mail', message: 'Nachricht', rueckrufzeit: 'Rückrufzeit', stadtteil: 'Ort / Stadtteil',
  wunschtermin: 'Wunschtermin', tageszeit: 'Tageszeit', pflegegrad: 'Pflegegrad', rechner_ergebnis: 'Ergebnis des Pflege-Rechners', position: 'Stelle',
  qualifikation: 'Qualifikation', eintritt: 'Eintrittstermin', arbeitszeit: 'Arbeitszeit', wunsch: 'Wunsch', geburtsjahr: 'Geburtsjahr', schulabschluss: 'Schulabschluss', beginn: 'Beginn', datenschutz: 'Datenschutz',
};
const formLabel = (t, f) => (FORM_LABELS[f] ? t(FORM_LABELS[f]) : f);
const anfrageUrl = (id) => `#/anfragen.php?id=${encodeURIComponent(id)}`;

function anfrageAction(t, route, id, label, { cls = '', next, status, confirm } = {}) {
  const look = /\bbutton\b/.test(cls) ? cls : `button-link ${cls}`;
  return html`<form class="inline-form" data-api="${route}"${confirm ? raw(' data-confirm') : ''} data-next="${next}"><input type="hidden" name="id" value="${id}">${status ? html`<input type="hidden" name="status" value="${status}">` : ''}<button type="submit" class="${look}">${label}</button></form>`;
}

const invalidMark = (t) => html` <span class="anfrage-invalid">${t('anfragen.invalid')}</span>`;

export function anfragenList(ctx, { items, counts, retention, view, cronUrl, warning }) {
  const { t } = ctx;
  const base = '#/anfragen.php';
  const views = [[base, t('list.all'), counts.all, 'all'], [`${base}?view=neu`, t('anfragen.new'), counts.neu, 'neu'], [`${base}?view=erledigt`, t('anfragen.done'), counts.erledigt, 'erledigt'], [`${base}?view=trash`, t('list.trash'), counts.trash, 'trash']];
  const here = view === 'all' ? base : `${base}?view=${view}`;
  const back = (message) => `${here}${here.includes('?') ? '&' : '?'}message=${message}`;
  const rows = items.map((a) => html`<tr class="${a.status === 'neu' ? 'is-new' : ''}">
    <td class="column-primary"><strong><a class="row-title" href="${anfrageUrl(a.id)}">${formatDate(a.received, t.lang)}</a></strong>
      <div class="row-actions"><span><a href="${anfrageUrl(a.id)}">${t('anfragen.open')}</a></span>
      ${view === 'trash' ? html` | ${anfrageAction(t, 'anfragen/restore', a.id, t('list.restore'), { next: back('anfrage-restored') })} | ${anfrageAction(t, 'anfragen/delete', a.id, t('list.delete'), { cls: 'link-delete', next: back('anfrage-deleted'), confirm: true })}`
        : html` | ${a.status === 'neu' ? anfrageAction(t, 'anfragen/status', a.id, t('anfragen.markdone'), { status: 'erledigt', next: back('anfrage-status') }) : anfrageAction(t, 'anfragen/status', a.id, t('anfragen.marknew'), { status: 'neu', next: back('anfrage-status') })} | ${anfrageAction(t, 'anfragen/trash', a.id, t('list.trash'), { cls: 'link-delete', next: back('anfrage-trashed') })}`}</div></td>
    <td>${formLabel(t, a.form)}${a.files ? html` <span class="description">(${t('anfragen.files', { n: a.files })})</span>` : ''}${a.filesRefused ? html` <span class="anfrage-invalid">${t('anfragen.refused.short', { n: a.filesRefused })}</span>` : ''}</td><td>${a.name}${a.invalid.includes('name') ? invalidMark(t) : ''}</td><td>${a.phone}${a.invalid.includes('phone') ? invalidMark(t) : ''}</td>
    <td>${a.status === 'neu' ? t('anfragen.new') : a.status === 'erledigt' ? t('anfragen.done') : a.status}</td>
    <td class="column-date">${formatDate(a.deleteAt, t.lang, false)}</td></tr>`);
  return html`<h1 class="wp-heading-inline">${t('anfragen.title')}</h1><hr class="wp-header-end">
  ${anfragenWarning(ctx, warning)}
  <ul class="subsubsub">${views.map(([href, label, n, key], i) => html`<li><a href="${href}"${view === key ? raw(' class="current" aria-current="page"') : ''}>${label} <span class="count">(${n})</span></a>${i < views.length - 1 ? ' |' : ''}</li>`)}</ul>
  <div class="tablenav top"><div class="tablenav-pages"><span class="displaying-num">${t('list.items', { n: items.length })}</span></div></div>
  <table class="wp-list-table widefat fixed striped table-view-list anfragen">
    <thead><tr><th scope="col" class="column-primary">${t('anfragen.date')}</th><th scope="col">${t('anfragen.form')}</th><th scope="col">${t('users.name')}</th><th scope="col">${t('anfragen.phone')}</th><th scope="col">${t('anfragen.status')}</th><th scope="col" class="column-date">${t('anfragen.deleteat')}</th></tr></thead>
    <tbody>${rows.length ? rows : html`<tr class="no-items"><td colspan="6">${view === 'trash' ? t('list.trash.empty') : t('anfragen.empty')}</td></tr>`}</tbody>
  </table>
  ${view === 'trash' ? html`<p class="description">${t('anfragen.trash.help', { days: 30 })}</p>` : ''}
  ${ctx.isAdmin ? postbox(ctx, { id: 'retentiondiv', title: t('anfragen.retention'), body: html`<form data-api="anfragen/retention" data-next="${back('retention')}" class="retention-form" novalidate>
    <p class="description">${t('anfragen.retention.help')}</p>
    <p><label for="ret-i">${t('anfragen.retention.inquiries')}</label> <input type="number" min="1" max="60" step="1" id="ret-i" name="inquiries" value="${retention.inquiries}" class="small-text"> ${t('anfragen.months')}</p>
    <p><label for="ret-a">${t('anfragen.retention.applications')}</label> <input type="number" min="1" max="60" step="1" id="ret-a" name="applications" value="${retention.applications}" class="small-text"> ${t('anfragen.months')}</p>
    <p><button type="submit" class="button button-primary">${t('media.save')}</button></p></form>
    ${cronUrl ? html`<h3 class="status-sub">${t('anfragen.cron')}</h3><p class="description">${t('anfragen.cron.help')}</p><p><code class="cron-url">${cronUrl}</code></p>` : ''}` }) : ''}`;
}

export function anfrageDetail(ctx, a) {
  const { t } = ctx;
  const list = '#/anfragen.php';
  const self = anfrageUrl(a.id);
  const fileUrlOf = (f) => `/wp-admin/api.php?r=anfragen/file&id=${encodeURIComponent(a.id)}&stored=${encodeURIComponent(f.stored)}`;
  return html`<h1 class="wp-heading-inline">${t('anfragen.detail', { form: formLabel(t, a.form) })}</h1><hr class="wp-header-end">
  <p><a href="${a.trashed ? `${list}?view=trash` : list}">← ${t('anfragen.back')}</a></p>
  ${a.filesRefused ? html`<div class="notice notice-warning"><p>${t('anfragen.refused', { n: a.filesRefused })}</p></div>` : ''}
  <div id="poststuff"><div id="post-body" class="metabox-holder columns-2">
    <div id="post-body-content">
      ${postbox(ctx, { id: 'anfrage-fields', title: t('anfragen.fields'), body: html`<table class="form-table anfrage-fields"><tbody>
        ${Object.entries(a.fields).map(([k, v]) => {
          const flagged = a.invalid.includes(k);
          const value = k === 'email' && !flagged ? html`<a href="mailto:${encodeURIComponent(String(v))}">${v}</a>` : v;
          return html`<tr><th scope="row">${FIELD_LABELS[k] || k}</th><td class="anfrage-value">${value}${flagged ? invalidMark(t) : ''}</td></tr>`;
        })}
      </tbody></table>` })}
      ${a.attachments.length ? postbox(ctx, { id: 'anfrage-files', title: t('anfragen.attachments'), body: html`<ul class="used-on">${a.attachments.map((f) => html`<li><a href="${fileUrlOf(f)}" download>${f.name}</a> <span class="description">— ${fmtSize(f.size)}</span></li>`)}</ul><p class="description">${t('anfragen.attachments.help')}</p>` }) : ''}
    </div>
    <div id="postbox-container-1" class="postbox-container">
      ${postbox(ctx, { id: 'submitdiv', title: t('anfragen.status'), body: html`<div class="submitbox">
        <div class="misc-pub-section">${t('anfragen.date')}: <strong>${formatDate(a.received, t.lang)}</strong></div>
        <div class="misc-pub-section">${t('anfragen.page')}: <strong>${a.page || '—'}</strong></div>
        <div class="misc-pub-section">${t('anfragen.status')}: <strong>${a.trashed ? t('list.trash') : a.status === 'neu' ? t('anfragen.new') : a.status === 'erledigt' ? t('anfragen.done') : a.status}</strong></div>
        <div class="misc-pub-section">${t('anfragen.deleteat')}: <strong>${formatDate(a.deleteAt, t.lang, false)}</strong></div>
        <div id="major-publishing-actions">
          ${a.trashed ? html`<div id="delete-action">${anfrageAction(t, 'anfragen/delete', a.id, t('list.delete'), { cls: 'submitdelete', next: `${list}?view=trash&message=anfrage-deleted`, confirm: true })}</div>
            <div id="publishing-action">${anfrageAction(t, 'anfragen/restore', a.id, t('list.restore'), { cls: 'button button-primary', next: `${self}&message=anfrage-restored` })}</div>`
          : html`<div id="delete-action">${anfrageAction(t, 'anfragen/trash', a.id, t('edit.totrash'), { cls: 'submitdelete', next: `${list}?message=anfrage-trashed` })}</div>
            <div id="publishing-action">${a.status === 'neu' ? anfrageAction(t, 'anfragen/status', a.id, t('anfragen.markdone'), { cls: 'button button-primary', status: 'erledigt', next: `${self}&message=anfrage-status` }) : anfrageAction(t, 'anfragen/status', a.id, t('anfragen.marknew'), { cls: 'button', status: 'neu', next: `${self}&message=anfrage-status` })}</div>`}
          <div class="clear"></div></div></div>` })}
    </div>
  </div></div>`;
}
