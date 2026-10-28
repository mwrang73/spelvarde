// V85-raden i S6b: det som vyn behöver utöver lib/coupon.ts. Rena funktioner
// utan React, testade i lib/coupon-ui.test.ts.

import { BUDGET_MAX, BUDGET_MIN, couponCost, LEGS, rowCount, type Selections } from "@/lib/coupon";
import { legsFor } from "@/lib/game-type";
import type { CouponBody, CouponBodyE6 } from "@/lib/round-overlay";
import type { TippaLeg } from "@/lib/tippa";
import type { CouponDto, RoundResponse } from "@/lib/types";
import { riktX, xOf } from "@/lib/xfactor-ui";
import type { XFactorSettings } from "@/lib/xfactor";

// E6: avdelningarna 1..legsFor(gameType) som indata till buildRad (6.5.1).
// riktX = riktoddset med X-faktor (räknat med factors när de finns, annars
// serverns värde). Saknas en avdelning i omgången blir den tom (utan startande).
export function tippaLegs(data: RoundResponse, factors?: XFactorSettings): TippaLeg[] {
  const out: TippaLeg[] = [];
  for (let leg = 1; leg <= legsFor(data.round.gameType); leg++) {
    const r = data.races.find((x) => x.leg === leg);
    if (!r) {
      out.push({ leg, startAt: "", cancelled: false, starts: [] });
      continue;
    }
    out.push({
      leg,
      startAt: r.startAt,
      cancelled: r.cancelled,
      starts: r.starts
        .map((s) => ({
          number: s.number,
          name: s.horse.name,
          scratched: s.scratched,
          streck: s.streck,
          riktX: s.scratched ? null : riktX(s, factors),
          signals: s.signals?.count ?? null,
          interesting: !!s.mark?.interesting,
          spelbar: !!s.mark?.spelbar,
          bet: !!s.mark?.bet,
          betOdds: s.mark?.betOdds ?? null,
          xFactor: xOf(s.mark),
        }))
        .sort((a, b) => a.number - b.number),
    });
  }
  return out;
}

export function selectionsOf(c: CouponDto | null): Selections {
  const out: Selections = {};
  if (!c) return out;
  for (const [k, v] of Object.entries(c.selections)) out[Number(k)] = [...v].sort((a, b) => a - b);
  return out;
}

// Ett tryck på en häst i arket Ändra avdelning (A4).
export function toggleNumber(current: number[], n: number): number[] {
  return current.includes(n) ? current.filter((x) => x !== n) : [...current, n].sort((a, b) => a - b);
}

export type CouponSummary = { rows: number; cost: number; left: number; over: boolean };

export function couponSummary(selections: Selections, budget: number, rowPrice: number, legs = 8): CouponSummary {
  const rows = rowCount(selections, legs);
  const cost = couponCost(rows, rowPrice);
  const left = Math.round((budget - cost) * 100) / 100;
  return { rows, cost, left, over: left < 0 };
}

const selRecord = (selections: Selections): Record<string, number[]> => {
  const sel: Record<string, number[]> = {};
  for (const leg of LEGS) {
    const nums = selections[leg];
    if (nums?.length) sel[String(leg)] = [...new Set(nums)].sort((a, b) => a - b);
  }
  return sel;
};

// Kroppen till PUT /api/rounds/[id]/coupon. Tomma avdelningar skickas inte.
// E6 (9.3): skicka alltid hela kroppen med e6, så att sammanslagningen i
// utkorgen aldrig tappar copiedAt.
export function couponBody(budget: number, rowPrice: number | null, selections: Selections, locked: number[], e6?: CouponBodyE6Input): CouponBody {
  const body: CouponBody = { budget, rowPrice, selections: selRecord(selections), lockedLegs: [...new Set(locked)].sort((a, b) => a - b) };
  if (!e6) return body;
  return {
    ...body,
    spikCount: e6.spikCount,
    allgMode: e6.allgMode,
    allgLeg: e6.allgLeg,
    legRoles: e6.legRoles,
    copiedAt: e6.copiedAt,
    copiedSelections: e6.copiedSelections ? selRecord(e6.copiedSelections) : null,
  };
}
export type CouponBodyE6Input = Omit<Required<CouponBodyE6>, "copiedSelections"> & { copiedSelections: Selections | null };

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
