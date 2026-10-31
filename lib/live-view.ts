// Live-sidan (E8, docs/specs/e8-live.md): val av lopp, loppraden, resultatlistan,
// statusraden, tangenterna och texterna. Rena funktioner utan React, testade i
// lib/live-view.test.ts. Lopp benämns alltid med legName.
//
// Inget här får säga något om utfallet för ett dolt lopp: bara liveResultList,
// rowSr och resultatsumman läser placeringen, och de används bara när loppet är visat.

import { hhmm, methodLabel, odds, ordinal, shortRaceName } from "@/lib/format";
import { legName } from "@/lib/game-type";
import { byPlace } from "@/lib/outcomes";
import { runningRace } from "@/lib/phase";
import type { ResultMode } from "@/lib/results-ui";
import { stockholmParts } from "@/lib/stockholm-time";
import type { RaceDto, StartDto, SubmittedRowDto } from "@/lib/types";

export const LIVE_READ_WAIT_MS = 3_000;
export const LIVE_DIGIT_WAIT_MS = 600;
export const LIVE_UNDO_MS = 10_000;

type RaceLike = Pick<RaceDto, "leg" | "startAt" | "resultAt" | "cancelled"> & { started?: boolean };

const startMs = (r: Pick<RaceDto, "startAt">) => Date.parse(r.startAt);
const hasStarted = (r: RaceLike, now: number) => !!r.started || startMs(r) <= now;
// Taggarna i Live öppnas 5 minuter före start. Bet, odds och resultat följer fortfarande starttiden.
export const LIVE_OPEN_BEFORE_MS = 5 * 60_000;
export const liveOpen = (r: RaceLike, now: number) => !r.cancelled && (hasStarted(r, now) || startMs(r) - now <= LIVE_OPEN_BEFORE_MS);
const toRunning = <R extends RaceLike>(r: R) => ({ race: r, startAt: r.startAt, hasResult: !!r.resultAt, cancelled: r.cancelled });

// ---- Val av lopp (3.2) ------------------------------------------------------------------

// Loppet som pågår: senast startade, inte inställt, utan resultat, högst 30 min efter start.
export function runningLeg(races: readonly RaceLike[], now: number): number | null {
  return runningRace(races.map(toRunning), new Date(now))?.race.leg ?? null;
}

export function parseLegParam(raw: string | null | undefined, races: readonly Pick<RaceDto, "leg">[]): number | null {
  if (!raw || !/^\d{1,2}$/.test(raw)) return null;
  const leg = Number(raw);
  return races.some((r) => r.leg === leg) ? leg : null;
}

// tagged: antal taggade löpande hästar per lopp, eller null om läsningen inte är
// klar. "failed" = läsningen misslyckades, och loppet räknas då som läst.
export type LegTagState = number | "failed" | null;

// Väljs en gång när sidan öppnas. null = vänta på taggarna (skelett, högst 3 s).
export function defaultLiveLeg(races: readonly RaceLike[], taggedOf: (leg: number) => LegTagState, now: number, waited: boolean): number | null {
  const opening = races.find((r) => !hasStarted(r, now) && liveOpen(r, now));
  if (opening) return opening.leg;
  const running = runningLeg(races, now);
  if (running !== null) return running;
  const started = races.filter((r) => !r.cancelled && hasStarted(r, now));
  if (!started.length) return races[0]?.leg ?? 1;
  const read = started.map((r) => ({ leg: r.leg, tagged: taggedOf(r.leg) }));
  if (read.every((r) => r.tagged !== null)) {
    const free = read.find((r) => r.tagged === 0);
    if (free) return free.leg;
    return started[0].leg;
  }
  return waited ? started[0].leg : null;
}

// ---- Loppraden (5.2) ---------------------------------------------------------------------

export type LiveTab = { leg: number; name: string; time: string; count: string | null; running: boolean; bet: boolean; cancelled: boolean; label: string };
export type TabTags = { tagged: number; total: number } | null;

// Aldrig något om resultatet.
export function liveTabs(gameType: string, races: readonly RaceDto[], tagged: Record<number, TabTags>, now: number): LiveTab[] {
  const running = runningLeg(races, now);
  return races.map((r) => {
    const name = legName(gameType, r.leg);
    const t = liveOpen(r, now) ? tagged[r.leg] ?? null : null;
    const bet = r.starts.some((s) => !s.scratched && (s.outcome?.bet ?? s.mark?.bet));
    const isRunning = running === r.leg;
    const parts = [name, r.cancelled ? "inställt" : hhmm(r.startAt), t ? `${t.tagged} av ${t.total} taggade` : null, isRunning ? "pågår" : null, bet ? "med Bet" : null];
    return { leg: r.leg, name, time: hhmm(r.startAt), count: t ? `${t.tagged}/${t.total}` : null, running: isRunning, bet, cancelled: r.cancelled, label: parts.filter(Boolean).join(", ") };
  });
}

// ---- Texter för loppet (6.2) -------------------------------------------------------------

const dayTime = (iso: string) => {
  const p = stockholmParts(new Date(iso));
  return `${p.weekdayShort} ${hhmm(iso)}`;
};

export const raceFacts = (r: Pick<RaceDto, "distance" | "startMethod">) => `${r.distance} m ${methodLabel(r.startMethod)}`;

export type RaceLine = { text: string; pulse: boolean };

export function raceLine(race: RaceDto, mode: ResultMode, shown: boolean, running: boolean): RaceLine {
  if (mode === "cancelled") return { text: "Inställt", pulse: false };
  if (mode === "before") return { text: `Startar ${hhmm(race.startAt)}`, pulse: false };
  if (mode === "result") return { text: `Startade ${dayTime(race.startAt)} · ${shown ? "resultat visas" : "resultat dolt"}`, pulse: false };
  if (running) return { text: `Pågår · startade ${hhmm(race.startAt)}`, pulse: true };
  if (mode === "late") return { text: `Startade ${hhmm(race.startAt)}`, pulse: false };
  return { text: `Väntar på resultat · startade ${hhmm(race.startAt)}`, pulse: false };
}

export const WAITING_TEXT = "Väntar på resultat. Du kan tagga under tiden. Placeringen hämtas automatiskt från ATG.";
export const RESULT_LIST_HELP = "Vill du ändra taggar? Tryck Dölj resultat.";
export const beforeTitle = (gameType: string, race: Pick<RaceDto, "leg" | "startAt">) => `${legName(gameType, race.leg)} startar ${hhmm(race.startAt)}`;
export const BEFORE_TEXT = "Taggarna öppnas 5 minuter före start. Förberedelserna gör du i Analys.";
export const CANCELLED_TITLE = "Loppet är inställt";
export const CANCELLED_TEXT = "ATG har ställt in loppet. Det räknas inte i statistiken.";
export const READ_FAILED_TITLE = "Kunde inte läsa taggarna.";
export const READ_FAILED_TEXT = "Du kan inte tagga förrän de är lästa, annars kan dina tidigare taggar skrivas över.";

// Senaste loppet som har startat medan sidan var öppen och inte är det valda.
export function newlyStartedLeg(races: readonly RaceLike[], openedAt: number, now: number, selected: number, dismissed: readonly number[]): number | null {
  const fresh = races.filter((r) => !r.cancelled && startMs(r) > openedAt && startMs(r) <= now).sort((a, b) => startMs(b) - startMs(a))[0];
  if (!fresh || fresh.leg === selected || dismissed.includes(fresh.leg)) return null;
  return fresh.leg;
}

// ---- Uppläsning (14.2) -------------------------------------------------------------------

export const sayLeg = (gameType: string, race: RaceDto) => [legName(gameType, race.leg), race.classLabel ?? shortRaceName(race.name), `${race.counts.starters} hästar`].join(", ") + ".";
export const sayResultCame = (gameType: string, leg: number) => `Resultatet för ${legName(gameType, leg)} har kommit. Det är dolt.`;
export const sayShown = (gameType: string, leg: number) => `Resultatet för ${legName(gameType, leg)} visas.`;
export const sayHidden = (gameType: string, leg: number) => `Resultatet för ${legName(gameType, leg)} är dolt.`;
export const sayStarted = (gameType: string, leg: number, current: number) => `${legName(gameType, leg)} har startat. Du taggar fortfarande ${legName(gameType, current)}.`;

// ---- Hästen ------------------------------------------------------------------------------

export const runnersOf = (race: Pick<RaceDto, "starts">) => [...race.starts].filter((s) => !s.scratched).sort((a, b) => a.number - b.number);
export const startsInOrder = (race: Pick<RaceDto, "starts">) => [...race.starts].sort((a, b) => a.number - b.number);

// Bet läses från de frysta värdena när de finns, annars från markeringen.
export const betOf = (s: StartDto): boolean => s.outcome?.bet ?? !!s.mark?.bet;

// Kolumnens etikett (14.1). Aldrig placering.
export function horseAria(s: StartDto, inRow: boolean): string {
  const parts = [`${s.number} ${s.horse.name}`];
  if (betOf(s)) parts.push(s.mark?.betOdds != null ? `Bet spelad till ${odds(s.mark.betOdds)}` : "Bet");
  if (inRow) parts.push("med i din rad");
  if (s.mark?.spelbar) parts.push("Spelbar");
  if (s.mark?.interesting) parts.push("Intressant");
  return parts.join(", ");
}

// Numren i den inlämnade raden för loppet.
export const rowNumbers = (row: SubmittedRowDto | null | undefined, leg: number): readonly number[] => row?.selections[String(leg)] ?? [];

export const taggedCount = (runners: readonly Pick<StartDto, "id">[], byStart: Record<string, { tags: string[] } | undefined>) => runners.filter((s) => (byStart[s.id]?.tags.length ?? 0) > 0).length;

// ---- Resultatlistan (7) -------------------------------------------------------------------

export type ResultKind = "placed" | "unplaced" | "disqualified";
export type ResultRow = {
  start: StartDto;
  kind: ResultKind;
  place: number | null;
  top3: boolean;
  // "–" för oplacerad, "d" för diskad, annars siffran.
  placeText: string;
  bet: { odds: number | null; hit: boolean } | null;
  // null = hästen är inte med i inlämnad rad.
  rad: { hit: boolean } | null;
  tags: string[];
  shownTags: string[];
  moreTags: number;
  sr: string;
};

const MAX_TAGS = 2;
export const BAD_TAGS: readonly string[] = ["Galopp", "Diskad"];

// "1:a, nummer 7, Nordic Sunset, A. Lindqvist. Bet, spelad till 2,40, träff. Med i din inlämnade rad, vann loppet. Taggar: Tog spets, Ledde hela vägen."
export function rowSr(row: Pick<ResultRow, "start" | "kind" | "place" | "bet" | "rad" | "tags">): string {
  const s = row.start;
  const head = row.kind === "disqualified" ? "Diskad" : row.kind === "placed" && row.place ? ordinal(row.place) : "Oplacerad";
  const parts = [`${head}, nummer ${s.number}, ${s.horse.name}, ${s.driver?.name ?? "kusk saknas"}.`];
  if (row.bet) parts.push(`Bet${row.bet.odds !== null ? `, spelad till ${odds(row.bet.odds)}` : ""}, ${row.bet.hit ? "träff" : "miss"}.`);
  if (row.rad) parts.push(row.rad.hit ? "Med i din inlämnade rad, vann loppet." : "Med i din inlämnade rad.");
  if (row.tags.length) parts.push(`Taggar: ${row.tags.join(", ")}.`);
  return parts.join(" ");
}

export function liveResultList(race: Pick<RaceDto, "leg" | "starts">, submitted: SubmittedRowDto | null | undefined, tagsOf: (startId: string) => string[]): ResultRow[] {
  const runners = race.starts.filter((s) => !s.scratched);
  const dq = (s: StartDto) => !!s.result?.disqualified;
  const placedOf = (s: StartDto) => !dq(s) && (s.result?.place ?? 0) >= 1;
  const placed = runners
    .filter(placedOf)
    .map((s) => ({ s, place: s.result!.place as number, number: s.number }))
    .sort(byPlace)
    .map((x) => x.s);
  const finish = (s: StartDto) => (s.result ? (s.result.finishOrder ?? 900) : 1000);
  const unplaced = runners.filter((s) => !dq(s) && !placedOf(s)).sort((a, b) => finish(a) - finish(b) || a.number - b.number);
  const disqualified = runners.filter(dq).sort((a, b) => a.number - b.number);
  const inRow = rowNumbers(submitted, race.leg);
  return [...placed, ...unplaced, ...disqualified].map((s) => {
    const kind: ResultKind = dq(s) ? "disqualified" : placedOf(s) ? "placed" : "unplaced";
    const place = kind === "placed" ? (s.result!.place as number) : null;
    const betted = betOf(s);
    const bet = betted ? { odds: s.mark?.betOdds ?? null, hit: place !== null && place <= 3 } : null;
    const rad = inRow.includes(s.number) ? { hit: place === 1 } : null;
    const tags = tagsOf(s.id);
    const base = { start: s, kind, place, bet, rad, tags };
    return {
      ...base,
      top3: place !== null && place <= 3,
      placeText: kind === "disqualified" ? "d" : place !== null ? String(place) : "–",
      shownTags: tags.slice(0, MAX_TAGS),
      moreTags: Math.max(0, tags.length - MAX_TAGS),
      sr: rowSr(base),
    };
  });
}

// ---- Statusraden (6.3) ---------------------------------------------------------------------

export type StatusInput = {
  // Loppets taggar: lästa, läses, eller misslyckades.
  read: "loaded" | "loading" | "failed";
  // Utkorgen är pausad för att användaren är utloggad (status.kind === "paused").
  paused: boolean;
  online: boolean;
  // Poster i kön för omgången.
  pending: number;
  // Senaste ändringen inom 10 s (text utan "Sparat · "), eller att Ångra precis gjordes.
  recent: string | null;
  undone: boolean;
};

export const statusSaved = (what: string, horse: string, removed: boolean) => (removed ? `Tog bort ${what} från ${horse}` : `${what} på ${horse}`);

// Högst en av raderna gäller, uppifrån. paused betyder utloggad, inte offline.
export function liveStatusText(s: StatusInput): string | null {
  if (s.read === "loading") return "Läser taggarna …";
  if (s.read === "failed") return null;
  if (s.paused) return "Logga in igen för att spara taggarna.";
  if (!s.online && s.pending) return `I kö (${s.pending}) · skickas när nätet är tillbaka`;
  if (s.pending) return "Sparas …";
  if (s.undone) return "Sparat · Ångrade senaste ändringen";
  if (s.recent) return `Sparat · ${s.recent}`;
  if (!s.online) return "Ingen uppkoppling · taggar sparas i kön";
  return "Sparas direkt · följer hästen";
}

// ---- Tangenter (14.3) ----------------------------------------------------------------------

// Väljer häst med siffror. "pick" = välj häst. "wait" = har loppet 10 eller fler
// hästar väntar appen på en andra siffra efter en etta.
export type DigitStep = { pick: number | null; pending: string | null };

export function digitStep(pending: string | null, digit: string, numbers: readonly number[]): DigitStep {
  const has = (n: number) => numbers.includes(n);
  if (pending) {
    const two = Number(`${pending}${digit}`);
    if (has(two)) return { pick: two, pending: null };
    const first = Number(pending);
    // Andra siffran bildar inget nummer: den första gäller, och den nya siffran börjar om.
    const again = digitStep(null, digit, numbers);
    return { pick: has(first) ? first : again.pick, pending: again.pending };
  }
  const n = Number(digit);
  const big = numbers.some((x) => x >= 10);
  if (big && digit === "1") return { pick: null, pending: "1" };
  return { pick: has(n) ? n : null, pending: null };
}

// Regeln mot fel häst: väntar appen på en andra siffra och något annat trycks,
// gäller den första siffran direkt, innan tangenten utförs.
export function flushDigit(pending: string | null, numbers: readonly number[]): number | null {
  if (!pending) return null;
  const n = Number(pending);
  return numbers.includes(n) ? n : null;
}

