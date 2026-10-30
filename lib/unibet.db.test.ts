// Integrationstest av E2.2 (Hämta streck och odds, oddsdelen) mot en riktig
// Postgres, samma upplägg som lib/e2.db.test.ts: omgången V85 Jägersro
// 2026-10-24 från ATG-fixturen, Unibets banor från den sparade fixturen och
// loppen som påhittade svar i Unibets form (priser, struken hos Unibet,
// saknad häst, fel och "inga odds än"). Hoppa över med SKIP_DB_TESTS=1.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AtgError, type AtgFetch } from "@/lib/atg";
import { saveMark, saveSettings } from "@/lib/e2-server";
import { fetchGameStep, type FetchDeps } from "@/lib/fetch-round";
import { riktoddsStep } from "@/lib/riktodds-server";
import { buildRoundResponse, buildStartDetail } from "@/lib/round-server";
import type { TsFetch } from "@/lib/travstatistik";
import type { MarkResponse, UnibetFinishResponse, UnibetLegResponse, UnibetStartResponse, UnibetUndoResponse } from "@/lib/types";
import { UnibetError, type UnibetFetch } from "@/lib/unibet";
import { fetchOddsLeg, finishOddsFetch, lockMessage, NEWER_FETCH, RACE_STARTED, startOddsFetch, undoOddsFetch, type UnibetDeps } from "@/lib/unibet-server";

const ROOT = path.join(__dirname, "..");
const FX = path.join(ROOT, "test", "fixtures");
const skip = process.env.SKIP_DB_TESTS === "1";
const atgFx = (f: string) => JSON.parse(readFileSync(path.join(FX, "atg", f), "utf8"));
const game = atgFx("game-V85_2026-10-24_7_5-bettable.json");
const meetings = JSON.parse(readFileSync(path.join(FX, "unibet", "meetings-2026-10-24.json"), "utf8"));
const atg: AtgFetch = async (p) => {
  if (p.startsWith("games/")) return structuredClone(game);
  throw new AtgError("ATG hittade inte spelet", 404);
};
const ts: TsFetch = async () => {
  throw new Error("travstatistik behövs inte här");
};

type Runner = { number: number; name: string };
const runners = (raceNumber: number): Runner[] =>
  (game.races as { number: number; starts: { number: number; horse: { name: string } }[] }[]).find((r) => r.number === raceNumber)!.starts.map((s) => ({ number: s.number, name: s.horse.name }));

// Ett lopp i Unibets form. price(nr) = platsodds (oavrundat) eller null = inga priser.
function eventJson(raceNumber: number, opts: { open: boolean; scratched?: number[]; absent?: number[]; place?: (n: number) => number }) {
  const place = opts.place ?? ((n: number) => 1.5 + n / 3);
  return {
    data: {
      viewer: {
        event: {
          hasFixedPrices: opts.open,
          markets: [{ name: "Place", priceTypes: [{ code: "FXD", name: "FixedPlace", status: "Open" }] }],
          competitors: runners(raceNumber)
            .filter((r) => !opts.absent?.includes(r.number))
            .map((r) => {
              const scr = opts.scratched?.includes(r.number);
              return {
                name: r.name,
                sequence: r.number,
                status: scr ? "Scratched" : "Starter",
                prices: !opts.open ? [] : scr ? [{ betType: "FixedWin", price: 0 }, { betType: "FixedPlace", price: 0 }] : [{ betType: "FixedWin", price: place(r.number) * 4 }, { betType: "FixedPlace", price: place(r.number) }],
              };
            }),
        },
      },
    },
  };
}

// Unibet som en funktion av vad testet vill: open = loppen har odds, fail =
// loppnummer som inte svarar.
function fakeUnibet(state: { open: boolean; fail: Set<number>; calls: string[]; scratched?: number[]; absent?: number[]; place?: (n: number) => number }): UnibetFetch {
  return async (query) => {
    state.calls.push(query.includes("meetings(") ? "meetings" : "event");
    if (query.includes("meetings(")) return structuredClone(meetings);
    const m = /eventKey:"\d{12}\.H\.SWE\.jagersro\.(\d+)"/.exec(query);
    if (!m) throw new UnibetError("okänt lopp");
    const nr = Number(m[1]);
    if (state.fail.has(nr)) throw new UnibetError("Unibet svarade inte i tid");
    return eventJson(nr, { open: state.open, scratched: nr === 5 ? state.scratched : undefined, absent: nr === 5 ? state.absent : undefined, place: state.place });
  };
}

describe.skipIf(skip)("E2.2 Unibets odds mot Postgres", () => {
  let pg: { stop(): Promise<void> } | null = null;
  let db: PrismaClientType;
  let dir = "";
  let userId = "";
  let roundId = "";
  const thursday = new Date("2026-10-22T19:00:00Z");
  const state = { open: false, fail: new Set<number>(), calls: [] as string[], scratched: [5], absent: [6] as number[] | undefined, place: undefined as ((n: number) => number) | undefined };
  const deps = (now: Date): UnibetDeps => ({ db, unibet: fakeUnibet(state), now: () => now, warn: () => {} });
  const fetchDeps = (now: Date): FetchDeps => ({ db, atg, ts, now: () => now });
  const startIdOf = async (leg: number, number: number) => (await db.start.findFirstOrThrow({ where: { number, race: { roundId, leg } }, select: { id: true } })).id;

  // Hela kedjan som klienten kör den: start, alla lopp, finish.
  async function chain(now: Date) {
    const s = await startOddsFetch(deps(now), { roundId, userId });
    if (s.status !== 200) return { start: s, legs: [], finish: null };
    const body = s.body as UnibetStartResponse;
    if (!body.fetchId) return { start: s, legs: [], finish: null };
    const legs = [];
    for (const l of body.legs.filter((x) => !x.skipped)) legs.push(await fetchOddsLeg(deps(now), { roundId, fetchId: body.fetchId, leg: l.leg, userId }));
    const finish = await finishOddsFetch(deps(now), { roundId, fetchId: body.fetchId, userId });
    return { start: s, legs, finish };
  }

  beforeAll(async () => {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    dir = mkdtempSync(path.join(os.tmpdir(), "spelvarde-e22-"));
    const port = 55500 + Math.floor(Math.random() * 400);
    const server = new EmbeddedPostgres({ databaseDir: dir, user: "t", password: "t", port, persistent: false, onLog: () => {}, onError: () => {} });
    await server.initialise();
    await server.start();
    await server.createDatabase("spelvarde_e22");
    pg = server;
    const url = `postgresql://t:t@127.0.0.1:${port}/spelvarde_e22?schema=spelvarde`;
    execFileSync(path.join(ROOT, "node_modules", ".bin", "prisma"), ["migrate", "deploy"], { cwd: ROOT, env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: "pipe" });
    const { PrismaClient } = await import("@prisma/client");
    db = new PrismaClient({ datasourceUrl: url });
    userId = (await db.user.create({ data: { email: "m@example.local", name: "M", passwordHash: "x", role: "ADMIN", status: "APPROVED" } })).id;
    roundId = (await fetchGameStep(fetchDeps(thursday), { gameId: "V85_2026-10-24_7_5", userId, skipRiktodds: true }))!.roundId;
    await riktoddsStep(db, { roundId, userId, now: thursday });
  });

  afterAll(async () => {
    await db?.$disconnect();
    await pg?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("inga odds än: 9 anrop, ingen ögonblicksbild, inga Mark, ingen spärr", async () => {
    state.calls = [];
    const r = await chain(thursday);
    expect(r.start.status).toBe(200);
    const body = r.start.body as UnibetStartResponse;
    expect(body.legs.map((l) => l.eventKey)).toEqual([5, 6, 7, 8, 9, 10, 11, 12].map((n) => expect.stringMatching(new RegExp(`\\.H\\.SWE\\.jagersro\\.${n}$`))));
    expect(body.legs[0].eventKey).toBe("202610241300.H.SWE.jagersro.5");
    expect(r.legs.every((l) => l.status === 200 && (l.body as UnibetLegResponse).noPrices)).toBe(true);
    expect(state.calls).toEqual(["meetings", ...Array(8).fill("event")]);
    expect(r.finish!.body).toEqual({ saved: false });
    expect(await db.oddsFetch.count()).toBe(0);
    expect(await db.mark.count()).toBe(0);
    expect(await db.unibetPrice.count()).toBe(0);
    const res = (await buildRoundResponse(db, roundId, userId, thursday))!;
    expect(res.latestOdds).toBeNull();
    expect(res.lastOddsAttempt).toEqual({ at: expect.any(String), outcome: "noOdds" });
    // Unibets steg syns inte som fel i Hämta omgång.
    expect(res.fetch.lastError).toBeNull();
  });

  it("en egen markering med eget odds och Bet före hämtningen", async () => {
    const kaley = await startIdOf(1, 5);
    const nilla = await startIdOf(1, 3);
    const bemy = await startIdOf(1, 4);
    expect((await saveMark(db, userId, nilla, { interesting: true, unibetOdds: 3.1 }, thursday)).status).toBe(200);
    const bet = (await saveMark(db, userId, bemy, { interesting: true, unibetOdds: 2.5, bet: true }, thursday)).body as MarkResponse;
    expect(bet.mark).toMatchObject({ unibetOddsSource: "MANUAL", betOdds: 2.5, bet: true });
    // Kaley D.C. är struken hos Unibet i nästa hämtning; hon har ett eget odds nu.
    expect(((await saveMark(db, userId, kaley, { interesting: true, unibetOdds: 4 }, thursday)).body as MarkResponse).mark.unibetOddsSource).toBe("MANUAL");
    // Ett tomt fält ger ingen källa.
    const cleared = (await saveMark(db, userId, await startIdOf(1, 1), { unibetOdds: null, interesting: true }, thursday)).body as MarkResponse;
    expect(cleared.mark.unibetOddsSource).toBeNull();
  });

  let firstFetch = "";
  const t1 = new Date("2026-10-22T19:10:00Z");

  it("med odds: spärren, ett lopp som inte svarar, struken och saknad hos Unibet, egna odds ersätts, Bet-oddset står still", async () => {
    state.open = true;
    state.fail = new Set([6]);
    const s = await startOddsFetch(deps(t1), { roundId, userId });
    expect(s.status).toBe(200);
    const body = s.body as Extract<UnibetStartResponse, { noMeeting?: false }>;
    firstFetch = body.fetchId;
    // Spärren: ett nytt tryck 18 s senare ger 429 med retryAfterSec.
    const locked = await startOddsFetch(deps(new Date(t1.getTime() + 18_000)), { roundId, userId });
    expect(locked).toEqual({ status: 429, body: { error: "Nyss hämtat. Försök igen om 1 min 42 s.", retryAfterSec: 102 } });

    const legs: UnibetLegResponse[] = [];
    for (const l of body.legs) {
      const r = await fetchOddsLeg(deps(t1), { roundId, fetchId: firstFetch, leg: l.leg, userId });
      legs.push(r.body as UnibetLegResponse);
      expect(r.status).toBe(l.leg === 2 ? 502 : 200);
    }
    expect(legs[1]).toMatchObject({ leg: 2, ok: false, error: "Unibet svarade inte för V85-2." });
    const leg1 = legs[0];
    expect(leg1).toMatchObject({ ok: true, noPrices: false, missing: [6], scratchedAtUnibet: [5] });
    expect(leg1.withOdds).toBe(10);
    // Nilla Lane: ditt 3,10 blev 1,5 + 3/3 = 2,50. Be My Baby: 2,50 → 2,83. Kaley D.C.: 4,00 → struken.
    const nilla = await startIdOf(1, 3);
    const bemy = await startIdOf(1, 4);
    const kaley = await startIdOf(1, 5);
    expect(leg1.replaced).toEqual(
      expect.arrayContaining([
        { startId: nilla, from: 3.1, to: 2.5 },
        { startId: bemy, from: 2.5, to: 2.83 },
        { startId: kaley, from: 4, to: null },
      ]),
    );
    expect(leg1.replaced).toHaveLength(3);

    const bm = await db.mark.findUniqueOrThrow({ where: { userId_startId: { userId, startId: bemy } } });
    expect(Number(bm.unibetOdds)).toBe(2.83);
    expect(Number(bm.betOdds)).toBe(2.5);
    expect(bm.unibetOddsSource).toBe("UNIBET");
    expect(bm.unibetOddsAt!.toISOString()).toBe(t1.toISOString());
    const km = await db.mark.findUniqueOrThrow({ where: { userId_startId: { userId, startId: kaley } } });
    expect(km).toMatchObject({ unibetOdds: null, unibetOddsSource: "UNIBET" });
    // Nr 6 fanns inte hos Unibet: ingen Mark skapades.
    expect(await db.mark.findUnique({ where: { userId_startId: { userId, startId: await startIdOf(1, 6) } } })).toBeNull();
    // Omarkerade hästar fick en Mark med interesting = false.
    const m12 = await db.mark.findUniqueOrThrow({ where: { userId_startId: { userId, startId: await startIdOf(1, 12) } } });
    expect(m12).toMatchObject({ interesting: false, unibetOddsSource: "UNIBET" });
    expect(Number(m12.unibetOdds)).toBe(5.5);

    // V85-2 körs om när Unibet svarar igen: räknas inte mot spärren.
    state.fail = new Set();
    const again = await fetchOddsLeg(deps(new Date(t1.getTime() + 30_000)), { roundId, fetchId: firstFetch, leg: 2, userId });
    expect(again.status).toBe(200);
    // Omkörning av samma avdelning: samma rader, Ångra-värdet står kvar.
    const rerun = (await fetchOddsLeg(deps(t1), { roundId, fetchId: firstFetch, leg: 1, userId })).body as UnibetLegResponse;
    expect(rerun.replaced).toHaveLength(3);
    expect(await db.unibetPrice.count({ where: { fetchId: firstFetch, start: { race: { leg: 1 } } } })).toBe(11);

    const fin = (await finishOddsFetch(deps(t1), { roundId, fetchId: firstFetch, userId })).body as UnibetFinishResponse;
    expect(fin).toMatchObject({ saved: true, fetchId: firstFetch, legsOk: [1, 2, 3, 4, 5, 6, 7, 8], legsFailed: [], legsSkipped: [] });
    const starters = await db.start.count({ where: { race: { roundId }, scratched: false } });
    expect(await db.unibetPrice.count({ where: { fetchId: firstFetch } })).toBe(starters - 1);
  });

  it("omgångens svar: latestOdds, unibet per start, källa, Ångra-fälten, oddsklass och tolerans", async () => {
    const res = (await buildRoundResponse(db, roundId, userId, new Date(t1.getTime() + 60_000)))!;
    expect(res.latestOdds).toMatchObject({ fetchId: firstFetch, takenAt: t1.toISOString(), legsOk: [1, 2, 3, 4, 5, 6, 7, 8] });
    expect(res.lastOddsAttempt?.outcome).toBe("saved");
    expect(res.settings.spelbarTolerance).toBe(0.1);
    const avd1 = res.races[0].starts;
    const nilla = avd1.find((s) => s.number === 3)!;
    expect(nilla.unibet).toEqual({ place: 2.5, win: 10, status: "Starter", at: t1.toISOString(), first: 2.5, firstAt: t1.toISOString() });
    expect(nilla.mark).toMatchObject({ unibetOdds: 2.5, unibetOddsSource: "UNIBET", replacedOdds: 3.1, replacedByFetchId: firstFetch });
    expect(["over", "near", "under"]).toContain(nilla.mark!.oddsClass);
    const kaley = avd1.find((s) => s.number === 5)!;
    expect(kaley.unibet).toMatchObject({ place: null, status: "Scratched", first: null });
    expect(kaley.mark).toMatchObject({ unibetOdds: null, unibetOddsSource: "UNIBET", oddsClass: null, forslag: false });
    expect(avd1.find((s) => s.number === 6)!.unibet).toBeNull();
    // Oddsklassen stämmer med riktoddset och toleransen.
    for (const s of res.races.flatMap((r) => r.starts)) {
      if (!s.mark || s.mark.unibetOdds === null || s.mark.riktoddsX === null) continue;
      const diff = Math.round((s.mark.unibetOdds - s.mark.riktoddsX) * 100) / 100;
      expect(s.mark.oddsClass).toBe(diff > 0 ? "over" : diff >= -0.1 ? "near" : "under");
    }
  });

  it("Ångra för en häst: eget odds tillbaka med källan eget; sedan finns inget att ångra", async () => {
    const nilla = await startIdOf(1, 3);
    const r = await undoOddsFetch(deps(t1), { roundId, fetchId: firstFetch, userId, startId: nilla });
    expect(r.status).toBe(200);
    const body = r.body as UnibetUndoResponse;
    expect(body.restored).toEqual([{ startId: nilla, odds: 3.1 }]);
    expect(body.marks[0]).toMatchObject({ unibetOdds: 3.1, unibetOddsSource: "MANUAL", replacedOdds: null, replacedByFetchId: null });
    expect((await undoOddsFetch(deps(t1), { roundId, fetchId: firstFetch, userId, startId: nilla })).status).toBe(404);
  });

  it("toleransen i S10: 0,00–0,50, och databasen har samma villkor", async () => {
    expect(await saveSettings(db, userId, { spelbarTolerance: 0.6 })).toEqual({ status: 400, body: { error: "Toleransen ska ligga mellan 0,00 och 0,50." } });
    expect(await saveSettings(db, userId, { spelbarTolerance: 0.123 })).toMatchObject({ status: 400 });
    expect(await saveSettings(db, userId, { spelbarTolerance: "0.2" })).toMatchObject({ status: 400 });
    expect(await saveSettings(db, userId, { spelbarTolerance: 0 })).toMatchObject({ status: 200, body: { spelbarTolerance: 0 } });
    expect(await saveSettings(db, userId, { spelbarTolerance: 0.5 })).toMatchObject({ status: 200, body: { spelbarTolerance: 0.5 } });
    await expect(db.userSettings.update({ where: { userId }, data: { spelbarTolerance: 0.51 } })).rejects.toThrow();
    const res = (await buildRoundResponse(db, roundId, userId, t1))!;
    expect(res.settings.spelbarTolerance).toBe(0.5);
    expect((await saveSettings(db, userId, { spelbarTolerance: 0.1 })).status).toBe(200);
  });

  const t2 = new Date("2026-10-22T19:13:00Z");
  let secondFetch = "";

  it("nästa hämtning efter spärren: Ångra för den förra ger 409, historiken och rörelsen", async () => {
    const before = await db.round.findUniqueOrThrow({ where: { id: roundId }, select: { rev: true } });
    state.scratched = [];
    state.absent = undefined;
    state.place = (n) => 1.6 + n / 3;
    const r = await chain(t2);
    expect(r.start.status).toBe(200);
    secondFetch = (r.start.body as { fetchId: string }).fetchId;
    expect((r.finish!.body as UnibetFinishResponse).saved).toBe(true);
    expect((await db.round.findUniqueOrThrow({ where: { id: roundId }, select: { rev: true } })).rev).toBe(before.rev + 1);
    expect(await undoOddsFetch(deps(t2), { roundId, fetchId: firstFetch, userId, startId: null })).toEqual({ status: 409, body: { error: NEWER_FETCH } });
    // Nilla Lane hade eget 3,10 (efter Ångra) och ersattes igen: 1,6 + 1 = 2,60.
    const nilla = await startIdOf(1, 3);
    const m = await db.mark.findUniqueOrThrow({ where: { userId_startId: { userId, startId: nilla } } });
    expect(Number(m.replacedOdds)).toBe(3.1);
    expect(m.replacedByFetchId).toBe(secondFetch);
    // Be My Baby ersattes förra gången; det glöms när en nyare hämtning sparas.
    const bm = await db.mark.findUniqueOrThrow({ where: { userId_startId: { userId, startId: await startIdOf(1, 4) } } });
    expect(bm).toMatchObject({ replacedOdds: null, replacedByFetchId: null });
    expect(Number(bm.betOdds)).toBe(2.5);

    const detail = (await buildStartDetail(db, nilla, userId, t2))!;
    expect(detail.unibetHistory).toEqual([
      { fetchId: firstFetch, at: t1.toISOString(), place: 2.5, win: 10, status: "Starter" },
      { fetchId: secondFetch, at: t2.toISOString(), place: 2.6, win: 10.4, status: "Starter" },
    ]);
    expect(detail.start.unibet).toEqual({ place: 2.6, win: 10.4, status: "Starter", at: t2.toISOString(), first: 2.5, firstAt: t1.toISOString() });
    // Kaley D.C. var struken hos Unibet första gången: rörelsen räknas från första platsoddset.
    const kaley = (await buildRoundResponse(db, roundId, userId, t2))!.races[0].starts.find((s) => s.number === 5)!;
    expect(kaley.unibet).toMatchObject({ place: 3.27, status: "Starter", first: 3.27, firstAt: t2.toISOString() });
    // Hon hade ett ersatt eget odds från den första hämtningen; det glömdes.
    expect(kaley.mark).toMatchObject({ unibetOddsSource: "UNIBET", replacedOdds: null });
  });

  it("ett inskrivet odds efter hämtningen får källan eget och Ångra försvinner för hästen", async () => {
    const nilla = await startIdOf(1, 3);
    const r = (await saveMark(db, userId, nilla, { unibetOdds: 2.6 }, t2)).body as MarkResponse;
    expect(r.mark).toMatchObject({ unibetOdds: 2.6, unibetOddsSource: "MANUAL", replacedOdds: null, replacedByFetchId: null });
  });

  it("startade lopp hoppas över, och Ångra efter start ger 409", async () => {
    const saturday = new Date("2026-10-24T13:10:00Z");
    const r = await chain(saturday);
    const legs = (r.start.body as Extract<UnibetStartResponse, { noMeeting?: false }>).legs;
    expect(legs[0]).toEqual({ leg: 1, eventKey: null, skipped: "started" });
    expect(legs.slice(1).every((l) => l.skipped === null)).toBe(true);
    const third = (r.start.body as { fetchId: string }).fetchId;
    expect(await fetchOddsLeg(deps(saturday), { roundId, fetchId: third, leg: 1, userId })).toEqual({ status: 409, body: { error: RACE_STARTED } });
    expect(r.finish!.body).toMatchObject({ saved: true, legsSkipped: [1], legsOk: [2, 3, 4, 5, 6, 7, 8] });
    // V85-1 rördes inte: Nilla Lane står kvar på ditt 2,60.
    const m = await db.mark.findUniqueOrThrow({ where: { userId_startId: { userId, startId: await startIdOf(1, 3) } } });
    expect(Number(m.unibetOdds)).toBe(2.6);
    // En häst i V85-2 ersattes och V85-2 startar 13:22; efter start går Ångra inte.
    const polly = await startIdOf(2, 2);
    await saveMark(db, userId, polly, { unibetOdds: 9.99 }, saturday);
    const r4 = await chain(new Date("2026-10-24T13:15:00Z"));
    const fourth = (r4.start.body as { fetchId: string }).fetchId;
    expect((await db.mark.findUniqueOrThrow({ where: { userId_startId: { userId, startId: polly } } })).replacedByFetchId).toBe(fourth);
    expect(await undoOddsFetch(deps(new Date("2026-10-24T13:25:00Z")), { roundId, fetchId: fourth, userId, startId: polly })).toEqual({ status: 409, body: { error: RACE_STARTED } });
  });

  it("ingen bana hos Unibet: noMeeting, inget sparas; Unibet nere: 502, inget sparas", async () => {
    const now = new Date("2026-10-24T13:30:00Z");
    const count = await db.oddsFetch.count();
    const nomeet: UnibetDeps = { db, unibet: async () => ({ data: { viewer: { meetings: [] } } }), now: () => now };
    expect(await startOddsFetch(nomeet, { roundId, userId })).toEqual({ status: 200, body: { fetchId: null, noMeeting: true, legs: [] } });
    const down: UnibetDeps = { db, unibet: async () => { throw new UnibetError("Kunde inte nå Unibet"); }, now: () => now };
    expect(await startOddsFetch(down, { roundId, userId })).toEqual({ status: 502, body: { error: "Unibet svarade inte. Försök igen om en stund." } });
    expect(await db.oddsFetch.count()).toBe(count);
    expect((await buildRoundResponse(db, roundId, userId, now))!.lastOddsAttempt?.outcome).toBe("failed");
  });

  it("fel lopp (hästarna heter något annat hos Unibet): loppet misslyckas och inget skrivs", async () => {
    const now = new Date("2026-10-24T13:40:00Z");
    const before = await db.unibetPrice.count();
    const wrongNames: UnibetDeps = {
      db,
      now: () => now,
      unibet: async (q) => {
        if (q.includes("meetings(")) return structuredClone(meetings);
        const json = eventJson(Number(/jagersro\.(\d+)"/.exec(q)![1]), { open: true });
        for (const c of json.data.viewer.event.competitors) c.name = `Annan häst ${c.sequence}`;
        return json;
      },
    };
    const s = (await startOddsFetch(wrongNames, { roundId, userId })).body as { fetchId: string };
    const leg = await fetchOddsLeg(wrongNames, { roundId, fetchId: s.fetchId, leg: 8, userId });
    expect(leg).toMatchObject({ status: 502, body: { ok: false, error: "Hästarna hos Unibet stämmer inte med V85-8." } });
    expect(await db.unibetPrice.count()).toBe(before);
    expect((await finishOddsFetch(wrongNames, { roundId, fetchId: s.fetchId, userId })).body).toEqual({ saved: false });
  });

  it("spärrens text", () => {
    expect(lockMessage(102)).toBe("Nyss hämtat. Försök igen om 1 min 42 s.");
    expect(lockMessage(42)).toBe("Nyss hämtat. Försök igen om 42 s.");
    expect(lockMessage(120)).toBe("Nyss hämtat. Försök igen om 2 min.");
  });
});
