// Efteranalysen från databasen: Outcome (frysta värden vid start) och
// taggarna från Live (HorseComment RACE). Beräkningarna är lib/analysis.ts.
import type { PrismaClient } from "@prisma/client";
import { overTime, roundAnalysis, type AnalysisRow, type OverTime, type RoundAnalysis, type RoundRows } from "@/lib/analysis";
import { dateStr } from "@/lib/dto";

type Db = PrismaClient;
const num = (d: { toString(): string } | null) => (d === null ? null : Number(d));

async function rowsFor(db: Db, userId: string, roundIds: string[]): Promise<Map<string, AnalysisRow[]>> {
  const [outcomes, comments] = await Promise.all([
    db.outcome.findMany({
      where: { userId, roundId: { in: roundIds } },
      include: { start: { select: { number: true, galloped: true, horse: { select: { name: true } }, driver: { select: { firstName: true, lastName: true } }, race: { select: { leg: true, cancelled: true } } } } },
    }),
    db.horseComment.findMany({ where: { userId, kind: "RACE", deletedAt: null, roundId: { in: roundIds } }, select: { startId: true, tags: true } }),
  ]);
  const tagsByStart = new Map(comments.filter((c) => c.startId).map((c) => [c.startId!, c.tags]));
  const out = new Map<string, AnalysisRow[]>(roundIds.map((id) => [id, []]));
  for (const o of outcomes) {
    if (o.start.race.cancelled) continue;
    out.get(o.roundId)?.push({
      startId: o.startId,
      leg: o.start.race.leg,
      number: o.start.number,
      horseName: o.start.horse.name,
      driverName: o.start.driver ? `${o.start.driver.firstName} ${o.start.driver.lastName}`.trim() : null,
      interesting: o.interesting,
      spelbar: o.spelbar,
      bet: o.bet,
      betOdds: num(o.betOdds),
      unibetOdds: num(o.unibetOdds),
      riktodds: num(o.riktodds),
      riktoddsX: num(o.riktoddsX),
      xFactor: o.xFactor,
      trollspotRank: o.trollspotRank,
      place: o.place,
      disqualified: o.disqualified,
      galloped: o.start.galloped,
      hit: o.hit,
      tags: tagsByStart.get(o.startId) ?? [],
    });
  }
  return out;
}

export type RoundAnalysisResponse = { round: { id: string; date: string; trackName: string; gameType: string }; analysis: RoundAnalysis };

export async function buildRoundAnalysis(db: Db, roundId: string, userId: string): Promise<RoundAnalysisResponse | null> {
  const round = await db.round.findUnique({ where: { id: roundId }, select: { id: true, date: true, trackName: true, gameType: true } });
  if (!round) return null;
  const rows = (await rowsFor(db, userId, [round.id])).get(round.id) ?? [];
  return { round: { id: round.id, date: dateStr(round.date), trackName: round.trackName, gameType: round.gameType }, analysis: roundAnalysis(rows) };
}

export type OverTimeResponse = { period: number | null; analysis: OverTime };

// De senaste `period` omgångarna med minst ett resultat (null = alla).
export async function buildOverTime(db: Db, userId: string, period: number | null): Promise<OverTimeResponse> {
  const rounds = await db.round.findMany({
    where: { outcomes: { some: { userId, hit: { not: null } } } },
    orderBy: { date: "desc" },
    take: period ?? undefined,
    select: { id: true, date: true, trackName: true, gameType: true },
  });
  const rows = await rowsFor(db, userId, rounds.map((r) => r.id));
  const list: RoundRows[] = rounds.map((r) => ({ roundId: r.id, date: dateStr(r.date), trackName: r.trackName, gameType: r.gameType, rows: rows.get(r.id) ?? [] }));
  return { period, analysis: overTime(list) };
}
