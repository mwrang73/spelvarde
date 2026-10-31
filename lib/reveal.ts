// Resultatskyddet (E8, docs/specs/e8-live.md 8.1): vilka lopp som är visade på
// enheten. Rena funktioner, testade i lib/reveal.test.ts. Lagret med
// localStorage ligger i components/round/revealStore.ts.
//
// Skyddet gäller vad som visas och läses upp, inte vad som går att hitta i
// utvecklarverktygen.

export const REVEAL_STORAGE_KEY = "sv-visat";
export const REVEAL_MAX_ROUNDS = 40;

// Omgångens id mot listan av visade lopp. Äldst valda omgång först.
export type RevealState = Record<string, number[]>;

export const EMPTY_REVEAL: RevealState = Object.freeze({}) as RevealState;
const NO_LEGS: readonly number[] = Object.freeze([]) as readonly number[];

const isLeg = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= 99;

// Tom eller skadad lagring ger tomt.
export function parseReveal(raw: string | null | undefined): RevealState {
  if (!raw) return EMPTY_REVEAL;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return EMPTY_REVEAL;
    const out: RevealState = {};
    for (const [id, legs] of Object.entries(data)) {
      if (!Array.isArray(legs)) continue;
      const clean = [...new Set(legs.filter(isLeg))].sort((a, b) => a - b);
      if (clean.length) out[id] = clean;
    }
    return out;
  } catch {
    return EMPTY_REVEAL;
  }
}

export const shownLegsOf = (state: RevealState, roundId: string): readonly number[] => state[roundId] ?? NO_LEGS;

// Visa ett lopp. Omgången blir nyast, och över gränsen försvinner den äldsta.
export function showLeg(state: RevealState, roundId: string, leg: number): RevealState {
  const legs = shownLegsOf(state, roundId);
  if (legs.includes(leg)) return state;
  const rest = Object.entries(state).filter(([id]) => id !== roundId);
  const entries: [string, number[]][] = [...rest, [roundId, [...legs, leg].sort((a, b) => a - b)]];
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - REVEAL_MAX_ROUNDS)));
}

// Dölj ett lopp. Andra lopp och omgångar rörs inte.
export function hideLeg(state: RevealState, roundId: string, leg: number): RevealState {
  const legs = shownLegsOf(state, roundId);
  if (!legs.includes(leg)) return state;
  const next = { ...state };
  const left = legs.filter((l) => l !== leg);
  if (left.length) next[roundId] = left;
  else delete next[roundId];
  return next;
}

// Ett lopp visas när resultatet finns, loppet inte är inställt och valet är satt.
export function isShown(race: { leg: number; resultAt: string | null; cancelled: boolean }, shownLegs: readonly number[]): boolean {
  return !!race.resultAt && !race.cancelled && shownLegs.includes(race.leg);
}

// Kommentar från samma omgång med dolt lopp: placeringen utelämnas (8.2 rad 16).
// Andra omgångar är hästens historik och visas som vanligt.
export function hidesCommentResult(c: { round: { id: string } | null; leg: number | null }, roundId: string, shownLegs: readonly number[]): boolean {
  return c.round?.id === roundId && c.leg !== null && !shownLegs.includes(c.leg);
}
