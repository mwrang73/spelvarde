// Resultathämtningen (specen e4a 6.10, 10.4 och 12): logiken bakom
// POST /api/rounds/[id]/results och GET /api/cron/results. Rutterna är tunna
// omslag; här ligger reglerna, så att de testas mot en riktig Postgres
// (lib/results.db.test.ts).

import { timingSafeEqual } from "node:crypto";
import { iso } from "@/lib/dto";
import { syncResults, type FetchDeps } from "@/lib/fetch-round";
import { nextResultsSyncAt } from "@/lib/outcomes";
import { settleOutcomes } from "@/lib/outcomes-server";
import { addDaysToDateString, stockholmDateString } from "@/lib/stockholm-time";
import type { CronResultsResponse, ResultsSyncResponse } from "@/lib/types";

// Läget efter hämtningen (eller senast sparade läge när claimet var taget).
async function lightState(deps: FetchDeps, roundId: string, now: Date) {
  const round = await deps.db.round.findUnique({
    where: { id: roundId },
    select: { rev: true, liveOkAt: true, liveSyncAt: true, finishedAt: true, races: { orderBy: { leg: "asc" }, select: { leg: true, startAt: true, resultAt: true, cancelled: true } } },
  });
  if (!round) return null;
  const phaseRaces = round.races.map((r) => ({ startAt: r.startAt, hasResult: !!r.resultAt, cancelled: r.cancelled }));
  return {
    rev: round.rev,
    syncedAt: iso(round.liveOkAt),
    nextSyncAt: iso(nextResultsSyncAt(phaseRaces, round.liveSyncAt, now)),
    finished: !!round.finishedAt,
    races: round.races.map((r) => ({ leg: r.leg, resultAt: iso(r.resultAt), cancelled: r.cancelled })),
  };
}

// POST /api/rounds/[id]/results. null = omgången finns inte. Kastar AtgError
// när ATG inte svarar (rutten svarar 502); frysningen görs ändå först.
export async function resultsForClient(baseDeps: FetchDeps, input: { roundId: string; userId: string; force: boolean }): Promise<ResultsSyncResponse | null> {
  // En klocka för hela anropet: claimet, liveOkAt och serverTime blir samma tid.
  const now = baseDeps.now?.() ?? new Date();
  const deps: FetchDeps = { ...baseDeps, now: () => now };
  const exists = await deps.db.round.findUnique({ where: { id: input.roundId }, select: { id: true } });
  if (!exists) return null;
  let sync: Awaited<ReturnType<typeof syncResults>>;
  try {
    sync = await syncResults(deps, { roundId: input.roundId, userId: input.userId, claim: input.force ? "force" : "normal" });
  } catch (e) {
    // Frysningen hänger inte på ATG: lopp som har startat fryses ändå.
    await settleOutcomes(deps.db, input.roundId, now);
    throw e;
  }
  const settled = await settleOutcomes(deps.db, input.roundId, now);
  const state = (await lightState(deps, input.roundId, now))!;
  return {
    serverTime: now.toISOString(),
    rev: state.rev,
    changed: !!sync?.changed || settled.updated > 0 || settled.deleted > 0,
    claimed: !!sync?.claimed,
    syncedAt: state.syncedAt,
    nextSyncAt: state.nextSyncAt,
    races: state.races,
  };
}

// ---- Cron ------------------------------------------------------------------------------

// Bearer-token mot CRON_SECRET, jämfört i konstant tid. Utan hemlighet: nej.
export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Posterna i vercel.json (10.4). Vercel skickar uttrycket i
// x-vercel-cron-schedule; ?slot= går att ange vid en körning för hand.
export const RESULT_SLOTS: Record<string, string> = { "0 15 * * 6": "em", "0 18 * * 6": "kvall", "30 22 * * 6": "natt" };
const SLOT_NAMES = new Set(Object.values(RESULT_SLOTS));

export function slotOf(query: string | null, schedule: string | null): string | null {
  if (query && SLOT_NAMES.has(query)) return query;
  return (schedule && RESULT_SLOTS[schedule]) ?? null;
}

const dateOnly = (d: string) => new Date(`${d}T00:00:00Z`);

// GET /api/cron/results: omgångar med datum i dag eller i går (svensk tid)
// som inte är klara. Hämtar resultat (claimet tvingas), fryser och skriver
// resultat för alla användare och sätter finishedAt. Idempotent. Ett fel i en
// omgång stoppar inte de andra.
export async function cronResults(baseDeps: FetchDeps, slot: string | null): Promise<CronResultsResponse> {
  const now = baseDeps.now?.() ?? new Date();
  const deps: FetchDeps = { ...baseDeps, now: () => now };
  const today = stockholmDateString(now);
  const rounds = await deps.db.round.findMany({
    where: { finishedAt: null, date: { gte: dateOnly(addDaysToDateString(today, -1)), lte: dateOnly(today) } },
    orderBy: { date: "asc" },
    select: { id: true },
  });
  const out: CronResultsResponse["rounds"] = [];
  for (const r of rounds) {
    let ok = true;
    try {
      await syncResults(deps, { roundId: r.id, userId: null, claim: "cron" });
    } catch (e) {
      ok = false;
      console.error("cron/results", r.id, e instanceof Error ? e.message : e);
    }
    try {
      await settleOutcomes(deps.db, r.id, now);
    } catch (e) {
      ok = false;
      console.error("cron/results frysning", r.id, e);
    }
    const state = await lightState(deps, r.id, now);
    out.push({ roundId: r.id, legsWithResult: state?.races.filter((x) => x.resultAt).length ?? 0, finished: !!state?.finished, ok });
  }
  return { slot, rounds: out };
}
