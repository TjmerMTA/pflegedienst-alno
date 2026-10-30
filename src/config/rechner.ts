// Daten und Rechenlogik des Pflege-Rechners (Stand 2026). Beträge: Pflegekasse SGB XI + Leistungskomplexe des Pflegedienstes.
// Zahlen jährlich prüfen (TODO). Die Rechenregeln sind 1:1 aus dem Kundenentwurf übernommen.
// Beträge und Leistungen stehen in src/content/pages/pflege-rechner.json, die Makros löst src/lib/client-texts.mjs beim Build auf.
declare function __T(path: string): string;
declare function __N(path: string): number;
declare function __LEISTUNGEN(path: string): Leistung[];

export type Mode = 'geld' | 'kombi' | 'sach';
export type Cat = 'koerper' | 'pakete' | 'essen' | 'mobil' | 'haus' | 'hilfe' | 'betreuung' | 'beratung';
export interface Leistung { id: string; cat: Cat; name: string; type: 'fix' | 'minute'; price: number; once?: boolean }
export interface PlanItem { uid: number; cat: Cat; code: string; name: string; unit: number; once?: boolean; perWeek: number; perMonth: number; when: string }

export const RECHNER = {
  stand: __T('betraege.stand'),
  pflegegeld: { 1: 0, 2: __N('betraege.geld2'), 3: __N('betraege.geld3'), 4: __N('betraege.geld4'), 5: __N('betraege.geld5') } as Record<number, number>,
  sachleistung: { 1: 0, 2: __N('betraege.sach2'), 3: __N('betraege.sach3'), 4: __N('betraege.sach4'), 5: __N('betraege.sach5') } as Record<number, number>,
  entlastung: __N('betraege.entlastung'),
  entlastungStundensatz: __N('betraege.stundensatz'), // € pro Stunde (L33: 0,68 €/Min.)
  hausbesuchPauschale: 0, // € pro Einsatz, 0 = aus
  investitionskostenProzent: 0, // % privat, 0 = aus
  // Einsätze pro Monat = pro Woche × 52/12
  wochenProMonat: 52 / 12,
};

// type: "fix" = pro Einsatz, "minute" = pro Minute | once: einmalige Leistung
export const LEISTUNGEN: Leistung[] = __LEISTUNGEN('preise.items');

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
