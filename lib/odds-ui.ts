// Unibets odds i gränssnittet (specen e2.2 6.1, S3, S4 och S6): grön
// markering (variant 1 · Ram), skillnaden `sv`, rörelsen sedan första
// hämtningen, gruppen "Inte markerade" (med Trollspöt, e4a 18) och toleransen i
// S10. Rena funktioner utan React, testade i lib/odds-ui.test.ts.

import { MINUS, odds } from "@/lib/format";
import { MIN_SPELBAR_ODDS, oddsClass, oddsDiff, spelbar as spelbarOf, TOLERANCE_MAX, TOLERANCE_MIN, type OddsClass, type Override } from "@/lib/spelbar";
import type { MarkDto, RaceDto, StartDto } from "@/lib/types";
import { trollspot } from "@/lib/trollspot";
import { riktX } from "@/lib/xfactor-ui";

const round2 = (x: number) => Math.round(x * 100) / 100;

// "+0,31", "−0,07" (U+2212) och "±0,00", alltid med två decimaler.
export function signedOdds(d: number): string {
  const r = round2(d);
  return `${r > 0 ? "+" : r < 0 ? MINUS : "±"}${odds(Math.abs(r))}`;
}

// Skärmläsartexten efter skillnaden (6.1).
export function svSr(c: OddsClass | null, diff: number | null): string {
  if (c === "over") return " över riktoddset, spelbart";
  if (c === "near") return diff !== null && round2(diff) === 0 ? " samma som riktoddset, spelbart" : " under riktoddset, nära, spelbart";
  if (c === "under") return " under riktoddset";
  return "";
}

// Hästens oddsklass. Serverns (eller utkorgens) beräknade värde används i
// första hand; äldre cachade svar saknar fältet.
export function classOf(start: Pick<StartDto, "riktodds" | "mark">, tolerance: number): OddsClass | null {
  const m = start.mark;
  if (m && m.oddsClass !== undefined) return m.oddsClass;
  return oddsClass(m?.unibetOdds ?? null, riktX(start), tolerance);
}

export const diffOf = (start: Pick<StartDto, "riktodds" | "mark">): number | null => oddsDiff(start.mark?.unibetOdds ?? null, riktX(start));

// Struken hos Unibet: hämtningen satte oddset till null med källan Unibet.
export function scratchedAtUnibet(m: Pick<MarkDto, "unibetOdds" | "unibetOddsSource"> | null | undefined): boolean {
  return !!m && (m.unibetOddsSource ?? null) === "UNIBET" && m.unibetOdds === null;
}

// Loppet har startat enligt klockan (samma regel som raceStarted i RoundProvider).
const started = (race: Pick<RaceDto, "started" | "startAt">, now: number) => race.started || Date.parse(race.startAt) <= now;

// troll = hästen är i Trollspöt just nu (plats 1–10 och minst X), annars null.
// diff = Unibet minus riktodds med X-faktor, null när oddset saknas (en
// Trollspöt-häst utan odds: fältet är tomt och "minst X" står under).
export type UnmarkedItem = { race: RaceDto; start: StartDto; diff: number | null; troll: { rank: number; minOdds: number } | null };

// "Inte markerade (n)" (S4 och S6, e4a avsnitt 18): inte Intressant, ingen
// Bet, inte struken och loppet har inte startat, och antingen i Trollspöt
// eller med oddset över eller nära. Trollspöt-hästarna först efter plats,
// sedan övriga efter skillnad, störst först. Varje häst bara en gång.
export function unmarkedItems(races: RaceDto[], now: number, tolerance: number): UnmarkedItem[] {
  const troll = new Map(trollspot(races, now, tolerance).items.map((t, i) => [t.start.id, { rank: i + 1, minOdds: t.minOdds }]));
  const inTroll: UnmarkedItem[] = [];
  const rest: UnmarkedItem[] = [];
  for (const race of races) {
    if (race.cancelled || started(race, now)) continue;
    for (const start of race.starts) {
      const m = start.mark;
      if (start.scratched || m?.interesting || m?.bet) continue;
      const t = troll.get(start.id) ?? null;
      const c = classOf(start, tolerance);
      if (t) inTroll.push({ race, start, diff: diffOf(start), troll: t });
      else if ((c === "over" || c === "near") && (m?.unibetOdds ?? 0) >= MIN_SPELBAR_ODDS) rest.push({ race, start, diff: diffOf(start) ?? 0, troll: null });
    }
  }
  inTroll.sort((a, b) => a.troll!.rank - b.troll!.rank);
  rest.sort((a, b) => (b.diff ?? 0) - (a.diff ?? 0) || a.race.leg - b.race.leg || a.start.number - b.start.number);
  return [...inTroll, ...rest];
}

// Hjälptexten under rubriken "Inte markerade (n)".
export const UNMARKED_HELP_TEXT = "Hästar du inte har markerat som är med i Trollspöt eller har spelbara odds. Tänd Intressant så kommer de med.";

// Spelbara i S6 sorteras per lopp och startnummer.
export function byLegNumber<T extends { race: { leg: number }; start: { number: number } }>(a: T, b: T): number {
  return a.race.leg - b.race.leg || a.start.number - b.start.number;
}

// Skillnaden mot riktoddset med X-faktor, största först.
export function byDiffDesc<T extends { race: { leg: number }; start: Pick<StartDto, "riktodds" | "mark" | "number"> }>(a: T, b: T): number {
  return (diffOf(b.start) ?? -Infinity) - (diffOf(a.start) ?? -Infinity) || a.race.leg - b.race.leg || a.start.number - b.start.number;
}

// ---- Rörelsen sedan första hämtningen (S4) -------------------------------------------

export type Movement =
  | { kind: "none" }
  | { kind: "new"; at: string | null }
  | { kind: "up" | "down" | "same"; from: number; delta: number; since: string };

// current = oddset i fältet (Mark.unibetOdds). Rörelsen räknas från den första
// ögonblicksbilden med platsodds. Finns bara en, eller ingen tidigare, är oddset "Ny".
export function movementOf(start: Pick<StartDto, "unibet" | "mark">): Movement {
  const current = start.mark?.unibetOdds ?? null;
  if (current === null) return { kind: "none" };
  const u = start.unibet;
  if (!u || u.first === null || u.firstAt === null) return start.mark?.unibetOddsSource === "UNIBET" ? { kind: "new", at: u?.at ?? start.mark.unibetOddsAt } : { kind: "none" };
  if (u.firstAt === u.at) return { kind: "new", at: u.at };
  const delta = round2(current - u.first);
  return { kind: delta > 0 ? "up" : delta < 0 ? "down" : "same", from: u.first, delta, since: u.firstAt };
}

// Texten under kurvan i mobilen: "▲ fr 2,20", "▼ fr 2,10", "= 2,30" eller "Ny".
export function movementShort(mv: Movement, current: number | null): string {
  if (mv.kind === "none") return "";
  if (mv.kind === "new") return "Ny";
  if (mv.kind === "same") return `= ${odds(current ?? mv.from)}`;
  return `${mv.kind === "up" ? "▲" : "▼"} fr ${odds(mv.from)}`;
}

// Skärmläsaren: "Upp från 2,20 sedan tors 18:02". when = tiden i text.
export function movementSr(mv: Movement, when: (iso: string) => string): string {
  if (mv.kind === "none") return "";
  if (mv.kind === "new") return "Nytt odds";
  if (mv.kind === "same") return `Oförändrat sedan ${when(mv.since)}`;
  return `${mv.kind === "up" ? "Upp" : "Ned"} från ${odds(mv.from)} sedan ${when(mv.since)}`;
}

// Punkterna i den lilla kurvan (bredd w, höjd h) och riktoddsets linje.
export function sparkPoints(values: number[], rikt: number | null, w: number, h: number): { points: string; last: [number, number]; riktY: number | null } | null {
  if (values.length < 2) return null;
  const all = rikt === null ? values : [...values, rikt];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo < 0.1) {
    hi += 0.05;
    lo -= 0.05;
  }
  const y = (v: number) => h - 2 - ((v - lo) / (hi - lo)) * (h - 4);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, y(v)] as [number, number]);
  return { points: pts.map(([x, yy]) => `${x.toFixed(1)},${yy.toFixed(1)}`).join(" "), last: pts[pts.length - 1], riktY: rikt === null ? null : Number(y(rikt).toFixed(1)) };
}

// ---- Rad 3 i S4: "Ersatte ditt 3,10" ---------------------------------------------------

// Ett eget odds som den senaste hämtningen ersatte. lostForslag = hästen var
// Spelbar med ditt odds men är det inte längre ("inte längre föreslagen").
export function replacedNote(start: Pick<StartDto, "riktodds" | "mark">, latestFetchId: string | null, tolerance: number): { from: number; lostForslag: boolean } | null {
  const m = start.mark;
  if (!m || m.replacedOdds == null || !m.replacedByFetchId || m.replacedByFetchId !== latestFetchId) return null;
  const rx = riktX(start);
  const before = spelbarOf({ interesting: m.interesting, unibetOdds: m.replacedOdds, riktodds: rx, override: m.spelbarOverride }, tolerance);
  return { from: m.replacedOdds, lostForslag: before && !m.spelbar };
}

// ---- Meningen i RiktoddsBox (S3) ------------------------------------------------------

// Över och nära (5b). null för under och när något saknas: då gäller
// meningen från före E2.2 (riktoddsSentence i lib/odds-keypad.ts).
export function boxVerdict(m: { unibetOdds: number | null; riktodds: number | null; interesting: boolean; spelbar: boolean; override: Override; tolerance: number; withX: boolean }): { cls: "over" | "near"; diff: string; lead: string | null; text: string } | null {
  const c = oddsClass(m.unibetOdds, m.riktodds, m.tolerance);
  if (c !== "over" && c !== "near") return null;
  const d = oddsDiff(m.unibetOdds, m.riktodds)!;
  const ref = m.withX ? "riktoddset med X-faktor" : "riktoddset";
  const how = c === "over" ? `Unibet ger mer än ${ref}` : `Unibet ligger högst ${odds(m.tolerance)} under ${ref}`;
  const diff = c === "near" ? `${signedOdds(d)} nära` : signedOdds(d);
  if (m.spelbar) return { cls: c, diff, lead: m.override === "ON" ? "Spelbar (satt av dig)" : "Spelbar", text: `, ${how}.` };
  if (m.override === "OFF") return { cls: c, diff, lead: "Inte spelbar (borttagen av dig)", text: `, ${how}.` };
  return { cls: c, diff, lead: null, text: `${how}. Markera Intressant för att få förslaget.` };
}

// ---- S10: toleransen --------------------------------------------------------------------

// "0,10" → 0.1. null = ogiltigt (0,00–0,50, högst två decimaler).
export function parseTolerance(text: string): number | null {
  const t = text.replace(/\s/g, "").replace(",", ".");
  if (!/^\d(\.\d{1,2})?$/.test(t)) return null;
  const n = round2(Number(t));
  return n >= TOLERANCE_MIN && n <= TOLERANCE_MAX ? n : null;
}
