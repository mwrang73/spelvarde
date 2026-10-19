// Läsning av omgången för klienten: GET /api/rounds/current, /api/rounds/[id],
// /api/rounds/[id]/races/[leg]/stats och /api/starts/[id]. Allt
// användarägt (Mark, RaceReview, HorseComment, Coupon, UserSettings)
// filtreras på userId. Riktodds är gemensamt och läses för den aktiva
// modellversionen.

import { Prisma, type PrismaClient } from "@prisma/client";
import { COMMENT_INCLUDE, asHorseStats, asPersonStats, commentDto, couponDto, dateStr, dec, iso, markDto, personDto, riktoddsDetailDto, roundDto, settingsDto, yearStatsDto } from "@/lib/dto";
import { formSummary, gallopWarning, lastStarts, type FormRecord } from "@/lib/gallop";
import { computePhase, nextStep, phaseRail, type NextStepRace } from "@/lib/phase";
import { favoriteWinPct, msRanks, type LeagueData, type LeagueRow, type MsData, type RankData, type StartnrData } from "@/lib/travstatistik";
import type {
  CurrentRoundResponse,
  FetchChanges,
  FetchState,
  LegSummary,
  NextAvailableResponse,
  PersonFormDto,
  RaceDto,
  RaceStatsLine,
  RaceStatsResponse,
  ResumePoint,
  RoundResponse,
  StartDetailResponse,
  StartDto,
} from "@/lib/types";

type Db = PrismaClient;

// ---- Gemensamma delar -------------------------------------------------------------

const roundInclude = (userId: string) =>
  ({
    races: {
      orderBy: { leg: "asc" },
      include: {
        reviews: { where: { userId } },
        starts: {
          orderBy: { number: "asc" },
          include: {
            horse: true,
            driver: true,
            trainer: true,
            prevDriver: true,
            marks: { where: { userId } },
          },
        },
      },
    },
  }) satisfies Prisma.RoundInclude;

type FullRound = Prisma.RoundGetPayload<{ include: ReturnType<typeof roundInclude> }>;

export async function loadFullRound(db: Db, roundId: string, userId: string): Promise<FullRound | null> {
  return db.round.findUnique({ where: { id: roundId }, include: roundInclude(userId) });
}

// Aktiv modellversion och dess riktodds per start i omgången.
export async function activeRiktodds(db: Db, roundId: string) {
  const model = await db.modelVersion.findFirst({ where: { active: true } });
  const rows = model ? await db.riktodds.findMany({ where: { modelVersionId: model.id, start: { race: { roundId } } } }) : [];
  return { model, byStart: new Map(rows.map((r) => [r.startId, r])) };
}

const riktOf = (r: { odds: Prisma.Decimal } | undefined) => (r ? Number(r.odds) : null);

// De 5 senaste riktiga starterna per häst före datumet, i en fråga.
export async function lastRecordsByHorse(db: Db, horseIds: string[], before: Date, n = 5): Promise<Map<string, FormRecord[]>> {
  const out = new Map<string, FormRecord[]>();
  if (!horseIds.length) return out;
  const rows = await db.$queryRaw<{ horseId: string; date: Date; trackName: string; place: number | null; galloped: boolean; disqualified: boolean }[]>(Prisma.sql`
    SELECT "horseId", "date", "trackName", "place", "galloped", "disqualified"
    FROM (
      SELECT r.*, row_number() OVER (PARTITION BY r."horseId" ORDER BY r."date" DESC) AS rn
      FROM "spelvarde"."HorseRecord" r
      WHERE r."horseId" = ANY(${horseIds}) AND r."date" < ${before} AND NOT r."scratched"
    ) x
    WHERE x.rn <= ${n}
    ORDER BY "horseId", "date" DESC`);
  for (const r of rows) {
    const list = out.get(r.horseId) ?? [];
    list.push({ date: dateStr(r.date), trackName: r.trackName, place: r.place, galloped: r.galloped, disqualified: r.disqualified });
    out.set(r.horseId, list);
  }
  return out;
}

async function latestStreck(db: Db, roundId: string) {
  const snap = await db.roundSnapshot.findFirst({
    where: { roundId },
    orderBy: { takenAt: "desc" },
    include: { values: { select: { startId: true, value: true } } },
  });
  return snap ? { kind: snap.kind, takenAt: snap.takenAt, values: new Map(snap.values.map((v) => [v.startId, v.value])) } : null;
}

type StatsSnap<T> = { data: T; fetchedAt: Date } | null;

async function latestStats(db: Db, roundId: string) {
  const keys = ["startnr", "ms", "rank", "kuskliga", "tranarliga", "form"] as const;
  const rows = await Promise.all(
    keys.map((source) => db.statsSnapshot.findFirst({ where: { roundId, source, ok: true }, orderBy: { fetchedAt: "desc" } })),
  );
  const last = await db.statsSnapshot.findFirst({ where: { roundId }, orderBy: { fetchedAt: "desc" } });
  const pick = <T>(i: number): StatsSnap<T> => (rows[i]?.data ? { data: rows[i]!.data as unknown as T, fetchedAt: rows[i]!.fetchedAt } : null);
  return {
    startnr: pick<StartnrData>(0),
    ms: pick<MsData>(1),
    rank: pick<RankData>(2),
    kuskliga: pick<LeagueData>(3),
    tranarliga: pick<LeagueData>(4),
    form: pick<LeagueData>(5),
    // Senaste försöket per sida (även misslyckat), för felmeddelanden.
    lastAttempt: last ? { fetchedAt: last.fetchedAt, ok: last.ok, error: last.error } : null,
  };
}

const started = (startAt: Date, now: Date) => startAt.getTime() <= now.getTime();

function reviewedRace(race: FullRound["races"][number]): boolean {
  return race.reviews.length > 0 || race.starts.some((s) => s.marks[0]?.interesting);
}

export async function fetchState(db: Db, round: { id: string; fetchStatus: FetchState["status"]; fetchedAt: Date | null }, races: { leg: number; recordsFetchedAt: Date | null }[]): Promise<FetchState> {
  const lastGame = await db.fetchLog.findFirst({ where: { roundId: round.id, step: "GAME", ok: true }, orderBy: { startedAt: "desc" } });
  const lastFail = await db.fetchLog.findFirst({ where: { roundId: round.id, ok: false }, orderBy: { startedAt: "desc" } });
  const lastStats = lastGame
    ? await db.fetchLog.findFirst({ where: { roundId: round.id, step: "STATS", ok: true, startedAt: { gte: lastGame.startedAt } } })
    : null;
  // Steg 11: misslyckades senaste riktoddsräkningen efter senaste steg 1 ska
  // kedjan fortsätta därifrån, även om resten är klart.
  const lastRikt = lastGame
    ? await db.fetchLog.findFirst({ where: { roundId: round.id, step: "RIKTODDS", startedAt: { gte: lastGame.startedAt } }, orderBy: { startedAt: "desc" } })
    : null;
  let resumeFrom: ResumePoint | null = null;
  if (round.fetchStatus === "COMPLETE" && lastRikt && !lastRikt.ok) resumeFrom = { step: "RIKTODDS" };
  if (round.fetchStatus !== "COMPLETE") {
    const missing = [...races].sort((a, b) => a.leg - b.leg).find((r) => !r.recordsFetchedAt);
    if (!lastGame || races.length < 8) resumeFrom = { step: "GAME" };
    else if (missing) resumeFrom = { step: "RACE", leg: missing.leg };
    else if (!lastStats) resumeFrom = { step: "STATS" };
    else resumeFrom = { step: "STATS" };
  }
  const failNewer = lastFail && (!lastGame || lastFail.startedAt >= lastGame.startedAt);
  return {
    status: round.fetchStatus,
    fetchedAt: iso(round.fetchedAt),
    lastChanges: (lastGame?.changes as unknown as FetchChanges | null) ?? null,
    resumeFrom,
    lastError: failNewer && lastFail ? { step: lastFail.step, message: lastFail.message, at: lastFail.startedAt.toISOString() } : null,
  };
}

// Aktuell omgång: den senaste (efter datum) som inte är klar, annars den senaste.
export async function currentRoundId(db: Db): Promise<string | null> {
  const open = await db.round.findFirst({ where: { finishedAt: null }, orderBy: { date: "desc" }, select: { id: true } });
  if (open) return open.id;
  const any = await db.round.findFirst({ orderBy: { date: "desc" }, select: { id: true } });
  return any?.id ?? null;
}

// ---- S2 statistikrad ---------------------------------------------------------------

function statsLines(round: FullRound, stats: Awaited<ReturnType<typeof latestStats>>, streck: Awaited<ReturnType<typeof latestStreck>>): Map<number, RaceStatsLine> {
  const favByLeg: Record<number, number | null> = {};
  for (const r of round.races) {
    const values = r.starts.filter((s) => !s.scratched).map((s) => streck?.values.get(s.id) ?? null).filter((v): v is number => v !== null);
    favByLeg[r.leg] = values.length ? Math.max(...values) : null;
  }
  const ranks = msRanks(favByLeg);
  const out = new Map<number, RaceStatsLine>();
  for (const r of round.races) {
    const legRow = stats.startnr?.data.legs.find((l) => l.leg === r.leg && l.distance === r.distance && l.method === r.startMethod) ?? null;
    const numbers = new Set(r.starts.filter((s) => !s.scratched).map((s) => s.number));
    const best = legRow?.byNumber.filter((b) => numbers.has(b.n) && b.pct !== null).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))[0] ?? null;
    out.set(r.leg, {
      ok: !!legRow,
      fetchedAt: iso(stats.startnr?.fetchedAt),
      bestNumber: best ? { number: best.n, pct: best.pct! } : null,
      number1Pct: legRow?.byNumber.find((b) => b.n === 1)?.pct ?? null,
      favoriteWinPct: stats.ms ? favoriteWinPct(stats.ms.data, ranks[r.leg] ?? null) : null,
    });
  }
  return out;
}

// Vinst % och plats % i livet och spår-% för desktoptabellen i S2.
function quickStats(horseStatsJson: Prisma.JsonValue | null, legRow: StartnrData["legs"][number] | null, number: number): StartDto["quick"] {
  const life = yearStatsDto("life", asHorseStats(horseStatsJson)?.life);
  return { winPct: life?.winPct ?? null, placePct: life?.placePct ?? null, postPct: legRow?.byNumber.find((b) => b.n === number)?.pct ?? null };
}

// ---- GET /api/rounds/[id] -------------------------------------------------------------

export async function buildRoundResponse(db: Db, roundId: string, userId: string, now: Date): Promise<RoundResponse | null> {
  const round = await loadFullRound(db, roundId, userId);
  if (!round) return null;
  const date = dateStr(round.date);
  const horseIds = [...new Set(round.races.flatMap((r) => r.starts.map((s) => s.horseId)))];
  const [records, streck, stats, fetch, currentId, rikt, settingsRow, coupon] = await Promise.all([
    lastRecordsByHorse(db, horseIds, round.date),
    latestStreck(db, round.id),
    latestStats(db, round.id),
    fetchState(db, round, round.races),
    currentRoundId(db),
    activeRiktodds(db, round.id),
    db.userSettings.findUnique({ where: { userId } }),
    db.coupon.findUnique({ where: { userId_roundId: { userId, roundId: round.id } } }),
  ]);
  const settings = settingsDto(settingsRow);
  const lines = statsLines(round, stats, streck);

  const races: RaceDto[] = round.races.map((r) => {
    const legRow = stats.startnr?.data.legs.find((l) => l.leg === r.leg && l.distance === r.distance && l.method === r.startMethod) ?? null;
    const starts: StartDto[] = r.starts.map((s) => {
      const r = rikt.byStart.get(s.id);
      const mark = s.marks[0] ? markDto(s.marks[0], riktOf(r), settings.spelbarGuideline) : null;
      const form = formSummary(records.get(s.horseId) ?? [], date);
      const sv = streck?.values.get(s.id);
      return {
        id: s.id,
        number: s.number,
        postPosition: s.postPosition,
        distance: s.distance,
        scratched: s.scratched,
        scratchedAt: iso(s.scratchedAt),
        horse: { id: s.horse.id, name: s.horse.name, sex: s.horse.sex, age: s.age, record: s.record, earnings: s.earnings },
        driver: personDto(s.driver),
        trainer: personDto(s.trainer),
        prevDriver: personDto(s.prevDriver),
        form,
        streck: sv === undefined ? null : sv / 100,
        riktodds: riktOf(r),
        probTop3: r ? Number(r.probTop3) : null,
        uncertain: r ? r.uncertain : form.fewStarts,
        mark,
        result: s.resultAt
          ? { place: s.place, finishOrder: s.finishOrder, disqualified: s.disqualified, galloped: s.galloped, kmTime: s.kmTime, finalOdds: dec(s.finalOdds) }
          : null,
        quick: quickStats(s.horseStatsJson, legRow, s.number),
      };
    });
    const review = r.reviews[0] ?? null;
    return {
      id: r.id,
      leg: r.leg,
      raceNumber: r.raceNumber,
      name: r.name,
      startAt: r.startAt.toISOString(),
      distance: r.distance,
      startMethod: r.startMethod,
      prize: r.prize,
      classLabel: r.classLabel,
      terms: r.terms,
      cancelled: r.cancelled,
      resultAt: iso(r.resultAt),
      started: started(r.startAt, now),
      reviewed: reviewedRace(r),
      review: review ? { reviewedAt: review.reviewedAt.toISOString(), noneInteresting: review.noneInteresting } : null,
      counts: {
        starters: starts.filter((s) => !s.scratched).length,
        scratched: starts.filter((s) => s.scratched).length,
        interesting: starts.filter((s) => s.mark?.interesting).length,
        spelbar: starts.filter((s) => s.mark?.spelbar).length,
        bet: starts.filter((s) => s.mark?.bet).length,
      },
      statsLine: lines.get(r.leg)!,
      starts,
    };
  });

  const phaseRaces: NextStepRace[] = round.races.map((r) => ({ leg: r.leg, name: r.name, startAt: r.startAt, hasResult: !!r.resultAt, cancelled: r.cancelled, reviewed: reviewedRace(r) }));
  const phase = computePhase(date, phaseRaces, now);
  const open = races.filter((r) => !r.started).flatMap((r) => r.starts).filter((s) => !s.scratched);
  return {
    serverTime: now.toISOString(),
    rev: round.rev,
    round: roundDto(round),
    isCurrent: currentId === round.id,
    currentRoundId: currentId,
    phase,
    phaseRail: phaseRail(date, phase),
    nextStep: nextStep({
      now,
      round: { id: round.id, date, fetchStatus: fetch.resumeFrom ? "PARTIAL" : round.fetchStatus, races: phaseRaces },
      nextAvailable: null,
      interestingWithoutOdds: open.filter((s) => s.mark?.interesting && s.mark.unibetOdds === null).length,
      spelbarWithoutBet: open.filter((s) => s.mark?.spelbar && !s.mark.bet).length,
      hasCoupon: !!coupon,
    }),
    fetch,
    races,
    latestStreck: streck ? { kind: streck.kind, takenAt: streck.takenAt.toISOString() } : null,
    coupon: coupon ? couponDto(coupon) : null,
    model: rikt.model ? { id: rikt.model.id, key: rikt.model.key } : null,
    settings: { spelbarGuideline: settings.spelbarGuideline, rowPrice: settings.rowPrice },
  };
}

// ---- GET /api/rounds/current -----------------------------------------------------------

export async function buildCurrentResponse(
  db: Db,
  userId: string,
  now: Date,
  getNextAvailable: () => Promise<NextAvailableResponse>,
): Promise<CurrentRoundResponse> {
  const id = await currentRoundId(db);
  const round = id ? await loadFullRound(db, id, userId) : null;
  if (!round) {
    const next = await getNextAvailable();
    return {
      serverTime: now.toISOString(),
      round: null,
      phase: null,
      phaseRail: null,
      nextStep: nextStep({ now, round: null, nextAvailable: next.game ? { gameId: next.game.gameId, trackName: next.game.trackName, date: next.game.date, fetched: next.fetched } : null }),
      fetch: null,
      legs: [],
      nextAvailable: next,
    };
  }
  const date = dateStr(round.date);
  const phaseRaces: NextStepRace[] = round.races.map((r) => ({ leg: r.leg, name: r.name, startAt: r.startAt, hasResult: !!r.resultAt, cancelled: r.cancelled, reviewed: reviewedRace(r) }));
  const phase = computePhase(date, phaseRaces, now);
  const next = phase === "KLART" ? await getNextAvailable() : null;
  const rikt = await activeRiktodds(db, round.id);
  const legs: LegSummary[] = round.races.map((r) => {
    const marks = r.starts.map((s) => (s.marks[0] ? markDto(s.marks[0], riktOf(rikt.byStart.get(s.id))) : null));
    return {
      raceId: r.id,
      leg: r.leg,
      name: r.name,
      startAt: r.startAt.toISOString(),
      distance: r.distance,
      startMethod: r.startMethod,
      classLabel: r.classLabel,
      starters: r.starts.filter((s) => !s.scratched).length,
      interesting: marks.filter((m) => m?.interesting).length,
      spelbar: marks.filter((m) => m?.spelbar).length,
      bet: marks.filter((m) => m?.bet).length,
      reviewed: reviewedRace(r),
      started: started(r.startAt, now),
      hasResult: !!r.resultAt,
    };
  });
  const fetchNow = await fetchState(db, round, round.races);
  return {
    serverTime: now.toISOString(),
    round: roundDto(round),
    phase,
    phaseRail: phaseRail(date, phase),
    nextStep: nextStep({
      now,
      round: { id: round.id, date, fetchStatus: fetchNow.resumeFrom ? "PARTIAL" : round.fetchStatus, races: phaseRaces },
      nextAvailable: next?.game ? { gameId: next.game.gameId, trackName: next.game.trackName, date: next.game.date, fetched: next.fetched } : null,
    }),
    fetch: fetchNow,
    legs,
    nextAvailable: next,
  };
}

// ---- GET /api/rounds/[id]/races/[leg]/stats ------------------------------------------------

function yearRow(stats: ReturnType<typeof asPersonStats>, year: string) {
  const y = stats?.[year];
  return y ? { year, starts: y.starts, wins: y.wins, winPct: y.winPercentage } : null;
}

export async function buildRaceStats(db: Db, roundId: string, leg: number, now: Date): Promise<RaceStatsResponse | null> {
  const race = await db.race.findUnique({
    where: { roundId_leg: { roundId, leg } },
    include: { round: true, starts: { orderBy: { number: "asc" }, include: { driver: true, trainer: true } } },
  });
  if (!race) return null;
  const [stats, streck, roundRaces] = await Promise.all([
    latestStats(db, roundId),
    latestStreck(db, roundId),
    db.race.findMany({ where: { roundId }, select: { leg: true, starts: { select: { id: true, scratched: true } } } }),
  ]);
  const year = String(new Date(race.round.date).getUTCFullYear());
  const active = race.starts.filter((s) => !s.scratched);

  const favByLeg: Record<number, number | null> = {};
  for (const r of roundRaces) {
    const v = r.starts.filter((s) => !s.scratched).map((s) => streck?.values.get(s.id) ?? null).filter((x): x is number => x !== null);
    favByLeg[r.leg] = v.length ? Math.max(...v) : null;
  }
  const msRank = msRanks(favByLeg)[leg] ?? null;

  const personIds = [...new Set(active.flatMap((s) => [s.driverId, s.trainerId]).filter((x): x is string => !!x))];
  const aliases = await db.personAlias.findMany({ where: { source: "TRAVSTATISTIK", personId: { in: personIds } } });
  const aliasByPerson = new Map<string, string[]>();
  for (const a of aliases) aliasByPerson.set(a.personId!, [...(aliasByPerson.get(a.personId!) ?? []), a.rawName]);

  const findRow = (data: LeagueData | undefined, names: string[]): LeagueRow | null => (data ? data.rows.find((r) => names.includes(r.name)) ?? null : null);
  const meta = (s: StatsSnap<unknown>, error = "Kunde inte hämta statistiken") => ({
    source: "travstatistik.se" as const,
    fetchedAt: iso(s?.fetchedAt),
    ok: !!s,
    error: s ? null : stats.lastAttempt ? stats.lastAttempt.error ?? error : "Statistiken är inte hämtad",
  });

  function people(kind: "driver" | "trainer"): PersonFormDto[] {
    const byPerson = new Map<string, { person: NonNullable<(typeof active)[number]["driver"]>; numbers: number[] }>();
    for (const s of active) {
      const p = kind === "driver" ? s.driver : s.trainer;
      if (!p) continue;
      const entry = byPerson.get(p.id) ?? { person: p, numbers: [] };
      entry.numbers.push(s.number);
      byPerson.set(p.id, entry);
    }
    return [...byPerson.values()].map(({ person, numbers }) => {
      const names = aliasByPerson.get(person.id) ?? [];
      return {
        personId: person.id,
        name: `${person.firstName} ${person.lastName}`.trim(),
        shortName: person.shortName,
        startNumbers: numbers,
        year: yearRow(asPersonStats(person.statsJson), year),
        league: findRow(kind === "driver" ? stats.kuskliga?.data : stats.tranarliga?.data, names),
        form: kind === "driver" ? findRow(stats.form?.data, names) : null,
        linked: names.length > 0,
        rawName: names[0] ?? null,
      };
    });
  }

  const legRow = stats.startnr?.data.legs.find((l) => l.leg === leg && l.distance === race.distance && l.method === race.startMethod) ?? null;
  const group = stats.startnr?.data.all.find((g) => g.distance === race.distance && g.method === race.startMethod) ?? null;
  const rankLeg = stats.rank?.data.legs.find((l) => l.leg === leg) ?? null;
  return {
    raceId: race.id,
    leg,
    distance: race.distance,
    startMethod: race.startMethod,
    trackName: race.round.trackName,
    startnr: { ...meta(stats.startnr), leg: legRow, group, numbers: active.map((s) => s.number), trackAvailable: false },
    favorites: {
      ...meta(stats.ms),
      msRank,
      favoriteWinPct: stats.ms ? favoriteWinPct(stats.ms.data, msRank) : null,
      overallWinPct: stats.ms ? favoriteWinPct(stats.ms.data, null) : null,
      top3Pct: null,
    },
    rank: { ...meta(stats.rank), byRank: rankLeg?.byRank ?? [], races: rankLeg?.races ?? null, range: rankLeg?.range ?? null },
    drivers: { ...meta(stats.kuskliga), rows: people("driver") },
    trainers: { ...meta(stats.tranarliga), rows: people("trainer") },
  };
}

// ---- GET /api/starts/[id] -----------------------------------------------------------------

export async function buildStartDetail(db: Db, startId: string, userId: string, now: Date): Promise<StartDetailResponse | null> {
  const s = await db.start.findUnique({
    where: { id: startId },
    include: { horse: true, driver: true, trainer: true, prevDriver: true, marks: { where: { userId } }, race: { include: { round: true } } },
  });
  if (!s) return null;
  const roundDate = s.race.round.date;
  const date = dateStr(roundDate);
  const [records, total, comments, stats, streck, model, settingsRow] = await Promise.all([
    db.horseRecord.findMany({ where: { horseId: s.horseId, date: { lt: roundDate }, scratched: false }, orderBy: { date: "desc" }, take: 10 }),
    db.horseRecord.count({ where: { horseId: s.horseId, date: { lt: roundDate }, scratched: false } }),
    db.horseComment.findMany({
      where: { userId, horseId: s.horseId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: COMMENT_INCLUDE,
    }),
    latestStats(db, s.race.roundId),
    latestStreck(db, s.race.roundId),
    db.modelVersion.findFirst({ where: { active: true } }),
    db.userSettings.findUnique({ where: { userId } }),
  ]);
  const rikt = model ? await db.riktodds.findUnique({ where: { startId_modelVersionId: { startId: s.id, modelVersionId: model.id } } }) : null;
  const formRecords: FormRecord[] = records.map((r) => ({ date: dateStr(r.date), trackName: r.trackName, place: r.place, galloped: r.galloped, disqualified: r.disqualified }));
  const form = formSummary(formRecords, date);
  const year = date.slice(0, 4);
  const lastYear = String(parseInt(year, 10) - 1);
  const hs = asHorseStats(s.horseStatsJson);
  const legRow = stats.startnr?.data.legs.find((l) => l.leg === s.race.leg && l.distance === s.race.distance && l.method === s.race.startMethod) ?? null;
  const sv = streck?.values.get(s.id);
  const mark = s.marks[0] ? markDto(s.marks[0], riktOf(rikt ?? undefined), settingsDto(settingsRow).spelbarGuideline) : null;

  return {
    start: {
      id: s.id,
      number: s.number,
      postPosition: s.postPosition,
      distance: s.distance,
      scratched: s.scratched,
      scratchedAt: iso(s.scratchedAt),
      horse: { id: s.horse.id, name: s.horse.name, sex: s.horse.sex, age: s.age, record: s.record, earnings: s.earnings },
      driver: personDto(s.driver),
      trainer: personDto(s.trainer),
      prevDriver: personDto(s.prevDriver),
      form,
      streck: sv === undefined ? null : sv / 100,
      riktodds: riktOf(rikt ?? undefined),
      probTop3: rikt ? Number(rikt.probTop3) : null,
      uncertain: rikt ? rikt.uncertain : form.fewStarts,
      mark,
      result: s.resultAt ? { place: s.place, finishOrder: s.finishOrder, disqualified: s.disqualified, galloped: s.galloped, kmTime: s.kmTime, finalOdds: dec(s.finalOdds) } : null,
      quick: quickStats(s.horseStatsJson, legRow, s.number),
      raceId: s.raceId,
      roundId: s.race.roundId,
      leg: s.race.leg,
      raceName: s.race.name,
      startAt: s.race.startAt.toISOString(),
      started: started(s.race.startAt, now),
    },
    records: records.map((r) => ({
      date: dateStr(r.date),
      trackName: r.trackName,
      distance: r.distance,
      startMethod: r.startMethod,
      postPosition: r.postPosition,
      place: r.place,
      galloped: r.galloped,
      disqualified: r.disqualified,
      kmTime: r.kmTime,
      odds: dec(r.odds),
      driverName: r.driverName,
    })),
    recordsTotal: total,
    recordsFetchedAt: iso(s.recordsFetchedAt),
    recordsError: s.recordsError,
    gallopWarning: gallopWarning(lastStarts(formRecords, date, 5)),
    stats: {
      horse: { thisYear: yearStatsDto(year, hs?.years[year]), lastYear: yearStatsDto(lastYear, hs?.years[lastYear]), life: yearStatsDto("life", hs?.life) },
      driver: yearStatsDto(year, asPersonStats(s.driver?.statsJson ?? null)?.[year]),
      trainer: yearStatsDto(year, asPersonStats(s.trainer?.statsJson ?? null)?.[year]),
      post: legRow ? { number: s.number, pct: legRow.byNumber.find((b) => b.n === s.number)?.pct ?? null, races: legRow.races } : null,
    },
    comments: comments.map(commentDto),
    riktodds: rikt && model ? riktoddsDetailDto(rikt, model) : null,
    tips: [],
  };
}
