// Daten und Rechenlogik des Pflege-Rechners (Stand 2026). Beträge: Pflegekasse SGB XI + Leistungskomplexe des Pflegedienstes.
// Zahlen jährlich prüfen (TODO). Die Rechenregeln sind 1:1 aus dem Kundenentwurf übernommen.

export type Mode = 'geld' | 'kombi' | 'sach';
export type Cat = 'koerper' | 'pakete' | 'essen' | 'mobil' | 'haus' | 'hilfe' | 'betreuung' | 'beratung';
export interface Leistung { id: string; cat: Cat; name: string; type: 'fix' | 'minute'; price: number; once?: boolean }
export interface PlanItem { uid: number; cat: Cat; code: string; name: string; unit: number; once?: boolean; perWeek: number; perMonth: number; when: string }

export const RECHNER = {
  stand: '2026',
  pflegegeld: { 1: 0, 2: 347, 3: 599, 4: 800, 5: 990 } as Record<number, number>,
  sachleistung: { 1: 0, 2: 796, 3: 1497, 4: 1859, 5: 2299 } as Record<number, number>,
  entlastung: 131,
  entlastungStundensatz: 40.8, // € pro Stunde (L33: 0,68 €/Min.)
  hausbesuchPauschale: 0, // € pro Einsatz, 0 = aus
  investitionskostenProzent: 0, // % privat, 0 = aus
  // Einsätze pro Monat = pro Woche × 52/12
  wochenProMonat: 52 / 12,
};

// type: "fix" = pro Einsatz, "minute" = pro Minute | once: einmalige Leistung
export const LEISTUNGEN: Leistung[] = [
  { id: 'L01', cat: 'koerper', name: 'L01 Ganzwaschung', type: 'fix', price: 29.0 },
  { id: 'L02', cat: 'koerper', name: 'L02 Teilwaschung', type: 'fix', price: 15.52 },
  { id: 'L03', cat: 'koerper', name: 'L03 Ausscheidungen', type: 'fix', price: 7.08 },
  { id: 'L04', cat: 'essen', name: 'L04 Selbständige Nahrungsaufnahme', type: 'fix', price: 7.08 },
  { id: 'L05', cat: 'essen', name: 'L05 Hilfe bei der Nahrungsaufnahme', type: 'fix', price: 17.7 },
  { id: 'L06', cat: 'essen', name: 'L06 Sondenernährung bei implantierter Magensonde (PEG)', type: 'fix', price: 7.08 },
  { id: 'L07', cat: 'mobil', name: 'L07 Lagern/Betten', type: 'fix', price: 7.08 },
  { id: 'L08', cat: 'mobil', name: 'L08 Mobilisation', type: 'fix', price: 12.73 },
  { id: 'L09', cat: 'betreuung', name: 'L09 Arztbesuche', type: 'fix', price: 24.51 },
  { id: 'L10', cat: 'haus', name: 'L10 Beheizen des Wohnbereiches', type: 'fix', price: 4.08 },
  { id: 'L11', cat: 'haus', name: 'L11 Einkaufen', type: 'fix', price: 10.21 },
  { id: 'L12', cat: 'essen', name: 'L12 Zubereiten von warmen Speisen', type: 'fix', price: 10.21 },
  { id: 'L13', cat: 'haus', name: 'L13 Aufräumen und/oder Reinigen der Wohnung', type: 'fix', price: 36.76 },
  { id: 'L14', cat: 'haus', name: 'L14 Waschen und Pflegen der Wäsche und Kleidung', type: 'fix', price: 24.51 },
  { id: 'L16', cat: 'beratung', name: 'L16 Erstgespräch', type: 'fix', price: 108.93, once: true },
  { id: 'L16a', cat: 'beratung', name: 'L16a Folgebesuch', type: 'fix', price: 61.27, once: true },
  { id: 'L17', cat: 'beratung', name: 'L17 Beratungsbesuch nach § 37.3 Satz 5 SGB XI nach Grad 1-5', type: 'fix', price: 91.91, once: true },
  { id: 'L18', cat: 'pakete', name: 'L18 Große Grundpflege mit Lagern/Betten und selbständiger Nahrungsaufnahme', type: 'fix', price: 43.09 },
  { id: 'L19', cat: 'pakete', name: 'L19 Große Grundpflege', type: 'fix', price: 31.79 },
  { id: 'L20', cat: 'pakete', name: 'L20 Kleine Grundpflege mit Lagern/Betten und selbständiger Nahrungsaufnahme', type: 'fix', price: 31.79 },
  { id: 'L21', cat: 'pakete', name: 'L21 Kleine Grundpflege', type: 'fix', price: 20.49 },
  { id: 'L22', cat: 'haus', name: 'L22 Große hauswirtschaftliche Versorgung', type: 'fix', price: 51.74 },
  { id: 'L23', cat: 'pakete', name: 'L23 Große Grundpflege mit Lagern/Betten', type: 'fix', price: 36.76 },
  { id: 'L24', cat: 'pakete', name: 'L24 Große Grundpflege mit Lagern/Betten und Hilfe bei der Nahrungsaufnahme', type: 'fix', price: 52.29 },
  { id: 'L25', cat: 'pakete', name: 'L25 Kleine Grundpflege mit Lagern/Betten', type: 'fix', price: 24.71 },
  { id: 'L26', cat: 'pakete', name: 'L26 Kleine Grundpflege mit Lagern/Betten und Hilfe bei der Nahrungsaufnahme', type: 'fix', price: 40.98 },
  { id: 'L27', cat: 'hilfe', name: 'L27 Kleine pflegerische Hilfestellung 1', type: 'fix', price: 7.08 },
  { id: 'L28', cat: 'hilfe', name: 'L28 Kleine pflegerische Hilfestellung 2', type: 'fix', price: 7.08 },
  { id: 'L29', cat: 'hilfe', name: 'L29 Kleine pflegerische Hilfestellung 3', type: 'fix', price: 11.98 },
  { id: 'L30', cat: 'hilfe', name: 'L30 Kleine pflegerische Hilfestellung 4', type: 'fix', price: 5.45 },
  { id: 'L31', cat: 'betreuung', name: 'L31 Pflegerische Betreuung', type: 'minute', price: 0.68 },
  { id: 'L32', cat: 'haus', name: 'L32 Hilfe bei der Sicherstellung der selbstverantwortlichen Haushaltsführung', type: 'minute', price: 0.68 },
  { id: 'L33', cat: 'haus', name: 'L33 Hauswirtschaftliche Versorgung', type: 'minute', price: 0.68 },
];

export const monthly = (plan: PlanItem[]) => plan.filter((p) => !p.once).reduce((s, p) => s + p.unit * p.perMonth, 0);
export const oneoffSum = (plan: PlanItem[]) => plan.filter((p) => p.once).reduce((s, p) => s + p.unit, 0);

export function unitPrice(l: Leistung, minutes: number) {
  return (l.type === 'minute' ? l.price * minutes : l.price) + (+RECHNER.hausbesuchPauschale || 0);
}

export function calc(mode: Mode, pg: number, plan: PlanItem[]) {
  const cost = monthly(plan);
  const invest = (cost * (+RECHNER.investitionskostenProzent || 0)) / 100;
  const geld = RECHNER.pflegegeld[pg];
  const sach = RECHNER.sachleistung[pg];
  let budget = 0, used = 0, rest = 0, payout = 0, over = 0;
  if (mode === 'geld') { payout = geld; over = cost; }
  else {
    budget = sach; used = Math.min(cost, sach); rest = sach - used; over = Math.max(0, cost - sach);
    if (mode === 'kombi') payout = geld * (1 - used / sach);
  }
  return { cost, invest, budget, used, rest, payout, own: over + invest, share: budget ? used / budget : 0, geld };
}
