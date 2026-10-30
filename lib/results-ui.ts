// Resultatet i gränssnittet (specen e4a: Resultatvyn, S1 under och efter
// loppen och 6.10). Rena funktioner utan React, testade i
// lib/results-ui.test.ts. Listornas innehåll och Nästa-kortet finns i
// lib/results-view.ts; här ligger lägena, pollningens schema, rutorna i
// summeringen, skärmläsartexterna och raderna i S1.

import { hhmm, ordinal } from "@/lib/format";
import { POLL_INTERVAL_MS, POLL_WINDOW_MS, pollingRaces } from "@/lib/outcomes";
import type { HitCount, OutcomeSummary, RaceDto } from "@/lib/types";
import type { PlacedRow } from "@/lib/results-view";
import { legName } from "@/lib/game-type";

type RaceLike = Pick<RaceDto, "startAt" | "resultAt" | "cancelled"> & { started?: boolean };

const startMs = (r: Pick<RaceDto, "startAt">) => Date.parse(r.startAt);
const hasStarted = (r: RaceLike, now: number) => !!r.started || startMs(r) <= now;

// ---- Lägen i resultatvyn ---------------------------------------------------------------

// before = loppet har inte startat (ingen resultatvy). waiting = högst 30 min
// efter start utan resultat. late = mer än 30 min utan resultat (Hämta resultat).
export type ResultMode = "before" | "waiting" | "late" | "cancelled" | "result";

export function resultMode(race: RaceLike, now: number): ResultMode {
  if (race.cancelled) return "cancelled";
  if (race.resultAt) return "result";
  if (!hasStarted(race, now)) return "before";
  return now - startMs(race) <= POLL_WINDOW_MS ? "waiting" : "late";
}

// Segmentkontrollen "Startlista | Resultat" visas när loppet har startat eller är inställt.
export const showsResultToggle = (race: RaceLike, now: number) => resultMode(race, now) !== "before";

// ---- Pollningen (6.10) ---------------------------------------------------------------

const toPoll = (races: RaceLike[]) => races.map((r) => ({ startAt: r.startAt, hasResult: !!r.resultAt, cancelled: r.cancelled }));

// Aktiv när något lopp har passerat starttiden, saknar resultat, inte är
// inställt och startade för högst 30 min sedan. (Ett sådant lopp betyder att
// fasen är Live: Klart kräver att alla lopp har resultat.)
export function pollActive(races: RaceLike[], now: number): boolean {
  return pollingRaces(toPoll(races), new Date(now)).length > 0;
}

// När pollningen blir aktiv nästa gång utan att något annat ändras: nästa
// starttid bland lopp utan resultat som inte är inställda. null = aldrig.
export function nextWakeAt(races: RaceLike[], now: number): number | null {
  const next = races.filter((r) => !r.cancelled && !r.resultAt && startMs(r) > now).map(startMs);
  return next.length ? Math.min(...next) : null;
}

// Efter fel försöker den igen efter 5, 10 och 15 s; därefter den ordinarie
// 60-sekundersrundan. failures = fel i rad (0 = senaste anropet lyckades).
export const RETRY_MS = [5_000, 10_000, 15_000] as const;
export const FAILS_FOR_ERROR = 3;

export function retryDelay(failures: number): number {
  if (failures <= 0) return POLL_INTERVAL_MS;
  return RETRY_MS[failures - 1] ?? POLL_INTERVAL_MS;
}

// Väntetid till nästa anrop när pollningen startar om (montering, ny data):
// räknat från förra försöket, så att en omläsning inte ger ett extra anrop.
export function initialDelay(lastAttemptAt: number | null, failures: number, now: number): number {
  if (lastAttemptAt === null) return 0;
  return Math.max(0, lastAttemptAt + retryDelay(failures) - now);
}

// "Senast kollat 17:16 · nästa 17:17". null när inget av dem är känt.
export function checkedLine(syncedAt: string | null, nextAt: number | null): string | null {
  const parts = [syncedAt ? `Senast kollat ${hhmm(syncedAt)}` : null, nextAt !== null ? `nästa ${hhmm(new Date(nextAt))}` : null].filter((x): x is string => !!x);
  return parts.length ? parts.join(" · ") : null;
}

// Den senaste av två tidpunkter (ISO), null om båda saknas.
export function latestIso(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

// ---- Summeringen på tavlan ---------------------------------------------------------------

export type SummaryBox = { key: "bet" | "spelbar" | "interesting" | "trollspot"; label: string; value: string; unit: string; sr: string };

const box = (key: SummaryBox["key"], label: string, c: HitCount, unit: string): SummaryBox =>
  c.total
    ? { key, label, value: `${c.hits} / ${c.total}`, unit, sr: `${label}: ${c.hits} av ${c.total} ${unit}.` }
    : { key, label, value: "–", unit: "ingen", sr: `${label}: ingen.` };

// Bet, Spelbar och Intressant alltid; Trollspöt bara när loppet (eller
// omgången) hade Trollspöt-hästar (avsnitt 18).
export function summaryBoxes(s: OutcomeSummary): SummaryBox[] {
  const out = [box("bet", "Bet", s.bet, "träff"), box("spelbar", "Spelbar", s.spelbar, "topp 3"), box("interesting", "Intressant", s.interesting, "topp 3")];
  if (s.trollspot?.total) out.push(box("trollspot", "Trollspöt", s.trollspot, "topp 3"));
  return out;
}

// Finns något att summera (markeringar eller Trollspöt)?
export function hasAnyMarks(s: OutcomeSummary | null | undefined): boolean {
  return !!s && s.bet.total + s.spelbar.total + s.interesting.total + (s.trollspot?.total ?? 0) > 0;
}

// "Bet: 1 av 2 träff. Spelbar: 1 av 2 topp 3. Intressant: 3 av 4 topp 3."
export function summarySr(s: OutcomeSummary): string {
  return summaryBoxes(s)
    .map((b) => b.sr)
    .join(" ");
}

// ---- Skärmläsartexter i resultatvyn -------------------------------------------------------

// "1:a, nummer 5, Kentucky River, Magnus A Djuse. Bet, träff."
export function placedRowSr(row: PlacedRow): string {
  const s = row.start;
  const head = [ordinal(row.place), `nummer ${s.number}`, s.horse.name, s.driver?.name, row.galloped ? "galopp" : null].filter(Boolean).join(", ");
  return `${head}. ${marksSr(row.outcome, row.bet)}`.trim();
}

// "Bet, träff." / "Bet, miss." / "Spelbar." / "Intressant." och " Trollspöt."
export function marksSr(o: { interesting: boolean; spelbar: boolean; bet: boolean; trollspotRank: number | null } | null, bet: "hit" | "miss" | null): string {
  if (!o) return "";
  const main = o.bet ? `Bet, ${bet === "hit" ? "träff" : "miss"}.` : o.spelbar ? "Spelbar." : o.interesting ? "Intressant." : "";
  return [main, o.trollspotRank !== null ? "Trollspöt." : ""].filter(Boolean).join(" ");
}

// Upplästes en gång när resultatet kommer medan vyn är öppen:
// "Resultat i avd 7: Kentucky River vann. Bet 1 av 2 träff."
export function resultAnnouncement(gameType: string, leg: number, placed: PlacedRow[], summary: OutcomeSummary | null | undefined): string {
  const winners = placed.filter((p) => p.place === 1).map((p) => p.start.horse.name);
  const who = winners.length ? `${winners.join(" och ")} vann.` : "Placeringen är klar.";
  const bet = summary?.bet.total ? ` Bet ${summary.bet.hits} av ${summary.bet.total} träff.` : "";
  return `Resultat i ${legName(gameType, leg)}: ${who}${bet}`;
}

// ---- S1: avdelningsraderna ------------------------------------------------------------

export type LegRow =
  | { kind: "before" }
  | { kind: "live"; line2: string }
  | { kind: "cancelled" }
  | { kind: "result"; title: string; line2: string; bet: HitCount | null };

// Rad 1 och 2 och högerdelen för en avdelning i S1 (specen, S1 under och
// efter loppen). Bet läses ur de frysta Outcome (StartDto.outcome).
export function legRow(race: RaceDto, now: number): LegRow {
  const mode = resultMode(race, now);
  if (mode === "before") return { kind: "before" };
  if (mode === "cancelled") return { kind: "cancelled" };
  if (mode !== "result") return { kind: "live", line2: `Startade ${hhmm(race.startAt)} · väntar på resultat` };
  const runners = race.starts.filter((s) => !s.scratched);
  const winner = runners.filter((s) => s.result?.place === 1 && !s.result.disqualified).sort((a, b) => a.number - b.number)[0];
  const bets = runners.filter((s) => s.outcome?.bet).sort((a, b) => a.number - b.number);
  const summary = race.summary ?? null;
  let line2: string;
  if (bets.length) {
    line2 = `Bet: ${bets
      .map((s) => {
        const p = s.result?.place ?? null;
        const hit = !s.result?.disqualified && p !== null && p >= 1 && p <= 3;
        return `${s.number} ${s.horse.name} ${hit ? ordinal(p) : "miss"}`;
      })
      .join(" · ")}`;
  } else if (summary?.interesting.total) {
    line2 = `Intressant ${summary.interesting.hits}/${summary.interesting.total} topp 3`;
  } else line2 = "Inga markeringar";
  const bet = bets.length ? (summary?.bet.total ? summary.bet : { hits: bets.filter((s) => s.outcome?.hit).length, total: bets.length }) : null;
  return { kind: "result", title: winner ? `Vinnare ${winner.number} ${winner.horse.name}` : "Resultat klart", line2, bet };
}

// Har alla avdelningar resultat eller är inställda ("Omgången" i stället för "Hittills")?
export function allLegsDone(races: Pick<RaceDto, "resultAt" | "cancelled">[]): boolean {
  return races.length > 0 && races.every((r) => r.cancelled || !!r.resultAt);
}

// Senaste resultattid i omgången (för "Resultat hämtade från ATG …").
export function lastResultAt(races: Pick<RaceDto, "resultAt">[]): string | null {
  return races.reduce<string | null>((acc, r) => latestIso(acc, r.resultAt), null);
}
