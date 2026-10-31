// Läsning av omgången för klienten: GET /api/rounds/current, /api/rounds/[id],
// /api/rounds/[id]/races/[leg]/stats och /api/starts/[id]. Allt
// användarägt (Mark, RaceReview, HorseComment, Coupon, UserSettings)
// filtreras på userId. Riktodds är gemensamt och läses för den aktiva
// modellversionen.

import { Prisma, type PrismaClient } from "@prisma/client";
import { COMMENT_INCLUDE, asHorseStats, asPersonStats, commentDto, couponDto, dateStr, dec, iso, markDto, personDto, riktoddsDetailDto, roundDto, settingsDto, submittedRowDto, yearStatsDto } from "@/lib/dto";
import { legsFor, type GameType } from "@/lib/game-type";
import { positiveSignals, type SignalResult } from "@/lib/positive-signals";
import { barefoot, isCalibrated, parseParams } from "@/lib/riktodds";
import { bestNumbers, MIN_RACES_TRACK_BEST, postTable, postTablesForRaces, type PostTable } from "@/lib/hist";
import { formSummary, gallopWarning, lastStarts, type FormRecord } from "@/lib/gallop";
import { computePhase, firstStartOf, mineLabel, nextStep, phaseRail, roundDayPassed, type NextStepRace } from "@/lib/phase";
import { byPlace, hitOf, nextResultsSyncAt, outcomeSummary } from "@/lib/outcomes";
import { settleOutcomes } from "@/lib/outcomes-server";
import { favoriteWinPct, msRanks, type LeagueData, type LeagueRow, type MsData, type RankData, type StartnrData } from "@/lib/travstatistik";
import { lastOddsAttemptOf, latestOddsOf, unibetByStart, unibetHistoryOf, unibetSummary } from "@/lib/unibet-server";
import { roundTipsSummary, startTipsByStart, startTipsDetail } from "@/lib/tips-server";
import type {
  CurrentRoundResponse,
  FetchChanges,
  FetchState,
  LegSummary,
  NextAvailableResponse,
  OutcomeSummary,
  PersonFormDto,
  RaceDto,
  RaceStatsLine,
  RaceStatsResponse,
  ResumePoint,
  RoundResponse,
  StartDetailResponse,
  StartDto,
  StartOutcomeDto,
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
            outcomes: { where: { userId } },
          },
        },
      },
    },
  }) satisfies Prisma.RoundInclude;

type FullRound = Prisma.RoundGetPayload<{ include: ReturnType<typeof roundInclude> }>;

export async function loadFullRound(db: Db, roundId: string, userId: string): Promise<FullRound | null> {
  return db.round.findUnique({ where: { id: roundId }, include: roundInclude(userId) });
}

// ---- Resultat (E4a) ------------------------------------------------------------------

// Behöver frysningen eller resultaten göras (lib/outcomes-server.ts)? Avgörs
// i minnet ur den redan lästa omgången, så att GET inte gör några extra frågor
// när allt är klart: ett lopp har startat utan att vara fryst, eller någon av
// användarens Outcome skiljer sig från resultatet (eller hästen är struken).
export function needsSettle(round: FullRound, now: Date): boolean {
  for (const r of round.races) {
    if (!r.cancelled && !r.outcomesFrozenAt && r.startAt.getTime() <= now.getTime()) return true;
    for (const s of r.starts) {
      const o = s.outcomes[0];
      if (!o) continue;
      if (s.scratched) return true;
      if (!r.resultAt && !r.cancelled) continue;
      const place = r.cancelled ? null : s.place;
      const disq = r.cancelled ? false : s.disqualified;
      if (o.place !== place || o.disqualified !== disq || o.hit !== hitOf(place, disq, r.cancelled)) return true;
    }
  }
  return false;
}

// Läser omgången och fryser/uppdaterar Outcome först om det behövs.
export async function loadSettledRound(db: Db, roundId: string, userId: string, now: Date): Promise<FullRound | null> {
  const round = await loadFullRound(db, roundId, userId);
  if (!round || !needsSettle(round, now)) return round;
  await settleOutcomes(db, round.id, now);
  // Bara användarens Outcome har ändrats: läs om dem i stället för hela omgången.
  const fresh = await db.outcome.findMany({ where: { roundId: round.id, userId } });
  const byStart = new Map(fresh.map((o) => [o.startId, o]));
  for (const r of round.races) {
    if (!r.cancelled && !r.outcomesFrozenAt && r.startAt.getTime() <= now.getTime()) r.outcomesFrozenAt = now;
    for (const s of r.starts) s.outcomes = byStart.has(s.id) ? [byStart.get(s.id)!] : [];
  }
  return round;
}

type FullRace = FullRound["races"][number];
type FullOutcome = FullRace["starts"][number]["outcomes"][number];

function outcomeDto(o: FullOutcome | undefined): StartOutcomeDto | null {
  if (!o) return null;
  return {
    interesting: o.interesting,
    spelbar: o.spelbar,
    bet: o.bet,
    xFactor: o.xFactor,
    hit: o.hit,
    place: o.place,
    disqualified: o.disqualified,
    unibetOdds: dec(o.unibetOdds),
    trollspotRank: o.trollspotRank,
    trollspotMinOdds: dec(o.trollspotMinOdds),
    trollspotEstOdds: dec(o.trollspotEstOdds),
  };
}

const raceOutcomes = (r: FullRace) => r.starts.flatMap((s) => (s.outcomes[0] ? [s.outcomes[0]] : []));
const hasCountedResult = (r: FullRace) => !!r.resultAt && !r.cancelled;

// Summeringen för avdelningen: null före resultat och för inställda lopp.
function raceSummary(r: FullRace): OutcomeSummary | null {
  return hasCountedResult(r) ? outcomeSummary(raceOutcomes(r)) : null;
}

// Summeringen för omgången: null tills någon avdelning har resultat.
function roundSummary(round: FullRound): OutcomeSummary | null {
  const done = round.races.filter(hasCountedResult);
  return done.length ? outcomeSummary(done.flatMap(raceOutcomes)) : null;
}

function legResults(r: FullRace): Pick<LegSummary, "cancelled" | "winner" | "betResults" | "summary"> {
  const placed = r.resultAt ? r.starts.filter((s) => !s.scratched && s.place === 1).sort(byPlace) : [];
  return {
    cancelled: r.cancelled,
    winner: placed[0] ? { number: placed[0].number, name: placed[0].horse.name } : null,
    betResults: r.starts
      .filter((s) => s.outcomes[0]?.bet)
      .map((s) => ({ number: s.number, name: s.horse.name, place: r.resultAt ? s.place : null, disqualified: !!r.resultAt && s.disqualified })),
    summary: raceSummary(r),
  };
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
  const rows = await db.$queryRaw<{ horseId: string; date: Date; trackName: string; place: number | null; galloped: boolean; disqualified: boolean; kmTime: string | null; distance: number | null; startMethod: "AUTO" | "VOLTE" | null }[]>(Prisma.sql`
    SELECT "horseId", "date", "trackName", "place", "galloped", "disqualified", "kmTime", "distance", "startMethod"
    FROM (
      SELECT r.*, row_number() OVER (PARTITION BY r."horseId" ORDER BY r."date" DESC) AS rn
      FROM "spelvarde"."HorseRecord" r
      WHERE r."horseId" = ANY(${horseIds}) AND r."date" < ${before} AND NOT r."scratched"
    ) x
    WHERE x.rn <= ${n}
    ORDER BY "horseId", "date" DESC`);
  for (const r of rows) {
    const list = out.get(r.horseId) ?? [];
    list.push({ date: dateStr(r.date), trackName: r.trackName, place: r.place, galloped: r.galloped, disqualified: r.disqualified, kmTime: r.kmTime, distance: r.distance, startMethod: r.startMethod });
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

export async function fetchState(db: Db, round: { id: string; gameType: string; fetchStatus: FetchState["status"]; fetchedAt: Date | null }, races: { leg: number; recordsFetchedAt: Date | null }[]): Promise<FetchState> {
  const legs = legsFor(round.gameType);
  const lastGame = await db.fetchLog.findFirst({ where: { roundId: round.id, step: "GAME", ok: true }, orderBy: { startedAt: "desc" } });
  // Unibets steg (E2.2) hör inte till Hämta omgång och visas inte som fel här.
  // Resultathämtningen (E4a) visas i resultatvyn, inte här.
  const lastFail = await db.fetchLog.findFirst({ where: { roundId: round.id, ok: false, NOT: [{ step: { startsWith: "UNIBET_" } }, { step: "RESULTS" }] }, orderBy: { startedAt: "desc" } });
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
    if (!lastGame || races.length < legs) resumeFrom = { step: "GAME" };
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

export const POST_SOURCE = "ATG 2 år";

function statsLines(
  round: FullRound,
  stats: Awaited<ReturnType<typeof latestStats>>,
  streck: Awaited<ReturnType<typeof latestStreck>>,
  posts: Map<number, PostTable | null>,
  trackPosts: Map<number, PostTable | null>,
): Map<number, RaceStatsLine> {
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
    const favorite = stats.ms ? favoriteWinPct(stats.ms.data, ranks[r.leg] ?? null) : null;
    // Statistikbasen i första hand, annars travstatistik.se (bara vinst).
    const table = posts.get(r.leg) ?? null;
    // Banans eget bästa spår bland loppets nummer, med minst 150 lopp på banan.
    const tt = trackPosts.get(r.leg) ?? null;
    const tb = tt && tt.races >= MIN_RACES_TRACK_BEST ? bestNumbers(tt, [...numbers]) : null;
    const track = {
      trackBestWin: tb?.win ? { number: tb.win.n, pct: tb.win.winPct! } : null,
      trackBestPlace: tb?.place ? { number: tb.place.n, pct: tb.place.placePct! } : null,
      trackRaces: tt?.races ?? null,
    };
    if (table) {
      const b = bestNumbers(table, [...numbers]);
      const one = table.byNumber.find((x) => x.n === 1);
      out.set(r.leg, {
        ok: true,
        fetchedAt: null,
        bestNumber: b.win ? { number: b.win.n, pct: b.win.winPct! } : null,
        bestPlace: b.place ? { number: b.place.n, pct: b.place.placePct! } : null,
        ...track,
        number1Pct: one?.winPct ?? null,
        number1PlacePct: one?.placePct ?? null,
        postSource: POST_SOURCE,
        favoriteWinPct: favorite,
      });
      continue;
    }
    const best = legRow?.byNumber.filter((b) => numbers.has(b.n) && b.pct !== null).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))[0] ?? null;
    out.set(r.leg, {
      ok: !!legRow,
      fetchedAt: iso(stats.startnr?.fetchedAt),
      bestNumber: best ? { number: best.n, pct: best.pct! } : null,
      bestPlace: null,
      ...track,
      number1Pct: legRow?.byNumber.find((b) => b.n === 1)?.pct ?? null,
      number1PlacePct: null,
      postSource: legRow ? "travstatistik.se" : null,
      favoriteWinPct: favorite,
    });
  }
  return out;
}

// Vinst % och plats % i år och i fjol tillsammans (samma period som
// riktoddsets plats och vinst, "Talar för") och startnumrets vinst % och
// plats % för desktoptabellen i S2. Statistikbasen i första hand, annars
// travstatistik.se. year = omgångens år.
function quickStats(horseStatsJson: Prisma.JsonValue | null, legRow: StartnrData["legs"][number] | null, number: number, table: PostTable | null, year: string): StartDto["quick"] {
  const hs = asHorseStats(horseStatsJson);
  const ys = [hs?.years[year], hs?.years[String(Number(year) - 1)]].filter((y): y is NonNullable<typeof y> => !!y);
  const starts = ys.reduce((a, y) => a + y.starts, 0);
  const wins = ys.reduce((a, y) => a + y.wins, 0);
  const placed = ys.reduce((a, y) => a + y.wins + y.seconds + y.thirds, 0);
  const pct1 = (n: number) => (starts > 0 ? Math.round((1000 * n) / starts) / 10 : null);
  const row = table?.byNumber.find((b) => b.n === number) ?? null;
  return {
    winPct: pct1(wins),
    placePct: pct1(placed),
    starts: starts > 0 ? starts : null,
    lifeStarts: hs?.life?.starts ?? null,
    postPct: table ? row?.winPct ?? null : legRow?.byNumber.find((b) => b.n === number)?.pct ?? null,
    postPlacePct: row?.placePct ?? null,
  };
}

// Positiva signaler för loppets hästar (lib/positive-signals.ts), samma indata som backtestet.
function raceSignals(
  starts: FullRound["races"][number]["starts"],
  records: Map<string, FormRecord[]>,
  table: PostTable | null,
  streck: Awaited<ReturnType<typeof latestStreck>>,
  year: string,
): Map<string, SignalResult> {
  const lastYear = String(Number(year) - 1);
  const rows = table?.byNumber.filter((b) => b.placePct !== null) ?? [];
  const mean = rows.length ? rows.reduce((a, b) => a + (b.placePct as number), 0) / rows.length : 0;
  const counts = (y: { starts: number; wins: number; seconds: number; thirds: number } | undefined) => (y ? { starts: y.starts, wins: y.wins, placed: y.wins + y.seconds + y.thirds } : null);
  const res = positiveSignals(
    starts.map((s) => {
      const hs = asHorseStats(s.horseStatsJson);
      const d = asPersonStats(s.driver?.statsJson ?? null)?.[year];
      const t = asPersonStats(s.trainer?.statsJson ?? null)?.[year];
      const row = rows.find((b) => b.n === s.number);
      const sv = streck?.values.get(s.id);
      const total = hs?.life?.earnings ?? s.earnings;
      return {
        scratched: s.scratched,
        thisYear: counts(hs?.years[year]),
        lastYear: counts(hs?.years[lastYear]),
        records: (records.get(s.horseId) ?? []).map((x) => ({ ...x })),
        driver: d ? { starts: d.starts, wins: d.wins } : null,
        trainer: t ? { starts: t.starts, wins: t.wins } : null,
        earnings: total != null && hs?.life?.starts ? { total, lifeStarts: hs.life.starts } : null,
        barefoot: barefoot(s.shoes),
        post: row && mean > 0 ? { pct: row.placePct as number, mean } : null,
        streck: sv === undefined ? null : sv / 100,
      };
    }),
  );
  const out = new Map<string, SignalResult>();
  starts.forEach((s, i) => res[i] && out.set(s.id, res[i]!));
  return out;
}

// ---- GET /api/rounds/[id] -------------------------------------------------------------

// getNextAvailable saknas = Nästa steg erbjuder aldrig nästa omgång (tester).
export async function buildRoundResponse(
  db: Db,
  roundId: string,
  userId: string,
  now: Date,
  getNextAvailable?: (gameType: GameType) => Promise<NextAvailableResponse>,
): Promise<RoundResponse | null> {
  const round = await loadSettledRound(db, roundId, userId, now);
  if (!round) return null;
  const date = dateStr(round.date);
  const horseIds = [...new Set(round.races.flatMap((r) => r.starts.map((s) => s.horseId)))];
  const [records, streck, stats, fetch, currentId, rikt, settingsRow, coupon, submittedRow, sourcesEnabled, posts, trackPosts, unibet, latestOdds, lastOddsAttempt] = await Promise.all([
    lastRecordsByHorse(db, horseIds, round.date),
    latestStreck(db, round.id),
    latestStats(db, round.id),
    fetchState(db, round, round.races),
    currentRoundId(db),
    activeRiktodds(db, round.id),
    db.userSettings.findUnique({ where: { userId } }),
    db.coupon.findUnique({ where: { userId_roundId: { userId, roundId: round.id } } }),
    db.submittedRow.findUnique({ where: { userId_roundId: { userId, roundId: round.id } } }),
    db.source.count({ where: { userId, enabled: true } }),
    postTablesForRaces(db, round.races, round.date),
    postTablesForRaces(db, round.races, round.date, round.trackId),
    // E2.2: Unibets senaste och första odds per start (två frågor för hela omgången).
    unibetByStart(db, round.id),
    latestOddsOf(db, round.id),
    lastOddsAttemptOf(db, round.id),
  ]);
  const settings = settingsDto(settingsRow);
  const lines = statsLines(round, stats, streck, posts, trackPosts);
  // E5: godkända tips per start och tipsraden i S1.
  const [tipsByStart, tipsSummary] = await Promise.all([startTipsByStart(db, userId, round.id), roundTipsSummary(db, userId, round.id, now)]);

  const year = date.slice(0, 4);
  const races: RaceDto[] = round.races.map((r) => {
    const legRow = stats.startnr?.data.legs.find((l) => l.leg === r.leg && l.distance === r.distance && l.method === r.startMethod) ?? null;
    const table = posts.get(r.leg) ?? null;
    const signals = raceSignals(r.starts, records, table, streck, year);
    const starts: StartDto[] = r.starts.map((s) => {
      const r = rikt.byStart.get(s.id);
      const mark = s.marks[0] ? markDto(s.marks[0], riktOf(r), settings.spelbarGuideline, settings, settings.spelbarTolerance) : null;
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
        quick: quickStats(s.horseStatsJson, legRow, s.number, table, date.slice(0, 4)),
        signals: signals.get(s.id) ?? null,
        unibet: unibet.get(s.id) ?? null,
        outcome: outcomeDto(s.outcomes[0]),
        tip: tipsByStart.get(s.id) ?? null,
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
      unibetEventKey: r.unibetEventKey ?? null,
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
      summary: raceSummary(r),
    };
  });

  const phaseRaces: NextStepRace[] = round.races.map((r, i) => ({
    leg: r.leg,
    name: r.name,
    startAt: r.startAt,
    hasResult: !!r.resultAt,
    cancelled: r.cancelled,
    reviewed: reviewedRace(r),
    mine: mineOf(races[i].starts.map((s) => ({ name: s.horse.name, scratched: s.scratched, mark: s.mark }))),
  }));
  const summary = roundSummary(round);
  const phase = computePhase(date, phaseRaces, now);
  const open = races.filter((r) => !r.started).flatMap((r) => r.starts).filter((s) => !s.scratched);
  // Den aktuella omgången är klar (eller dess dag har passerat): slå upp nästa
  // spel, så att Nästa steg blir Hämta omgång som i /api/rounds/current.
  const next = getNextAvailable && currentId === round.id && (phase === "KLART" || roundDayPassed(date, now)) ? await getNextAvailable(settings.gameType) : null;
  return {
    serverTime: now.toISOString(),
    rev: round.rev,
    round: roundDto(round),
    isCurrent: currentId === round.id,
    currentRoundId: currentId,
    phase,
    phaseRail: phaseRail(date, phase, firstStartOf(round.races)),
    nextStep: nextStep({
      now,
      gameType: settings.gameType,
      round: { id: round.id, date, gameType: round.gameType, fetchStatus: fetch.resumeFrom ? "PARTIAL" : round.fetchStatus, races: phaseRaces },
      nextAvailable: next?.game ? { gameId: next.game.gameId, trackName: next.game.trackName, date: next.game.date, fetched: next.fetched } : null,
      interestingWithoutOdds: open.filter((s) => s.mark?.interesting && s.mark.unibetOdds === null).length,
      spelbarWithoutBet: open.filter((s) => s.mark?.spelbar && !s.mark.bet).length,
      hasCoupon: !!coupon,
      summary,
    }),
    fetch,
    races,
    latestStreck: streck ? { kind: streck.kind, takenAt: streck.takenAt.toISOString() } : null,
    coupon: coupon ? couponDto(coupon, legsFor(round.gameType)) : null,
    submittedRow: submittedRow ? submittedRowDto(submittedRow) : null,
    model: rikt.model ? { id: rikt.model.id, key: rikt.model.key, calibrated: isCalibrated(parseParams(rikt.model.params)) } : null,
    settings: { spelbarGuideline: settings.spelbarGuideline, rowPrice: settings.rowPrice, xFactorTror: settings.xFactorTror, xFactorStark: settings.xFactorStark, spelbarTolerance: settings.spelbarTolerance },
    sourcesEnabled,
    latestOdds,
    lastOddsAttempt,
    results: {
      syncedAt: iso(round.liveOkAt),
      nextSyncAt: iso(nextResultsSyncAt(phaseRaces, round.liveSyncAt, now)),
      summary,
    },
    tips: tipsSummary,
  };
}

// Användarens markerade hästar i avdelningen för Nästa steg (punkt 4).
function mineOf(starts: { name: string; scratched: boolean; mark: { interesting: boolean; spelbar: boolean; bet: boolean } | null }[]): NextStepRace["mine"] {
  return starts.flatMap((s) => {
    const label = s.scratched ? null : mineLabel(s.mark);
    return label ? [{ name: s.name, label }] : [];
  });
}

// ---- GET /api/rounds/current -----------------------------------------------------------

export async function buildCurrentResponse(
  db: Db,
  userId: string,
  now: Date,
  getNextAvailable: (gameType: GameType) => Promise<NextAvailableResponse>,
): Promise<CurrentRoundResponse> {
  const id = await currentRoundId(db);
  const [round, settingsRow] = await Promise.all([id ? loadSettledRound(db, id, userId, now) : null, db.userSettings.findUnique({ where: { userId } })]);
  const settings = settingsDto(settingsRow);
  const gameType = settings.gameType;
  if (!round) {
    const next = await getNextAvailable(gameType);
    return {
      serverTime: now.toISOString(),
      gameType,
      round: null,
      phase: null,
      phaseRail: null,
      nextStep: nextStep({ now, gameType, round: null, nextAvailable: next.game ? { gameId: next.game.gameId, trackName: next.game.trackName, date: next.game.date, fetched: next.fetched } : null }),
      fetch: null,
      legs: [],
      nextAvailable: next,
    };
  }
  const date = dateStr(round.date);
  const rikt = await activeRiktodds(db, round.id);
  const marksByRace = round.races.map((r) => r.starts.map((s) => (s.marks[0] ? markDto(s.marks[0], riktOf(rikt.byStart.get(s.id)), settings.spelbarGuideline, settings, settings.spelbarTolerance) : null)));
  const phaseRaces: NextStepRace[] = round.races.map((r, i) => ({
    leg: r.leg,
    name: r.name,
    startAt: r.startAt,
    hasResult: !!r.resultAt,
    cancelled: r.cancelled,
    reviewed: reviewedRace(r),
    mine: mineOf(r.starts.map((s, j) => ({ name: s.horse.name, scratched: s.scratched, mark: marksByRace[i][j] }))),
  }));
  const phase = computePhase(date, phaseRaces, now);
  const next = phase === "KLART" || roundDayPassed(date, now) ? await getNextAvailable(gameType) : null;
  const legs: LegSummary[] = round.races.map((r, i) => {
    const marks = marksByRace[i];
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
      ...legResults(r),
    };
  });
  const fetchNow = await fetchState(db, round, round.races);
  return {
    serverTime: now.toISOString(),
    gameType,
    round: roundDto(round),
    phase,
    phaseRail: phaseRail(date, phase, firstStartOf(round.races)),
    nextStep: nextStep({
      now,
      gameType,
      round: { id: round.id, date, gameType: round.gameType, fetchStatus: fetchNow.resumeFrom ? "PARTIAL" : round.fetchStatus, races: phaseRaces },
      nextAvailable: next?.game ? { gameId: next.game.gameId, trackName: next.game.trackName, date: next.game.date, fetched: next.fetched } : null,
      summary: roundSummary(round),
    }),
    fetch: fetchNow,
    legs,
    nextAvailable: next,
    tips: await roundTipsSummary(db, userId, round.id, now),
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
  const postQuery = { method: race.startMethod, distance: race.distance, before: race.round.date };
  const [stats, streck, roundRaces, postsAll, postsTrack, baseRaces] = await Promise.all([
    latestStats(db, roundId),
    latestStreck(db, roundId),
    db.race.findMany({ where: { roundId }, select: { leg: true, starts: { select: { id: true, scratched: true } } } }),
    postTable(db, postQuery).catch(() => null),
    postTable(db, { ...postQuery, trackId: race.round.trackId }).catch(() => null),
    db.histRace.count(),
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
    posts: { all: postsAll, track: postsTrack, numbers: active.map((s) => s.number), baseRaces },
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
  const [records, total, comments, stats, streck, model, settingsRow, table, unibetHistory] = await Promise.all([
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
    postTable(db, { method: s.race.startMethod, distance: s.race.distance, before: roundDate }).catch(() => null),
    unibetHistoryOf(db, s.id),
  ]);
  const tipsDetail = await startTipsDetail(db, userId, s.id, s.race.roundId, now);
  const rikt = model ? await db.riktodds.findUnique({ where: { startId_modelVersionId: { startId: s.id, modelVersionId: model.id } } }) : null;
  const formRecords: FormRecord[] = records.map((r) => ({ date: dateStr(r.date), trackName: r.trackName, place: r.place, galloped: r.galloped, disqualified: r.disqualified }));
  const form = formSummary(formRecords, date);
  const year = date.slice(0, 4);
  const lastYear = String(parseInt(year, 10) - 1);
  const hs = asHorseStats(s.horseStatsJson);
  const legRow = stats.startnr?.data.legs.find((l) => l.leg === s.race.leg && l.distance === s.race.distance && l.method === s.race.startMethod) ?? null;
  const sv = streck?.values.get(s.id);
  const st = settingsDto(settingsRow);
  const mark = s.marks[0] ? markDto(s.marks[0], riktOf(rikt ?? undefined), st.spelbarGuideline, st, st.spelbarTolerance) : null;

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
      quick: quickStats(s.horseStatsJson, legRow, s.number, table, year),
      // Signalerna kräver hela fältet och finns på starten i omgångens svar.
      signals: null,
      unibet: unibetSummary(unibetHistory),
      raceId: s.raceId,
      roundId: s.race.roundId,
      leg: s.race.leg,
      raceName: s.race.name,
      startAt: s.race.startAt.toISOString(),
      started: started(s.race.startAt, now),
      tip: tipsDetail.tip,
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
      post: table
        ? { number: s.number, pct: table.byNumber.find((b) => b.n === s.number)?.winPct ?? null, placePct: table.byNumber.find((b) => b.n === s.number)?.placePct ?? null, races: table.races, label: table.distanceLabel }
        : legRow
          ? { number: s.number, pct: legRow.byNumber.find((b) => b.n === s.number)?.pct ?? null, placePct: null, races: legRow.races, label: null }
          : null,
    },
    comments: comments.map(commentDto),
    riktodds: rikt && model ? riktoddsDetailDto(rikt, model) : null,
    tips: tipsDetail.tips,
    tipSourceCount: tipsDetail.tipSourceCount,
    tipsPending: tipsDetail.tipsPending,
    unibetHistory,
  };
}
