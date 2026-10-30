// A Russian user meets no German from the server or the schema. Page and group labels are German by contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { translator } from '../public/wp-admin/assets/js/i18n.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'wp-admin');
const t = translator('ru');

function serverMessages() {
  const out = new Map();
  for (const f of fs.readdirSync(path.join(root, 'lib')).filter((x) => x.endsWith('.php'))) {
    const src = fs.readFileSync(path.join(root, 'lib', f), 'utf8');
    const re = /(?:new \w*(?:Error|Exception)\((?:(?:\d+|\$status), (?:'\w+', )?)?|const MSG_\w+ = |\$err\(\$[\w[\]']+, |: |\? )(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
    for (const m of src.matchAll(re)) {
      const s = (m[1] ?? m[2]).replace(/\{?\$\w+\}?/g, '5');
      if (/[ÄÖÜäöüß]|^[A-ZÄÖÜa-zäöü-]+( [a-zA-ZäöüÄÖÜß„“.,:() -]+)+$|^(fehlt|kein Objekt)$/.test(s) && !/^(not found|https?:|application)/.test(s)) out.set(s, f);
    }
  }
  return out;
}

test('every message of the server has a Russian text', () => {
  const msgs = serverMessages();
  assert.ok(msgs.size > 50, `only ${msgs.size} found`);
  // Store's are internal: the client gets a general error. Those ending in a space or „ are parts of the ones below.
  assert.deepEqual([...msgs].filter(([m, f]) => f !== 'Store.php' && !/[ „]$/.test(m) && t.msg(m) === m).map(([m]) => m), []);
});

test('the long messages with a variable part translate as a whole', () => {
  assert.match(t.msg('Das Wort „abc“ ist mit 31 Zeichen zu lang (höchstens 30): Auf schmalen Bildschirmen passt es nicht in die Zeile. Bitte mit einem Bindestrich oder Leerzeichen trennen.'), /^слово «abc»/);
  assert.equal(t.msg('Datei zu groß (höchstens 10 MB)'), 'файл слишком большой (максимум 10 МБ)');
  assert.equal(t.msg('Zeile 7: Schlüssel „title“ doppelt'), 'строка 7: ключ «title» повторяется');
  assert.equal(t.msg('GitHub-Fehler 500: boom'), 'ошибка GitHub 500: boom');
});

test('every label of the post, Leistung and team forms has a Russian text', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'schema', 'collections.json'), 'utf8'));
  const names = new Set(['Inhalt', 'Permalink', 'Text', 'Eintrag']);
  for (const c of Object.values(schema)) for (const f of c.fields) for (const k of ['label', 'help', 'itemLabel']) if (f[k]) names.add(f[k]);
  assert.deepEqual([...names].filter((n) => t.label(n) === n && !/^Meta (Title|Description)$/.test(n)), []);
  assert.equal(translator('de').label('Titel (H1 und Meta Title)'), 'Titel (H1 und Meta Title)');
});

test('the password label and the link placeholder are Russian, and one entry is one entry', () => {
  assert.equal(t('login.pass'), 'Пароль');
  assert.equal(t('tb.link.ph'), 'https://… или /kontakt/');
  assert.equal(translator('de').count(1), '1 Eintrag');
  assert.equal(translator('de').count(2), '2 Einträge');
});
