// Чтение src/content/pages/*.json вне Vite (astro.config, плагин картинок): битый файл — ошибка с его именем
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PAGES_DIR = 'src/content/pages';

export const pageIds = (root) => readdirSync(join(root, PAGES_DIR)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));

export function readPage(root, id) {
  const file = `${PAGES_DIR}/${id}.json`;
  let text;
  try {
    text = readFileSync(join(root, file), 'utf8');
  } catch {
    throw new Error(`[content] ${file} not found`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`[content] ${file}: invalid JSON: ${e.message}`);
  }
}
