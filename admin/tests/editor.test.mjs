// The classic editor in real Chrome: the clipboard, the focus and the modal exist nowhere else.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch } from '../../test/browser/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const IMG = '../../assets/img/team.jpg';
const chromeThere = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].some((p) => p && fs.existsSync(p));
const skip = spawnSync('php', ['-v']).error ? 'php is missing' : chromeThere ? false : 'Chrome is missing: set CHROME_PATH';

let tmp; let server; let chrome; let page; let base;

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const until = async (expr, what = expr) => {
  for (let i = 0; i < 200; i++) {
    if (await page.evaluate(expr)) return;
    await new Promise((r) => { setTimeout(r, 25); });
  }
  assert.fail(`never true: ${what}`);
};
const key = async (name, code, commands = []) => {
  await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: name === 'Escape' ? 27 : 0, commands });
  await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code });
};
const openPost = async (id, body) => {
  // Every test leaves its body unsaved, and the warning about that would block the page.
  await page.evaluate(`window.confirm = () => true; location.hash = '#/edit.php?post_type=post'`);
  await until(`!document.querySelector('.wp-editor-area')`);
  await page.evaluate(`location.hash = '#/post.php?post_type=post&post=${id}'`);
  await until(`document.querySelector('.wp-editor-wrap .wp-editor-area')`);
  await page.evaluate(`(() => {
    const wrap = document.querySelector('.wp-editor-wrap');
    wrap.querySelector('[data-mode=text]').click();
    const area = wrap.querySelector('.wp-editor-area');
    area.value = ${JSON.stringify(body)};
    area.dispatchEvent(new Event('input', { bubbles: true }));
    area.dispatchEvent(new Event('change', { bubbles: true }));
    wrap.querySelector('[data-mode=visual]').click();
  })()`);
  await until(`document.querySelector('.wp-editor-wrap.tmce-active')`);
};
// Chrome's own editing commands try inline styles, which the admin's CSP refuses; that is not an error of ours.
const errors = () => page.problems.filter((p) => p.startsWith('exception'));
const text = () => page.evaluate(`document.querySelector('.wp-editor-area').value`);
const images = () => page.evaluate(`document.querySelectorAll('.wp-editor-visual img').length`);
const selectParagraph = (n) => page.evaluate(`(() => {
  const r = document.createRange();
  r.selectNode(document.querySelectorAll('.wp-editor-visual p')[${n}]);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  document.querySelector('.wp-editor-visual').focus();
})()`);
const cursorAtEnd = () => page.evaluate(`(() => {
  const v = document.querySelector('.wp-editor-visual');
  v.focus();
  const r = document.createRange(); r.selectNodeContents(v.lastElementChild); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
})()`);

before(async () => {
  if (skip) return;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alno-editor-'));
  const port = await freePort();
  base = `http://127.0.0.1:${port}/wp-admin/`;
  server = spawn('php', [path.join(here, 'dev.php'), '--fresh', `--port=${port}`], { env: { ...process.env, TMPDIR: tmp }, stdio: 'ignore', detached: true });
  for (let i = 0; i < 200; i++) {
    if (await fetch(base).then(() => true, () => false)) break;
    await new Promise((r) => { setTimeout(r, 50); });
  }
  chrome = await launch();
  page = await chrome.newPage();
  await page.open(base);
  await until(`document.querySelector('#user_login')`);
  await page.evaluate(`(() => {
    document.querySelector('#user_login').value = 'admin';
    document.querySelector('#user_pass').value = 'dev-passwort-123';
    document.querySelector('#user_pass').form.requestSubmit();
  })()`);
  await until(`document.querySelector('#wpbody-content')`);
});

after(async () => {
  await chrome?.close();
  if (server) { try { process.kill(-server.pid); } catch { /* gone */ } }
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test('cut and paste in Visuell keeps an image to the byte', { skip }, async () => {
  const md = `![Team & "Co"](${IMG})`;
  await openPost('erster-beitrag', `Erster Absatz.\n\nMit ${md} Bild.\n\nLetzter Absatz.`);
  assert.equal(await images(), 1);
  await selectParagraph(1);
  await key('x', 'KeyX', ['cut']);
  await until(`!document.querySelector('.wp-editor-visual img')`, 'the cut takes the image');
  await cursorAtEnd();
  await key('v', 'KeyV', ['paste']);
  await until(`document.querySelector('.wp-editor-visual img')`, 'the paste brings the image back');
  assert.ok((await text()).includes(md), await text());
  assert.match(await page.evaluate(`document.querySelector('.wp-editor-visual img').getAttribute('src') || ''`), /team\.jpg/);
  assert.deepEqual(errors(), []);
});

test('copy and paste in Visuell doubles an image', { skip }, async () => {
  const md = `![Bild](${IMG})`;
  await openPost('zweiter-beitrag', `Erster Absatz.\n\nMit ${md} Bild.\n\nLetzter Absatz.`);
  await selectParagraph(1);
  await key('c', 'KeyC', ['copy']);
  await cursorAtEnd();
  await key('v', 'KeyV', ['paste']);
  await until(`document.querySelectorAll('.wp-editor-visual img').length === 2`, 'the copy arrives with its image');
  assert.equal((await text()).split(md).length, 3);
});

test('the insert window opens clean, takes the focus and closes with Escape', { skip }, async () => {
  await openPost('erster-beitrag', 'Ein Absatz.');
  const open = async () => {
    await page.click('.js-add-media');
    await until(`document.activeElement?.matches('.js-modal-filter')`, 'focus in the window');
  };
  await open();
  assert.deepEqual(errors(), []);
  assert.equal(await page.evaluate(`document.querySelector('.js-modal-choose').disabled`), true);
  await key('Escape', 'Escape');
  await until(`document.querySelector('#media-modal').hidden`, 'Escape closes the window');
  assert.equal(await page.evaluate(`document.activeElement?.matches('.js-add-media')`), true);

  await open();
  await page.evaluate(`document.querySelector('.modal-grid .attachment').click()`);
  await page.evaluate(`document.querySelector('.js-modal-alt').value = 'Ein Bild'`);
  await key('Escape', 'Escape');
  await open();
  assert.equal(await page.evaluate(`document.querySelector('.js-modal-choose').disabled`), true);
  assert.equal(await page.evaluate(`document.querySelector('.media-sidebar-inner').hidden`), true);
  await key('Escape', 'Escape');
});

test('an alt that leaves nothing in the Markdown is refused', { skip }, async () => {
  await openPost('erster-beitrag', 'Ein Absatz.');
  await page.click('.js-add-media');
  await until(`document.querySelector('.modal-grid .attachment')`);
  await page.evaluate(`document.querySelector('.modal-grid .attachment').click()`);
  await page.evaluate(`document.querySelector('.js-modal-alt').value = '[\`]'`);
  await page.click('.js-modal-choose');
  assert.equal(await page.evaluate(`document.querySelector('#media-modal').hidden`), false);
  assert.equal(await page.evaluate(`document.querySelector('.js-modal-alt-error').hidden`), false);
  assert.equal(await images(), 0);
  await key('Escape', 'Escape');
});

test('in the Text tab an image before a line leaves the line as it was', { skip }, async () => {
  await openPost('erster-beitrag', '## Titel\n\nText');
  await page.evaluate(`(() => {
    document.querySelector('.wp-editor-wrap [data-mode=text]').click();
    document.querySelector('.wp-editor-area').setSelectionRange(0, 0);
  })()`);
  await page.click('.js-add-media');
  await until(`document.querySelector('.modal-grid .attachment')`);
  await page.evaluate(`document.querySelector('.modal-grid .attachment').click()`);
  await page.evaluate(`document.querySelector('.js-modal-alt').value = 'Bild'`);
  await page.click('.js-modal-choose');
  await until(`document.querySelector('#media-modal').hidden`);
  assert.match(await text(), /^!\[Bild\]\(\S+\)\n\n## Titel\n\nText$/);
  assert.equal(await page.evaluate(`document.activeElement?.matches('.wp-editor-area')`), true, 'the cursor stays in the editor');
});

test('a no-break space in an alt survives an edit in Visuell', { skip }, async () => {
  const md = `![Alt Text](${IMG})`;
  await openPost('erster-beitrag', `${md}\n\nAbsatz.`);
  await cursorAtEnd();
  await page.evaluate(`document.execCommand('insertText', false, ' mehr')`);
  await until(`document.querySelector('.wp-editor-area').value.includes('mehr')`);
  assert.ok((await text()).includes(md), await text());
});
