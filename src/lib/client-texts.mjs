// Тексты для браузерных <script> (сообщения форм, подпись карты). Скрипт на клиенте JSON не видит,
// а data-атрибуты изменили бы HTML, поэтому astro.config.mjs подставляет значения при сборке
// через vite.define — в код они попадают обычными литералами. Токены {{key}} — как в content.ts.
// В astro dev значения define читаются при старте: после правки JSON сервер нужно перезапустить.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pagePath = (id) => fileURLToPath(new URL(`../content/pages/${id}.json`, import.meta.url));
const read = (id) => JSON.parse(readFileSync(pagePath(id), 'utf8'));
const fillTokens = (s, tokens) => String(s ?? '').replace(/\{\{\s*([\w-]+)\s*\}\}/g, (m, key) => tokens[key] ?? m);

// Читатель полей группы: нет группы или поля — та же понятная ошибка сборки, что в content.ts
function reader(id, groupId, tokens) {
  const file = `src/content/pages/${id}.json`;
  const group = read(id).groups.find((g) => g.id === groupId);
  if (!group) throw new Error(`[content] ${file}: group "${groupId}" not found`);
  return (fieldId) => {
    const f = group.fields.find((x) => x.id === fieldId);
    if (!f) throw new Error(`[content] ${file}: field "${groupId}.${fieldId}" not found`);
    return fillTokens(f.value, tokens);
  };
}

const contactTokens = () => Object.fromEntries(read('_global').groups.find((g) => g.id === 'contact').fields
  .filter((f) => f.type === 'text' || f.type === 'textarea').map((f) => [f.id, String(f.value)]));

export function clientTexts() {
  const tokens = contactTokens();
  const forms = reader('_global', 'forms', tokens);
  const contact = reader('_global', 'contactForm', tokens);
  const application = reader('_global', 'applicationForm', tokens);
  // Порядок ключей важен: минификатор сохраняет его в собранном HTML
  return {
    __CONTACT_FORM_MSG__: JSON.stringify({
      required: forms('errRequired'),
      phone: forms('errPhone'),
      email: forms('errEmail'),
      consent: forms('errConsent'),
      ok: contact('ok'),
      preview: forms('msgPreview'),
      fail: forms('msgFail'),
      spam: forms('msgSpam'),
    }),
    __APPLICATION_FORM_MSG__: JSON.stringify({
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
    __KONTAKT_MAP_TITLE__: JSON.stringify(reader('kontakt', 'anfahrt', tokens)('mapTitle').replace(/"/g, '&quot;')),
  };
}

// Pflege-Rechner: в скрипте десятки фраз с числами внутри («Der Plan übersteigt das Budget um 5 €»),
// а vite.define умеет только готовые значения. Поэтому там макросы — плагин разворачивает их при сборке
// в обычные литералы, и минификатор видит тот же код, что и с текстом прямо в скрипте:
//   __T('группа.поле', { имя: выражение })  текст, {имя} в значении → ${выражение}; для textContent
//   __H(…)                                  то же для innerHTML: текст экранируется как textHtml() в content.ts
//   __N('группа.поле')                      число: «1.497», «7,08», «131 €»
//   __LEISTUNGEN('группа.поле')             список услуг для src/config/rechner.ts
// Незнакомый {имя} остаётся как написан, убранный редактором просто не выводится.
const RECHNER_SOURCES = /\/src\/(components\/Rechner\.astro\?astro&type=script|config\/rechner\.ts$)/;
const PAGE = 'pflege-rechner';

const escText = (s) => s.replace(/</g, '&lt;').replace(/&(?=[#a-zA-Z0-9])/g, '&amp;');
const inTemplate = (s) => s.replace(/[\\`]|\$\{/g, '\\$&');

// Сайт обязан собраться с любым значением из админки: не число — предупреждение и 0
function number(value, where) {
  const n = Number(String(value).replace(/[€\s]/g, '').replace(/\.(?=\d{3}(?:,|$))/g, '').replace(',', '.'));
  if (Number.isFinite(n)) return n;
  console.warn(`[content] src/content/pages/${PAGE}.json "${where}": "${value}" is not a number, using 0`);
  return 0;
}

// Те же проверки и ошибки сборки, что в content.ts
function field(page, path, ...types) {
  const file = `src/content/pages/${PAGE}.json`;
  const [groupId, fieldId] = path.split('.');
  const group = page.groups.find((g) => g.id === groupId);
  if (!group) throw new Error(`[content] ${file}: group "${groupId}" not found (field "${path}")`);
  const f = group.fields.find((x) => x.id === fieldId);
  if (!f) throw new Error(`[content] ${file}: field "${path}" not found`);
  if (!types.includes(f.type)) throw new Error(`[content] ${file}: field "${path}" is "${f.type}", expected ${types.join(' or ')}`);
  if (f.required && !String(f.value ?? '').trim()) throw new Error(`[content] ${file}: required field "${path}" is empty`);
  return f;
}

function serviceList(page, path) {
  const items = field(page, path, 'list').value;
  return JSON.stringify(items.map((l, i) => ({
    id: l.code, cat: l.cat, name: `${l.code} ${l.name}`, type: l.type === 'minute' ? 'minute' : 'fix',
    price: number(l.price, `${path}[${i + 1}].price`), ...(l.once?.trim() ? { once: true } : {}),
  })));
}

function expandMacro(call, code, tokens, page) {
  const [pathArg, partsArg] = call.arguments;
  const path = pathArg.value;
  if (call.callee.name === '__LEISTUNGEN') return serviceList(page, path);
  const value = fillTokens(field(page, path, 'text', 'textarea').value, tokens);
  if (call.callee.name === '__N') return String(number(value, path));
  const text = call.callee.name === '__H' ? escText(value) : value;
  if (!partsArg) return JSON.stringify(text);
  const parts = Object.fromEntries(partsArg.properties.map((n) => [n.key.name, code.slice(n.value.start, n.value.end)]));
  const pieces = text.split(/\{(\w+)\}/).map((piece, i) => {
    if (i % 2 === 0) return inTemplate(piece);
    return piece in parts ? `\${${parts[piece]}}` : inTemplate(`{${piece}}`);
  });
  return `\`${pieces.join('')}\``;
}

function walk(node, visit) {
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
  else if (node && typeof node === 'object') {
    if (node.type) visit(node);
    Object.values(node).forEach((n) => walk(n, visit));
  }
}

export function rechnerTexts() {
  const macros = new Set(['__T', '__H', '__N', '__LEISTUNGEN']);
  return {
    name: 'alno-rechner-texts',
    transform(source, id) {
      if (!RECHNER_SOURCES.test(id)) return null;
      this.addWatchFile(pagePath(PAGE));
      const tokens = contactTokens();
      const page = read(PAGE);
      let code = source;
      for (;;) {
        const calls = [], nested = [];
        walk(this.parse(code), (n) => {
          if (n.type === 'CallExpression' && macros.has(n.callee.name)) calls.push(n);
          if (n.type === 'TemplateLiteral') nested.push(...n.expressions.filter((e) => e.type === 'TemplateLiteral'));
        });
        // После макросов раскрываем шаблон внутри шаблона: минификатор этого не делает, а код должен совпасть с прежним
        const todo = calls.length ? calls : nested;
        if (!todo.length) return { code, map: null };
        // Сначала внутренние: аргумент одного макроса может содержать другой
        const inner = todo.filter((c) => !todo.some((o) => o !== c && o.start >= c.start && o.end <= c.end));
        for (const n of inner.sort((a, b) => b.start - a.start)) {
          code = calls.length
            ? code.slice(0, n.start) + expandMacro(n, code, tokens, page) + code.slice(n.end)
            : code.slice(0, n.start - 2) + code.slice(n.start + 1, n.end - 1) + code.slice(n.end + 1);
        }
      }
    },
  };
}
