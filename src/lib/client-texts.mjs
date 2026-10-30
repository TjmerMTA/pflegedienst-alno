// Тексты для браузерных <script> (сообщения форм, подпись карты). Скрипт на клиенте JSON не видит,
// а data-атрибуты изменили бы HTML, поэтому astro.config.mjs подставляет значения при сборке
// через vite.define — в код они попадают обычными литералами. Токены {{key}} — как в content.ts.
// В astro dev значения читаются при старте: после правки JSON сервер нужно перезапустить.
import { fileURLToPath } from 'node:url';
import { breakScriptTags, jsonForScript } from './json-for-script.mjs';
import { readPage } from './page-files.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (id) => readPage(ROOT, id);

// Нет группы или самого списка групп — та же понятная ошибка сборки, что в content.ts
function findGroup(id, groupId) {
  const file = `src/content/pages/${id}.json`;
  const { groups } = read(id);
  if (!Array.isArray(groups)) throw new Error(`[content] ${file}: "groups" must be an array`);
  const group = groups.find((g) => g.id === groupId);
  if (!group) throw new Error(`[content] ${file}: group "${groupId}" not found`);
  return group;
}

// Читатель полей группы
function reader(id, groupId, tokens) {
  const file = `src/content/pages/${id}.json`;
  const group = findGroup(id, groupId);
  return (fieldId) => {
    const f = group.fields.find((x) => x.id === fieldId);
    if (!f) throw new Error(`[content] ${file}: field "${groupId}.${fieldId}" not found`);
    return breakScriptTags(String(f.value ?? '').replace(/\{\{\s*([\w-]+)\s*\}\}/g, (m, key) => tokens[key] ?? m));
  };
}

const contactTokens = () => Object.fromEntries(findGroup('_global', 'contact').fields
  .filter((f) => f.type === 'text' || f.type === 'textarea').map((f) => [f.id, String(f.value)]));

export function clientTexts() {
  const tokens = contactTokens();
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
