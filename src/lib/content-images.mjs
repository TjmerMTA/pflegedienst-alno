// Vite-плагин: модуль virtual:content-images импортирует только картинки, названные в страницах
// (поля image и image в элементах list). Импортированный файл попадает в dist, даже если не показан,
// поэтому общий glob по src/assets/img оставлял бы на сайте снятые с публикации фото.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pageIds, PAGES_DIR, readPage } from './page-files.mjs';

const ID = 'virtual:content-images';
const RESOLVED = `\0${ID}`;
const IMG_DIR = 'src/assets/img';

// Те же файлы, что и в библиотеке админки: всё jpg/jpeg/png/webp под src/assets/img
const library = (root) => new Set(readdirSync(join(root, IMG_DIR), { recursive: true }).filter((f) => /\.(jpg|jpeg|png|webp)$/.test(f)));

function namedInPage(page) {
  const names = [];
  for (const group of page?.groups ?? []) {
    for (const f of group?.fields ?? []) {
      if (f?.type === 'image') names.push(f.value);
      if (f?.type !== 'list' || !Array.isArray(f.value)) continue;
      for (const sub of f.fields ?? []) {
        if (sub?.type === 'image') names.push(...f.value.map((item) => item?.[sub.id]?.value));
      }
    }
  }
  return names;
}

export function contentImages() {
  let root;
  return {
    name: 'content-images',
    configResolved(config) { root = config.root; },
    // Битый JSON — сразу с именем файла, до разбора страниц сборщиком
    buildStart() { pageIds(root).forEach((id) => readPage(root, id)); },
    resolveId(id) { return id === ID ? RESOLVED : undefined; },
    load(id) {
      if (id !== RESOLVED) return undefined;
      const ids = pageIds(root);
      ids.forEach((page) => this.addWatchFile(join(root, PAGES_DIR, `${page}.json`)));
      const all = library(root);
      const used = [...new Set(ids.flatMap((page) => namedInPage(readPage(root, page))))].filter((name) => all.has(name)).sort();
      const imports = used.map((name, i) => `import i${i} from ${JSON.stringify(`/${IMG_DIR}/${name}`)};`);
      const entries = used.map((name, i) => `${JSON.stringify(`/${IMG_DIR}/${name}`)}: i${i}`);
      return `${imports.join('\n')}\nexport default { ${entries.join(', ')} };\n`;
    },
  };
}
