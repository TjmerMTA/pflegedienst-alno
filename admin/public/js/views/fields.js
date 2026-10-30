// Form controls: text, textarea with counter, classic editor, image picker, repeatable list.
import { html, raw } from '../html.js';
import { itemImage } from '../rules.js';

const idOf = (s) => String(s).replace(/[^a-zA-Z0-9_-]+/g, '-');
const thumbUrl = (p) => `/wp-admin/api/media/file?path=${encodeURIComponent(p)}&thumb=1`;
const chars = (s) => Array.from(String(s ?? '')).length;

function fieldError(ctx, errs) {
  if (!errs?.length) return '';
  return html`<p class="field-error" role="alert">${errs.map((e) => ctx.t.msg(e))
    .join(' · ')}</p>`;
}

function counter(value, max) {
  if (!max) return '';
  const n = chars(value);
  return html`<span class="char-counter${n > max ? ' over' : ''}" data-max="${max}" aria-live="polite"><span class="n">${n}</span> / ${max}</span>`;
}

export function textInput(ctx, { name, id, label, value, max, required, help, big, placeholder, errs }) {
  return html`<div class="field field-text${errs?.length ? ' has-error' : ''}">
    <label for="${id}">${label}${required ? raw(' <span class="req">*</span>') : ''}</label>
    <div class="input-wrap"><input type="text" id="${id}" name="${name}" value="${value ?? ''}" class="${big ? 'large-text big' : 'large-text'}${max ? ' js-count' : ''}"${placeholder ? html` placeholder="${placeholder}"` : ''}${required ? raw(' required') : ''}>${counter(value, max)}</div>
    ${help ? html`<p class="description">${help}</p>` : ''}
    ${fieldError(ctx, errs)}
  </div>`;
}

export function textArea(ctx, { name, id, label, value, max, required, help, rows = 3, errs }) {
  return html`<div class="field field-textarea${errs?.length ? ' has-error' : ''}">
    <label for="${id}">${label}${required ? raw(' <span class="req">*</span>') : ''}</label>
    <textarea id="${id}" name="${name}" rows="${rows}" class="large-text${max ? ' js-count' : ''}"${required ? raw(' required') : ''}>${value ?? ''}</textarea>
    <div class="field-meta">${counter(value, max)}</div>
    ${help ? html`<p class="description">${help}</p>` : ''}
    ${fieldError(ctx, errs)}
  </div>`;
}

// Classic editor. The textarea always holds the stored format (HTML for page richtext, Markdown for
// collection bodies); the Visuell tab is a contenteditable kept in sync by admin.js.
export function editor(ctx, { name, id, label, value, format = 'html', required, help, errs, visualOff = [], tall }) {
  const { t } = ctx;
  const tb = [
    ['bold', 'B', t('tb.bold')], ['italic', 'I', t('tb.italic')], ['link', 'link', t('tb.link')],
    ['ul', '•', t('tb.ul')], ['ol', '1.', t('tb.ol')], ['h2', 'H2', t('tb.h2')], ['h3', 'H3', t('tb.h3')],
    ...(format === 'markdown' ? [['quote', '❝', t('tb.quote')]] : []), ['p', '¶', t('tb.p')],
  ];
  const visual = !visualOff.length;
  return html`<div class="field field-editor${errs?.length ? ' has-error' : ''}">
    ${label ? html`<label for="${id}" class="editor-label">${label}${required ? raw(' <span class="req">*</span>') : ''}</label>` : ''}
    <div class="wp-editor-wrap ${visual ? 'tmce-active' : 'html-active'}${tall ? ' tall' : ''}" data-format="${format}" data-visual="${visual ? 'on' : 'off'}">
      <div class="wp-editor-tabs" role="tablist">
        <button type="button" class="wp-switch-editor switch-tmce" data-mode="visual" role="tab"${visual ? '' : raw(' disabled')}>${t('edit.visual')}</button>
        <button type="button" class="wp-switch-editor switch-html" data-mode="text" role="tab">${t('edit.text')}</button>
      </div>
      <div class="wp-editor-container">
        <div class="wp-editor-toolbar" role="toolbar">
          ${tb.map(([cmd, txt, title]) => html`<button type="button" class="ed-btn ed-${cmd}" data-cmd="${cmd}" title="${title}" aria-label="${title}">${cmd === 'link' ? raw('<svg viewBox="0 0 20 20" class="ed-icon" aria-hidden="true"><path d="M8.6 11.4a3 3 0 0 0 4.2 0l3-3a3 3 0 0 0-4.2-4.2l-1.2 1.2 1 1 1.2-1.2a1.6 1.6 0 0 1 2.2 2.2l-3 3a1.6 1.6 0 0 1-2.2 0zm2.8-2.8a3 3 0 0 0-4.2 0l-3 3a3 3 0 0 0 4.2 4.2l1.2-1.2-1-1-1.2 1.2a1.6 1.6 0 0 1-2.2-2.2l3-3a1.6 1.6 0 0 1 2.2 0z"/></svg>') : txt}</button>`)}
          <span class="ed-link-pop" hidden><input type="text" class="ed-link-url" placeholder="https://… oder /kontakt/" aria-label="${t('tb.link.url')}"><button type="button" class="button ed-link-apply">${t('tb.link.apply')}</button><button type="button" class="button-link ed-link-remove">${t('tb.link.remove')}</button></span>
        </div>
        <div class="wp-editor-visual" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${label || t('edit.body')}"></div>
        <textarea class="wp-editor-area" id="${id}" name="${name}" rows="${tall ? 18 : 6}" spellcheck="true">${value ?? ''}</textarea>
      </div>
    </div>
    ${visualOff.length ? html`<p class="description">${t('edit.visual.off', { what: visualOff.join(', ') })}</p>` : ''}
    ${help ? html`<p class="description">${help}</p>` : ''}
    ${fieldError(ctx, errs)}
  </div>`;
}

export function imagePicker(ctx, { name, altName, id, label, value, alt, required, help, errs, altErrs, withAlt = true }) {
  const { t } = ctx;
  return html`<div class="field field-image${errs?.length || altErrs?.length ? ' has-error' : ''}" data-image-field>
    <label>${label}${required ? raw(' <span class="req">*</span>') : ''}</label>
    <div class="image-picker">
      <div class="image-preview${value ? '' : ' empty'}">
        ${value ? html`<img src="${thumbUrl(value)}" alt="">` : html`<span>${t('edit.image.none')}</span>`}
      </div>
      <div class="image-actions">
        <input type="hidden" name="${name}" value="${value ?? ''}" class="js-image-value">
        <p class="image-file">${value || ''}</p>
        <p><button type="button" class="button-link js-image-choose">${value ? t('edit.image.replace') : t('edit.image.choose')}</button>
        <span class="sep"${value ? '' : raw(' hidden')}> · </span><button type="button" class="button-link link-delete js-image-remove"${value ? '' : raw(' hidden')}>${t('edit.image.remove')}</button></p>
        ${withAlt ? html`<div class="image-alt"${value ? '' : raw(' hidden')}><label for="${id}-alt" class="sub-label">${t('edit.image.alt')}</label>
        <input type="text" id="${id}-alt" name="${altName}" value="${value ? (alt ?? '') : ''}" class="regular-text js-image-alt">
        <p class="description">${t('edit.image.alt.help')}</p></div>` : ''}
      </div>
    </div>
    ${help ? html`<p class="description">${help}</p>` : ''}
    ${fieldError(ctx, errs)}${fieldError(ctx, altErrs)}
  </div>`;
}

// One field of a page file. `errors` maps 'group.field' paths to messages.
export function pageField(ctx, f, { name, id, value, alt, errPath, errors }) {
  const errs = errors.get(errPath);
  const common = { name, id, label: f.label, value, max: f.max, required: f.required, help: f.help, errs };
  switch (f.type) {
    case 'text': return textInput(ctx, { ...common, big: f.id === 'h1' });
    case 'textarea': return textArea(ctx, { ...common, rows: Math.min(8, Math.max(2, Math.ceil(chars(value) / 90) + 1)) });
    case 'richtext': return editor(ctx, { ...common, format: 'html' });
    case 'image': return imagePicker(ctx, { ...common, name: `${name}[value]`, altName: `${name}[alt]`, alt, altErrs: null });
    default: return '';
  }
}

let keySeq = 0;
export const itemKey = () => `i${(++keySeq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function listItem(ctx, f, { name, id, item, index, errPathBase, errors, key }) {
  const { t } = ctx;
  const k = key || itemKey();
  return html`<li class="list-item" draggable="true" data-key="${k}">
    <div class="list-item-head">
      <span class="list-handle" title="${t('edit.list.drag')}" aria-hidden="true">⋮⋮</span>
      <span class="list-item-title">${f.itemLabel || 'Eintrag'} <span class="list-num">${index + 1}</span></span>
      <span class="list-item-actions">
        <button type="button" class="button-link js-item-up" aria-label="${t('edit.list.up')}" title="${t('edit.list.up')}">▲</button>
        <button type="button" class="button-link js-item-down" aria-label="${t('edit.list.down')}" title="${t('edit.list.down')}">▼</button>
        <button type="button" class="button-link link-delete js-item-remove">${t('edit.list.remove')}</button>
      </span>
    </div>
    <div class="list-item-body">
      ${f.fields.map((sub) => {
        const subName = `${name}[${k}][${sub.id}]`;
        const subId = idOf(`${id}-${k}-${sub.id}`);
        const errPath = `${errPathBase}[${index + 1}].${sub.id}`;
        if (sub.type === 'image') {
          const im = itemImage(item || {}, sub);
          return imagePicker(ctx, { name: `${subName}[value]`, altName: `${subName}[alt]`, id: subId, label: sub.label, value: im.value, alt: im.alt, required: sub.required, help: sub.help, errs: errors.get(errPath) });
        }
        return pageField(ctx, sub, { name: subName, id: subId, value: item?.[sub.id] ?? '', errPath, errors });
      })}
    </div>
  </li>`;
}

export function listField(ctx, f, { name, id, value, errPath, errors }) {
  const { t } = ctx;
  const items = Array.isArray(value) ? value : [];
  const errs = errors.get(errPath);
  const limits = f.min !== undefined && f.max !== undefined ? t('edit.list.minmax', { min: f.min, max: f.max })
    : f.max !== undefined ? t('edit.list.max', { max: f.max }) : f.min !== undefined ? t('edit.list.min', { min: f.min }) : '';
  const tpl = listItem(ctx, f, { name, id, item: null, index: 0, errPathBase: '__none__', errors: new Map(), key: '__KEY__' });
  return html`<div class="field field-list${errs?.length ? ' has-error' : ''}" data-list data-min="${f.min ?? 0}" data-max="${f.max ?? 999}">
    <label>${f.label}</label>
    <input type="hidden" name="${name}[_]" value="">
    <ol class="list-items">${items.map((item, i) => listItem(ctx, f, { name, id, item, index: i, errPathBase: errPath, errors }))}</ol>
    <template class="list-template">${tpl}</template>
    <p class="list-footer"><button type="button" class="button js-item-add">+ ${t('edit.list.add', { item: f.itemLabel || 'Eintrag' })}</button> <span class="description">${limits}</span></p>
    ${f.help ? html`<p class="description">${f.help}</p>` : ''}
    ${fieldError(ctx, errs)}
  </div>`;
}

// Simple string list (Leistungen highlights).
export function stringList(ctx, f, { name, id, value, errs }) {
  const { t } = ctx;
  const one = (v, k) => html`<li class="list-item list-item-inline" draggable="true" data-key="${k}">
      <span class="list-handle" title="${t('edit.list.drag')}" aria-hidden="true">⋮⋮</span>
      <input type="text" name="${name}[${k}]" value="${v}" class="large-text" aria-label="${f.itemLabel}">
      <span class="list-item-actions"><button type="button" class="button-link js-item-up" aria-label="${t('edit.list.up')}">▲</button><button type="button" class="button-link js-item-down" aria-label="${t('edit.list.down')}">▼</button><button type="button" class="button-link link-delete js-item-remove">${t('edit.list.remove')}</button></span>
    </li>`;
  return html`<div class="field field-list${errs?.length ? ' has-error' : ''}" data-list data-min="${f.required ? 1 : 0}" data-max="50">
    <label>${f.label}${f.required ? raw(' <span class="req">*</span>') : ''}</label>
    <input type="hidden" name="${name}[_]" value="">
    <ol class="list-items">${(value || []).map((v) => one(v, itemKey()))}</ol>
    <template class="list-template">${one('', '__KEY__')}</template>
    <p class="list-footer"><button type="button" class="button js-item-add">+ ${t('edit.list.add', { item: f.itemLabel })}</button></p>
    ${fieldError(ctx, errs)}
  </div>`;
}

export { idOf, thumbUrl };
