// Riktodds mot databasen (specen 7.5 och steg 11 i 10.1): samlar indata per
// start, räknar med lib/riktodds.ts och sparar en rad per start och
// modellversion. Riktodds är gemensam data (som ATG-fakta) och räknas med
// den aktiva modellen om inget annat anges. Testat i lib/e2.db.test.ts.

import type { Prisma, PrismaClient } from "@prisma/client";
import { asHorseStats, asPersonStats, dateStr } from "@/lib/dto";
import { computeRace, parseParams, parseWeights, V1_PARAMS, V1_WEIGHTS, type StartFacts, type StartRiktodds } from "@/lib/riktodds";
import { lastRecordsByHorse } from "@/lib/round-server";
import type { StartnrData } from "@/lib/travstatistik";

type Db = PrismaClient;

// Den aktiva modellen. Finns ingen alls skapas v1 med standardvikterna (7.3),
// och finns versioner men ingen aktiv blir den senaste aktiv.
export async function ensureActiveModel(db: Db) {
  const active = await db.modelVersion.findFirst({ where: { active: true } });
  if (active) return active;
  const latest = await db.modelVersion.findFirst({ orderBy: { createdAt: "desc" } });
  try {
    if (latest) return await db.modelVersion.update({ where: { id: latest.id }, data: { active: true } });
    return await db.modelVersion.create({ data: { key: "v1", weights: V1_WEIGHTS, params: V1_PARAMS, active: true } });
  } catch {
    // Två anrop samtidigt: det unika indexet på active släpper bara igenom ett.
    return db.modelVersion.findFirstOrThrow({ where: { active: true } });
  }
}

const counts = (y: { starts: number; wins: number; seconds: number; thirds: number } | undefined | null) =>
  y ? { starts: y.starts, wins: y.wins, placed: y.wins + y.seconds + y.thirds } : null;

export type RoundRiktoddsResult = {
  roundId: string;
  modelKey: string;
  // Antal starter som fick riktodds.
  computed: number;
  // Avdelningar som inte fick något (färre än 4 startande).
  skippedLegs: number[];
};

// Räknar alla avdelningar i omgången och sparar. Strukna och lopp med färre
// än 4 startande får ingen rad (en gammal rad för modellversionen tas bort).
export async function computeRoundRiktodds(db: Db, roundId: string, opts: { modelVersionId?: string; now?: Date } = {}): Promise<RoundRiktoddsResult | null> {
  const now = opts.now ?? new Date();
  const round = await db.round.findUnique({
    where: { id: roundId },
    include: { races: { orderBy: { leg: "asc" }, include: { starts: { orderBy: { number: "asc" }, include: { driver: true, trainer: true } } } } },
  });
  if (!round) return null;
  const model = opts.modelVersionId ? await db.modelVersion.findUniqueOrThrow({ where: { id: opts.modelVersionId } }) : await ensureActiveModel(db);
  const weights = parseWeights(model.weights);
  const params = parseParams(model.params);

  const horseIds = [...new Set(round.races.flatMap((r) => r.starts.map((s) => s.horseId)))];
  const [records, snap, startnrRow] = await Promise.all([
    lastRecordsByHorse(db, horseIds, round.date, 5),
    db.roundSnapshot.findFirst({ where: { roundId }, orderBy: { takenAt: "desc" }, include: { values: { select: { startId: true, value: true } } } }),
    db.statsSnapshot.findFirst({ where: { roundId, source: "startnr", ok: true }, orderBy: { fetchedAt: "desc" } }),
  ]);
  const streck = new Map(snap?.values.map((v) => [v.startId, v.value / 100]) ?? []);
  const startnr = (startnrRow?.data as unknown as StartnrData | null) ?? null;
  const year = dateStr(round.date).slice(0, 4);
  const lastYear = String(Number(year) - 1);

  const results: StartRiktodds[] = [];
  const skippedLegs: number[] = [];
  const allStartIds: string[] = [];
  for (const race of round.races) {
    allStartIds.push(...race.starts.map((s) => s.id));
    // Startnumrets vinst % på loppets distans och startmetod: loppets klass i
    // första hand, annars hela distansgruppen.
    const legRow = startnr?.legs.find((l) => l.leg === race.leg && l.distance === race.distance && l.method === race.startMethod) ?? null;
    const group = startnr?.all.find((g) => g.distance === race.distance && g.method === race.startMethod) ?? null;
    const buckets = (legRow?.byNumber.some((b) => b.pct !== null) ? legRow.byNumber : group?.byNumber) ?? [];
    const known = buckets.filter((b) => b.pct !== null);
    const postMean = known.length ? known.reduce((a, b) => a + (b.pct ?? 0), 0) / known.length : 0;

    const facts: StartFacts[] = race.starts.map((s) => {
      const hs = asHorseStats(s.horseStatsJson);
      const d = asPersonStats(s.driver?.statsJson ?? null)?.[year];
      const t = asPersonStats(s.trainer?.statsJson ?? null)?.[year];
      const bucket = buckets.find((b) => b.n === s.number && b.pct !== null);
      return {
        startId: s.id,
        number: s.number,
        scratched: s.scratched,
        horse: { thisYear: counts(hs?.years[year]), lastYear: counts(hs?.years[lastYear]), lifeStarts: hs?.life ? hs.life.starts : null },
        records: (records.get(s.horseId) ?? []).map((r) => ({ place: r.place, galloped: r.galloped, disqualified: r.disqualified })),
        driver: d ? { starts: d.starts, wins: d.wins } : null,
        trainer: t ? { starts: t.starts, wins: t.wins } : null,
        post: bucket && postMean > 0 ? { pct: bucket.pct!, mean: postMean, distance: race.distance, method: race.startMethod } : null,
        streck: streck.get(s.id) ?? null,
      };
    });
    const res = computeRace(facts, weights, params);
    if (!res.length) skippedLegs.push(race.leg);
    results.push(...res);
  }

  const keep = results.map((r) => r.startId);
  await db.$transaction([
    db.riktodds.deleteMany({ where: { modelVersionId: model.id, startId: { in: allStartIds, notIn: keep } } }),
    ...results.map((r) => {
      const data = {
        probTop3: r.probTop3,
        odds: r.odds,
        uncertain: r.uncertain,
        inputs: r.inputs as unknown as Prisma.InputJsonValue,
        contributions: r.contributions as unknown as Prisma.InputJsonValue,
        computedAt: now,
      };
      return db.riktodds.upsert({
        where: { startId_modelVersionId: { startId: r.startId, modelVersionId: model.id } },
        create: { startId: r.startId, modelVersionId: model.id, ...data },
        update: data,
      });
    }),
    db.round.update({ where: { id: roundId }, data: { rev: { increment: 1 } } }),
  ]);
  return { roundId, modelKey: model.key, computed: results.length, skippedLegs };
}

// Steg 11 med FetchLog (RIKTODDS), som de andra stegen.
export async function riktoddsStep(db: Db, input: { roundId: string; userId: string | null; now?: Date }): Promise<RoundRiktoddsResult | null> {
  const startedAt = input.now ?? new Date();
  try {
    const res = await computeRoundRiktodds(db, input.roundId, { now: startedAt });
    if (!res) return null;
    await db.fetchLog.create({
      data: {
        roundId: input.roundId,
        userId: input.userId,
        step: "RIKTODDS",
        startedAt,
        finishedAt: new Date(),
        ok: true,
        message: `${res.computed} starter med ${res.modelKey}${res.skippedLegs.length ? `, inget riktodds i avd ${res.skippedLegs.join(", ")} (färre än 4 startande)` : ""}`,
      },
    });
    return res;
  } catch (e) {
    await db.fetchLog
      .create({ data: { roundId: input.roundId, userId: input.userId, step: "RIKTODDS", startedAt, finishedAt: new Date(), ok: false, message: "Kunde inte räkna riktodds" } })
      .catch(() => {});
    throw e;
  }
}
