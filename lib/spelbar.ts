// Spelbar (specen 6.1). Räknas fram vid läsning och lagras inte. Mikaels val
// lagras som override: NONE (följer förslaget), ON (satt av dig) eller OFF
// (borttagen av dig). Rena funktioner, testade i lib/spelbar.test.ts.

export type Override = "NONE" | "ON" | "OFF";
export type SpelbarInput = "on" | "off" | "auto";

export const DEFAULT_GUIDELINE = 2.0;

export function forslag(m: { interesting: boolean; unibetOdds: number | null; riktodds: number | null }): boolean {
  return m.interesting && m.unibetOdds !== null && m.riktodds !== null && m.unibetOdds > m.riktodds;
}

export function spelbar(m: { interesting: boolean; unibetOdds: number | null; riktodds: number | null; override: Override }): boolean {
  if (m.override === "ON") return true;
  if (m.override === "OFF") return false;
  return forslag(m);
}

// Riktlinjen (2,00): Unibet-odds under den ger taggen "Under 2,00". Påverkar
// inte förslaget.
export function belowGuideline(unibetOdds: number | null, guideline: number = DEFAULT_GUIDELINE): boolean {
  return unibetOdds !== null && unibetOdds < guideline;
}

// Unibet minus riktodds, avrundat till hundradelar. null om något saknas.
export function oddsDiff(unibetOdds: number | null, riktodds: number | null): number | null {
  if (unibetOdds === null || riktodds === null) return null;
  return Math.round((unibetOdds - riktodds) * 100) / 100;
}

// Ett tryck på Spelbar (eller "Återställ till förslag" = auto).
// - Samma värde som förslaget ger NONE, ett annat ger ON eller OFF.
// - Spelbar för hand på en häst som inte är Intressant gör den Intressant
//   (Spelbar är en delmängd av Intressant).
export function applySpelbar(
  m: { interesting: boolean; unibetOdds: number | null; riktodds: number | null },
  want: SpelbarInput,
): { interesting: boolean; override: Override } {
  if (want === "auto") return { interesting: m.interesting, override: "NONE" };
  const interesting = want === "on" ? true : m.interesting;
  const suggested = forslag({ ...m, interesting });
  const value = want === "on";
  return { interesting, override: value === suggested ? "NONE" : value ? "ON" : "OFF" };
}

// Tas Intressant bort nollställs override (och Spelbar försvinner med den,
// eftersom förslaget kräver Intressant).
export function applyInteresting(override: Override, interesting: boolean): Override {
  return interesting ? override : "NONE";
}

// Läget som S3, S4 och S6a visar.
export type SpelbarState = {
  forslag: boolean;
  spelbar: boolean;
  override: Override;
  belowGuideline: boolean;
  diff: number | null;
};

export function spelbarState(
  m: { interesting: boolean; unibetOdds: number | null; riktodds: number | null; override: Override },
  guideline: number = DEFAULT_GUIDELINE,
): SpelbarState {
  return {
    forslag: forslag(m),
    spelbar: spelbar(m),
    override: m.override,
    belowGuideline: belowGuideline(m.unibetOdds, guideline),
    diff: oddsDiff(m.unibetOdds, m.riktodds),
  };
}
