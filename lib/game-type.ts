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

// Benämningen på ett lopp i spelet: "V85-1". Avdelning är ATG:s egen numrering
// och kan vara en annan, så det är den här formen som visas i appen.
export const legName = (gameType: string, leg: number | string): string => `${gameType}-${leg}`;

// "V85-2", "V85-2 och V85-6", "V85-1, V85-2 och V85-6".
export function legNames(gameType: string, legs: readonly (number | string)[]): string {
  const names = legs.map((l) => legName(gameType, l));
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} och ${names[names.length - 1]}`;
}

// Spelformen ur ATG:s spel-id ("V75_2026-11-29_5_5" → "V75"). null = okänd.
export function gameTypeOfId(id: string): GameType | null {
  const p = id.split("_")[0];
  return isGameType(p) ? p : null;
}

// Spel-id för någon av spelformerna.
export const GAME_ID_RE = /^(V75|V85|V86|GS75)_\d{4}-\d{2}-\d{2}_\d{1,3}_\d{1,2}$/;

export const GAME_TYPE_ERROR = "Spelformen ska vara V75, V85, V86 eller GS75.";

// E6 (docs/specs/e6-v85-rad.md): högsta antal spikar och favoritspärren per
// spelform. Konstanter, inte inställningar (beslut 13).
export const SPIK_MAX: Record<GameType, number> = { V75: 6, V85: 7, V86: 7, GS75: 6 };
export const FAV_LIMIT: Record<GameType, number> = { V75: 3, V85: 4, V86: 4, GS75: 3 };

// Okänd spelform räknas som V85 (8 avdelningar), som legsFor.
export const spikMaxFor = (t: string): number => (isGameType(t) ? SPIK_MAX[t] : SPIK_MAX.V85);
export const favLimitFor = (t: string): number => (isGameType(t) ? FAV_LIMIT[t] : FAV_LIMIT.V85);
