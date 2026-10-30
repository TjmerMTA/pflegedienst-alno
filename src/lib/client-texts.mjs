// Тексты для браузерных <script> (сообщения форм, подпись карты). Скрипт на клиенте JSON не видит,
// а data-атрибуты изменили бы HTML, поэтому astro.config.mjs подставляет значения при сборке
// через vite.define — в код они попадают обычными литералами. Токены {{key}} — как в content.ts.
// В astro dev значения читаются при старте: после правки JSON сервер нужно перезапустить.
import { readFileSync } from 'node:fs';
import { breakScriptTags, jsonForScript } from './json-for-script.mjs';

const read = (id) => JSON.parse(readFileSync(new URL(`../content/pages/${id}.json`, import.meta.url), 'utf8'));

// Читатель полей группы: нет группы или поля — та же понятная ошибка сборки, что в content.ts
function reader(id, groupId, tokens) {
  const file = `src/content/pages/${id}.json`;
  const group = read(id).groups.find((g) => g.id === groupId);
  if (!group) throw new Error(`[content] ${file}: group "${groupId}" not found`);
  return (fieldId) => {
    const f = group.fields.find((x) => x.id === fieldId);
    if (!f) throw new Error(`[content] ${file}: field "${groupId}.${fieldId}" not found`);
    return breakScriptTags(String(f.value ?? '').replace(/\{\{\s*([\w-]+)\s*\}\}/g, (m, key) => tokens[key] ?? m));
  };
}

export function clientTexts() {
  const tokens = Object.fromEntries(read('_global').groups.find((g) => g.id === 'contact').fields
    .filter((f) => f.type === 'text' || f.type === 'textarea').map((f) => [f.id, String(f.value)]));
  const forms = reader('_global', 'forms', tokens);
  const contact = reader('_global', 'contactForm', tokens);
  const application = reader('_global', 'applicationForm', tokens);
  // Порядок ключей важен: минификатор сохраняет его в собранном HTML
  return {
    __CONTACT_FORM_MSG__: jsonForScript({
      required: forms('errRequired'),
      phone: forms('errPhone'),
      email: forms('errEmail'),
      consent: forms('errConsent'),
      ok: contact('ok'),
      preview: forms('msgPreview'),
      fail: forms('msgFail'),
      spam: forms('msgSpam'),
    }),
    __APPLICATION_FORM_MSG__: jsonForScript({
      required: forms('errRequired'),
      phone: forms('errPhone'),
      email: forms('errEmail'),
      year: application('errYear'),
      consent: forms('errConsent'),
      ok: application('ok'),
      preview: forms('msgPreview'),
      fail: forms('msgFail'),
      spam: forms('msgSpam'),
    }),
    // Вставляется в атрибут title внутри innerHTML
    __KONTAKT_MAP_TITLE__: jsonForScript(reader('kontakt', 'anfahrt', tokens)('mapTitle').replace(/"/g, '&quot;')),
  };
}
