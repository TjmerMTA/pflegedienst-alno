// Единый источник данных компании (NAP) — используется в шапке, подвале, Schema.org и формах.
// Значения — в src/content/pages/_global.json (группа contact, правится в админке), здесь только тонкий слой.
// Всё, что помечено TODO, нужно подтвердить у клиента до запуска.
import { getGlobal, getPage, escText, jsonForScript } from '../lib/content';
import FORM_RULES from './form-rules.json';
import { intlPhone } from '../lib/phone.mjs';

// Страницы и компоненты, которые уже импортируют site.ts, берут это отсюда: лишний import в .astro
// сдвигает порядок <style> в собранном HTML (Astro сортирует CSS по позиции импорта)
export { getGlobal, getPage, escText, jsonForScript, FORM_RULES };

// Атрибуты поля формы из единых правил: их же проверяет public/api/anfrage.php
export function fieldAttrs(name: keyof typeof FORM_RULES.fields) {
  const r: { min?: number; max: number; pattern?: string } = FORM_RULES.fields[name];
  return { minlength: r.min, maxlength: r.max, pattern: r.pattern };
}

const g = getGlobal();
const c = (id: string) => g.text(`contact.${id}`);
// Координаты в админке — строкой; запятую вместо точки тоже понимаем
const num = (id: string) => Number(c(id).replace(',', '.'));

export const SITE = {
  name: c('name'),
  shortName: c('shortName'),
  street: c('street'),
  zip: c('zip'),
  city: c('city'),
  region: c('region'),
  country: c('country'),
  geo: { lat: num('lat'), lng: num('lng') }, // TODO: точные координаты офиса
  phone: c('phone'),
  // «Telefon international» — необязательная замена: обычно номер для ссылки выводится из показанного
  phoneIntl: c('phoneIntl') || intlPhone(c('phone')),
  phoneHref: `tel:${intlPhone(c('phoneIntl') || c('phone'))}`,
  phone2: c('phone2'),
  fax: c('fax'),
  faxIntl: c('faxIntl'),
  email: c('email'),
  // TODO: мобильный номер для WhatsApp (стационарный WhatsApp не принимает)
  whatsapp: c('whatsapp').replace(/\D/g, ''),
  whatsappText: c('whatsappText'),
  ceo: c('ceo'),
  hrb: c('hrb'),
  court: c('court'),
  hours: g.list<{ days: string; time: string }>('contact.hoursList'),
  // Сюда адрес обработчика форм (Web3Forms / Formspree / свой endpoint). Пусто — режим превью.
  formEndpoint: import.meta.env.PUBLIC_FORM_ENDPOINT || '',
  // ID Google Analytics 4. Пусто — GA и cookie-баннер не подключаются.
  gaId: import.meta.env.PUBLIC_GA_ID || '',
};

// Превью на siteboosty.com закрыто от индексации, продакшн — открыт.
export const NOINDEX = (import.meta.env.SITE || '').includes('siteboosty');

export const whatsappUrl = `https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent(SITE.whatsappText)}`;

// Адреса пунктов меню — в коде, подписи — в админке (группа header)
export const NAV = [
  { href: '/leistungen/', label: g.text('header.navLeistungen') },
  { href: '/kosten-finanzierung/', label: g.text('header.navKosten') },
  { href: '/ueber-uns/', label: g.text('header.navUeberUns') },
  { href: '/blog/', label: g.text('header.navRatgeber') },
  { href: '/kontakt/', label: g.text('header.navKontakt') },
];

// Районы обслуживания (реальные зоны клиента): три Stadtbezirke Дортмунда и город Schwerte.
// key связывает группу с фигурой на схеме в ServiceArea.astro, поэтому набор районов задан в коде,
// а названия и списки Stadtteile — в админке (группы areaAplerbeck … areaSchwerte).
const area = (key: string, group: string) => ({
  key,
  name: g.text(`${group}.mapName`),
  title: g.text(`${group}.title`),
  districts: g.list<{ name: string }>(`${group}.districts`).map((d) => d.name),
});
export const AREAS = [
  area('aplerbeck', 'areaAplerbeck'),
  area('hoerde', 'areaHoerde'),
  area('hombruch', 'areaHombruch'),
  area('schwerte', 'areaSchwerte'),
];
