// Små byggare av RoundResponse för enhetstesterna av klientlogiken (E2.2).
// Bara för tester; importeras inte av appen.

import type { MarkDto, RaceDto, RoundResponse, StartDto } from "@/lib/types";

export function mkMark(startId: string, p: Partial<MarkDto> = {}): MarkDto {
  return {
    startId,
    interesting: false,
    interestingAt: null,
    spelbarOverride: "NONE",
    bet: false,
    betAt: null,
    betOdds: null,
    unibetOdds: null,
    unibetOddsAt: null,
    unibetOddsPrev: null,
    updatedAt: "",
    xFactor: "NONE",
    xFactorAt: null,
    xFactorValue: 1,
    sourceSupport: null,
    forslag: false,
    spelbar: false,
    riktodds: null,
    riktoddsX: null,
    belowGuideline: false,
    unibetOddsSource: null,
    replacedOdds: null,
    replacedByFetchId: null,
    oddsClass: null,
    ...p,
  };
}

export function mkStart(id: string, number: number, p: Partial<StartDto> = {}): StartDto {
  return {
    id,
    number,
    postPosition: number,
    distance: 2140,
    scratched: false,
    scratchedAt: null,
    horse: { id: `h${id}`, name: `Häst ${id}`, sex: "mare", age: 5, record: null, earnings: null },
    driver: null,
    trainer: null,
    prevDriver: null,
    form: { boxes: [], ariaLabel: "", gallop: null, warning: null, fewStarts: true, debut: true },
    streck: null,
    riktodds: null,
    probTop3: null,
    uncertain: false,
    mark: null,
    result: null,
    quick: { winPct: null, placePct: null, starts: null, lifeStarts: null, postPct: null, postPlacePct: null },
    signals: null,
    unibet: null,
    ...p,
  };
}

export function mkRace(leg: number, starts: StartDto[], p: Partial<RaceDto> = {}): RaceDto {
  return {
    id: `r${leg}`,
    leg,
    raceNumber: leg + 4,
    name: `Lopp ${leg}`,
    startAt: `2026-10-24T${String(12 + leg).padStart(2, "0")}:00:00.000Z`,
    distance: 2140,
    startMethod: "AUTO",
    prize: null,
    classLabel: null,
    terms: [],
    cancelled: false,
    resultAt: null,
    started: false,
    reviewed: false,
    review: null,
    counts: { starters: starts.length, scratched: 0, interesting: 0, spelbar: 0, bet: 0 },
    statsLine: { ok: false, fetchedAt: null, bestNumber: null, bestPlace: null, trackBestWin: null, trackBestPlace: null, trackRaces: null, number1Pct: null, number1PlacePct: null, postSource: null, favoriteWinPct: null },
    starts,
    ...p,
  };
}

export function mkRound(races: RaceDto[], p: Partial<RoundResponse> = {}): RoundResponse {
  return {
    serverTime: "2026-10-22T19:05:00.000Z",
    rev: 1,
    round: { id: "R", atgGameId: "V85_2026-10-24_7_5", gameType: "V85", date: "2026-10-24", trackId: 7, trackName: "Jägersro", firstStartAt: "2026-10-24T13:00:00.000Z", atgStatus: null, fetchedAt: null, fetchStatus: "COMPLETE", finishedAt: null, rev: 1 },
    isCurrent: true,
    currentRoundId: "R",
    phase: "ODDS",
    phaseRail: [],
    nextStep: { kind: "ALL_REVIEWED", title: "", text: "", action: null },
    fetch: { status: "COMPLETE", fetchedAt: null, lastChanges: null, resumeFrom: null, lastError: null },
    races,
    latestStreck: null,
    coupon: null,
    model: null,
    settings: { spelbarGuideline: 2, rowPrice: 0.5, xFactorTror: 1.25, xFactorStark: 1.5, spelbarTolerance: 0.1 },
    sourcesEnabled: 0,
    latestOdds: null,
    lastOddsAttempt: null,
    ...p,
  };
}
