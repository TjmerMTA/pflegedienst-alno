export const FAQ = [
  { q: 'Was kostet mich der Pflegedienst?', a: '<p>In den meisten Fällen übernehmen Pflegekasse und Krankenkasse den Großteil der Kosten. Behandlungspflege auf ärztliche Verordnung zahlt die Krankenkasse vollständig. Bei Grundpflege und Betreuung rechnen wir direkt mit der Pflegekasse ab – im Beratungsgespräch zeigen wir Ihnen transparent, ob und welcher Eigenanteil entsteht.</p>' },
  { q: 'Wie schnell können Sie mit der Pflege beginnen?', a: '<p>Oft schon innerhalb weniger Tage. Nach einem Krankenhausaufenthalt organisieren wir die Versorgung gern bereits vor der Entlassung, damit zu Hause alles vorbereitet ist.</p>' },
  { q: 'Was passiert bei der kostenlosen Erstbegutachtung?', a: '<p>Eine Pflegefachkraft besucht Sie zu Hause, lernt Sie und Ihre Angehörigen kennen und erfasst den Hilfebedarf. Gemeinsam planen wir die passenden Leistungen und klären die Finanzierung. Der Besuch ist kostenlos und unverbindlich.</p>' },
  { q: 'Brauche ich einen Pflegegrad?', a: '<p>Für Behandlungspflege genügt eine ärztliche Verordnung. Für Leistungen der Pflegekasse ist ein Pflegegrad nötig – wir helfen Ihnen beim Antrag und bereiten Sie auf die Begutachtung durch den Medizinischen Dienst vor.</p>' },
  { q: 'In welchen Stadtteilen von Dortmund sind Sie unterwegs?', a: '<p>Unser Büro liegt in Hörde. Schwerpunkt sind Hörde, Aplerbeck, Hombruch, Brackel und die Innenstadt. Weitere Stadtteile auf Anfrage – rufen Sie uns einfach an.</p>' },
  { q: 'Sind Sie auch nachts und am Wochenende erreichbar?', a: '<p>Ja. Unsere Patientinnen und Patienten erreichen die Rufbereitschaft rund um die Uhr, an 365 Tagen im Jahr.</p>' },
];

export const faqSchema = (items = FAQ) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: items.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a.replace(/<[^>]+>/g, '') } })),
});
