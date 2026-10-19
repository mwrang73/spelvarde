// Knappsatsen i S4 (beslut 4B): tillståndsmaskinen och texterna för läget.
// Rena funktioner utan React, testade i lib/odds-keypad.test.ts. Tolkningen
// av siffrorna ligger i lib/odds-input.ts.
//
// Regler (specen S4):
// - Siffrorna tolkas med två decimaler, högst 4 siffror.
// - Tre siffror och ett odds på 1,01–9,99: oddset sparas direkt och appen går
//   vidare efter 350 ms. Ett nytt tryck under den tiden avbryter övergången
//   (och räknas som ett vanligt tryck, så 1-2-5-0 blir 12,50).
// - Fyra siffror kräver Nästa.
// - Radera tar bort en siffra. Radera på tom display frågar "Ta bort oddset
//   för <häst>?" om hästen har ett sparat odds.
// - Nästa sparar det som står i displayen (om det är giltigt) och går vidare.
//   Tom display går vidare utan att ändra något.

import { odds as formatOdds } from "@/lib/format";
import { digitsToOdds, isValidOdds, ODDS_MIN, ODDS_RANGE_ERROR, popDigit, pushDigit, shouldAutoAdvance } from "@/lib/odds-input";
import { oddsDiff, type Override } from "@/lib/spelbar";

export type KeypadState = {
  // Plats i kön. index === total betyder att kön är slut.
  index: number;
  total: number;
  digits: string;
  // Väntande automatiskt hopp (token). null = inget.
  advance: number | null;
  seq: number;
  // Frågan "Ta bort oddset för …?" visas.
  confirmDelete: boolean;
  error: string | null;
};

export type KeypadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "del" | "next" | "prev" | "skip";

export type KeypadAction =
  | { type: "key"; key: KeypadKey }
  // Timern för det automatiska hoppet har gått ut.
  | { type: "advance"; token: number }
  | { type: "confirm"; yes: boolean }
  // Kön har ändrat längd (t.ex. när omgången hämtades på nytt).
  | { type: "resize"; total: number };

export type KeypadEffect = { type: "save"; index: number; odds: number } | { type: "delete"; index: number };

// Det som reducern behöver veta om hästen som visas.
export type KeypadContext = { savedOdds: number | null };

export const MIN_ODDS_ERROR = "Oddset måste vara minst 1,01.";

export function initialKeypad(total: number, index = 0): KeypadState {
  return { index: Math.max(0, Math.min(index, total)), total, digits: "", advance: null, seq: 0, confirmDelete: false, error: null };
}

export const isDone = (s: KeypadState) => s.index >= s.total;

const DIGITS = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

function moveTo(s: KeypadState, index: number): KeypadState {
  return { ...s, index: Math.max(0, Math.min(index, s.total)), digits: "", advance: null, confirmDelete: false, error: null };
}

export function keypadReduce(s: KeypadState, action: KeypadAction, ctx: KeypadContext): { state: KeypadState; effect: KeypadEffect | null } {
  const none = (state: KeypadState) => ({ state, effect: null });

  if (action.type === "resize") return none({ ...s, total: action.total, index: Math.min(s.index, action.total) });
  if (action.type === "advance") return none(s.advance !== null && s.advance === action.token ? moveTo(s, s.index + 1) : s);
  if (action.type === "confirm") {
    if (!s.confirmDelete) return none(s);
    const state = { ...s, confirmDelete: false };
    return action.yes && ctx.savedOdds !== null && !isDone(s) ? { state, effect: { type: "delete", index: s.index } } : none(state);
  }

  const key = action.key;
  // Medan frågan visas gäller bara Ja och Avbryt.
  if (s.confirmDelete) return none(s);
  if (key === "prev") return none(moveTo(s, Math.min(s.index, s.total) - 1));
  if (isDone(s)) return none(s);
  if (key === "skip") return none(moveTo(s, s.index + 1));

  // Ett tryck avbryter alltid ett väntande hopp.
  const base: KeypadState = { ...s, advance: null, error: null };

  if (DIGITS.has(key)) {
    const digits = pushDigit(base.digits, key);
    if (digits === base.digits) return none(base);
    if (shouldAutoAdvance(digits)) {
      const seq = base.seq + 1;
      const odds = digitsToOdds(digits)!;
      return { state: { ...base, digits, seq, advance: seq }, effect: odds === ctx.savedOdds ? null : { type: "save", index: s.index, odds } };
    }
    const odds = digitsToOdds(digits);
    const error = digits.length === 3 && odds !== null && odds < ODDS_MIN ? MIN_ODDS_ERROR : null;
    return none({ ...base, digits, error });
  }

  if (key === "del") {
    if (base.digits) return none({ ...base, digits: popDigit(base.digits) });
    return none(ctx.savedOdds !== null ? { ...base, confirmDelete: true } : base);
  }

  // Nästa.
  if (!base.digits) return none(moveTo(base, s.index + 1));
  const odds = digitsToOdds(base.digits);
  if (odds === null || !isValidOdds(odds)) return none({ ...base, error: ODDS_RANGE_ERROR });
  return { state: moveTo(base, s.index + 1), effect: odds === ctx.savedOdds ? null : { type: "save", index: s.index, odds } };
}

// Tangentbordet på desktop: siffror, Backsteg, Enter (Nästa), ← (Föregående)
// och Tab (Hoppa över). Komma och punkt ignoreras. null = inte knappsatsens tangent.
export function keyFromKeyboard(e: { key: string; shiftKey?: boolean }): KeypadKey | "ignore" | null {
  if (DIGITS.has(e.key)) return e.key as KeypadKey;
  if (e.key === "," || e.key === "." || e.key === "Decimal") return "ignore";
  if (e.key === "Backspace" || e.key === "Delete") return "del";
  if (e.key === "Enter") return "next";
  if (e.key === "ArrowLeft") return "prev";
  if (e.key === "Tab" && !e.shiftKey) return "skip";
  return null;
}

// ---- Läget i ord ---------------------------------------------------------------------

export type Verdict = { tone: "ok" | "no" | "warn" | "help"; text: string; below: boolean };

const sv = (x: number) => formatOdds(Math.abs(x));

// Resultatraden i S4 för oddset i displayen (eller det sparade).
// "0,70 över riktoddset · föreslås som Spelbar", "0,10 under riktoddset · inte spelbar".
export function keypadVerdict(m: { odds: number | null; riktodds: number | null; interesting: boolean; override: Override; guideline: number }): Verdict {
  const below = m.odds !== null && m.odds < m.guideline;
  if (m.odds === null) return { tone: "help", text: "Skriv tre siffror, till exempel 3 1 0 för 3,10.", below: false };
  if (m.riktodds === null) return { tone: "warn", text: "Riktodds saknas – hämta omgången igen. Oddset sparas ändå.", below };
  const d = oddsDiff(m.odds, m.riktodds)!;
  const head = d > 0 ? `${sv(d)} över riktoddset` : d < 0 ? `${sv(d)} under riktoddset` : "Samma som riktoddset";
  let tail: string;
  if (d > 0) tail = !m.interesting ? "inte Intressant" : m.override === "OFF" ? "Spelbar borttagen av dig" : "föreslås som Spelbar";
  else tail = m.override === "ON" ? "Spelbar satt av dig" : "inte spelbar";
  const spelbar = m.override === "ON" || (m.override === "NONE" && m.interesting && d > 0);
  return { tone: spelbar ? "ok" : "no", text: `${head} · ${tail}`, below };
}

// Meningen i RiktoddsBox (S3).
export function riktoddsSentence(m: { unibetOdds: number | null; riktodds: number | null; interesting: boolean; spelbar: boolean; override: Override }): string {
  if (m.riktodds === null) return m.unibetOdds === null ? "Riktodds saknas för hästen." : "Riktodds saknas, så förslaget kan inte räknas.";
  if (m.unibetOdds === null) return "Fyll i Unibet-odds för att se om hästen är spelbar";
  const d = oddsDiff(m.unibetOdds, m.riktodds)!;
  const how = d > 0 ? `Unibet ger ${sv(d)} mer än riktoddset` : d < 0 ? `Unibet ger ${sv(d)} mindre än riktoddset` : "Unibet ger samma odds som riktoddset";
  if (m.spelbar) return m.override === "ON" ? `Spelbar (satt av dig): ${how}` : `Spelbar: ${how}`;
  if (m.override === "OFF") return `Inte spelbar (borttagen av dig): ${how}`;
  if (!m.interesting && d > 0) return `${how}. Markera Intressant för att få förslaget.`;
  return `Inte spelbar: ${how}`;
}

// "Under 2,00" för riktlinjen.
export const guidelineTag = (guideline: number) => `Under ${formatOdds(guideline)}`;

// ---- Kön ---------------------------------------------------------------------------------

// Alla Intressant och alla med Bet i omgången, i avdelnings- och
// startnummerordning. De som redan har odds ligger sist, så att en ny
// körning börjar med det som saknas. Strukna och lopp som har startat hoppas över.
export function buildOddsQueue(
  races: { leg: number; startAt: string; started: boolean; cancelled: boolean; starts: { id: string; number: number; scratched: boolean; mark: { interesting: boolean; bet: boolean; unibetOdds: number | null } | null }[] }[],
  now: number,
): string[] {
  const rows = races
    .filter((r) => !r.cancelled && !r.started && Date.parse(r.startAt) > now)
    .flatMap((r) => r.starts.filter((s) => !s.scratched && (s.mark?.interesting || s.mark?.bet)).map((s) => ({ id: s.id, leg: r.leg, number: s.number, has: s.mark?.unibetOdds != null })));
  rows.sort((a, b) => Number(a.has) - Number(b.has) || a.leg - b.leg || a.number - b.number);
  return rows.map((r) => r.id);
}
