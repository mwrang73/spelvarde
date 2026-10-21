// Integrationstest av E4a mot en riktig Postgres (samma upplägg som
// lib/e2.db.test.ts): frysningen av Outcome med Trollspöt, resultathämtningen
// med claim, cron-jobbet, summeringarna och Nästa steg, på fixturen V85
// Halmstad 2026-10-17 (game-V85_2026-10-17_16_5-results.json). Läget före
// loppen byggs ur samma fixtur genom att resultaten tas bort.
// Hoppa över med SKIP_DB_TESTS=1.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AtgError, type AtgFetch } from "@/lib/atg";
import { saveMark } from "@/lib/e2-server";
import { fetchGameStep, fetchRaceStep, syncResults, type FetchDeps } from "@/lib/fetch-round";
import { hitOf } from "@/lib/outcomes";
import { settleOutcomes } from "@/lib/outcomes-server";
import { cronAuthorized, cronResults, resultsForClient, slotOf } from "@/lib/results-server";
import { riktoddsStep } from "@/lib/riktodds-server";
import { buildCurrentResponse, buildRoundResponse, fetchState } from "@/lib/round-server";
import { trollspot } from "@/lib/trollspot";
import type { RoundResponse } from "@/lib/types";

const ROOT = path.join(__dirname, "..");
const FX = path.join(ROOT, "test", "fixtures");
const skip = process.env.SKIP_DB_TESTS === "1";
const atgFx = (f: string) => JSON.parse(readFileSync(path.join(FX, "atg", f), "utf8"));
const GAME_ID = "V85_2026-10-17_16_5";
type Game = { status: string; races: { id: string; status: string; startTime: string; starts: { number: number; scratched?: boolean; horse: { id: number }; result?: Record<string, unknown> }[] }[] };
const results: Game = atgFx("game-V85_2026-10-17_16_5-results.json");
const startFx = atgFx("start-2026-10-24_7_11-1.json");

// Spelet före första start: inga resultat, loppen "upcoming". Strecket står kvar.
function beforeRaces(): Game {
  const g = structuredClone(results);
  g.status = "bettable";
  for (const r of g.races) {
    r.status = "upcoming";
    for (const s of r.starts) delete s.result;
  }
  return g;
}

function makeAtg(get: () => unknown, calls: string[] = []): AtgFetch {
  const idx = new Map<string, number>();
  for (const r of results.races) for (const s of r.starts) idx.set(`${r.id}/${s.number}`, s.horse.id);
  return async (p: string) => {
    calls.push(p);
    if (p.startsWith("games/")) return structuredClone(get());
    const m = /^races\/([^/]+)\/start\/(\d+)$/.exec(p);
    if (m) {
      const copy = structuredClone(startFx);
      copy.raceId = decodeURIComponent(m[1]);
      copy.startNumber = Number(m[2]);
      copy.horse.id = idx.get(`${decodeURIComponent(m[1])}/${m[2]}`);
      delete copy.horse.statistics;
      return copy;
    }
    throw new AtgError("ATG hittade inte spelet", 404);
  };
}
const ts = async () => {
  throw new Error("travstatistik behövs inte här");
};

describe("cron-skyddet och posterna", () => {
  it("Bearer CRON_SECRET jämförs exakt; utan hemlighet nej", () => {
    expect(cronAuthorized("Bearer hemlis", "hemlis")).toBe(true);
    expect(cronAuthorized("Bearer hemli", "hemlis")).toBe(false);
    expect(cronAuthorized("hemlis", "hemlis")).toBe(false);
    expect(cronAuthorized(null, "hemlis")).toBe(false);
    expect(cronAuthorized("Bearer ", "")).toBe(false);
    expect(cronAuthorized("Bearer x", undefined)).toBe(false);
  });
  it("posten känns igen på Vercels schema eller ?slot=", () => {
    expect(slotOf(null, "0 15 * * 6")).toBe("em");
    expect(slotOf(null, "0 18 * * 6")).toBe("kvall");
    expect(slotOf(null, "30 22 * * 6")).toBe("natt");
    expect(slotOf("natt", null)).toBe("natt");
    expect(slotOf("drop table", null)).toBeNull();
    const vercel = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] };
    expect(vercel.crons.filter((c) => c.path === "/api/cron/results").map((c) => slotOf(null, c.schedule))).toEqual(["em", "kvall", "natt"]);
    expect(vercel.crons.some((c) => c.path === "/api/cron/hist")).toBe(true);
  });
});

describe.skipIf(skip)("E4a resultat mot Postgres", () => {
  let pg: { stop(): Promise<void> } | null = null;
  let db: PrismaClientType;
  let dir = "";
  let admin = "";
  let other = "";
  let roundId = "";
  let game: Game = beforeRaces();
  const calls: string[] = [];
  const morning = new Date("2026-10-17T08:00:00Z");
  const deps = (now: Date): FetchDeps => ({ db, atg: makeAtg(() => game, calls), ts, now: () => now });
  let before: RoundResponse;
  const startOf = (leg: number, number: number) => before.races[leg - 1].starts.find((s) => s.number === number)!;
  const startAt = (leg: number) => new Date(before.races[leg - 1].startAt);

  beforeAll(async () => {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    dir = mkdtempSync(path.join(os.tmpdir(), "spelvarde-e4a-"));
    const port = 55600 + Math.floor(Math.random() * 400);
    const server = new EmbeddedPostgres({ databaseDir: dir, user: "t", password: "t", port, persistent: false, onLog: () => {}, onError: () => {} });
    await server.initialise();
    await server.start();
    await server.createDatabase("spelvarde_e4a");
    pg = server;
    const url = `postgresql://t:t@127.0.0.1:${port}/spelvarde_e4a?schema=spelvarde`;
    execFileSync(path.join(ROOT, "node_modules", ".bin", "prisma"), ["migrate", "deploy"], { cwd: ROOT, env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: "pipe" });
    const { PrismaClient } = await import("@prisma/client");
    db = new PrismaClient({ datasourceUrl: url });
    admin = (await db.user.create({ data: { email: "m@example.local", name: "M", passwordHash: "x", role: "ADMIN", status: "APPROVED" } })).id;
    other = (await db.user.create({ data: { email: "o@example.local", name: "O", passwordHash: "x", status: "APPROVED" } })).id;
    // En användare som inte är godkänd får inga Outcome.
    await db.user.create({ data: { email: "p@example.local", name: "P", passwordHash: "x", status: "PENDING" } });
    await db.userSettings.create({ data: { userId: other, spelbarTolerance: 0 } });

    const g = await fetchGameStep(deps(morning), { gameId: GAME_ID, userId: admin });
    roundId = g!.roundId;
    for (let leg = 1; leg <= 8; leg++) await fetchRaceStep(deps(morning), { roundId, leg, userId: admin });
    await riktoddsStep(db, { roundId, userId: admin, now: morning });
    // Steg 10 (travstatistik) hoppas över här; hämtningen räknas som komplett.
    await db.round.update({ where: { id: roundId }, data: { fetchStatus: "COMPLETE" } });
    before = (await buildRoundResponse(db, roundId, admin, morning))!;
  });

  afterAll(async () => {
    await db?.$disconnect();
    await pg?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("före start: inga Outcome, inga resultat och ingen summering", async () => {
    expect(await db.outcome.count()).toBe(0);
    expect(before.results).toEqual({ syncedAt: null, nextSyncAt: null, summary: null });
    expect(before.races.every((r) => r.summary === null && r.starts.every((s) => s.outcome === null))).toBe(true);
    expect(before.latestStreck).not.toBeNull();
  });

  it("markeringar före start, och 409 efter starttiden", async () => {
    const ok = async (userId: string, leg: number, n: number, body: Record<string, unknown>) => expect((await saveMark(db, userId, startOf(leg, n).id, body, morning)).status).toBe(200);
    await ok(admin, 1, 1, { interesting: true, xFactor: "TROR", sourceSupport: 2 });
    await ok(admin, 1, 1, { unibetOdds: 3.4 });
    await ok(admin, 1, 6, { bet: true, betOdds: 2.1 });
    await ok(admin, 1, 3, { interesting: true });
    await ok(admin, 2, 5, { interesting: true, spelbar: "on" });
    await ok(other, 1, 1, { interesting: true });
    // Struken häst med en gammal markering (sattes före strykningen) fryses inte.
    const scr = before.races.flatMap((r) => r.starts).find((s) => s.scratched)!;
    await db.mark.create({ data: { userId: admin, startId: scr.id, interesting: true } });
    const after = new Date(startAt(1).getTime() + 1000);
    expect(await saveMark(db, admin, startOf(1, 2).id, { interesting: true }, after)).toEqual({ status: 409, body: { error: "Loppet har startat" } });
  });

  it("första läsningen efter avd 1:s start fryser avd 1: I, S, B, X, odds, källstöd och Trollspöt", async () => {
    const t = new Date(startAt(1).getTime() + 60_000);
    const res = (await buildRoundResponse(db, roundId, admin, t))!;
    const rows = await db.outcome.findMany({ include: { start: { select: { number: true, race: { select: { leg: true } } } } } });
    expect(rows.every((o) => o.start.race.leg === 1)).toBe(true);
    const mine = rows.filter((o) => o.userId === admin);
    const h1 = mine.find((o) => o.start.number === 1)!;
    expect(h1).toMatchObject({ interesting: true, xFactor: "TROR", sourceSupport: 2, sourceTotal: 0, bet: false });
    expect(Number(h1.xFactorValue)).toBe(1.25);
    expect(Number(h1.unibetOdds)).toBe(3.4);
    expect(Number(h1.riktoddsX)).toBe(Math.max(1.01, Math.round((Number(h1.riktodds) / 1.25) * 100) / 100));
    const h6 = mine.find((o) => o.start.number === 6)!;
    expect(h6).toMatchObject({ bet: true, interesting: false });
    expect(Number(h6.betOdds)).toBe(2.1);
    expect(h1.frozenAt.toISOString()).toBe(t.toISOString());

    // Trollspöt precis före start, räknat i klienten med samma DTO:er.
    const list = trollspot(before.races, startAt(1).getTime() - 1, 0.1).items;
    const expected = new Map(list.map((it, i) => [it.start.id, i + 1] as [string, number]).filter(([id]) => before.races[0].starts.some((s) => s.id === id)));
    const trollRows = mine.filter((o) => o.trollspotRank !== null);
    expect(new Map(trollRows.map((o) => [o.startId, o.trollspotRank]))).toEqual(expected);
    for (const o of trollRows) {
      const it = list.find((x) => x.start.id === o.startId)!;
      expect(Number(o.trollspotMinOdds)).toBe(it.minOdds);
      expect(Number(o.trollspotEstOdds)).toBe(it.estOdds);
    }
    // Omarkerade hästar i Trollspöt fick också en Outcome, och den andra
    // användaren får samma plats (men minst X med sin tolerans 0,00).
    expect(trollRows.some((o) => !o.interesting && !o.bet)).toBe(true);
    const otherTroll = rows.filter((o) => o.userId === other && o.trollspotRank !== null);
    expect(otherTroll.map((o) => [o.startId, o.trollspotRank]).sort()).toEqual(trollRows.map((o) => [o.startId, o.trollspotRank]).sort());
    const tol0 = trollspot(before.races, startAt(1).getTime() - 1, 0).items;
    for (const o of otherTroll) expect(Number(o.trollspotMinOdds)).toBe(tol0.find((x) => x.start.id === o.startId)!.minOdds);
    // Exakt en per användare och start; den icke godkända fick inga.
    expect(new Set(rows.map((o) => `${o.userId}:${o.startId}`)).size).toBe(rows.length);
    expect(new Set(rows.map((o) => o.userId))).toEqual(new Set([admin, other]));
    // DTO:n bär de frysta värdena.
    const dto = res.races[0].starts.find((s) => s.number === 1)!;
    expect(dto.outcome).toMatchObject({ interesting: true, xFactor: "TROR", hit: null, unibetOdds: 3.4 });
    expect(res.races[0].summary).toBeNull();
    expect(await db.race.count({ where: { roundId, outcomesFrozenAt: { not: null } } })).toBe(1);
  });

  it("idempotent: en ny läsning ger inga dubbletter och ändrade inställningar skriver inte om", async () => {
    const n = await db.outcome.count();
    await db.userSettings.upsert({ where: { userId: admin }, create: { userId: admin, xFactorTror: 2, xFactorStark: 2.5, spelbarTolerance: 0.5 }, update: { xFactorTror: 2, xFactorStark: 2.5, spelbarTolerance: 0.5 } });
    const t = new Date(startAt(1).getTime() + 120_000);
    await buildRoundResponse(db, roundId, admin, t);
    await settleOutcomes(db, roundId, t);
    expect(await db.outcome.count()).toBe(n);
    const h1 = await db.outcome.findFirstOrThrow({ where: { userId: admin, start: { number: 1, race: { leg: 1 } } } });
    expect(Number(h1.xFactorValue)).toBe(1.25);
    await db.userSettings.update({ where: { userId: admin }, data: { xFactorTror: 1.25, xFactorStark: 1.5, spelbarTolerance: 0.1 } });
  });

  it("avd 2: listan fylls på efter att avd 1 har startat, och räknas vid avd 2:s egen start", async () => {
    const t = new Date(startAt(2).getTime() + 30_000);
    await buildRoundResponse(db, roundId, admin, t);
    const rows = await db.outcome.findMany({ where: { userId: admin, start: { race: { leg: 2 } } } });
    const atLeg1 = trollspot(before.races, startAt(1).getTime() - 1, 0.1).items;
    const atLeg2 = trollspot(before.races, startAt(2).getTime() - 1, 0.1).items;
    const leg2 = new Set(before.races[1].starts.map((s) => s.id));
    const expected = new Map(atLeg2.map((it, i) => [it.start.id, i + 1] as [string, number]).filter(([id]) => leg2.has(id)));
    expect(new Map(rows.filter((o) => o.trollspotRank !== null).map((o) => [o.startId, o.trollspotRank]))).toEqual(expected);
    // Påfyllningen: listan vid avd 2:s start är en annan än vid avd 1:s.
    const ids1 = new Set(atLeg1.map((x) => x.start.id));
    expect(atLeg2.some((x) => !ids1.has(x.start.id))).toBe(true);
    // Spelbar för hand (override ON) fryses som Spelbar.
    const h5 = rows.find((o) => o.startId === startOf(2, 5).id)!;
    expect(h5).toMatchObject({ interesting: true, spelbar: true });
    // Den strukna hästen fick ingen Outcome.
    const scr = before.races.flatMap((r) => r.starts).find((s) => s.scratched)!;
    expect(await db.outcome.count({ where: { startId: scr.id } })).toBe(0);
  });

  it("POST /results: claim var 50:e s, force var 15:e, inga streck-snapshots, resultat och Nästa steg", async () => {
    game = results;
    const snapshots = await db.roundSnapshot.count();
    const streck = await db.streckValue.count();
    const t1 = new Date("2026-10-17T15:50:00Z");
    calls.length = 0;
    const r1 = (await resultsForClient(deps(t1), { roundId, userId: admin, force: false }))!;
    expect(r1).toMatchObject({ claimed: true, changed: true, syncedAt: t1.toISOString() });
    expect(r1.races).toHaveLength(8);
    expect(r1.races.every((r) => r.resultAt)).toBe(true);
    expect(calls.filter((c) => c.startsWith("games/"))).toHaveLength(1);
    // En annan flik 20 s senare: inget ATG-anrop, senast sparade läge.
    const r2 = (await resultsForClient(deps(new Date(t1.getTime() + 20_000)), { roundId, userId: other, force: false }))!;
    expect(r2).toMatchObject({ claimed: false, changed: false, rev: r1.rev });
    // force efter 16 s går igenom, vanlig gör det inte.
    expect((await resultsForClient(deps(new Date(t1.getTime() + 36_000)), { roundId, userId: admin, force: false }))!.claimed).toBe(false);
    const r3 = (await resultsForClient(deps(new Date(t1.getTime() + 36_000)), { roundId, userId: admin, force: true }))!;
    expect(r3).toMatchObject({ claimed: true, changed: false, rev: r1.rev });
    expect(calls.filter((c) => c.startsWith("games/"))).toHaveLength(2);
    expect(await db.roundSnapshot.count()).toBe(snapshots);
    expect(await db.streckValue.count()).toBe(streck);
    expect(await db.fetchLog.count({ where: { roundId, step: "RESULTS", ok: true } })).toBe(2);

    const round = await db.round.findUniqueOrThrow({ where: { id: roundId } });
    expect(round.finishedAt).not.toBeNull();
    // Alla lopp har startat och fryses av hämtningen: avd 3–8 också.
    expect(await db.race.count({ where: { roundId, outcomesFrozenAt: null } })).toBe(0);
  });

  it("hit följer ATG: 1–3 träff, annars miss, diskad miss", async () => {
    const rows = await db.outcome.findMany({ where: { roundId }, include: { start: true } });
    expect(rows.length).toBeGreaterThan(0);
    for (const o of rows) {
      expect(o.place).toBe(o.start.place);
      expect(o.disqualified).toBe(o.start.disqualified);
      expect(o.hit).toBe(hitOf(o.start.place, o.start.disqualified, false));
    }
    // Avd 1: vinnaren i fixturen är nr 6 (Bet).
    const h6 = rows.find((o) => o.userId === admin && o.startId === startOf(1, 6).id)!;
    expect(h6).toMatchObject({ place: 1, hit: true });
  });

  it("GET /api/rounds/[id] och /current: summeringar, vinnare, Bet och Omgången är klar", async () => {
    const t = new Date("2026-10-17T19:00:00Z");
    const res = (await buildRoundResponse(db, roundId, admin, t))!;
    expect(res.phase).toBe("KLART");
    const mine = await db.outcome.findMany({ where: { userId: admin, roundId }, include: { start: { select: { race: { select: { leg: true } } } } } });
    const count = (leg: number, k: "bet" | "spelbar" | "interesting") => {
      const xs = mine.filter((o) => o.start.race.leg === leg && o[k]);
      return { hits: xs.filter((o) => o.hit).length, total: xs.length };
    };
    expect(res.races[0].summary).toMatchObject({ bet: count(1, "bet"), interesting: count(1, "interesting"), spelbar: count(1, "spelbar") });
    expect(res.races[0].summary!.bet).toEqual({ hits: 1, total: 1 });
    const troll = mine.filter((o) => o.trollspotRank !== null);
    expect(res.results!.summary!.trollspot).toEqual({ hits: troll.filter((o) => o.hit).length, total: troll.length });
    expect(res.results!.syncedAt).not.toBeNull();
    expect(res.results!.nextSyncAt).toBeNull();
    expect(res.nextStep.kind).toBe("ROUND_DONE");
    expect(res.nextStep.text).toMatch(/^Bet 1\/1 träff · Spelbar \d+\/\d+ topp 3 · Intressant \d+\/\d+ topp 3 · Trollspöt \d+\/\d+ topp 3\.$/);
    const h = res.races[0].starts.find((s) => s.number === 6)!;
    expect(h.outcome).toMatchObject({ bet: true, hit: true, place: 1 });

    const cur = await buildCurrentResponse(db, admin, t, async () => ({ game: null, fetched: false, roundId: null, checkedAt: t.toISOString(), ok: true }));
    expect(cur.round?.id).toBe(roundId);
    const leg1 = cur.legs[0];
    expect(leg1).toMatchObject({ cancelled: false, hasResult: true, winner: { number: 6 } });
    expect(leg1.betResults).toEqual([{ number: 6, name: startOf(1, 6).horse.name, place: 1, disqualified: false }]);
    expect(leg1.summary!.bet).toEqual({ hits: 1, total: 1 });
    expect(cur.legs[2].summary).toEqual({ bet: { hits: 0, total: 0 }, spelbar: { hits: 0, total: 0 }, interesting: { hits: 0, total: 0 }, trollspot: expect.any(Object) });
  });

  it("protest och strykning efter frysningen: nästa hämtning skriver om, resultAt står kvar", async () => {
    const g = structuredClone(results);
    const r1 = g.races[0];
    const winner = r1.starts.find((s) => (s.result as { place?: number })?.place === 1)!;
    const fifth = r1.starts.find((s) => (s.result as { place?: number })?.place === 5)!;
    (winner.result as { place: number }).place = 5;
    (fifth.result as { place: number }).place = 1;
    // Avd 2 nr 5 (Spelbar för hand) visas som struken i resultatet.
    const r2s5 = g.races[1].starts.find((s) => s.number === 5)!;
    r2s5.scratched = true;
    delete r2s5.result;
    game = g;
    const raceBefore = await db.race.findUniqueOrThrow({ where: { id: before.races[0].id } });
    const t = new Date("2026-10-17T20:00:00Z");
    const s = await syncResults(deps(t), { roundId, userId: null, claim: "cron" });
    expect(s).toMatchObject({ claimed: true, changed: true });
    await settleOutcomes(db, roundId, t);
    const h6 = await db.outcome.findFirstOrThrow({ where: { userId: admin, startId: startOf(1, 6).id } });
    expect(h6).toMatchObject({ place: 5, hit: false });
    expect((await db.race.findUniqueOrThrow({ where: { id: before.races[0].id } })).resultAt).toEqual(raceBefore.resultAt);
    expect(await db.outcome.count({ where: { startId: startOf(2, 5).id } })).toBe(0);
    game = results;
  });

  it("cron: omgångar i dag och i går som inte är klara; tål ATG-fel; idempotent", async () => {
    await db.round.update({ where: { id: roundId }, data: { finishedAt: null } });
    const n = await db.outcome.count();
    const sat = new Date("2026-10-17T22:30:00Z");
    const res = await cronResults(deps(sat), "natt");
    expect(res).toEqual({ slot: "natt", rounds: [{ roundId, legsWithResult: 8, finished: true, ok: true }] });
    // Klar: nästa körning hittar inget.
    expect((await cronResults(deps(new Date("2026-10-18T05:00:00Z")), null)).rounds).toEqual([]);
    // Söndag kväll är omgången från i går fortfarande med om den inte är klar; ATG nere ger ok: false.
    await db.round.update({ where: { id: roundId }, data: { finishedAt: null } });
    const down: FetchDeps = { db, atg: async () => { throw new AtgError("ATG svarade inte i tid"); }, ts, now: () => new Date("2026-10-18T20:00:00Z") };
    const r = await cronResults(down, null);
    expect(r.rounds).toEqual([{ roundId, legsWithResult: 8, finished: false, ok: false }]);
    // För gammal: tisdag.
    expect((await cronResults(deps(new Date("2026-10-20T20:00:00Z")), null)).rounds).toEqual([]);
    expect(await db.outcome.count()).toBe(n);
    // Felet visas inte som ett fel i Hämta omgång.
    const round = await db.round.findUniqueOrThrow({ where: { id: roundId }, include: { races: true } });
    expect((await fetchState(db, round, round.races)).lastError).toBeNull();
    await cronResults(deps(sat), "natt");
  });

  it("POST /results när ATG inte svarar: AtgError (502 i rutten) och loggat", async () => {
    const down: FetchDeps = { db, atg: async () => { throw new AtgError("ATG svarade inte i tid"); }, ts, now: () => new Date("2026-10-17T21:00:00Z") };
    await expect(resultsForClient(down, { roundId, userId: admin, force: true })).rejects.toBeInstanceOf(AtgError);
    expect(await db.fetchLog.count({ where: { roundId, step: "RESULTS", ok: false } })).toBeGreaterThan(0);
    expect(await resultsForClient(down, { roundId: "c" + "x".repeat(24), userId: admin, force: false })).toBeNull();
  });
});
