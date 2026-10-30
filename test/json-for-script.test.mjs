// Запись данных в <script>: значение остаётся тем же, а разметку закрыть нельзя. Запуск: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { breakScriptTags, jsonForScript } from '../src/lib/json-for-script.mjs';

const hostile = { name: 'A</script><img src=x>', text: 'a & b > c <!--<script>', line: 'x\u2028y\u2029z' };

test('jsonForScript leaves no < > & or line separators, and parses back to the same value', () => {
  const out = jsonForScript(hostile);
  assert.doesNotMatch(out, /[<>&\u2028\u2029]/);
  assert.deepEqual(JSON.parse(out), hostile);
});

test('jsonForScript changes nothing when there is nothing to escape', () => {
  const plain = { name: 'Pflegedienst ALNO GmbH', list: [1, 'Sulpkestraße 50', null] };
  assert.equal(jsonForScript(plain), JSON.stringify(plain));
});

test('breakScriptTags splits the sequences a minifier keeps, in any case', () => {
  for (const s of ['<!--<script>', '</script>', '</SCRIPT >', '<ScRiPt']) {
    assert.doesNotMatch(breakScriptTags(s), /<(!--|\/?script)/i);
  }
});

test('breakScriptTags leaves ordinary text alone', () => {
  for (const s of ['Bitte füllen Sie dieses Feld aus.', 'A < B', 'Preis <100 €', 'a & b']) {
    assert.equal(breakScriptTags(s), s);
  }
});
