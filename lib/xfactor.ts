// X-faktor och källstöd (specen 6.8, E2.1). Rena funktioner utan React och
// databas, så att klienten (direkt visning) och servern (forslag/spelbar)
// räknar exakt lika. Testade i lib/xfactor.test.ts.
//
// X-faktorn är Mikaels egen krydda. Den sänker riktoddset:
//   riktoddsX = xFactor === "NONE" ? riktodds : max(1,01, round2(riktodds / faktor))
// där faktorn är användarens inställning för läget (S10). Saknas riktodds är
// riktoddsX null. Appen sätter aldrig X-faktorn själv, och källstödet påverkar
// varken riktoddset eller Spelbar.

import { round2 } from "@/lib/riktodds";
import type { Result } from "@/lib/validate";

export type XFactor = "NONE" | "TROR" | "STARK";
export const XFACTORS: readonly XFactor[] = ["NONE", "TROR", "STARK"] as const;

// Användarens faktorer (UserSettings.xFactorTror/xFactorStark).
export type XFactorSettings = { xFactorTror: number; xFactorStark: number };

export const DEFAULT_X_TROR = 1.25;
export const DEFAULT_X_STARK = 1.5;
export const DEFAULT_X_FACTORS: XFactorSettings = { xFactorTror: DEFAULT_X_TROR, xFactorStark: DEFAULT_X_STARK };
export const X_FACTOR_MIN = 1.05;
export const X_FACTOR_MAX = 3.0;
// Golvet för riktoddset med X-faktor (lägsta odds som finns).
export const RIKTODDS_X_FLOOR = 1.01;
export const SOURCE_SUPPORT_MAX = 20;

export const X_FACTOR_ERROR = "Okänt läge för X-faktor.";
export const X_NEEDS_INTERESTING = "X-faktor kräver Intressant.";
export const SOURCE_SUPPORT_ERROR = "Källstödet ska vara ett heltal mellan 0 och 20.";
export const X_FACTOR_RANGE_ERROR = "Faktorn ska ligga mellan 1,05 och 3,00.";
export const X_FACTOR_ORDER_ERROR = "Stark känsla ska vara större än Tror på.";

export const X_LABEL: Record<XFactor, string> = { NONE: "Ingen", TROR: "Tror på", STARK: "Stark känsla" };
// Märket efter S och B (Badge x/xp). NONE har inget märke.
export const X_BADGE: Record<XFactor, string | null> = { NONE: null, TROR: "X", STARK: "X+" };

export const isXFactor = (v: unknown): v is XFactor => typeof v === "string" && (XFACTORS as readonly string[]).includes(v);

// Tänder läget Intressant (Tror på och Stark känsla gör det, Ingen aldrig).
export const xTurnsOnInteresting = (x: XFactor) => x !== "NONE";

// Faktorn för läget: 1 för Ingen, annars användarens faktor.
export function factorFor(x: XFactor, s: XFactorSettings = DEFAULT_X_FACTORS): number {
  if (x === "TROR") return s.xFactorTror;
  if (x === "STARK") return s.xFactorStark;
  return 1;
}

// Riktoddset med X-faktor. null när riktodds saknas.
export function riktoddsX(riktodds: number | null, x: XFactor, s: XFactorSettings = DEFAULT_X_FACTORS): number | null {
  if (riktodds === null) return null;
  if (x === "NONE") return riktodds;
  return Math.max(RIKTODDS_X_FLOOR, round2(riktodds / factorFor(x, s)));
}

// Nästa läge vid X (Ingen → Tror på → Stark känsla → Ingen) och Shift + X (baklänges).
export function nextXFactor(x: XFactor, backwards = false): XFactor {
  const i = XFACTORS.indexOf(x);
  const n = XFACTORS.length;
  return XFACTORS[(i + (backwards ? n - 1 : 1)) % n];
}

const dec2 = (x: number) => x.toFixed(2).replace(".", ",");

// "÷1,25" under segmentet och i RiktoddsBox.
export const factorText = (x: XFactor, s: XFactorSettings = DEFAULT_X_FACTORS) => `÷${dec2(factorFor(x, s))}`;

// X-steget som läggs till serverns beräkningsrad (RiktoddsDetailDto.calcLine):
// "… = 3,20" → "… = 3,20 → ÷ 1,25 (Tror på) = 2,56". Utan X eller utan
// riktodds är raden oförändrad.
export function calcLineWithX(calcLine: string, riktodds: number | null, x: XFactor, s: XFactorSettings = DEFAULT_X_FACTORS): string {
  const rx = riktoddsX(riktodds, x, s);
  if (x === "NONE" || rx === null) return calcLine;
  return `${calcLine} → ÷ ${dec2(factorFor(x, s))} (${X_LABEL[x]}) = ${dec2(rx)}`;
}

const hundredths = (x: number) => Math.abs(x * 100 - Math.round(x * 100)) < 1e-6;

// En faktor (1,05–3,00, hundradelar).
export function parseFactor(v: unknown): Result<number> {
  if (typeof v !== "number" || !Number.isFinite(v) || !hundredths(v)) return { ok: false, error: X_FACTOR_RANGE_ERROR };
  const r = round2(v);
  if (r < X_FACTOR_MIN || r > X_FACTOR_MAX) return { ok: false, error: X_FACTOR_RANGE_ERROR };
  return { ok: true, value: r };
}

// Faktorerna tillsammans: Stark känsla ska vara större än Tror på.
export function checkFactors(s: XFactorSettings): Result<XFactorSettings> {
  for (const v of [s.xFactorTror, s.xFactorStark]) {
    const p = parseFactor(v);
    if (!p.ok) return p;
  }
  if (!(s.xFactorStark > s.xFactorTror)) return { ok: false, error: X_FACTOR_ORDER_ERROR };
  return { ok: true, value: s };
}

// Källstöd: heltal 0–20 eller null (inte ifyllt).
export function parseSourceSupport(v: unknown): Result<number | null> {
  if (v === null) return { ok: true, value: null };
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > SOURCE_SUPPORT_MAX) return { ok: false, error: SOURCE_SUPPORT_ERROR };
  return { ok: true, value: v };
}

// "2 av 4 källor pekar ut hästen" / "Inte ifyllt · 4 påslagna källor".
export function sourceSupportText(n: number | null, m: number): string {
  if (n === null) return `Inte ifyllt · ${m} ${m === 1 ? "påslagen källa" : "påslagna källor"}`;
  return `${n} av ${m} ${m === 1 ? "källa" : "källor"} pekar ut hästen`;
}

// Stegaren: + och − inom 0..min(m, 20). Ett sparat värde över m (en källa har
// stängts av) får gå nedåt. Tomt: + ger 1, − ger 0.
export function stepSourceSupport(n: number | null, m: number, delta: 1 | -1): number | null {
  const max = Math.min(m, SOURCE_SUPPORT_MAX);
  if (n === null) return delta > 0 ? Math.min(1, max) : 0;
  if (delta > 0) return n >= max ? n : n + 1;
  return n <= 0 ? 0 : n - 1;
}
