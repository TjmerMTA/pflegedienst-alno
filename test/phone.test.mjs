import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { intlPhone } from '../src/lib/phone.mjs';

test('номер для tel: выводится из показанного', () => {
  for (const [shown, tel] of [
    ['0231 54 67 686', '+492315467686'],
    ['0231 / 54 67 - 686', '+492315467686'],
    ['(0231) 5467686', '+492315467686'],
    ['0176 12345678', '+4917612345678'],
    ['+49 231 5467686', '+492315467686'],
    ['+49 (0) 231 5467686', '+492315467686'],
    ['+49 (0)231 5467686', '+492315467686'],
    ['0049 231 5467686', '+492315467686'],
    ['+43 1 234567', '+431234567'],
    ['0043 1 234567', '+431234567'],
    ['  0231 5467686  ', '+492315467686'],
  ]) assert.equal(intlPhone(shown), tel, shown);
});

test('без цифр номера нет: ссылка не ведёт на пустой +49', () => {
  for (const shown of ['', null, undefined, 'auf Anfrage']) assert.equal(intlPhone(shown), '', String(shown));
});

test('поле «Telefon» ведёт все ссылки: второе поле пусто и не обязательно, а сайт берёт номер из показанного', () => {
  const contact = JSON.parse(readFileSync('src/content/pages/_global.json', 'utf8')).groups.find((g) => g.id === 'contact').fields;
  const intl = contact.find((f) => f.id === 'phoneIntl');
  assert.equal(intl.value, '');
  assert.ok(!intl.required);
  const site = readFileSync('src/config/site.ts', 'utf8');
  assert.match(site, /phoneHref: `tel:\$\{intlPhone\(c\('phoneIntl'\) \|\| c\('phone'\)\)\}`/);
  assert.match(site, /phoneIntl: c\('phoneIntl'\) \|\| intlPhone\(c\('phone'\)\)/);
});
