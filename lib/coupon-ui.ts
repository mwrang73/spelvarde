// V85-raden i S6b: det som vyn behöver utöver lib/coupon.ts. Rena funktioner
// utan React, testade i lib/coupon-ui.test.ts.

import { BUDGET_MAX, BUDGET_MIN, couponCost, LEGS, rowCount, suggestionOrder, type CouponLeg, type Selections } from "@/lib/coupon";
import type { CouponBody } from "@/lib/round-overlay";
import type { CouponDto, RoundResponse } from "@/lib/types";

// Avdelningarna i omgången som indata till förslaget (6.5).
export function couponLegs(data: RoundResponse): CouponLeg[] {
  return data.races.map((r) => ({
    leg: r.leg,
    started: r.started,
    starts: r.starts.map((s) => ({
      number: s.number,
      scratched: s.scratched,
      spelbar: !!s.mark?.spelbar,
      interesting: !!s.mark?.interesting,
      // Från E2.1 sorteras på riktoddset med X-faktor (6.5). Utan Mark = riktodds.
      riktodds: s.mark?.riktoddsX ?? s.riktodds,
      streck: s.streck,
    })),
  }));
}

export function selectionsOf(c: CouponDto | null): Selections {
  const out: Selections = {};
  if (!c) return out;
  for (const [k, v] of Object.entries(c.selections)) out[Number(k)] = [...v].sort((a, b) => a - b);
  return out;
}

// Stepper: + lägger till nästa häst i förslagets ordning som inte är vald,
// − tar bort den valda som kommer sist i ordningen. Minst 1 när något är
// valt, högst antal startande.
export function stepLeg(leg: CouponLeg, current: number[], delta: 1 | -1): number[] {
  const order = suggestionOrder(leg.starts);
  const have = new Set(current);
  if (delta > 0) {
    const next = order.find((n) => !have.has(n));
    return next === undefined ? current : [...current, next].sort((a, b) => a - b);
  }
  if (current.length <= 1) return current;
  const rank = (n: number) => {
    const i = order.indexOf(n);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const drop = [...current].sort((a, b) => rank(b) - rank(a))[0];
  return current.filter((n) => n !== drop);
}

export const legMax = (leg: CouponLeg) => leg.starts.filter((s) => !s.scratched).length;

// Ett tryck på en häst i arket "Eget val".
export function toggleNumber(current: number[], n: number): number[] {
  return current.includes(n) ? current.filter((x) => x !== n) : [...current, n].sort((a, b) => a - b);
}

export type CouponSummary = { rows: number; cost: number; left: number; over: boolean };

export function couponSummary(selections: Selections, budget: number, rowPrice: number): CouponSummary {
  const rows = rowCount(selections);
  const cost = couponCost(rows, rowPrice);
  const left = Math.round((budget - cost) * 100) / 100;
  return { rows, cost, left, over: left < 0 };
}

// Kroppen till PUT /api/rounds/[id]/coupon. Tomma avdelningar skickas inte.
export function couponBody(budget: number, rowPrice: number | null, selections: Selections, locked: number[]): CouponBody {
  const sel: Record<string, number[]> = {};
  for (const leg of LEGS) {
    const nums = selections[leg];
    if (nums?.length) sel[String(leg)] = [...nums].sort((a, b) => a - b);
  }
  return { budget, rowPrice, selections: sel, lockedLegs: [...new Set(locked)].sort((a, b) => a - b) };
}

// Fältet för exakt budget: hela kronor, 0–100 000. "1 000" och "250 kr" går bra.
export function parseBudget(text: string): number | null {
  const t = text.replace(/\s|kr/gi, "");
  if (!/^\d{1,6}$/.test(t)) return null;
  const n = Number(t);
  return n >= BUDGET_MIN && n <= BUDGET_MAX ? n : null;
}
export const BUDGET_ERROR = "Budgeten ska vara ett heltal mellan 0 och 100 000 kr.";

// Radpriset: "0,50", "0.5" eller "1" kr, 0,01–100.
export function parseRowPrice(text: string): number | null {
  const t = text.replace(/\s|kr/gi, "").replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const n = Math.round(Number(t) * 100) / 100;
  return n >= 0.01 && n <= 100 ? n : null;
}
export const ROW_PRICE_ERROR = "Radpriset ska ligga mellan 0,01 och 100,00 kr.";

// Riktlinjen för Unibet-odds (S10): 1,01–99,99 som odds.
export function parseGuideline(text: string): number | null {
  const t = text.replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return null;
  const n = Math.round(Number(t) * 100) / 100;
  return n >= 1.01 && n <= 99.99 ? n : null;
}
export const GUIDELINE_ERROR = "Riktlinjen ska ligga mellan 1,01 och 99,99.";
