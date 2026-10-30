// Checks admin/i18n/labels-ru.json against the content: every German label/help/itemLabel of the pages and
// of the collection schema has a Russian text, tokens and numbers survive, the file is sorted. Prints what is missing.
// Run: node admin/tests/labels_ru_check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dictFile = path.join(root, 'admin', 'i18n', 'labels-ru.json');
const raw = fs.readFileSync(dictFile, 'utf8');
const dict = JSON.parse(raw);
const NAMES = ['label', 'help', 'itemLabel'];
// Used by the admin outside the files: see ruLabels in assets/js/i18n.js
const FIXED = ['Inhalt', 'Permalink', 'Text', 'Eintrag'];

const keys = new Set(FIXED);
const walk = (o) => {
  if (Array.isArray(o)) return o.forEach(walk);
  if (!o || typeof o !== 'object') return;
  for (const [k, v] of Object.entries(o)) {
    if (NAMES.includes(k) && typeof v === 'string') keys.add(v);
    else if (k !== 'value') walk(v); // values are the page's content, not labels
  }
};
const pagesDir = path.join(root, 'src', 'content', 'pages');
for (const f of fs.readdirSync(pagesDir).filter((x) => x.endsWith('.json'))) walk(JSON.parse(fs.readFileSync(path.join(pagesDir, f), 'utf8')));
const schema = JSON.parse(fs.readFileSync(path.join(root, 'admin', 'public', 'wp-admin', 'schema', 'collections.json'), 'utf8'));
for (const c of Object.values(schema)) walk(c.fields);

const problems = [];
const missing = [...keys].filter((k) => !(k in dict) || typeof dict[k] !== 'string' || !dict[k].trim());
for (const k of missing) problems.push(`missing: ${k}`);
const unused = Object.keys(dict).filter((k) => !keys.has(k));
for (const k of unused) problems.push(`unused key: ${k}`);

const bits = (s) => (s.match(/\{\{?\w+\}?\}|\d+(?:[.,]\d+)?/g) || []).sort().join('|');
for (const [k, v] of Object.entries(dict)) if (bits(k) !== bits(v)) problems.push(`tokens/numbers differ: ${k} -> ${v}`);

const sorted = Object.keys(dict).slice().sort();
if (Object.keys(dict).some((k, i) => k !== sorted[i])) problems.push('keys are not sorted');
if (raw !== JSON.stringify(dict, null, 2) + '\n') problems.push('file is not 2-space JSON with a final newline');

console.log(`${keys.size} German strings in the files, ${Object.keys(dict).length} in the dictionary, ${missing.length} missing`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('labels-ru: ok');
