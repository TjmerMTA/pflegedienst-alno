// Сайт под настоящими заголовками из dist/.htaccess: ни одного нарушения CSP на страницах, в формах,
// Рехнере, карте и баннере согласия. Запуск: npm run test:browser
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { launch } from './chrome.mjs';
import { build, copySite, htaccessHeaders, pagesOf, serve, walkForms, walkRechner } from './site.mjs';

let chrome;
const copies = [];
before(async () => { chrome = await launch(); });
after(async () => {
  await chrome?.close();
  copies.forEach((c) => rmSync(c, { recursive: true, force: true }));
});

function buildSite(env) {
  const root = copySite();
  copies.push(root);
  return build(root, env);
}

const violations = (page) => page.problems.filter((p) => !/Failed to load resource/.test(p));

// Заполняет форму так, чтобы она ушла на сервер: отправка идёт через fetch, ответ — от тестового сервера
const SEND_FORM = `(async () => {
  const form = document.querySelector('[data-lead-form]');
  for (const el of form.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([name=website])')) {
    el.value = el.type === 'email' ? 'test@example.de' : el.type === 'tel' ? '0231 123456' : el.type === 'date' ? '2030-01-02' : 'Max Muster';
  }
  form.querySelectorAll('select').forEach((s) => { if (s.options.length > 1) s.selectedIndex = 1; });
  form.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = true; });
  await new Promise((r) => setTimeout(r, 3100));
  form.requestSubmit();
  await new Promise((r) => setTimeout(r, 300));
  return form.querySelector('.form-status').className;
})()`;

async function walkSite(dist, withGa) {
  const headers = htaccessHeaders(dist);
  const site = await serve(dist, headers);
  const page = await chrome.newPage();
  const failed = [];
  try {
    for (const path of pagesOf(dist)) {
      await page.open(`${site.url}${path}`);
      const broken = await page.evaluate(`[...document.images].filter((i) => i.complete && !i.naturalWidth && !i.loading).map((i) => i.src)`);
      if (broken.length) failed.push(`${path}: картинки ${broken.join(' ')}`);
      const css = await page.evaluate(`getComputedStyle(document.body).fontFamily`);
      if (!/Figtree/i.test(css)) failed.push(`${path}: стили не применились (${css})`);
      await walkForms(page, site.url, path);
    }
    await walkRechner(page, site.url);
    const row = await page.evaluate(`getComputedStyle(document.querySelector('.tab')).display`);
    assert.notEqual(row, 'inline', 'стили Рехнера на месте');
    await page.open(`${site.url}/kontakt/`);
    await page.click('[data-map] button');
    assert.ok(await page.evaluate(`!!document.querySelector('[data-map] iframe')`), 'карта вставлена');
    await page.open(`${site.url}/kontakt/`);
    assert.match(await page.evaluate(SEND_FORM), /\bok\b/, 'форма ушла и получила ответ');
    if (withGa) {
      await page.evaluate(`localStorage.clear()`);
      await page.open(`${site.url}/`);
      assert.equal(await page.evaluate(`document.getElementById('consent').hidden`), false, 'баннер согласия показан');
      await page.click('[data-consent="yes"]');
      assert.ok(await page.evaluate(`!!document.querySelector('script[src*="googletagmanager"]')`), 'GA подключён');
      // Куда ходит gtag.js: по этим адресам CSP не должна мешать, ответ сервера здесь не важен
      await page.evaluate(`Promise.allSettled(['https://www.google-analytics.com/g/collect', 'https://region1.google-analytics.com/g/collect', 'https://region1.analytics.google.com/g/collect'].map((u) => fetch(u, { mode: 'no-cors' })))`);
      await page.evaluate(`new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = 'https://www.google-analytics.com/g/collect?v=2'; })`);
    }
    return { failed, problems: violations(page), headers };
  } finally {
    await page.close();
    await site.close();
  }
}

test('без GA: все страницы и сценарии работают под CSP', async () => {
  const { failed, problems, headers } = await walkSite(buildSite({ PUBLIC_FORM_ENDPOINT: '/api/anfrage.php' }), false);
  assert.deepEqual(failed, []);
  assert.deepEqual(problems, []);
  const csp = headers['Content-Security-Policy'];
  assert.match(csp, /^default-src 'none'; script-src 'self' 'sha256-/);
  assert.doesNotMatch(csp, /unsafe-eval|__CSP__|googletagmanager/);
  assert.doesNotMatch(/script-src[^;]*/.exec(csp)[0], /unsafe-inline/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /form-action 'self'/);
});

test('с GA: баннер, загрузка gtag и адреса аналитики разрешены', async () => {
  const { failed, problems, headers } = await walkSite(buildSite({ PUBLIC_GA_ID: 'G-TEST', PUBLIC_FORM_ENDPOINT: '/api/anfrage.php' }), true);
  assert.deepEqual(failed, []);
  assert.deepEqual(problems, []);
  assert.match(headers['Content-Security-Policy'], /script-src [^;]*https:\/\/www\.googletagmanager\.com/);
});

test('проверка видит нарушение: страница с чужим инлайновым скриптом', async () => {
  const dist = buildSite({});
  const site = await serve(dist, { 'Content-Security-Policy': htaccessHeaders(dist)['Content-Security-Policy'] });
  const page = await chrome.newPage();
  try {
    await page.open(`${site.url}/`);
    await page.evaluate(`(() => { const s = document.createElement('script'); s.textContent = 'window.__ran = 1'; document.body.append(s); })()`);
    assert.equal(await page.evaluate(`window.__ran`), undefined, 'CSP не дала выполниться');
    assert.ok(violations(page).length > 0, 'нарушение попало в список');
  } finally {
    await page.close();
    await site.close();
  }
});
