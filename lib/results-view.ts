// Resultatvyn i S2 (specen e4a, "Resultatvyn" och 18): innehållet i listorna
// och Nästa-kortet ur RaceDto. Rena funktioner utan React, testade i
// lib/results-view.test.ts. Märken och träff läses från de frysta värdena
// (StartDto.outcome), aldrig från dagens Mark.
//
// - placed: placering 1–4 (inte diskade), sorterade på placeringen; dött
//   lopp står i startnummerordning.
// - betMisses: Bet som inte står i placed ("5+" eller "d" vid diskning).
// - others: övriga som inte är strukna, i startnummerordning.
// - Strukna hästar finns inte med någonstans.

import { hhmm } from "@/lib/format";
import { byPlace, summaryText } from "@/lib/outcomes";
import { mineLabel } from "@/lib/phase";
import type { OutcomeSummary, RaceDto, StartDto, StartOutcomeDto } from "@/lib/types";
import { legName, legNames } from "@/lib/game-type";

export type BetVerdict = "hit" | "miss" | null;

export type PlacedRow = {
  start: StartDto;
  place: number;
  galloped: boolean;
  outcome: StartOutcomeDto | null;
  // Bet med placering 1–3 = träff, 4 = miss. null = inte Bet.
  bet: BetVerdict;
  trollspotRank: number | null;
};

export type BetMissRow = {
  start: StartDto;
  // "5+" (oplacerad eller 5 och sämre) eller "d" (diskad).
  label: "5+" | "d";
  galloped: boolean;
  disqualified: boolean;
  outcome: StartOutcomeDto;
  trollspotRank: number | null;
};

export type OtherItem = {
  number: number;
  name: string;
  // Märket efter namnet: S för Spelbar, annars I för Intressant.
  badge: "S" | "I" | null;
  disqualified: boolean;
  trollspotRank: number | null;
};

export type RaceResultView = { placed: PlacedRow[]; betMisses: BetMissRow[]; others: OtherItem[] };

const outcomeOf = (s: StartDto) => s.outcome ?? null;

export function raceResultView(race: RaceDto): RaceResultView {
  const runners = race.starts.filter((s) => !s.scratched);
  const placedStarts = runners
    .filter((s) => s.result && !s.result.disqualified && s.result.place !== null && s.result.place >= 1 && s.result.place <= 4)
    .map((s) => ({ s, place: s.result!.place as number, number: s.number }))
    .sort(byPlace);
  const placedIds = new Set(placedStarts.map((p) => p.s.id));
  const placed: PlacedRow[] = placedStarts.map(({ s, place }) => {
    const o = outcomeOf(s);
    return { start: s, place, galloped: !!s.result?.galloped, outcome: o, bet: o?.bet ? (place <= 3 ? "hit" : "miss") : null, trollspotRank: o?.trollspotRank ?? null };
  });
  const betMisses: BetMissRow[] = runners
    .filter((s) => !placedIds.has(s.id) && outcomeOf(s)?.bet)
    .map((s) => ({
      start: s,
      label: s.result?.disqualified ? "d" : "5+",
      galloped: !!s.result?.galloped,
      disqualified: !!s.result?.disqualified,
      outcome: s.outcome!,
      trollspotRank: s.outcome!.trollspotRank,
    }));
  const missIds = new Set(betMisses.map((b) => b.start.id));
  const others: OtherItem[] = runners
    .filter((s) => !placedIds.has(s.id) && !missIds.has(s.id))
    .sort((a, b) => a.number - b.number)
    .map((s) => {
      const o = outcomeOf(s);
      return { number: s.number, name: s.horse.name, badge: o?.spelbar ? "S" : o?.interesting ? "I" : null, disqualified: !!s.result?.disqualified, trollspotRank: o?.trollspotRank ?? null };
    });
  return { placed, betMisses, others };
}

// "1 Laredo Boko · 6 Boscha Diablo I · 9 Harpy (diskad)"
export function othersLine(items: OtherItem[]): string {
  return items.map((i) => `${i.number} ${i.name}${i.badge ? ` ${i.badge}` : ""}${i.disqualified ? " (diskad)" : ""}`).join(" · ");
}

// ---- Nästa-kortet --------------------------------------------------------------------

export type NextCard = { title: string; text: string; label: string; href: string };

// Bet-träffen i en avdelning med resultat: "Träff 1/1." Utan Bet: summeringen
// eller "Inga markeringar.".
function resultSentence(summary: OutcomeSummary | null | undefined): string {
  if (!summary) return "Inga markeringar.";
  if (summary.bet.total) return `Träff ${summary.bet.hits}/${summary.bet.total}.`;
  return summaryText(summary) ?? "Inga markeringar.";
}

const startedAt = (r: RaceDto, now: number) => r.started || Date.parse(r.startAt) <= now;

// roundSummary = RoundResponse.results.summary (hela omgången).
// shownLegs = lopp som är visade på enheten (E8 8.2 rad 10). Utan listan räknas alla som visade.
export function nextCard(gameType: string, race: RaceDto, races: RaceDto[], roundId: string, now: number, roundSummary: OutcomeSummary | null, shownLegs?: readonly number[]): NextCard {
  const shown = (r: RaceDto) => !shownLegs || shownLegs.includes(r.leg);
  const sorted = [...races].sort((a, b) => a.leg - b.leg);
  const next = sorted.find((r) => r.leg === race.leg + 1);
  const base = `/omgang/${roundId}`;
  if (next) {
    const link = { label: `Till ${legName(gameType, next.leg)}`, href: `${base}/avd/${next.leg}` };
    if (next.cancelled) return { title: `${legName(gameType, next.leg)} är inställd`, text: next.name, ...link };
    if (!startedAt(next, now)) {
      const mine = next.starts.flatMap((s) => {
        const l = s.scratched ? null : mineLabel(s.mark);
        return l ? [`${s.horse.name} är ${l}.`] : [];
      });
      return { title: `${legName(gameType, next.leg)} startar ${hhmm(next.startAt)}`, text: mine.length ? mine.join(" ") : next.name, ...link };
    }
    if (next.resultAt && !shown(next)) return { title: `${legName(gameType, next.leg)} · resultat dolt`, text: "Tryck Visa resultat i loppet.", ...link };
    if (next.resultAt) return { title: `${legName(gameType, next.leg)} · resultat`, text: resultSentence(next.summary), ...link };
    return { title: `${legName(gameType, next.leg)} pågår`, text: "Väntar på resultat.", ...link };
  }
  const missing = sorted.filter((r) => !r.cancelled && !r.resultAt);
  const link = { label: "Till omgången", href: base };
  if (!missing.length && sorted.some((r) => !r.cancelled && !shown(r))) return { title: "Omgången är klar", text: "Alla lopp har resultat.", ...link };
  if (!missing.length) return { title: "Omgången är klar", text: (roundSummary && summaryText(roundSummary)) ?? "Inga markeringar i omgången.", ...link };
  const legs = missing.map((r) => r.leg);
  const list = legNames(gameType, legs);
  return { title: `Väntar på ${legName(gameType, legs[0])}`, text: `${list} saknar resultat.`, ...link };
}
