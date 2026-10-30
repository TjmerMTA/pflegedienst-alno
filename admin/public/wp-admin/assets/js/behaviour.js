// Browser behaviour of the screens: metaboxes, counters, classic editor, media modal, lists, uploads,
// status polling. Document listeners are installed once; mount() wires up each freshly rendered screen.
import { sanitizeHtml, safeHref, slugify, PAGE_TAGS, MD_TAGS } from './rules.js';
import { markdownToHtml, htmlToMarkdown } from './markdown.js';
import { thumbUrl } from './views/fields.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const chars = (s) => Array.from(s).length;
const POLL_MS = 5000;
const POLL_MAX = 120; // ten minutes; a run that never appears must not poll forever

// { api, t, go, nonce, statusChanged }, set by the router on each mount.
let opts = null;
// Bumped by each mount: timers and answers of a screen that is gone stop by themselves.
let generation = 0;

// ---------------- metaboxes ----------------
function toggleBox(h) {
  const box = h.closest('.postbox');
  box.classList.toggle('closed');
  const btn = $('.handlediv', box);
  if (btn) btn.setAttribute('aria-expanded', String(!box.classList.contains('closed')));
}

// ---------------- counters ----------------
function updateCounter(input) {
  const wrap = input.closest('.field');
  const c = wrap && $('.char-counter', wrap);
  if (!c) return;
  const n = chars(input.value);
  $('.n', c).textContent = n;
  c.classList.toggle('over', n > Number(c.dataset.max));
}

// ---------------- classic editor ----------------
function initEditor(wrap) {
  if (wrap.dataset.ready) return;
  wrap.dataset.ready = '1';
  const format = wrap.dataset.format;
  const area = $('.wp-editor-area', wrap);
  const visual = $('.wp-editor-visual', wrap);
  const pop = $('.ed-link-pop', wrap);
  const popInput = $('.ed-link-url', wrap);
  let savedRange = null;
  let linkMode = null;

  const toVisual = () => {
    visual.innerHTML = format === 'markdown' ? sanitizeHtml(markdownToHtml(area.value), MD_TAGS) : sanitizeHtml(area.value, PAGE_TAGS);
  };
  const fromVisual = () => {
    const raw = visual.innerHTML.replace(/<div\b[^>]*>/gi, '<p>').replace(/<\/div>/gi, '</p>').replace(/&nbsp;| /g, ' ');
    area.value = format === 'markdown' ? htmlToMarkdown(raw) : sanitizeHtml(raw, PAGE_TAGS).replace(/<p>\s*(<br>)?\s*<\/p>/g, '');
    area.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const mode = () => (wrap.classList.contains('tmce-active') ? 'visual' : 'text');
  const setMode = (m) => {
    if (m === 'visual' && wrap.dataset.visual === 'off') return;
    if (m === mode()) return;
    if (m === 'visual') toVisual();
    wrap.classList.toggle('tmce-active', m === 'visual');
    wrap.classList.toggle('html-active', m === 'text');
    pop.hidden = true;
  };
  if (mode() === 'visual') toVisual();
  // The textarea changes only after a real edit, so an untouched Markdown body stays byte-identical.
  visual.addEventListener('input', fromVisual);
  visual.addEventListener('paste', (e) => {
    // Paste as clean HTML: everything outside the allowed tags is dropped.
    const data = e.clipboardData;
    if (!data) return;
    e.preventDefault();
    const htmlData = data.getData('text/html');
    const clean = htmlData ? sanitizeHtml(htmlData.replace(/<div\b[^>]*>/gi, '<p>').replace(/<\/div>/gi, '</p>'), format === 'markdown' ? MD_TAGS : PAGE_TAGS)
      : data.getData('text/plain').split(/\n{2,}/).map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('');
    document.execCommand('insertHTML', false, clean);
    fromVisual();
  });
  $$('.wp-switch-editor', wrap).forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  const blockOf = () => {
    const sel = getSelection();
    let n = sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
    while (n && n !== visual) { if (n.nodeType === 1 && /^(H2|H3|BLOCKQUOTE|P)$/.test(n.nodeName)) return n.nodeName; n = n.parentNode; }
    return null;
  };
  const exec = (cmd, val = null) => { visual.focus(); document.execCommand(cmd, false, val); fromVisual(); };

  function wrapText(before, after = before, placeholder = '') {
    const s = area.selectionStart; const e2 = area.selectionEnd;
    const sel = area.value.slice(s, e2) || placeholder;
    area.setRangeText(before + sel + after, s, e2, 'select');
    area.focus();
    area.setSelectionRange(s + before.length, s + before.length + sel.length);
  }
  function prefixLines(prefixFn) {
    const v = area.value;
    const s = v.lastIndexOf('\n', area.selectionStart - 1) + 1;
    let e2 = v.indexOf('\n', area.selectionEnd); if (e2 === -1) e2 = v.length;
    const lines = v.slice(s, e2).split('\n').map((l, i) => prefixFn(l.replace(/^(#{1,6}\s|>\s?|[-*+]\s|\d+\.\s)/, ''), i));
    area.setRangeText(lines.join('\n'), s, e2, 'select');
    area.focus();
  }

  function openLink() {
    linkMode = mode();
    if (linkMode === 'visual') {
      const sel = getSelection();
      savedRange = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      let n = savedRange ? savedRange.startContainer : null;
      while (n && n !== visual && n.nodeName !== 'A') n = n.parentNode;
      popInput.value = n && n.nodeName === 'A' ? n.getAttribute('href') : '';
    } else popInput.value = '';
    pop.hidden = false;
    popInput.focus();
  }
  function applyLink() {
    const url = safeHref(popInput.value.trim());
    pop.hidden = true;
    if (!url) return;
    if (linkMode === 'visual') {
      visual.focus();
      if (savedRange) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(savedRange); }
      if (getSelection().isCollapsed) document.execCommand('insertHTML', false, `<a href="${url.replace(/"/g, '&quot;')}">${url.replace(/</g, '&lt;')}</a>`);
      else document.execCommand('createLink', false, url);
      fromVisual();
    } else if (format === 'markdown') wrapText('[', `](${url})`, 'Linktext');
    else wrapText(`<a href="${url.replace(/"/g, '&quot;')}">`, '</a>', 'Linktext');
  }
  $('.ed-link-apply', wrap).addEventListener('click', applyLink);
  popInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } if (e.key === 'Escape') pop.hidden = true; });
  $('.ed-link-remove', wrap).addEventListener('click', () => {
    pop.hidden = true;
    if (linkMode === 'visual') { visual.focus(); if (savedRange) { const s = getSelection(); s.removeAllRanges(); s.addRange(savedRange); } exec('unlink'); }
  });

  $$('.ed-btn', wrap).forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
  $$('.ed-btn', wrap).forEach((b) => b.addEventListener('click', () => {
    const cmd = b.dataset.cmd;
    if (cmd === 'link') return openLink();
    if (mode() === 'visual') {
      document.execCommand('defaultParagraphSeparator', false, 'p');
      const toggleBlock = (tag) => exec('formatBlock', blockOf() === tag.toUpperCase() ? '<p>' : `<${tag}>`);
      switch (cmd) {
        case 'bold': return exec('bold');
        case 'italic': return exec('italic');
        case 'ul': return exec('insertUnorderedList');
        case 'ol': return exec('insertOrderedList');
        case 'h2': return toggleBlock('h2');
        case 'h3': return toggleBlock('h3');
        case 'quote': return toggleBlock('blockquote');
        case 'p': return exec('formatBlock', '<p>');
      }
      return;
    }
    const md = format === 'markdown';
    switch (cmd) {
      case 'bold': return md ? wrapText('**') : wrapText('<strong>', '</strong>');
      case 'italic': return md ? wrapText('*') : wrapText('<em>', '</em>');
      case 'ul': return md ? prefixLines((l) => `- ${l}`) : wrapText('<ul>\n<li>', '</li>\n</ul>');
      case 'ol': return md ? prefixLines((l, i) => `${i + 1}. ${l}`) : wrapText('<ol>\n<li>', '</li>\n</ol>');
      case 'h2': return md ? prefixLines((l) => `## ${l}`) : wrapText('<h2>', '</h2>');
      case 'h3': return md ? prefixLines((l) => `### ${l}`) : wrapText('<h3>', '</h3>');
      case 'quote': return md ? prefixLines((l) => `> ${l}`) : null;
      case 'p': return md ? prefixLines((l) => l) : wrapText('<p>', '</p>');
    }
  }));
}

// ---------------- image fields + media modal ----------------
let modal = null;
let modalTarget = null;
let modalSelected = null;
let mediaCache = null;

async function loadMedia(force) {
  if (mediaCache && !force) return mediaCache;
  mediaCache = (await opts.api.get('media')).images || [];
  return mediaCache;
}

function renderModalGrid(filter = '') {
  const grid = $('.modal-grid', modal);
  const list = (mediaCache || []).filter((i) => i.path.toLowerCase().includes(filter.toLowerCase()));
  grid.replaceChildren(...list.map((im) => {
    const li = document.createElement('li');
    li.className = 'attachment' + (modalSelected && modalSelected.path === im.path ? ' selected' : '');
    li.tabIndex = 0;
    li.dataset.path = im.path;
    li.setAttribute('role', 'option');
    const img = document.createElement('img'); img.src = thumbUrl(im.path); img.alt = ''; img.loading = 'lazy';
    const name = document.createElement('span'); name.className = 'attachment-name'; name.textContent = im.path;
    li.append(img, name);
    return li;
  }));
  if (!list.length) { const li = document.createElement('li'); li.className = 'no-media'; li.textContent = opts.t('media.empty'); grid.append(li); }
}

function selectInModal(path) {
  modalSelected = (mediaCache || []).find((i) => i.path === path) || null;
  $$('.modal-grid .attachment', modal).forEach((li) => li.classList.toggle('selected', li.dataset.path === path));
  const side = $('.media-sidebar-inner', modal);
  $('.js-modal-choose', modal).disabled = !modalSelected;
  if (!modalSelected) { side.hidden = true; return; }
  side.hidden = false;
  $('.sidebar-thumb', side).src = thumbUrl(modalSelected.path);
  $('.sidebar-name', side).textContent = modalSelected.path;
  $('.sidebar-meta', side).textContent = `${Math.round(modalSelected.size / 1024)} KB${modalSelected.alt ? ' · Alt: ' + modalSelected.alt : ''}`;
}

function modalTab(tab) {
  $$('.media-menu-item', modal).forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('.media-tab-upload', modal).hidden = tab !== 'upload';
  $('.media-tab-library', modal).hidden = tab !== 'library';
}

async function openModal(field) {
  if (!modal) return;
  modalTarget = field;
  modal.hidden = false;
  document.body.classList.add('modal-open');
  modalTab('library');
  $('.modal-grid', modal).replaceChildren(Object.assign(document.createElement('li'), { className: 'no-media', textContent: opts.t('js.loading') }));
  await loadMedia(true);
  renderModalGrid($('.js-modal-filter', modal).value);
  selectInModal($('.js-image-value', field).value);
  $('.js-modal-filter', modal).focus();
}
function closeModal() {
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove('modal-open');
  const btn = modalTarget && $('.js-image-choose', modalTarget);
  modalTarget = null;
  btn?.focus();
}
function setImage(field, im) {
  $('.js-image-value', field).value = im ? im.path : '';
  const prev = $('.image-preview', field);
  prev.classList.toggle('empty', !im);
  prev.replaceChildren();
  if (im) { const img = document.createElement('img'); img.src = thumbUrl(im.path); img.alt = ''; prev.append(img); }
  else { const s = document.createElement('span'); s.textContent = opts.t('edit.image.none'); prev.append(s); }
  $('.image-file', field).textContent = im ? im.path : '';
  $('.js-image-choose', field).textContent = opts.t(im ? 'edit.image.replace' : 'edit.image.choose');
  $('.js-image-remove', field).hidden = !im;
  $('.image-actions .sep', field).hidden = !im;
  const alt = $('.js-image-alt', field);
  if (alt) {
    $('.image-alt', field).hidden = !im;
    if (!im) alt.value = ''; // no image = value "" and alt ""
    else if (!alt.value.trim() && im.alt) alt.value = im.alt;
  }
}

function initModal(el) {
  modal = el;
  modalTarget = null;
  modalSelected = null;
  mediaCache = null;
  document.body.classList.remove('modal-open');
  if (!modal) return;
  modal.addEventListener('click', (e) => {
    if (e.target.closest('.js-modal-close')) return closeModal();
    const tab = e.target.closest('.media-menu-item'); if (tab) return modalTab(tab.dataset.tab);
    const li = e.target.closest('.modal-grid .attachment'); if (li) return selectInModal(li.dataset.path);
    if (e.target.closest('.js-modal-choose') && modalSelected && modalTarget) { setImage(modalTarget, modalSelected); closeModal(); }
  });
  modal.addEventListener('dblclick', (e) => {
    const li = e.target.closest('.modal-grid .attachment');
    if (li && modalTarget) { selectInModal(li.dataset.path); setImage(modalTarget, modalSelected); closeModal(); }
  });
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    const li = e.target.closest?.('.modal-grid .attachment');
    if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectInModal(li.dataset.path); }
  });
  $('.js-modal-filter', modal).addEventListener('input', (e) => renderModalGrid(e.target.value));
}

// ---------------- repeatable lists ----------------
function refreshList(list) {
  const items = $$(':scope > .list-items > .list-item', list);
  const min = Number(list.dataset.min || 0); const max = Number(list.dataset.max || 999);
  items.forEach((li, i) => {
    const n = $('.list-num', li); if (n) n.textContent = i + 1;
    $('.js-item-remove', li).disabled = items.length <= min;
    $('.js-item-up', li).disabled = i === 0;
    $('.js-item-down', li).disabled = i === items.length - 1;
  });
  const add = $(':scope > .list-footer .js-item-add', list);
  if (add) add.disabled = items.length >= max;
}
function initList(list) {
  if (list.dataset.ready) return;
  list.dataset.ready = '1';
  const ol = $(':scope > .list-items', list);
  $$(':scope > .list-item', ol).forEach((li) => { li.draggable = false; });
  list.addEventListener('click', (e) => {
    const li = e.target.closest('.list-item');
    if (e.target.closest('.js-item-add') && e.target.closest('[data-list]') === list) {
      const key = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const tpl = $(':scope > .list-template', list);
      const holder = document.createElement('div');
      holder.innerHTML = tpl.innerHTML.split('__KEY__').join(key);
      const item = holder.firstElementChild;
      item.draggable = false;
      ol.append(item);
      $$('.wp-editor-wrap', item).forEach(initEditor);
      $$('[data-list]', item).forEach(initList);
      refreshList(list);
      item.querySelector('input, textarea, [contenteditable]')?.focus();
      return;
    }
    if (!li || li.closest('[data-list]') !== list) return;
    if (e.target.closest('.js-item-remove')) { li.remove(); refreshList(list); }
    else if (e.target.closest('.js-item-up') && li.previousElementSibling) { ol.insertBefore(li, li.previousElementSibling); refreshList(list); e.target.focus(); }
    else if (e.target.closest('.js-item-down') && li.nextElementSibling) { ol.insertBefore(li.nextElementSibling, li); refreshList(list); e.target.focus(); }
  });
  // Drag & drop: only from the handle.
  let dragged = null;
  ol.addEventListener('mousedown', (e) => { const h = e.target.closest('.list-handle'); if (h) h.closest('.list-item').draggable = true; });
  ol.addEventListener('dragstart', (e) => {
    const li = e.target.closest('.list-item');
    if (!li || li.parentElement !== ol || !li.draggable) return;
    dragged = li; li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', li.dataset.key || '');
  });
  ol.addEventListener('dragover', (e) => {
    if (!dragged) return;
    e.preventDefault();
    const over = e.target.closest('.list-item');
    $$(':scope > .drop-before', ol).forEach((x) => x.classList.remove('drop-before'));
    if (over && over.parentElement === ol && over !== dragged) over.classList.add('drop-before');
  });
  ol.addEventListener('drop', (e) => {
    if (!dragged) return;
    e.preventDefault();
    const over = e.target.closest('.list-item');
    if (over && over.parentElement === ol && over !== dragged) {
      const r = over.getBoundingClientRect();
      ol.insertBefore(dragged, e.clientY > r.top + r.height / 2 ? over.nextElementSibling : over);
    }
  });
  ol.addEventListener('dragend', () => {
    if (dragged) { dragged.classList.remove('dragging'); dragged.draggable = false; }
    $$(':scope > .drop-before', ol).forEach((x) => x.classList.remove('drop-before'));
    dragged = null; refreshList(list);
  });
  refreshList(list);
}

// ---------------- uploads ----------------
function initUploader(up) {
  const area = $('.drag-drop-area', up);
  const input = $('.js-upload-input', up);
  const progress = $('.upload-progress', up);
  const inModal = !!up.closest('#media-modal');
  const send = async (files) => {
    const results = [];
    for (const file of files) {
      const li = document.createElement('li'); li.textContent = `${file.name} — ${opts.t('js.uploading')}`; progress.append(li);
      const fd = new FormData(); fd.append('file', file, file.name);
      try {
        const j = await opts.api.upload(fd, inModal);
        if (j.files?.length) { li.className = 'done'; li.textContent = `${file.name} — ${opts.t('js.uploaded')}: ${j.files[0].path}`; results.push(...j.files); }
        else { li.className = 'error'; li.textContent = `${file.name} — ${opts.t.msg(j.errors?.[0]?.msg || j.message || j.error || '')}`; }
      } catch (err) { li.className = 'error'; li.textContent = `${file.name} — ${err.message}`; }
    }
    return results;
  };
  const handle = async (files) => {
    const done = await send([...files]);
    if (!done.length) return;
    if (inModal) {
      await loadMedia(true);
      modalTab('library');
      renderModalGrid('');
      selectInModal(done[done.length - 1].path);
    } else if (done.length === 1) opts.go(`#/upload.php?item=${encodeURIComponent(done[0].path)}&message=uploaded`);
    else opts.go('#/upload.php?message=uploaded');
  };
  input.addEventListener('change', () => { if (input.files.length) handle(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => area.addEventListener(ev, (e) => { e.preventDefault(); area.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach((ev) => area.addEventListener(ev, (e) => { e.preventDefault(); area.classList.remove('drag-over'); }));
  area.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) handle(e.dataTransfer.files); });
}

// ---------------- status polling ----------------
function setBar(state) {
  const el = $('#ab-status');
  if (!el) return;
  el.className = `ab-status state-${state}`;
  $('.ab-status-text', el).textContent = opts.t(`bar.status.${state}`);
}

function finishJob(el, j) {
  const failed = j.state === 'failed';
  const done = j.state === 'done';
  el.className = `notice notice-${failed ? 'error' : done ? 'success' : 'warning'}`;
  $('.notice-text', el).textContent = opts.t(failed ? (j.phase === 'deploy' ? 'notice.deployfailed' : 'notice.buildfailed') : done ? 'notice.updated' : 'notice.cancelled');
  if (j.url && failed) {
    const p = document.createElement('p');
    const a = document.createElement('a');
    a.href = j.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = opts.t('notice.details');
    p.append(a); el.append(p);
  }
}

async function pollJob(el, g, n = 0) {
  if (g !== generation || n > POLL_MAX) return;
  try {
    const j = await opts.api.get('status', { commit: el.dataset.job });
    if (g !== generation) return;
    if (j.state === 'queued' || j.state === 'running') setBar(j.state);
    else {
      finishJob(el, j);
      setBar(j.state === 'failed' ? 'failed' : 'idle');
      opts.statusChanged?.();
      return;
    }
  } catch { /* GitHub or the network hiccup: the next round tries again */ }
  setTimeout(() => pollJob(el, g, n + 1), POLL_MS);
}

async function pollBar(g, n = 0) {
  if (g !== generation || n > POLL_MAX) return;
  try {
    const { latest } = await opts.api.get('status');
    if (g !== generation) return;
    const state = latest ? latest.state : 'idle';
    if (state !== 'queued' && state !== 'running') {
      setBar(state === 'failed' ? 'failed' : 'idle');
      opts.statusChanged?.();
      return;
    }
    setBar(state);
  } catch { /* as above */ }
  setTimeout(() => pollBar(g, n + 1), POLL_MS);
}

// ---------------- misc ----------------
function initSlug(root) {
  const src = $('.js-slug-source', root); const slug = $('.js-slug', root);
  if (!src || !slug) return;
  let touched = !!slug.value;
  slug.addEventListener('input', () => { touched = true; });
  src.addEventListener('input', () => { if (!touched) slug.value = slugify(src.value); });
}

let installed = false;
function installOnce() {
  if (installed) return;
  installed = true;
  document.addEventListener('click', (e) => {
    const h = e.target.closest('.handlediv, .postbox-header .hndle');
    if (h) { toggleBox(h); return; }
    const choose = e.target.closest('.js-image-choose');
    if (choose) { e.preventDefault(); openModal(choose.closest('[data-image-field]')); return; }
    const remove = e.target.closest('.js-image-remove');
    if (remove) { e.preventDefault(); setImage(remove.closest('[data-image-field]'), null); return; }
    const toggle = e.target.closest('.js-toggle-uploader');
    if (toggle) { e.preventDefault(); const u = $('.media-uploader-inline'); u.hidden = !u.hidden; return; }
    const skip = e.target.closest('.js-skip');
    if (skip) { e.preventDefault(); $('#wpbody-content')?.focus(); }
  });
  document.addEventListener('input', (e) => {
    if (e.target.matches('.js-count')) updateCounter(e.target);
    if (e.target.matches('.js-media-filter')) {
      const q = e.target.value.toLowerCase();
      $$('.media-grid .attachment').forEach((li) => { li.hidden = !li.dataset.path.toLowerCase().includes(q); });
    }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { const f = $('.js-edit-form'); if (f) { e.preventDefault(); f.requestSubmit(); } }
  });
}

export function mount(root, options) {
  opts = options;
  const g = ++generation;
  installOnce();
  initModal($('#media-modal', root));
  $$('.wp-editor-wrap', root).forEach(initEditor);
  $$('[data-list]', root).forEach(initList);
  $$('[data-uploader]', root).forEach(initUploader);
  const jobs = $$('.js-job', root);
  jobs.forEach((el) => pollJob(el, g));
  if (!jobs.length && /state-(queued|running)/.test($('#ab-status', root)?.className || '')) pollBar(g);
  initSlug(root);
}
