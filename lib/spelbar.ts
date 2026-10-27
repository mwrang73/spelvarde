// Spelbar (specen 6.1). Räknas fram vid läsning och lagras inte. Mikaels val
// lagras som override: NONE (följer förslaget), ON (satt av dig) eller OFF
// (borttagen av dig). Rena funktioner, testade i lib/spelbar.test.ts.
//
// Från E2.1 är `riktodds` i indata riktoddset MED X-faktor (riktoddsX i
// lib/xfactor.ts). Anroparna (lib/dto.ts, lib/marks.ts, lib/round-overlay.ts)
// räknar fram det först. Riktlinjen gäller fortfarande Unibet-oddset.
//
// Från E2.2 (e2.2 6.1) föreslås hästen även när Unibet ligger upp till
// `tolerans` under riktoddset: diff = round2(unibetOdds − riktoddsX) och
// forslag = intressant && diff ≥ −tolerans. Med toleransen 0,00 räcker
// alltså ett odds lika med riktoddset (före E2.2 krävdes >).

export type Override = "NONE" | "ON" | "OFF";
export type SpelbarInput = "on" | "off" | "auto";
// Över, nära eller under riktoddset (med X-faktor). null = något värde saknas.
export type OddsClass = "over" | "near" | "under";

export const DEFAULT_GUIDELINE = 2.0;
// Under det här Unibet-oddset föreslås aldrig Spelbar (Mikael 2026-10-27).
// Spelbar satt för hand (ON) gäller ändå.
export const MIN_SPELBAR_ODDS = 1.75;
// UserSettings.spelbarTolerance: standard 0,10, tillåtet 0,00–0,50 (S10).
export const DEFAULT_TOLERANCE = 0.1;
export const TOLERANCE_MIN = 0;
export const TOLERANCE_MAX = 0.5;
export const TOLERANCE_ERROR = "Toleransen ska ligga mellan 0,00 och 0,50.";

const round2 = (x: number) => Math.round(x * 100) / 100;
// Flyttalsmarginal vid jämförelsen av hundradelar.
const EPS = 1e-9;

// Över (diff > 0), nära (−tolerans ≤ diff ≤ 0) eller under (diff < −tolerans).
// Beskriver oddset och gäller även hästar som inte är Intressant.
export function oddsClass(unibetOdds: number | null, riktodds: number | null, tolerance: number = DEFAULT_TOLERANCE): OddsClass | null {
  const diff = oddsDiff(unibetOdds, riktodds);
  if (diff === null) return null;
  if (diff > EPS) return "over";
  return diff >= -round2(tolerance) - EPS ? "near" : "under";
}

export function forslag(m: { interesting: boolean; unibetOdds: number | null; riktodds: number | null }, tolerance: number = DEFAULT_TOLERANCE): boolean {
  if (!m.interesting) return false;
  if (m.unibetOdds !== null && m.unibetOdds < MIN_SPELBAR_ODDS - EPS) return false;
  const c = oddsClass(m.unibetOdds, m.riktodds, tolerance);
  return c === "over" || c === "near";
}

export function spelbar(m: { interesting: boolean; unibetOdds: number | null; riktodds: number | null; override: Override }, tolerance: number = DEFAULT_TOLERANCE): boolean {
  if (m.override === "ON") return true;
  if (m.override === "OFF") return false;
  return forslag(m, tolerance);
}

// Riktlinjen (2,00): Unibet-odds under den ger taggen "Under 2,00". Påverkar
// inte förslaget.
export function belowGuideline(unibetOdds: number | null, guideline: number = DEFAULT_GUIDELINE): boolean {
  return unibetOdds !== null && unibetOdds < guideline;
}

// Unibet minus riktodds (med X-faktor), avrundat till hundradelar. null om något saknas.
export function oddsDiff(unibetOdds: number | null, riktodds: number | null): number | null {
  if (unibetOdds === null || riktodds === null) return null;
  return round2(unibetOdds - riktodds);
}

// Ett tryck på Spelbar (eller "Återställ till förslag" = auto).
// - Samma värde som förslaget ger NONE, ett annat ger ON eller OFF.
// - Spelbar för hand på en häst som inte är Intressant gör den Intressant
//   (Spelbar är en delmängd av Intressant).
export function applySpelbar(
  m: { interesting: boolean; unibetOdds: number | null; riktodds: number | null },
  want: SpelbarInput,
  tolerance: number = DEFAULT_TOLERANCE,
): { interesting: boolean; override: Override } {
  if (want === "auto") return { interesting: m.interesting, override: "NONE" };
  const interesting = want === "on" ? true : m.interesting;
  const suggested = forslag({ ...m, interesting }, tolerance);
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
  // Grön markering (Ram): over och near. Följer oddset, inte S-märket.
  oddsClass: OddsClass | null;
};

export function spelbarState(
  m: { interesting: boolean; unibetOdds: number | null; riktodds: number | null; override: Override },
  guideline: number = DEFAULT_GUIDELINE,
  tolerance: number = DEFAULT_TOLERANCE,
): SpelbarState {
  return {
    forslag: forslag(m, tolerance),
    spelbar: spelbar(m, tolerance),
    override: m.override,
    belowGuideline: belowGuideline(m.unibetOdds, guideline),
    diff: oddsDiff(m.unibetOdds, m.riktodds),
    oddsClass: oddsClass(m.unibetOdds, m.riktodds, tolerance),
  };
}
