// Единый источник данных компании (NAP) — используется в шапке, подвале, Schema.org и формах.
// Всё, что помечено TODO, нужно подтвердить у клиента до запуска.

export const SITE = {
  name: 'Pflegedienst ALNO GmbH',
  shortName: 'Pflegedienst ALNO',
  slogan: 'Ambulante Pflege in Dortmund – mit Herz und Kompetenz',
  street: 'Sulpkestraße 50',
  zip: '44269',
  city: 'Dortmund',
  region: 'NRW',
  country: 'DE',
  geo: { lat: 51.4786, lng: 7.5186 }, // TODO: точные координаты офиса
  phone: '0231 54 67 686',
  phoneHref: 'tel:+492315467686',
  phone2: '0231 580 69 165',
  fax: '0231 580 69 169',
  email: 'info@pflegedienst-nogina.de',
  // TODO: мобильный номер для WhatsApp (стационарный WhatsApp не принимает)
  whatsapp: '492315467686',
  whatsappText: 'Hallo, ich interessiere mich für eine kostenlose Pflegeberatung.',
  ceo: 'Alla Nogina',
  hrb: 'HRB 29328',
  court: 'Amtsgericht Dortmund',
  hours: [
    { days: 'Mo – Fr', time: '08:00 – 16:00 Uhr' },
    { days: 'Pflege-Notruf', time: '24 Stunden, 7 Tage' },
  ],
  // Сюда адрес обработчика форм (Web3Forms / Formspree / свой endpoint). Пусто — режим превью.
  formEndpoint: import.meta.env.PUBLIC_FORM_ENDPOINT || '',
  // ID Google Analytics 4. Пусто — GA и cookie-баннер не подключаются.
  gaId: import.meta.env.PUBLIC_GA_ID || '',
};

// Превью на siteboosty.com закрыто от индексации, продакшн — открыт.
export const NOINDEX = (import.meta.env.SITE || '').includes('siteboosty');

export const whatsappUrl = `https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent(SITE.whatsappText)}`;

export const NAV = [
  { href: '/leistungen/', label: 'Leistungen' },
  { href: '/kosten-finanzierung/', label: 'Kosten & Finanzierung' },
  { href: '/ueber-uns/', label: 'Über uns' },
  { href: '/blog/', label: 'Ratgeber' },
  { href: '/kontakt/', label: 'Kontakt' },
];

// Районы обслуживания (Stadtbezirke Dortmund). core — основная зона, остальные — по запросу.
// TODO: подтвердить у клиента.
export const AREAS = [
  { name: 'Hörde', core: true },
  { name: 'Aplerbeck', core: true },
  { name: 'Hombruch', core: true },
  { name: 'Innenstadt-Ost', core: true },
  { name: 'Innenstadt-West', core: true },
  { name: 'Brackel', core: true },
  { name: 'Innenstadt-Nord', core: false },
  { name: 'Scharnhorst', core: false },
  { name: 'Lütgendortmund', core: false },
  { name: 'Huckarde', core: false },
  { name: 'Eving', core: false },
  { name: 'Mengede', core: false },
];
