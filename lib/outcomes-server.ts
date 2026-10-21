// Frysning och resultat för Outcome (specen e4a 6.4 och 18). Körs av
// GET /api/rounds/[id] (bara när något behöver göras, se needsSettle i
// lib/round-server.ts), POST /api/rounds/[id]/results och cron-jobbet
// GET /api/cron/results.
//
// - freezeOutcomes: för varje lopp som har startat, inte är inställt och inte
//   är fryst (Race.outcomesFrozenAt = NULL) skrivs en Outcome per godkänd
//   användare och start där I, S eller B gäller eller hästen var i Trollspöt
//   vid loppets start. Strukna hoppas över. createMany med skipDuplicates på
//   (userId, startId): befintliga rader ändras aldrig, så det är idempotent
//   och tål att två anrop fryser samtidigt.
// - applyResults: resultatfälten (place, disqualified, hit) skrivs om från
//   Start för lopp med resultat eller som är inställda. En häst som strukits
//   efter frysningen får sin Outcome borttagen. Bara rader som skiljer sig
//   skrivs, så en ny körning gör ingenting.
//
// Outcome är användarägd data, men skrivs här för alla användare utan
// session: värdena tas bara ur varje användares egen Mark och UserSettings.

import type { Prisma, PrismaClient } from "@prisma/client";
import { dec } from "@/lib/dto";
import { freezeValues, hitOf, shouldFreeze, trollspotAtStart, type FreezeMark, type TrollAtStart } from "@/lib/outcomes";
import { DEFAULT_TOLERANCE } from "@/lib/spelbar";
import type { TrollRace } from "@/lib/trollspot";
import { DEFAULT_X_TROR, DEFAULT_X_STARK } from "@/lib/xfactor";

type Db = PrismaClient;

// Decimal(6,2) rymmer 9999,99. Trollspöts odds kan i teorin bli större.
const ODDS_CAP = 9999.99;
const odds2 = (x: number) => Math.min(ODDS_CAP, Math.round(x * 100) / 100);

export type FreezeResult = { races: number; created: number };
export type ApplyResult = { updated: number; deleted: number };

// Omgångens lopp i den form Trollspöt läser, med samma data som
// GET /api/rounds/[id] (senaste strecket och den aktiva modellens riktodds).
async function trollRaces(db: Db, roundId: string): Promise<TrollRace[]> {
  const [races, snap, model] = await Promise.all([
    db.race.findMany({ where: { roundId }, orderBy: { leg: "asc" }, select: { id: true, leg: true, startAt: true, cancelled: true, starts: { orderBy: { number: "asc" }, select: { id: true, number: true, scratched: true } } } }),
    db.roundSnapshot.findFirst({ where: { roundId }, orderBy: { takenAt: "desc" }, select: { values: { select: { startId: true, value: true } } } }),
    db.modelVersion.findFirst({ where: { active: true }, select: { id: true } }),
  ]);
  const rikt = model ? await db.riktodds.findMany({ where: { modelVersionId: model.id, start: { race: { roundId } } }, select: { startId: true, odds: true, probTop3: true } }) : [];
  const streck = new Map((snap?.values ?? []).map((v) => [v.startId, v.value / 100]));
  const byStart = new Map(rikt.map((r) => [r.startId, r]));
  return races.map((r) => ({
    id: r.id,
    leg: r.leg,
    startAt: r.startAt.toISOString(),
    cancelled: r.cancelled,
    starts: r.starts.map((s) => {
      const k = byStart.get(s.id);
      return { id: s.id, number: s.number, scratched: s.scratched, streck: streck.get(s.id) ?? null, probTop3: k ? Number(k.probTop3) : null, riktodds: k ? Number(k.odds) : null };
    }),
  }));
}

export async function freezeOutcomes(db: Db, roundId: string, now: Date): Promise<FreezeResult> {
  const pending = await db.race.findMany({ where: { roundId, startAt: { lte: now }, cancelled: false, outcomesFrozenAt: null }, select: { id: true } });
  if (!pending.length) return { races: 0, created: 0 };
  const pendingIds = new Set(pending.map((r) => r.id));

  const [races, users, marks] = await Promise.all([
    trollRaces(db, roundId),
    db.user.findMany({
      where: { status: "APPROVED" },
      select: { id: true, settings: { select: { spelbarTolerance: true, xFactorTror: true, xFactorStark: true } }, _count: { select: { sources: { where: { enabled: true } } } } },
    }),
    db.mark.findMany({ where: { start: { raceId: { in: [...pendingIds] } } } }),
  ]);

  // Trollspöts plats är densamma för alla; minst X beror på toleransen.
  const trollByTolerance = new Map<number, Map<string, TrollAtStart>>();
  const trollFor = (tolerance: number) => {
    let m = trollByTolerance.get(tolerance);
    if (!m) trollByTolerance.set(tolerance, (m = trollspotAtStart(races, tolerance, pendingIds)));
    return m;
  };
  const markBy = new Map(marks.map((m) => [`${m.userId}:${m.startId}`, m]));
  const riktBy = new Map(races.flatMap((r) => r.starts.map((s) => [s.id, s.riktodds] as const)));

  const rows: Prisma.OutcomeCreateManyInput[] = [];
  for (const u of users) {
    const settings = {
      spelbarTolerance: u.settings ? Number(u.settings.spelbarTolerance) : DEFAULT_TOLERANCE,
      xFactorTror: u.settings ? Number(u.settings.xFactorTror) : DEFAULT_X_TROR,
      xFactorStark: u.settings ? Number(u.settings.xFactorStark) : DEFAULT_X_STARK,
    };
    const troll = trollFor(settings.spelbarTolerance);
    for (const race of races) {
      if (!pendingIds.has(race.id)) continue;
      for (const s of race.starts) {
        if (s.scratched) continue;
        const m = markBy.get(`${u.id}:${s.id}`) ?? null;
        const t = troll.get(s.id) ?? null;
        if (!shouldFreeze(m, t !== null)) continue;
        const mark: FreezeMark | null = m
          ? { interesting: m.interesting, bet: m.bet, spelbarOverride: m.spelbarOverride, unibetOdds: dec(m.unibetOdds), betOdds: dec(m.betOdds), xFactor: m.xFactor, sourceSupport: m.sourceSupport }
          : null;
        const v = freezeValues(mark, riktBy.get(s.id) ?? null, settings, u._count.sources);
        rows.push({
          userId: u.id,
          startId: s.id,
          roundId,
          ...v,
          frozenAt: now,
          trollspotRank: t?.rank ?? null,
          trollspotMinOdds: t ? odds2(t.minOdds) : null,
          trollspotEstOdds: t ? odds2(t.estOdds) : null,
        });
      }
    }
  }

  const created = rows.length ? (await db.outcome.createMany({ data: rows, skipDuplicates: true })).count : 0;
  await db.race.updateMany({ where: { id: { in: [...pendingIds] }, outcomesFrozenAt: null }, data: { outcomesFrozenAt: now } });
  return { races: pendingIds.size, created };
}

export async function applyResults(db: Db, roundId: string): Promise<ApplyResult> {
  const rows = await db.outcome.findMany({
    where: { roundId },
    select: { id: true, place: true, disqualified: true, hit: true, start: { select: { place: true, disqualified: true, scratched: true, resultAt: true, race: { select: { resultAt: true, cancelled: true } } } } },
  });
  const remove: string[] = [];
  const updates: { id: string; place: number | null; disqualified: boolean; hit: boolean | null }[] = [];
  for (const o of rows) {
    const s = o.start;
    if (s.scratched) {
      remove.push(o.id);
      continue;
    }
    if (!s.race.resultAt && !s.race.cancelled) continue;
    const place = s.race.cancelled ? null : s.place;
    const disqualified = s.race.cancelled ? false : s.disqualified;
    const hit = hitOf(place, disqualified, s.race.cancelled);
    if (o.place !== place || o.disqualified !== disqualified || o.hit !== hit) updates.push({ id: o.id, place, disqualified, hit });
  }
  if (remove.length || updates.length) {
    await db.$transaction([
      ...(remove.length ? [db.outcome.deleteMany({ where: { id: { in: remove } } })] : []),
      ...updates.map((u) => db.outcome.update({ where: { id: u.id }, data: { place: u.place, disqualified: u.disqualified, hit: u.hit } })),
    ]);
  }
  return { updated: updates.length, deleted: remove.length };
}

// Frysning och resultat i den ordning specen anger.
export async function settleOutcomes(db: Db, roundId: string, now: Date): Promise<FreezeResult & ApplyResult> {
  const f = await freezeOutcomes(db, roundId, now);
  const a = await applyResults(db, roundId);
  return { ...f, ...a };
}
