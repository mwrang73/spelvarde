// Inmatning av Unibets platsodds (specen S4 och S6a). Rena funktioner, testade
// i lib/odds-input.test.ts.
//
// Knappsatsen tolkar siffrorna med två decimaler: 3-1-0 = 3,10, 1-2-5-0 =
// 12,50 och 2 = 0,02 tills fler siffror kommer. Högst 4 siffror. Komma och
// punkt ignoreras. Godkänt intervall 1,01–99,99.

export const ODDS_MIN = 1.01;
export const ODDS_MAX = 99.99;
export const MAX_DIGITS = 4;
// Med tre siffror och ett odds på 1,01–9,99 sparas oddset och appen går
// vidare efter så här lång tid.
export const AUTO_ADVANCE_MS = 350;
export const ODDS_RANGE_ERROR = "Oddset ska ligga mellan 1,01 och 99,99.";

export function isValidOdds(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= ODDS_MIN - 1e-9 && x <= ODDS_MAX + 1e-9 && Math.abs(x * 100 - Math.round(x * 100)) < 1e-6;
}

// Lägger till en siffra (eller ignorerar komma, punkt och en inledande nolla).
export function pushDigit(digits: string, key: string): string {
  if (!/^\d$/.test(key)) return digits;
  if (digits.length >= MAX_DIGITS) return digits;
  if (!digits && key === "0") return digits;
  return digits + key;
}

export const popDigit = (digits: string) => digits.slice(0, -1);

// "310" → 3.1, "1250" → 12.5, "2" → 0.02, "" → null.
export function digitsToOdds(digits: string): number | null {
  const d = digits.replace(/[^\d]/g, "");
  if (!d) return null;
  return Number(d) / 100;
}

// "3,10" / "3.10" / "310" → "310" (siffrorna som knappsatsen skulle ha fått).
export function keysToDigits(keys: string): string {
  let d = "";
  for (const k of keys) d = pushDigit(d, k);
  return d;
}

// Ska knappsatsen spara och hoppa vidare direkt? Tre siffror och 1,01–9,99.
export function shouldAutoAdvance(digits: string): boolean {
  if (digits.length !== 3) return false;
  const o = digitsToOdds(digits);
  return o !== null && o >= ODDS_MIN && o <= 9.99;
}

// Visning i LED-displayen: "3,10", "0,02", "" för tom.
export function displayDigits(digits: string): string {
  const o = digitsToOdds(digits);
  return o === null ? "" : o.toFixed(2).replace(".", ",");
}

// Fältet i S6a: samma tolkning som knappsatsen. Med decimaltecken tolkas
// texten som ett vanligt decimaltal ("3,1" = 3,10), annars som siffror med
// två decimaler ("310" = 3,10).
export function parseOddsText(text: string): { ok: true; value: number } | { ok: false; error: string } {
  const t = text.trim().replace(/\s/g, "");
  let value: number | null = null;
  if (/^\d{1,2}[.,]\d{0,2}$/.test(t)) value = Math.round(Number(t.replace(",", ".")) * 100) / 100;
  else if (/^\d{1,4}$/.test(t)) value = digitsToOdds(keysToDigits(t));
  if (value === null || !isValidOdds(value)) return { ok: false, error: ODDS_RANGE_ERROR };
  return { ok: true, value };
}
