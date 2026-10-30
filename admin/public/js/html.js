// Tiny HTML templating: every interpolated value is escaped unless it is a Raw (another template
// result or raw()). This is the admin's main XSS defence — never build HTML by string concatenation.

export class Raw {
  constructor(s) { this.s = String(s); }
  toString() { return this.s; }
}

export const raw = (s) => new Raw(s);

export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function part(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
  return new Raw(out);
}
