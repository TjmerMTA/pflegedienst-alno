// Кавычки и скобки в каждом текстовом поле, Markdown и frontmatter — проверка собранных страниц в Chrome.
// CSP здесь нет намеренно: иначе она спрятала бы ошибку экранирования, проверяется само экранирование.
// Запуск: npm run test:browser
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { launch } from './chrome.mjs';
import { build, copySite, pagesOf, serve, walkForms, walkRechner } from './site.mjs';

// Вырывается из "…", '…', из разметки, из <script> и из шаблонной строки JS; {constructor} — имя плейсхолдера
const MARKUP = `Mo" onmouseover="window.__xss=1" data-xss="1' onfocus='window.__xss=1' data-xss='1<img src=x data-xss onerror=window.__xss=1></script><svg data-xss onload=window.__xss=1>\`\${window.__xss=1}{constructor}`;
const URL_VALUE = 'javascript:window.__xss=1';
// В описаниях коллекций предел 170 знаков
const SHORT = `Mo" onmouseover="window.__xss=1" data-xss="1<img src=x data-xss onerror=window.__xss=1></script>`;
const MARKDOWN = `

Text <img src=x data-xss onerror=window.__xss=1> ende

<script>window.__xss=1</script>

[a](javascript:window.__xss=1) [b][r] [c](jav&#x61;script:window.__xss=1) <javascript:window.__xss=1>

[r]: JaVaScRiPt:window.__xss=1
`;

// Признаки, а не тексты: от них зависит ход расчёта (подпись, цена и код — обычные поля)
const FLAGS = new Set(['type', 'once']);

function poisonField(f, value) {
  if (['text', 'textarea', 'richtext'].includes(f.type)) f.value = value;
  if (f.type === 'image' && f.value) f.alt = value;
  if (f.type === 'list') {
    for (const item of f.value) {
      for (const s of f.fields) {
        if (FLAGS.has(s.id)) continue;
        if (['text', 'textarea', 'richtext'].includes(s.type)) item[s.id] = value;
        if (s.type === 'image' && item[s.id]?.value) item[s.id].alt = value;
      }
    }
  }
}

// only: только эти группы _global.json. Остальные тексты целы, значит, токены {{…}} в них подставятся
function poison(root, value, only) {
  let fields = 0;
  const dir = join(root, 'src/content/pages');
  for (const name of readdirSync(dir)) {
    const data = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    for (const g of data.groups) {
      if (only && !(name === '_global.json' && only.includes(g.id))) continue;
      for (const f of g.fields) { poisonField(f, value); fields++; }
    }
    writeFileSync(join(dir, name), JSON.stringify(data));
  }
  if (only) return fields;
  for (const collection of ['blog', 'leistungen', 'team']) {
    const base = join(root, 'src/content', collection);
    for (const name of readdirSync(base)) {
      const file = join(base, name);
      const text = readFileSync(file, 'utf8');
      const [, front, body] = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
      const yaml = JSON.stringify(value.length > 170 ? SHORT : value);
      const next = front
        .replace(/^(title|metaTitle|description|teaser|payer|author|imageAlt|name|role):.*$/gm, `$1: ${yaml}`)
        .replace(/^(\s+- ).*$/gm, `$1${yaml}`);
      writeFileSync(file, `---\n${next}\n---\n${body}${MARKDOWN}`);
    }
  }
  return fields;
}

// Что считается вторжением: любой on-атрибут, признак из значения, вставленные элементы, опасная ссылка
const DETECT = `(() => {
  const found = [];
  for (const el of document.querySelectorAll('*')) {
    for (const a of el.attributes) {
      if (/^on/i.test(a.name)) found.push(el.tagName + ' ' + a.name);
      if (a.name === 'data-xss') found.push(el.tagName + ' data-xss');
    }
    const url = el.getAttribute('href') ?? el.getAttribute('src') ?? '';
    if (/^[\\u0000-\\u0020]*(javascript|vbscript|data:text)/i.test(url)) found.push(el.tagName + ' ' + url.slice(0, 40));
    if (el.tagName === 'IMG' && el.getAttribute('src') === 'x') found.push('img src=x');
  }
  if (window.__xss) found.push('window.__xss');
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { JSON.parse(s.textContent); } catch { found.push('JSON-LD не разбирается'); }
  }
  return found;
})()`;

let chrome;
const copies = [];
before(async () => { chrome = await launch(); });
after(async () => {
  await chrome?.close();
  copies.forEach((c) => rmSync(c, { recursive: true, force: true }));
});

async function check(value, { literal, only }) {
  const root = copySite();
  copies.push(root);
  const fields = poison(root, value, only);
  assert.ok(only || fields > 300, `полей заполнено мало: ${fields}`);
  const dist = build(root, { PUBLIC_GA_ID: 'G-TEST', PUBLIC_FORM_ENDPOINT: '/api/anfrage.php' });
  const site = await serve(dist);
  const page = await chrome.newPage();
  const bad = [];
  const look = async (label) => { for (const f of await page.evaluate(DETECT)) bad.push(`${label}: ${f}`); };
  try {
    const pages = pagesOf(dist);
    assert.ok(pages.length >= 22, `страниц мало: ${pages.length}`);
    for (const path of pages) {
      await page.open(`${site.url}${path}`);
      await look(path);
      // Значение обязано дойти до страницы текстом: иначе проверка ничего не проверяет
      const shown = await page.evaluate(`document.body.textContent.includes(${JSON.stringify(literal)})`);
      if (!shown && !only) bad.push(`${path}: значение не дошло до страницы`);
      await walkForms(page, site.url, path);
      await look(`${path} (формы)`);
    }
    await walkRechner(page, site.url, (name) => look(`Рехнер, ${name}`));
    await page.open(`${site.url}/kontakt/`);
    await page.click('[data-map] button');
    await look('карта');
    return { bad, problems: page.problems.filter((p) => !/Failed to load resource/.test(p)), page, site };
  } catch (e) {
    await page.close();
    await site.close();
    throw e;
  }
}

test('детектор срабатывает на вторжении', async () => {
  const page = await chrome.newPage();
  await page.open(`data:text/html,<a href="JavaScript:x">a</a><p data-xss onclick="x"></p><img src=x>`);
  const found = await page.evaluate(DETECT);
  await page.close();
  assert.equal(found.length, 4, found.join(', '));
});

test('кавычки и скобки в каждом поле не меняют разметку', async () => {
  const { bad, problems, page, site } = await check(MARKUP, { literal: 'onmouseover="window.__xss=1"' });
  try {
    assert.deepEqual(bad, []);
    assert.deepEqual(problems, []);
    await walkRechner(page, site.url);
    const rechner = await page.evaluate(`({
      cells: document.querySelectorAll('.cell').length,
      label: document.querySelector('.pitem .del')?.getAttribute('aria-label'),
      sub: document.querySelector('#res-sub').textContent,
    })`);
    assert.ok(rechner.label?.includes('onmouseover="'), 'подпись кнопки плана: значение цело, кавычки на месте');
    assert.ok(rechner.sub.includes('onmouseover="') && !rechner.sub.includes('&quot;'), 'textContent: без двойного экранирования');
    await page.click('.tab[data-tab="plan"]');
    await page.click('#back2');
    await page.click('.svc');
    const grid = await page.evaluate(`({ cells: document.querySelectorAll('.cell').length, aria: document.querySelector('.cell')?.getAttribute('aria-label') })`);
    assert.equal(grid.cells, 28, 'сетка 7 × 4 цела: кавычка не разорвала кнопки');
    assert.ok(grid.aria.includes('onmouseover="window.__xss=1"'), 'aria-label держит значение целиком');
    await page.open(`${site.url}/kontakt/`);
    await page.click('[data-map] button');
    const frame = await page.evaluate(`({ n: document.querySelectorAll('[data-map] iframe').length, title: document.querySelector('[data-map] iframe')?.title, loading: document.querySelector('[data-map] iframe')?.loading })`);
    assert.equal(frame.n, 1);
    assert.equal(frame.loading, 'lazy');
    assert.ok(frame.title.includes('onmouseover="window.__xss=1"'), 'подпись карты дошла целиком');
  } finally {
    await page.close();
    await site.close();
  }
});

test('javascript: в каждом поле не становится ссылкой', async () => {
  const { bad, problems, page, site } = await check(URL_VALUE, { literal: URL_VALUE });
  try {
    assert.deepEqual(bad, []);
    assert.deepEqual(problems, []);
  } finally {
    await page.close();
    await site.close();
  }
});

test('значения контактов через токены {{…}} не меняют разметку', async () => {
  const { bad, problems, page, site } = await check(MARKUP, { literal: 'onmouseover="window.__xss=1"', only: ['contact'] });
  try {
    assert.deepEqual(bad, []);
    assert.deepEqual(problems, []);
    await page.open(`${site.url}/impressum/`);
    assert.ok(await page.evaluate(`document.body.textContent.includes('onmouseover="window.__xss=1"')`), 'токен подставился');
  } finally {
    await page.close();
    await site.close();
  }
});
