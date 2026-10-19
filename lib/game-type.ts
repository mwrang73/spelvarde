// Spelformen. Hämta omgång letar efter användarens spelform (S10) i ATG:s
// kalender. V85 ersätts av V75 i slutet av november 2026, så spelformen är en
// inställning och inte inbyggd. Antalet avdelningar följer spelformen.

export const GAME_TYPES = ["V75", "V85", "V86", "GS75"] as const;
export type GameType = (typeof GAME_TYPES)[number];
export const DEFAULT_GAME_TYPE: GameType = "V85";

export const isGameType = (v: unknown): v is GameType => typeof v === "string" && (GAME_TYPES as readonly string[]).includes(v);

const LEGS: Record<GameType, number> = { V75: 7, V85: 8, V86: 8, GS75: 7 };

// Antal avdelningar i spelformen.
export const legsFor = (t: string): number => (isGameType(t) ? LEGS[t] : 8);

// Avdelningarna 1..n.
export const legNumbers = (t: string): number[] => Array.from({ length: legsFor(t) }, (_, i) => i + 1);

// Spelformen ur ATG:s spel-id ("V75_2026-11-29_5_5" → "V75"). null = okänd.
export function gameTypeOfId(id: string): GameType | null {
  const p = id.split("_")[0];
  return isGameType(p) ? p : null;
}

// Spel-id för någon av spelformerna.
export const GAME_ID_RE = /^(V75|V85|V86|GS75)_\d{4}-\d{2}-\d{2}_\d{1,3}_\d{1,2}$/;

export const GAME_TYPE_ERROR = "Spelformen ska vara V75, V85, V86 eller GS75.";
