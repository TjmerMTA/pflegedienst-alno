// Запускает настоящий src/lib через Vite на временной копии со своими JSON и картинками:
// контент сайта тесты не трогают. Vite без плагинов Astro отдаёт вместо ImageMetadata адрес файла.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer } from 'vite';
import { contentImages } from '../src/lib/content-images.mjs';

const page = (label, groups) => JSON.stringify({ label, url: null, order: 0, groups });
const contact = { id: 'contact', label: 'Kontakt', fields: [{ id: 'street', label: 'Straße', type: 'text', value: 'Teststraße 1' }] };

// pages: { id: groups[] } или готовая строка файла; images: пути внутри src/assets/img
export async function loadContent(pages = {}, images = []) {
  const root = mkdtempSync(join(tmpdir(), 'content-test-'));
  const write = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  cpSync('src/lib', join(root, 'src/lib'), { recursive: true });
  for (const img of images) write(`src/assets/img/${img}`, 'jpg');
  mkdirSync(join(root, 'src/assets/img'), { recursive: true });
  write('src/content/pages/_global.json', page('Allgemein', [contact]));
  for (const [id, data] of Object.entries(pages)) write(`src/content/pages/${id}.json`, typeof data === 'string' ? data : page(id, data));
  const server = await createServer({
    root, configFile: false, logLevel: 'silent', appType: 'custom', plugins: [contentImages()],
    server: { middlewareMode: true, watch: null, ws: false }, optimizeDeps: { noDiscovery: true },
  });
  return {
    root, server,
    content: () => server.ssrLoadModule('/src/lib/content.ts'),
    close: async () => { await server.close(); rmSync(root, { recursive: true, force: true }); },
  };
}
