export const FAQ = [
  { q: 'Was kostet mich der Pflegedienst?', a: '<p>In den meisten Fällen übernehmen Pflegekasse und Krankenkasse den Großteil der Kosten. Behandlungspflege auf ärztliche Verordnung zahlt die Krankenkasse vollständig. Bei Grundpflege und Betreuung rechnen wir direkt mit der Pflegekasse ab – im Beratungsgespräch zeigen wir Ihnen transparent, ob und welcher Eigenanteil entsteht.</p>' },
  { q: 'Wie schnell können Sie mit der Pflege beginnen?', a: '<p>Oft schon innerhalb weniger Tage. Nach einem Krankenhausaufenthalt organisieren wir die Versorgung gern bereits vor der Entlassung, damit zu Hause alles vorbereitet ist.</p>' },
  { q: 'Was passiert bei der kostenlosen Erstbegutachtung?', a: '<p>Eine Pflegefachkraft besucht Sie zu Hause, lernt Sie und Ihre Angehörigen kennen und erfasst den Hilfebedarf. Gemeinsam planen wir die passenden Leistungen und klären die Finanzierung. Der Besuch ist kostenlos und unverbindlich.</p>' },
  { q: 'Brauche ich einen Pflegegrad?', a: '<p>Für Behandlungspflege genügt eine ärztliche Verordnung. Für Leistungen der Pflegekasse ist ein Pflegegrad nötig – wir helfen Ihnen beim Antrag und bereiten Sie auf die Begutachtung durch den Medizinischen Dienst vor.</p>' },
  { q: 'In welchen Stadtteilen sind Sie unterwegs?', a: '<p>Unser Büro liegt in Hörde. Wir sind in den Dortmunder Stadtbezirken Hörde, Hombruch und Aplerbeck sowie in der Stadt Schwerte für Sie da – alle Stadtteile finden Sie auf der Startseite unter „Einsatzgebiet“. Ihr Ort ist nicht dabei? Rufen Sie uns einfach an, wir prüfen das gern.</p>' },
  { q: 'Wann sind Sie erreichbar?', a: '<p>Telefonisch erreichen Sie uns von 8 bis 22 Uhr. Unser Büro in der Sulpkestraße 50 ist montags bis freitags von 8 bis 16 Uhr geöffnet – zu diesen Zeiten können Sie gern auch persönlich zur Beratung vorbeikommen.</p>' },
];

export const faqSchema = (items = FAQ) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: items.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a.replace(/<[^>]+>/g, '') } })),
});
