// Экранирование текста и ссылки в richtext. Запуск: npm test
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadContent } from './load-content.mjs';

let fixture, escText, sanitize;

before(async () => {
  fixture = await loadContent();
  ({ escText, sanitize } = await fixture.content());
});

after(() => fixture?.close());

test('escText: < shows as < and a bare & stays as written', () => {
  assert.equal(escText('Kosten < 100 €'), 'Kosten &lt; 100 €');
  assert.equal(escText('A & B <C>'), 'A & B &lt;C>');
  assert.equal(escText('R&D'), 'R&amp;D');
  assert.equal(escText("Kosten & Finanzierung, geht's"), "Kosten & Finanzierung, geht's");
});

test('sanitize: a code point beyond Unicode in a link does not crash the build', () => {
  for (const href of ['&#9999999;', '&#x110000;', `&#x${'f'.repeat(400)};`, `&#${'9'.repeat(400)};`]) {
    assert.equal(sanitize(`<a href="${href}">Link</a>`), `<a href="${href}">Link</a>`);
  }
});

test('sanitize: entity-encoded javascript: is still removed', () => {
  assert.equal(sanitize('<a href="&#106;avascript:alert(1)">x</a>'), '<a>x</a>');
  assert.equal(sanitize('<a href="&#x6a;avascript:alert(1)">x</a>'), '<a>x</a>');
});
