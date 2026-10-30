// Запись данных внутрь <script>. JSON.stringify от этого не защищает: </script> в значении закрывает блок.
// Чистый JS без Vite: нужен и на сайте, и в astro.config.mjs (src/lib/client-texts.mjs).

// JSON для <script>: < > & и разделители строк U+2028/U+2029 идут как \uXXXX, значение при разборе то же
export const jsonForScript = (value) =>
  JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

// Значение, которое пройдёт через минификатор (vite.define): он перепечатает строку и снимет \u003c,
// а <!--<script> в обычном скрипте съедает страницу до конца. Поэтому разбиваем сам текст невидимым U+200B.
export const breakScriptTags = (s) => s.replace(/<(?=!--|\/?script)/gi, '<\u200b');
