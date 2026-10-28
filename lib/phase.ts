// Fas (3.1) och Nästa steg (3.2). Rena funktioner, all tid i Europe/Stockholm.

import { FEATURES, type Features } from "@/lib/features";
import { addDaysToDateString, stockholmDateString, stockholmLocalToUtc, stockholmParts } from "@/lib/stockholm-time";
import { DEFAULT_GAME_TYPE, gameTypeOfId } from "@/lib/game-type";
import { summaryText } from "@/lib/outcomes";
import type { OutcomeSummary } from "@/lib/types";

export type Phase = "ANALYS" | "ODDS" | "LIVE" | "KLART";
export const PHASES: Phase[] = ["ANALYS", "ODDS", "LIVE", "KLART"];
export const PHASE_LABELS: Record<Phase, string> = { ANALYS: "Analys", ODDS: "Odds", LIVE: "Live", KLART: "Klart" };

export type PhaseRace = {
  leg: number;
  name: string;
  startAt: Date;
  hasResult: boolean;
  cancelled: boolean;
};

// D−2 18:00 och D 12:00 för omgångens datum D ("2026-10-24").
export function phaseBounds(date: string) {
  return {
    oddsFrom: stockholmLocalToUtc(`${addDaysToDateString(date, -2)}T18:00`),
    liveFrom: stockholmLocalToUtc(`${date}T12:00`),
  };
}

export function isRoundFinished(races: PhaseRace[]): boolean {
  if (!races.length) return false;
  return races.every((r) => r.hasResult || r.cancelled) && races.some((r) => r.hasResult);
}

// Omgångens dag är slut (Stockholm). Gäller även när ett resultat saknas, så
// att en omgång som aldrig blir Klart inte stänger vägen till nästa.
export function roundDayPassed(date: string, now: Date): boolean {
  return stockholmDateString(now) > date;
}

export function computePhase(date: string, races: PhaseRace[], now: Date): Phase {
  if (isRoundFinished(races)) return "KLART";
  const { oddsFrom, liveFrom } = phaseBounds(date);
  const anyStarted = races.some((r) => r.startAt.getTime() <= now.getTime());
  if (now.getTime() >= liveFrom.getTime() || anyStarted) return "LIVE";
  if (now.getTime() >= oddsFrom.getTime()) return "ODDS";
  return "ANALYS";
}

export type PhaseStep = { phase: Phase; label: string; state: "done" | "current" | "upcoming"; from: string | null; dayLabel: string };

// Rutorna i PhaseRail. Analys gäller från hämtningen, därför from = null.
export function phaseRail(date: string, current: Phase): PhaseStep[] {
  const { oddsFrom, liveFrom } = phaseBounds(date);
  const idx = PHASES.indexOf(current);
  const day = (d: Date, withTime: boolean) => {
    const p = stockholmParts(d);
    return withTime ? `${p.weekdayShort} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}` : p.weekdayShort;
  };
  return PHASES.map((phase, i) => ({
    phase,
    label: PHASE_LABELS[phase],
    state: i < idx ? "done" : i === idx ? "current" : "upcoming",
    from: phase === "ODDS" ? oddsFrom.toISOString() : phase === "LIVE" ? liveFrom.toISOString() : null,
    dayLabel: phase === "ANALYS" ? "sön–tors" : phase === "ODDS" ? day(oddsFrom, true) : phase === "LIVE" ? day(liveFrom, true) : day(liveFrom, false),
  }));
}

// "lör 24 okt" för ett datum "2026-10-24".
export function dayDateLabel(date: string): string {
  const p = stockholmParts(new Date(`${date}T12:00:00Z`));
  return `${p.weekdayShort} ${p.day} ${p.monthShort}`;
}

const hhmm = (d: Date) => {
  const p = stockholmParts(d);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

// ---- Nästa steg ----------------------------------------------------------------

export type NextStepKind =
  | "FETCH_ROUND"
  | "RESUME_FETCH"
  | "ALARM"
  | "LIVE_NEXT_RACE"
  | "LIVE_WAITING"
  | "ODDS_FILL"
  | "MARK_BET"
  | "BUILD_COUPON"
  | "ANALYZE_LEG"
  | "ALL_REVIEWED"
  | "SEE_STATS"
  | "SEE_ANALYSIS"
  | "ROUND_DONE";

export type NextStepAction =
  // Länk till en vy.
  | { type: "link"; label: string; href: string }
  // Starta Hämta omgång (kedjan i 10.1). gameId saknas = välj nästa spel av spelformen.
  | { type: "fetch"; label: string; gameId: string | null }
  // Fortsätt kedjan från steget som misslyckades.
  | { type: "resume"; label: string; roundId: string };

export type NextStep = { kind: NextStepKind; title: string; text: string; action: NextStepAction | null };

// mine = användarens markerade hästar i avdelningen (E4a, punkt 4): "Blixt
// Lane är Bet. Django Silver är Intressant." Saknas = loppnamnet.
export type MineLabel = "Bet" | "Spelbar" | "Intressant";
export type NextStepRace = PhaseRace & { reviewed: boolean; mine?: { name: string; label: MineLabel }[] };

// Starkaste märket: Bet före Spelbar före Intressant. null = omarkerad.
export function mineLabel(m: { interesting: boolean; spelbar: boolean; bet: boolean } | null | undefined): MineLabel | null {
  if (!m) return null;
  if (m.bet) return "Bet";
  if (m.spelbar) return "Spelbar";
  if (m.interesting) return "Intressant";
  return null;
}

export function mineSentence(race: Pick<NextStepRace, "name" | "mine">): string {
  return race.mine?.length ? race.mine.map((h) => `${h.name} är ${h.label}.`).join(" ") : race.name;
}

export type NextStepInput = {
  now: Date;
  // Användarens spelform (S10). Saknas = V85.
  gameType?: string;
  round: {
    id: string;
    date: string;
    // Omgångens spelform. Saknas = V85.
    gameType?: string;
    fetchStatus: "COMPLETE" | "PARTIAL" | "FAILED";
    races: NextStepRace[];
  } | null;
  // Nästa spel av spelformen i ATG:s kalender (null = ingen eller okänd).
  nextAvailable: { gameId: string; trackName: string | null; date: string; fetched: boolean } | null;
  // E2/E3: räknare som är 0 i E1.
  interestingWithoutOdds?: number;
  spelbarWithoutBet?: number;
  hasCoupon?: boolean;
  unackedAlarms?: { leg: number; horseName: string; kind: "RUSH" | "DROP" }[];
  // E4a: summeringen för hela omgången (punkt 9), från de frysta Outcome.
  summary?: OutcomeSummary | null;
  features?: Features;
};

function fetchStep(next: NextStepInput["nextAvailable"], gameType: string): NextStep {
  const gt = (next && gameTypeOfId(next.gameId)) ?? gameType;
  const label = next ? `${gt} ${next.trackName ?? ""} ${dayDateLabel(next.date)}`.replace(/\s+/g, " ") : null;
  return {
    kind: "FETCH_ROUND",
    title: label ? `Hämta omgång – ${label}` : "Hämta omgång",
    text: `Hämta veckans ${gt} från ATG. Startlistan brukar finnas från söndag kväll.`,
    action: { type: "fetch", label: "Hämta omgång", gameId: next?.gameId ?? null },
  };
}

const LEG_WORDS: Record<number, string> = { 7: "sju", 8: "åtta" };

export function nextStep(input: NextStepInput): NextStep {
  const f = input.features ?? FEATURES;
  const { round, now, nextAvailable } = input;
  const gameType = input.gameType ?? DEFAULT_GAME_TYPE;

  // 1. Ingen omgång, eller nästa spel finns men är inte hämtat.
  if (!round) return fetchStep(nextAvailable, gameType);
  const phase = computePhase(round.date, round.races, now);
  if ((phase === "KLART" || roundDayPassed(round.date, now)) && nextAvailable && !nextAvailable.fetched) return fetchStep(nextAvailable, gameType);
  const roundGame = round.gameType ?? DEFAULT_GAME_TYPE;

  // 2. Hämtningen ofullständig.
  if (round.fetchStatus !== "COMPLETE") {
    return {
      kind: "RESUME_FETCH",
      title: "Slutför hämtningen",
      text: "Något steg i hämtningen blev inte klart. Det som redan hämtats är sparat.",
      action: { type: "resume", label: "Slutför hämtningen", roundId: round.id },
    };
  }

  const races = [...round.races].sort((a, b) => a.leg - b.leg);
  const base = `/omgang/${round.id}`;

  if (phase === "LIVE") {
    // 3. Olarmade larm.
    const alarm = f.live ? input.unackedAlarms?.[0] : undefined;
    if (alarm) {
      return {
        kind: "ALARM",
        title: `${alarm.kind === "RUSH" ? "Rusning" : "Tappar"} i avd ${alarm.leg} – ${alarm.horseName}`,
        text: "Kontrollera hästen innan loppet startar.",
        action: { type: "link", label: "Visa larmet", href: `${base}/live?avd=${alarm.leg}` },
      };
    }
    // 4. Nästa lopp som inte har startat.
    const next = races.find((r) => !r.cancelled && r.startAt.getTime() > now.getTime());
    // E4a: knappen leder till avdelningen (S2), som visar Resultat när loppet har startat.
    const legLink = (leg: number): NextStepAction =>
      f.raceView ? { type: "link", label: "Till loppet", href: `${base}/lopp/${leg}` } : { type: "link", label: `Till avd ${leg}`, href: `${base}/avd/${leg}` };
    if (next) {
      return {
        kind: "LIVE_NEXT_RACE",
        title: `Avd ${next.leg} startar ${hhmm(next.startAt)}`,
        text: f.results ? mineSentence(next) : next.name,
        action: f.results || f.raceView ? legLink(next.leg) : null,
      };
    }
    // 4b. Alla lopp har startat och något saknar resultat.
    const waiting = races.find((r) => !r.cancelled && !r.hasResult);
    return {
      kind: "LIVE_WAITING",
      title: waiting ? `Väntar på resultat i avd ${waiting.leg}` : "Väntar på resultat",
      text: f.results ? "Placeringen hämtas automatiskt från ATG." : "Placeringen hämtas när ATG har den.",
      action: f.results && waiting ? legLink(waiting.leg) : null,
    };
  }

  if (phase === "ODDS") {
    // 5–7 (E2).
    const missing = input.interestingWithoutOdds ?? 0;
    if (f.odds && missing > 0) {
      return {
        kind: "ODDS_FILL",
        title: `Fyll i Unibets odds – ${missing} kvar`,
        text: "Platsodds för dina intressanta hästar.",
        action: { type: "link", label: "Fyll i odds", href: `${base}/odds` },
      };
    }
    const noBet = input.spelbarWithoutBet ?? 0;
    if (f.odds && noBet > 0) {
      return {
        kind: "MARK_BET",
        title: `Markera Bet – ${noBet} spelbara`,
        text: "Markera det du spelar hos Unibet.",
        action: { type: "link", label: "Till platsspel", href: `${base}/spel?flik=plats` },
      };
    }
    if (f.coupon && !input.hasCoupon) {
      return {
        kind: "BUILD_COUPON",
        title: `Gör ${roundGame}-raden`,
        text: "Appen föreslår raden inom din budget. Kopiera den till ATG.",
        action: { type: "link", label: "Till raden", href: `${base}/spel?flik=rad` },
      };
    }
  }

  if (phase === "ANALYS" || phase === "ODDS") {
    // 8. Första avdelning som inte är genomgången.
    const todo = races.find((r) => !r.reviewed);
    if (todo) {
      return {
        kind: "ANALYZE_LEG",
        title: `Analysera avd ${todo.leg} – ${todo.name}`,
        text: "Markera Intressant på hästar du tror på, eller tryck Inga intressanta här.",
        action: { type: "link", label: `Till avd ${todo.leg}`, href: `${base}/avd/${todo.leg}` },
      };
    }
    return { kind: "ALL_REVIEWED", title: "Allt genomgånget – odds fylls i torsdag kväll", text: `Alla ${LEG_WORDS[races.length] ?? races.length} avdelningar är genomgångna.`, action: null };
  }

  // 9. Klart.
  if (f.stats) {
    return { kind: "SEE_STATS", title: "Se statistik", text: "Omgången är klar.", action: { type: "link", label: "Se statistik", href: "/statistik" } };
  }
  const sum = f.results && input.summary ? summaryText(input.summary) : null;
  // Efteranalysen (mockupen efteranalys-tips, del 1 A).
  if (f.results) {
    return { kind: "SEE_ANALYSIS", title: "Efteranalysen är klar", text: sum ?? "Vad omgången gav och vad du kan lära dig.", action: { type: "link", label: "Se efteranalysen", href: `${base}/analys` } };
  }
  return { kind: "ROUND_DONE", title: "Omgången är klar", text: sum ?? `Nästa ${gameType} kan hämtas när ATG har publicerat den.`, action: null };
}
