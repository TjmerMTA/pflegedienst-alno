import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyValues, checkStructure, validateValues, mergeOldValues, structureOf, pageImageRefs, pageLines, tokenKeys, ALT_REQUIRED } from '../lib/pages.js';
import { applyForm } from '../lib/collections.js';
import { FIXTURE } from './helpers.mjs';

const load = (id) => JSON.parse(fs.readFileSync(path.join(FIXTURE, 'src/content/pages', `${id}.json`), 'utf8'));
const ctx = { imageExists: (p) => ['hero/start.jpg', 'team.jpg'].includes(p) };
const msgs = (r) => r.errors.map((e) => `${e.path}: ${e.msg}`);

test('fixture pages satisfy the contract', () => {
  for (const id of ['index', 'ueber-uns', '_global']) {
    assert.deepEqual(checkStructure(load(id)), []);
    assert.deepEqual(validateValues(load(id), ctx), []);
  }
});

test('values change, structure does not', () => {
  const page = load('index');
  const r = applyValues(page, { hero: { h1: 'Neu' } }, ctx);
  assert.deepEqual(r.errors, []);
  assert.equal(r.page.groups[1].fields[1].value, 'Neu');
  assert.equal(structureOf(r.page), structureOf(page));
  assert.equal(page.groups[1].fields[1].value, 'Gut versorgt zu Hause –', 'input object untouched');
});

test('unknown groups and fields are rejected', () => {
  const page = load('index');
  assert.match(msgs(applyValues(page, { neu: { a: 'x' } }, ctx)).join(), /unbekannte Gruppe/);
  assert.match(msgs(applyValues(page, { hero: { neu: 'x' } }, ctx)).join(), /unbekanntes Feld/);
  assert.match(msgs(applyValues(page, { hero: { trust: { a: { text: 'x', neu: 'y' } } } }, ctx)).join(), /unbekanntes Feld/);
});

test('a client cannot change label, type or max through the form', () => {
  const page = load('index');
  const r = applyValues(page, { seo: { title: { label: 'x', type: 'richtext', max: 9999, value: 'y' } } }, ctx);
  assert.ok(r.errors.length);
  assert.equal(r.page.groups[0].fields[0].type, 'text');
  assert.equal(r.page.groups[0].fields[0].max, 70);
});

test('required and max are enforced by characters, not bytes', () => {
  const page = load('index');
  assert.match(msgs(applyValues(page, { seo: { title: '' } }, ctx)).join(), /seo.title: Pflichtfeld/);
  assert.match(msgs(applyValues(page, { seo: { title: '   ' } }, ctx)).join(), /Pflichtfeld/);
  assert.deepEqual(msgs(applyValues(page, { seo: { title: 'ü'.repeat(70) } }, ctx)), []);
  assert.match(msgs(applyValues(page, { seo: { title: 'ü'.repeat(71) } }, ctx)).join(), /höchstens 70 Zeichen \(jetzt 71\)/);
});

test('text and textarea take no HTML', () => {
  const page = load('index');
  assert.match(msgs(applyValues(page, { hero: { pill: '<b>x</b>' } }, ctx)).join(), /HTML ist hier nicht erlaubt/);
  assert.match(msgs(applyValues(page, { seo: { description: 'a <script>b' } }, ctx)).join(), /HTML/);
  assert.deepEqual(msgs(applyValues(page, { hero: { pill: 'Preis < 5 €' } }, ctx)), []);
});

test('text is one line; textarea keeps line breaks', () => {
  const page = load('index');
  const r = applyValues(page, { hero: { pill: 'a\nb' }, seo: { description: 'x\r\ny' } }, ctx);
  assert.equal(r.page.groups[1].fields[0].value, 'a b');
  assert.equal(r.page.groups[0].fields[1].value, 'x\ny');
});

test('richtext is sanitised on save', () => {
  const page = load('index');
  const r = applyValues(page, { hero: { lead: '<p onclick="x">a<script>b</script></p><img src=x>' } }, ctx);
  assert.deepEqual(r.errors, []);
  assert.equal(r.page.groups[1].fields[3].value, '<p>a</p>');
});

test('tokens survive saving', () => {
  const page = load('index');
  const r = applyValues(page, { hero: { lead: '<p>Tel {{phone}}</p>', pill: 'Ruf {{phone}}' } }, ctx);
  assert.deepEqual(r.errors, []);
  assert.equal(r.page.groups[1].fields[3].value, '<p>Tel {{phone}}</p>');
});

test('image fields need a library path and an alt text', () => {
  const page = load('index');
  assert.deepEqual(msgs(applyValues(page, { hero: { image: { value: 'team.jpg', alt: 'x' } } }, ctx)), []);
  assert.match(msgs(applyValues(page, { hero: { image: { value: 'team.jpg', alt: ' ' } } }, ctx)).join(), /Alternativtext fehlt/);
  assert.match(msgs(applyValues(page, { hero: { image: { value: 'fehlt.jpg', alt: 'x' } } }, ctx)).join(), /nicht gefunden/);
  for (const bad of ['../secret.jpg', '/etc/passwd.jpg', 'a/../../b.jpg', '.hidden.jpg', 'x.svg', 'x.php', 'a\\b.jpg']) {
    assert.match(msgs(applyValues(page, { hero: { image: { value: bad, alt: 'x' } } }, ctx)).join(), /ungültiger Bildpfad/, bad);
  }
});

test('lists keep submitted order and respect min/max', () => {
  const page = load('index');
  const r = applyValues(page, { hero: { trust: { b: { text: 'zwei' }, a: { text: 'eins' }, _: '' } } }, ctx);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.page.groups[1].fields[5].value, [{ text: 'zwei' }, { text: 'eins' }]);
  assert.match(msgs(applyValues(page, { hero: { trust: { _: '' } } }, ctx)).join(), /mindestens 1 Einträge/);
  const five = Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`i${i}`, { text: `t${i}` }]));
  assert.match(msgs(applyValues(page, { hero: { trust: five } }, ctx)).join(), /höchstens 4 Einträge/);
});

test('sub-fields are validated with their item number', () => {
  const page = load('index');
  const r = applyValues(page, { cards: { items: { a: { title: '', text: 'x'.repeat(121), photo: { value: '', alt: '' } } } } }, ctx);
  const m = msgs(r).join('\n');
  assert.match(m, /cards\.items\[1\]\.title: Pflichtfeld/);
  assert.match(m, /cards\.items\[1\]\.text: höchstens 120/);
});

test('an image sub-field is stored as { value, alt }', () => {
  const page = load('index');
  const r = applyValues(page, { cards: { items: { a: { title: 'T', text: '', photo: { value: 'team.jpg', alt: 'Alt', extra: 'weg' } } } } }, ctx);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.page.groups[2].fields[0].value, [{ title: 'T', text: '', photo: { value: 'team.jpg', alt: 'Alt' } }]);
  const empty = applyValues(page, { cards: { items: { a: { title: 'T', text: '', photo: { value: '', alt: '' } } } } }, ctx);
  assert.deepEqual(empty.errors, [], 'an optional image may stay empty');
  assert.deepEqual(empty.page.groups[2].fields[0].value[0].photo, { value: '', alt: '' });
});

test('an image sub-field needs a valid path and an alt text', () => {
  const page = load('index');
  const item = (photo) => ({ cards: { items: { a: { title: 'T', text: '', photo } } } });
  assert.match(msgs(applyValues(page, item({ value: 'team.jpg', alt: '' }), ctx)).join(), /cards\.items\[1\]\.photo: Alternativtext fehlt/);
  assert.match(msgs(applyValues(page, item({ value: '../x.jpg', alt: 'a' }), ctx)).join(), /ungültiger Bildpfad/);
  assert.match(msgs(applyValues(page, item({ value: 'fehlt.jpg', alt: 'a' }), ctx)).join(), /nicht gefunden/);
});

test('no image means value "" with alt "", top-level and in lists', () => {
  const page = load('index');
  const top = applyValues(page, { hero: { image: { value: '', alt: 'steht noch im Formular' } } }, ctx);
  assert.deepEqual(top.errors, []);
  assert.equal(top.page.groups[1].fields[4].value, '');
  assert.equal(top.page.groups[1].fields[4].alt, '');
  const list = applyValues(page, { cards: { items: { a: { title: 'T', text: '', photo: { value: '', alt: 'alt' } } } } }, ctx);
  assert.deepEqual(list.errors, []);
  assert.deepEqual(list.page.groups[2].fields[0].value[0].photo, { value: '', alt: '' });
});

test('a set image needs a non-empty alt: the message says so and names the item', () => {
  const page = load('index');
  const top = applyValues(page, { hero: { image: { value: 'team.jpg', alt: '   ' } } }, ctx);
  assert.equal(top.errors.length, 1);
  assert.equal(top.errors[0].label, 'Bild');
  assert.equal(top.errors[0].msg, ALT_REQUIRED);
  assert.match(ALT_REQUIRED, /Ist ein Bild gesetzt, muss der Alternativtext ausgefüllt sein/);
  const items = { a: { title: 'A', text: '', photo: { value: '', alt: '' } }, b: { title: 'B', text: '', photo: { value: 'team.jpg', alt: '' } } };
  const list = applyValues(page, { cards: { items } }, ctx);
  assert.equal(list.errors.length, 1);
  assert.equal(list.errors[0].path, 'cards.items[2].photo');
  assert.equal(list.errors[0].label, 'Karte 2 › Bild');
});

test('restoring a version with an old alt on an empty image clears the alt', () => {
  const old = load('index');
  old.groups[1].fields[4].value = '';
  old.groups[1].fields[4].alt = 'alt';
  old.groups[2].fields[0].value[0].photo = { value: '', alt: 'alt' };
  const m = mergeOldValues(load('index'), old);
  assert.equal(m.groups[1].fields[4].alt, '');
  assert.deepEqual(m.groups[2].fields[0].value[0].photo, { value: '', alt: '' });
});

test('restoring a revision keeps list images as { value, alt }', () => {
  const m = mergeOldValues(load('index'), load('index'));
  assert.deepEqual(m.groups[2].fields[0].value[0].photo, { value: 'team.jpg', alt: 'Team auf einem Bild' });
});

test('broken structures are detected', () => {
  assert.ok(checkStructure({ label: 'x' }).length);
  assert.ok(checkStructure({ label: 'x', groups: [{ id: 'a', fields: [{ id: 'b', type: 'video' }] }] }).length);
  assert.ok(checkStructure({ label: 'x', groups: [{ id: 'a', fields: [{ id: 'b', type: 'text' }, { id: 'b', type: 'text' }] }] }).length);
  assert.ok(checkStructure({ label: 'x', groups: [{ id: 'a', fields: [{ id: 'l', type: 'list', fields: [{ id: 'n', type: 'list', fields: [] }] }] }] }).length, 'no nested lists');
});

test('old values are poured into the current structure', () => {
  const current = load('index');
  const old = load('index');
  old.groups[1].fields[1].value = 'Alt';
  old.groups[1].fields.push({ id: 'weg', label: 'Weg', type: 'text', value: 'x' });
  current.groups[1].fields[0].label = 'Neue Beschriftung';
  const m = mergeOldValues(current, old);
  assert.equal(m.groups[1].fields[1].value, 'Alt');
  assert.equal(m.groups[1].fields[0].label, 'Neue Beschriftung');
  assert.equal(m.groups[1].fields.some((f) => f.id === 'weg'), false);
});

test('pages read as lines by field', () => {
  const lines = pageLines(load('index')).split('\n');
  assert.ok(lines.includes('Erster Bildschirm › Überschrift (H1): Gut versorgt zu Hause –'));
  assert.ok(lines.includes('Erster Bildschirm › Bild: hero/start.jpg (Alt: Testbild Startseite)'));
  assert.ok(lines.includes('Erster Bildschirm › Punkt 2 › Text: Telefon {{hours}}'));
  assert.ok(lines.includes('Karten › Karte 1 › Bild: team.jpg (Alt: Team auf einem Bild)'));
});

test('image references and tokens are found', () => {
  assert.deepEqual(pageImageRefs(load('index')).map((r) => r.path), ['hero/start.jpg', 'team.jpg']);
  assert.deepEqual(tokenKeys(load('_global')), ['phone', 'email', 'hours', 'officeHours']);
});

test('collections: required, max, dates, numbers, images', () => {
  const r = applyForm('blog', [], { title: '', description: 'x'.repeat(171), date: '2026-02-31', image: { value: 'team.jpg', alt: '' } }, ctx);
  const m = r.errors.map((e) => `${e.path}: ${e.msg}`).join('\n');
  assert.match(m, /title: Pflichtfeld/);
  assert.match(m, /description: höchstens 170/);
  assert.match(m, /date: ungültiges Datum/);
  assert.match(m, /imageAlt: Alternativtext fehlt/);
  const t = applyForm('team', [], { name: 'N', role: 'R', order: 'abc' }, ctx);
  assert.match(t.errors.map((e) => e.msg).join(), /keine Zahl/);
  const l = applyForm('leistungen', [], { title: 'a', metaTitle: 'b', description: 'c', teaser: 'd', icon: 'virus', order: '1', payer: 'e', highlights: { _: '' } }, ctx);
  const lm = l.errors.map((e) => e.msg).join();
  assert.match(lm, /ungültige Auswahl/);
  assert.match(lm, /mindestens ein Eintrag/);
});

test('collections: unknown frontmatter keys and key order are kept', () => {
  const r = applyForm('team', [['name', 'A'], ['custom', 'bleibt'], ['role', 'B']], { name: 'A2', role: 'B', hidden: 'on' }, ctx);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.entries, [['name', 'A2'], ['custom', 'bleibt'], ['role', 'B'], ['hidden', true]]);
});

test('collections: image goes in as a path relative to the .md file', () => {
  const r = applyForm('team', [], { name: 'A', role: 'B', photo: { value: 'team.jpg' } }, ctx);
  assert.equal(new Map(r.entries).get('photo'), '../../assets/img/team.jpg');
});

test('collections: body is cleaned of raw HTML', () => {
  const r = applyForm('blog', [], { title: 'T', description: 'D', date: '2026-01-01', body: 'a <iframe src=x></iframe> b\n' }, ctx);
  assert.equal(r.body, 'a  b');
});
