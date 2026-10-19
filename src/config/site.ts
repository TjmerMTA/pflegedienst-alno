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
    { days: 'Büro Mo – Fr', time: '08:00 – 16:00 Uhr' },
    { days: 'Telefonisch', time: '08:00 – 22:00 Uhr' },
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

// Районы обслуживания (реальные зоны клиента): три Stadtbezirke Дортмунда и город Schwerte.
// key связывает группу с фигурой на схеме в ServiceArea.astro.
export const AREAS = [
  { key: 'aplerbeck', title: 'Stadtbezirk Aplerbeck', districts: ['Aplerbeck', 'Berghofen', 'Schüren', 'Sölde', 'Sölderholz'] },
  { key: 'hoerde', title: 'Stadtbezirk Hörde', districts: ['Benninghofen', 'Hacheney', 'Hörde', 'Holzen', 'Syburg', 'Wellinghofen', 'Wichlinghofen'] },
  { key: 'hombruch', title: 'Stadtbezirk Hombruch', districts: ['Barop', 'Bittermark', 'Brünninghausen', 'Hombruch', 'Persebeck-Kruckel-Schnee', 'Kirchhörde-Löttringhausen', 'Rombergpark-Lücklemberg', 'Menglinghausen'] },
  { key: 'schwerte', title: 'Stadt Schwerte', districts: ['Schwerte-Mitte', 'Ergste', 'Geisecke', 'Holzen (Schwerte)', 'Lichtendorf', 'Villigst', 'Wandhofen', 'Westhofen'] },
];
