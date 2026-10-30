// Картинки: поле image и image внутри элемента list. Запускает настоящий src/lib/content.ts через Vite на временной
// копии со своими JSON и картинкой — контент сайта не трогает. Vite без плагинов Astro отдаёт
// вместо ImageMetadata адрес файла, поэтому src здесь строка. Запуск: npm test
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

const photo = (fields = {}) => ({ id: 'photo', label: 'Foto', type: 'image', ...fields });
const list = (id, value, sub = photo()) => ({ id, label: id, type: 'list', fields: [{ id: 'title', label: 'Titel', type: 'text' }, sub], value });
const lists = [
  list('ok', [{ title: 'Eins', photo: { value: 'a.jpg', alt: 'Foto in der {{street}}' } }]),
  list('empty', [{ title: 'Ohne Foto', photo: { value: '', alt: '' } }, { title: 'Ohne Schlüssel' }]),
  list('emptyRequired', [{ photo: { value: '', alt: '' } }], photo({ required: true })),
  list('noFile', [{ photo: { value: 'fehlt.jpg', alt: 'Foto' } }]),
  list('noAlt', [{ photo: { value: 'a.jpg', alt: '  ' } }]),
  list('plainString', [{ photo: 'a.jpg' }]),
];
const image = (id, value, alt, fields = {}) => ({ id, label: id, type: 'image', value, alt, ...fields });
const images = [
  image('ok', 'a.jpg', 'Foto in der {{street}}'),
  image('empty', '', ''),
  image('emptyRequired', '', '', { required: true }),
  image('noFile', 'fehlt.jpg', 'Foto'),
  image('noAlt', 'a.jpg', '  '),
  { id: 'altKeyMissing', label: 'altKeyMissing', type: 'image', value: 'a.jpg' },
];
const page = (label, groups) => JSON.stringify({ label, url: null, order: 0, groups });

let root, server, p;

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'content-test-'));
  mkdirSync(join(root, 'src/content/pages'), { recursive: true });
  mkdirSync(join(root, 'src/assets/img'), { recursive: true });
  cpSync('src/lib', join(root, 'src/lib'), { recursive: true });
  writeFileSync(join(root, 'src/assets/img/a.jpg'), 'jpg');
  writeFileSync(join(root, 'src/content/pages/_global.json'), page('Allgemein', [
    { id: 'contact', label: 'Kontakt', fields: [{ id: 'street', label: 'Straße', type: 'text', value: 'Teststraße 1' }] },
  ]));
  writeFileSync(join(root, 'src/content/pages/liste.json'), page('Liste', [{ id: 'team', label: 'Team', fields: lists }, { id: 'img', label: 'Bilder', fields: images }]));
  server = await createServer({
    root, configFile: false, logLevel: 'silent', appType: 'custom',
    server: { middlewareMode: true, watch: null, ws: false }, optimizeDeps: { noDiscovery: true },
  });
  p = (await server.ssrLoadModule('/src/lib/content.ts')).getPage('liste');
});

after(async () => {
  await server?.close();
  rmSync(root, { recursive: true, force: true });
});

test('image sub-field comes back as { src, alt }, alt with tokens replaced', () => {
  const [item] = p.list('team.ok');
  assert.equal(item.title, 'Eins');
  assert.deepEqual(item.photo, { src: '/src/assets/img/a.jpg', alt: 'Foto in der Teststraße 1' });
});

test('empty optional image is null, both with empty keys and without the key', () => {
  assert.deepEqual(p.list('team.empty').map((i) => i.photo), [null, null]);
});

test('empty required image fails the build', () => {
  assert.throws(() => p.list('team.emptyRequired'), /required field "team\.emptyRequired\[0\]\.photo" is empty/);
});

test('missing file fails the build', () => {
  assert.throws(() => p.list('team.noFile'), /image "fehlt\.jpg" of "team\.noFile\[0\]\.photo" not found in src\/assets\/img\//);
});

test('empty alt fails the build', () => {
  assert.throws(() => p.list('team.noAlt'), /image "a\.jpg" of "team\.noAlt\[0\]\.photo" has an empty alt/);
});

test('a plain path instead of { value, alt } fails the build', () => {
  assert.throws(() => p.list('team.plainString'), /"team\.plainString\[0\]\.photo" must be an object/);
});

test('top-level image follows the same rules', () => {
  assert.deepEqual(p.img('img.ok'), { src: '/src/assets/img/a.jpg', alt: 'Foto in der Teststraße 1' });
  assert.equal(p.img('img.empty'), null);
  assert.throws(() => p.img('img.emptyRequired'), /required field "img\.emptyRequired" is empty/);
  assert.throws(() => p.img('img.noFile'), /image "fehlt\.jpg" of "img\.noFile" not found/);
  assert.throws(() => p.img('img.noAlt'), /image "a\.jpg" of "img\.noAlt" has an empty alt/);
  assert.throws(() => p.img('img.altKeyMissing'), /image "a\.jpg" of "img\.altKeyMissing" has an empty alt/);
});
