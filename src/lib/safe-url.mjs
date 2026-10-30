// Какие схемы адресов пропускаем в ссылках из текстов: richtext (content.ts) и Markdown (hardening.mjs).
// Браузер не видит управляющие символы и пробелы внутри схемы: «java\tscript:» для него javascript:
const ALLOWED = ['http', 'https', 'mailto', 'tel'];

export function safeScheme(url) {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url.replace(/[\u0000- ]/g, ''))?.[1].toLowerCase();
  return !scheme || ALLOWED.includes(scheme);
}
