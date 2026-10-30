// Вопросы FAQ главной — в src/content/pages/_global.json (группа faq), ответ — уже очищенный HTML
import { getGlobal } from '../lib/content';

export const FAQ = getGlobal().list<{ q: string; a: string }>('faq.items');

export const faqSchema = (items = FAQ) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: items.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a.replace(/<[^>]+>/g, '') } })),
});
