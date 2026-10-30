// A Russian user meets no German from the server, the schema or the page files. The contract: German in the
// files, Russian through assets/labels-ru.json. labels_ru_check.mjs, run below, fails on a label it lacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setLabels, translator } from '../public/wp-admin/assets/js/i18n.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'wp-admin');
const t = translator('ru');
setLabels(JSON.parse(fs.readFileSync(path.join(root, 'assets', 'labels-ru.json'), 'utf8')));

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
  assert.equal(t.msg('Datei zu groß (höchstens 10 MB). Bitte das Foto verkleinern und noch einmal hochladen.'), 'файл слишком большой (максимум 10 МБ). Уменьшите фото и загрузите снова.');
  assert.equal(t.msg('Zeile 7: Schlüssel „title“ doppelt'), 'строка 7: ключ «title» повторяется');
  assert.equal(t.msg('GitHub-Fehler 500: boom'), 'ошибка GitHub 500: boom');
});

test('every label of the page files and the schema has a Russian text', () => {
  const out = execFileSync(process.execPath, [path.join(root, '..', '..', 'tests', 'labels_ru_check.mjs')], { encoding: 'utf8' });
  assert.match(out, /labels-ru: ok/);
});

test('a page reaches the Russian screen with Russian labels and its content untouched', () => {
  const page = { label: 'Startseite', hash: 'x', groups: [{ id: 'hero', label: 'Erster Bildschirm', fields: [
    { id: 'title', label: 'Überschrift', type: 'text', value: 'Startseite' },
    { id: 'items', label: 'Plaketten unter dem Text', itemLabel: 'Plakette', type: 'list', value: [{ label: 'Startseite' }], fields: [{ id: 'label', label: 'Überschrift', type: 'text' }] },
    { id: 'neu', label: 'Noch nicht übersetzt', help: 'Hilfe ohne Übersetzung', type: 'text', value: 'x' },
  ] }] };
  const ru = t.localize(page);
  assert.notEqual(ru.label, 'Startseite');
  assert.notEqual(ru.groups[0].label, 'Erster Bildschirm');
  assert.notEqual(ru.groups[0].fields[0].label, 'Überschrift');
  assert.notEqual(ru.groups[0].fields[1].itemLabel, 'Plakette');
  assert.equal(ru.groups[0].fields[0].value, 'Startseite', 'a value is content');
  assert.deepEqual(ru.groups[0].fields[1].value, [{ label: 'Startseite' }], 'also in a list');
  assert.equal(ru.groups[0].fields[2].label, 'Noch nicht übersetzt', 'German as the fallback');
  assert.equal(ru.groups[0].id, 'hero');
  assert.deepEqual(translator('de').localize(page), page);
  assert.equal(translator('de').label('Überschrift'), 'Überschrift');
});

test('the password label and the link placeholder are Russian, and one entry is one entry', () => {
  assert.equal(t('login.pass'), 'Пароль');
  assert.equal(t('tb.link.ph'), 'https://… или /kontakt/');
  assert.equal(translator('de').count(1), '1 Eintrag');
  assert.equal(translator('de').count(2), '2 Einträge');
});
