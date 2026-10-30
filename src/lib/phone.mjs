// Номер для ссылки tel: и для Google — из того, как он показан на сайте: «0231 54 67 686» → «+492315467686».
// Так в админке хватает одного поля «Телефон»; «Telefon international» нужен, только если ссылка ведёт на другой номер.
export function intlPhone(display) {
  const shown = String(display ?? '').replace(/\(0\)/g, '');
  const digits = shown.replace(/\D/g, '');
  if (!digits) return '';
  if (shown.trim().startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  return `+49${digits.replace(/^0/, '')}`;
}
