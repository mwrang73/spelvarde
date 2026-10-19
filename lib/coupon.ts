// V85-raden (specen 6.5 och S6b): rader, kostnad, ordningen för förslag,
// "Föreslå inom budget" och texten för Kopiera rad. Rena funktioner, testade
// i lib/coupon.test.ts. Förslaget räknas i klienten; servern sparar bara
// kupongen (PUT /api/rounds/[id]/coupon) och kontrollerar den.

import { stockholmParts } from "@/lib/stockholm-time";
import type { Result } from "@/lib/validate";

export const LEGS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const DEFAULT_ROW_PRICE = 0.5;
export const DEFAULT_BUDGET = 100;
export const BUDGET_MIN = 0;
export const BUDGET_MAX = 100_000;
// Reglaget i S6b.
export const BUDGET_SLIDER = { min: 20, max: 1000, step: 10 } as const;

// Valda startnummer per avdelning, { 1: [3, 10], 2: [5], … }.
export type Selections = Record<number, number[]>;

export type CouponStart = {
  number: number;
  scratched: boolean;
  spelbar: boolean;
  interesting: boolean;
  riktodds: number | null;
  // Streck i procent.
  streck: number | null;
};

export type CouponLeg = { leg: number; starts: CouponStart[]; started?: boolean };

const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

export function rowCount(selections: Selections): number {
  let rows = 1;
  for (const leg of LEGS) rows *= selections[leg]?.length ?? 0;
  return rows;
}

export const couponCost = (rows: number, rowPrice: number) => r2(rows * rowPrice);

// Ordningen för förslag i en avdelning: Spelbar (lägst riktodds först),
// övriga Intressant (lägst riktodds först), sist resten efter högst streck.
// Saknas riktodds sorteras hästen på streck, efter dem som har riktodds.
// Strukna är inte med.
export function suggestionOrder(starts: CouponStart[]): number[] {
  const group = (s: CouponStart) => (s.spelbar ? 0 : s.interesting ? 1 : 2);
  const streck = (s: CouponStart) => s.streck ?? -1;
  return starts
    .filter((s) => !s.scratched)
    .sort((a, b) => {
      const g = group(a) - group(b);
      if (g) return g;
      if (group(a) < 2) {
        if (a.riktodds !== null && b.riktodds !== null && a.riktodds !== b.riktodds) return a.riktodds - b.riktodds;
        if (a.riktodds !== null && b.riktodds === null) return -1;
        if (a.riktodds === null && b.riktodds !== null) return 1;
      }
      return streck(b) - streck(a) || a.number - b.number;
    })
    .map((s) => s.number);
}

// Favoritens streck i avdelningen (högst streck bland de ej strukna). Saknas = 0.
export function favoriteStreck(starts: CouponStart[]): number {
  return Math.max(0, ...starts.filter((s) => !s.scratched).map((s) => s.streck ?? 0));
}

// "Föreslå inom budget" (6.5), girig:
// 1. 1 häst i varje avdelning som inte är låst (eller har startat).
// 2. Varv efter varv genom avdelningarna, sorterade efter lägst streck för
//    favoriten (mest öppna lopp först): lägg till nästa häst i ordningen om
//    kostnaden ryms i budgeten.
// 3. Sluta när ett helt varv inte lade till något.
// Låsta avdelningar behåller sitt val och räknas in i kostnaden.
export function suggestCoupon(legs: CouponLeg[], opts: { budget: number; rowPrice: number; locked: number[]; current: Selections }): Selections {
  const locked = new Set(opts.locked);
  const out: Selections = {};
  const orders = new Map<number, number[]>();
  for (const l of legs) {
    if (locked.has(l.leg) || l.started) {
      out[l.leg] = [...(opts.current[l.leg] ?? [])];
      continue;
    }
    const order = suggestionOrder(l.starts);
    orders.set(l.leg, order);
    out[l.leg] = order.slice(0, 1);
  }
  const free = legs
    .filter((l) => orders.has(l.leg))
    .sort((a, b) => favoriteStreck(a.starts) - favoriteStreck(b.starts) || a.leg - b.leg)
    .map((l) => l.leg);
  // Raderna räknas över avdelningarna som skickades in.
  const rows = (sel: Selections) => legs.reduce((a, l) => a * (sel[l.leg]?.length ?? 0), 1);
  const fits = (sel: Selections) => couponCost(rows(sel), opts.rowPrice) <= opts.budget + 1e-9;
  for (;;) {
    let added = false;
    for (const leg of free) {
      const order = orders.get(leg)!;
      const have = out[leg].length;
      if (have >= order.length) continue;
      const trial = { ...out, [leg]: order.slice(0, have + 1) };
      if (fits(trial)) {
        out[leg] = trial[leg];
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}

// "lör 24 okt 2026" för ett datum "2026-10-24".
export function couponDateLabel(date: string): string {
  const p = stockholmParts(new Date(`${date}T12:00:00Z`));
  return `${p.weekdayShort} ${p.day} ${p.monthShort} ${p.year}`;
}

const krText = (x: number) => `${x.toFixed(2).replace(".", ",")} kr`;

// Texten för Kopiera rad (6.5).
export function couponText(round: { trackName: string; date: string }, selections: Selections, rowPrice: number): string {
  const rows = rowCount(selections);
  const lines = [`V85 ${round.trackName} ${couponDateLabel(round.date)}`];
  for (const leg of LEGS) {
    const nums = [...(selections[leg] ?? [])].sort((a, b) => a - b);
    lines.push(`Avd ${leg}: ${nums.length ? nums.join(", ") : "–"}`);
  }
  lines.push(`${rows} ${rows === 1 ? "rad" : "rader"} · ${krText(couponCost(rows, rowPrice))}`);
  return lines.join("\n");
}

// ---- Kroppen till PUT /api/rounds/[id]/coupon -----------------------------------------------

export type CouponInput = { budget: number; rowPrice: number | null; selections: Selections; lockedLegs: number[] };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function parseCouponBody(body: Record<string, unknown>): Result<CouponInput> {
  const unknown = Object.keys(body).filter((k) => !["budget", "rowPrice", "selections", "lockedLegs"].includes(k));
  if (unknown.length) return fail("Okänt fält i kupongen.");
  const budget = body.budget;
  if (typeof budget !== "number" || !Number.isInteger(budget) || budget < BUDGET_MIN || budget > BUDGET_MAX) return fail("Budgeten ska vara ett heltal mellan 0 och 100 000 kr.");
  let rowPrice: number | null = null;
  if (body.rowPrice !== undefined && body.rowPrice !== null) {
    if (typeof body.rowPrice !== "number" || !Number.isFinite(body.rowPrice) || body.rowPrice < 0.01 || body.rowPrice > 100) return fail("Radpriset ska ligga mellan 0,01 och 100 kr.");
    rowPrice = r2(body.rowPrice);
  }
  const sel = body.selections;
  if (!sel || typeof sel !== "object" || Array.isArray(sel)) return fail("selections ska vara ett objekt med avdelning som nyckel.");
  const selections: Selections = {};
  for (const [k, v] of Object.entries(sel as Record<string, unknown>)) {
    const leg = Number(k);
    if (!/^[1-8]$/.test(k)) return fail("Avdelningarna är 1–8.");
    if (!Array.isArray(v) || v.length > 30 || !v.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 30)) return fail(`Ogiltiga startnummer i avd ${leg}.`);
    selections[leg] = [...new Set(v as number[])].sort((a, b) => a - b);
  }
  const lockedRaw = body.lockedLegs ?? [];
  if (!Array.isArray(lockedRaw) || !lockedRaw.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 8)) return fail("lockedLegs ska vara avdelningar 1–8.");
  const lockedLegs = [...new Set(lockedRaw as number[])].sort((a, b) => a - b);
  return { ok: true, value: { budget, rowPrice, selections, lockedLegs } };
}

// Tolkar Coupon.selections (JSON) från databasen.
export function asSelections(x: unknown): Selections {
  const out: Selections = {};
  if (!x || typeof x !== "object" || Array.isArray(x)) return out;
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (/^[1-8]$/.test(k) && Array.isArray(v)) out[Number(k)] = v.filter((n): n is number => typeof n === "number" && Number.isInteger(n));
  }
  return out;
}

export const sameNumbers = (a: number[] | undefined, b: number[] | undefined) => {
  const x = [...(a ?? [])].sort((p, q) => p - q);
  const y = [...(b ?? [])].sort((p, q) => p - q);
  return x.length === y.length && x.every((n, i) => n === y[i]);
};
