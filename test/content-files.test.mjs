// В сборку идут только названные в страницах картинки; битый JSON называет свой файл. Запуск: npm test
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { loadContent } from './load-content.mjs';
import { readPage } from '../src/lib/page-files.mjs';

const image = (id, value) => ({ id, label: id, type: 'image', value, alt: 'Foto' });
const groups = [{
  id: 'bilder', label: 'Bilder', fields: [
    image('oben', 'benutzt.jpg'),
    image('leer', ''),
    image('fehlt', 'fehlt.jpg'),
    image('heraus', '../geheim.jpg'),
    image('gross', 'gross.JPG'),
    { id: 'karten', label: 'Karten', type: 'list', fields: [{ id: 'foto', label: 'Foto', type: 'image' }], value: [{ foto: { value: 'uploads/liste.webp', alt: 'Foto' } }, {}] },
  ],
}];
const library = ['benutzt.jpg', 'unbenutzt.jpg', 'gross.JPG', 'uploads/liste.webp', 'uploads/alt.png'];

let fixture;

before(async () => {
  fixture = await loadContent({ seite: groups }, library);
});

after(() => fixture?.close());

test('only images named in the pages are imported, top-level and in lists', async () => {
  const images = (await fixture.server.ssrLoadModule('virtual:content-images')).default;
  assert.deepEqual(Object.keys(images), ['/src/assets/img/benutzt.jpg', '/src/assets/img/uploads/liste.webp']);
});

test('invalid JSON names the file', () => {
  const root = mkdtempSync(join(tmpdir(), 'content-test-'));
  mkdirSync(join(root, 'src/content/pages'), { recursive: true });
  writeFileSync(join(root, 'src/content/pages/kaputt.json'), '{"label": [');
  assert.throws(() => readPage(root, 'kaputt'), /\[content\] src\/content\/pages\/kaputt\.json: invalid JSON: /);
  rmSync(root, { recursive: true, force: true });
});

test('a missing page file names the file', () => {
  assert.throws(() => readPage(fixture.root, 'gibtsnicht'), /\[content\] src\/content\/pages\/gibtsnicht\.json not found/);
});
