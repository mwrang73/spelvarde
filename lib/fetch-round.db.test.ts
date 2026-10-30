// Integrationstest av hämtningskedjan (10.1) och läsningen (9.1) mot en
// riktig Postgres. Testet startar en egen, tillfällig Postgres
// (embedded-postgres) på 127.0.0.1 i en temporär katalog, kör migreringen
// med `prisma migrate deploy` och tar bort allt efteråt. ATG och
// travstatistik.se matas från test/fixtures – inga nätverksanrop.
// Hoppa över med SKIP_DB_TESTS=1.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AtgError, type AtgFetch } from "@/lib/atg";
import { fetchGameStep, fetchRaceStep, fetchStatsStep, type FetchDeps } from "@/lib/fetch-round";
import { buildCurrentResponse, buildRaceStats, buildRoundResponse, buildStartDetail } from "@/lib/round-server";
import { decodeHtml, TS_PAGES, type TsFetch } from "@/lib/travstatistik";

const ROOT = path.join(__dirname, "..");
const FX = path.join(ROOT, "test", "fixtures");
const skip = process.env.SKIP_DB_TESTS === "1";
const atgFx = (f: string) => JSON.parse(readFileSync(path.join(FX, "atg", f), "utf8"));
const games: Record<string, unknown> = {
  upcoming: atgFx("game-V85_2026-10-24_7_5.json"),
  bettable: atgFx("game-V85_2026-10-24_7_5-bettable.json"),
  results: atgFx("game-V85_2026-10-17_16_5-results.json"),
  foreign: atgFx("game-V85_2026-10-31_78_5-foreign.json"),
};
const startFx = atgFx("start-2026-10-24_7_11-1.json");

// Hästens ATG-id per (loppid, startnummer), för att ge varje start "sina" tidigare lopp.
function horseIndex(game: { races: { id: string; starts: { number: number; horse: { id: number } }[] }[] }) {
  const m = new Map<string, number>();
  for (const r of game.races) for (const s of r.starts) m.set(`${r.id}/${s.number}`, s.horse.id);
  return m;
}

function makeAtg(gameKey: keyof typeof games, opts: { failStarts?: Set<string> } = {}): AtgFetch & { calls: string[] } {
  const calls: string[] = [];
  const idx = horseIndex(games[gameKey] as never);
  const fn = (async (p: string) => {
    calls.push(p);
    if (p.startsWith("calendar/day/")) {
      if (p.endsWith("2026-10-24")) return atgFx("calendar-2026-10-24.json");
      throw new AtgError("ATG hittade inte spelet", 404);
    }
    if (p.startsWith("games/")) return structuredClone(games[gameKey]);
    const m = /^races\/([^/]+)\/start\/(\d+)$/.exec(p);
    if (m) {
      const key = `${decodeURIComponent(m[1])}/${m[2]}`;
      if (opts.failStarts?.has(key)) throw new AtgError("ATG svarade inte i tid");
      const copy = structuredClone(startFx);
      copy.raceId = decodeURIComponent(m[1]);
      copy.startNumber = Number(m[2]);
      copy.horse.id = idx.get(key);
      return copy;
    }
    throw new Error(`okänd sökväg ${p}`);
  }) as AtgFetch & { calls: string[] };
  fn.calls = calls;
  return fn;
}

const TS_FILES: Record<string, string> = {
  [TS_PAGES.startnr]: "visaveckansnr.html",
  [TS_PAGES.rank]: "visaveckansrankvalny.html",
  [TS_PAGES.ms]: "visaveckansMS.html",
  [TS_PAGES.bana]: "visaveckansbana.html",
  [TS_PAGES.kuskliga]: "visakuskligan.html",
  [TS_PAGES.tranarliga]: "visatranarligan.html",
  [TS_PAGES.form]: "formtoppen.html",
  [TS_PAGES.senaste]: "visasenasteomg.html",
};
const ts: TsFetch = async (p) => decodeHtml(new Uint8Array(readFileSync(path.join(FX, "travstatistik", TS_FILES[p]))));

describe.skipIf(skip)("hämtningskedjan mot Postgres", () => {
  let pg: { stop(): Promise<void> } | null = null;
  let db: PrismaClientType;
  let dir = "";
  let userId = "";
  let otherUserId = "";
  const sunday = new Date("2026-10-19T19:00:00Z");
  const deps = (atg: AtgFetch, now = sunday): FetchDeps => ({ db, atg, ts, now: () => now });

  beforeAll(async () => {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    dir = mkdtempSync(path.join(os.tmpdir(), "spelvarde-test-"));
    const port = 54400 + Math.floor(Math.random() * 500);
    const server = new EmbeddedPostgres({ databaseDir: dir, user: "t", password: "t", port, persistent: false, onLog: () => {}, onError: () => {} });
    await server.initialise();
    await server.start();
    await server.createDatabase("spelvarde_test");
    pg = server;
    const url = `postgresql://t:t@127.0.0.1:${port}/spelvarde_test?schema=spelvarde`;
    execFileSync(path.join(ROOT, "node_modules", ".bin", "prisma"), ["migrate", "deploy"], { cwd: ROOT, env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: "pipe" });
    const { PrismaClient } = await import("@prisma/client");
    db = new PrismaClient({ datasourceUrl: url });
    userId = (await db.user.create({ data: { email: "m@example.local", name: "M", passwordHash: "x", role: "ADMIN", status: "APPROVED" } })).id;
    otherUserId = (await db.user.create({ data: { email: "o@example.local", name: "O", passwordHash: "x", status: "APPROVED" } })).id;
  });

  afterAll(async () => {
    await db?.$disconnect();
    await pg?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  let roundId = "";

  it("migreringen lade allt i schemat spelvarde, med RLS på varje tabell", async () => {
    const schemas = await db.$queryRaw<{ s: string }[]>`SELECT DISTINCT table_schema AS s FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')`;
    expect(schemas.map((r) => r.s)).toEqual(["spelvarde"]);
    const noRls = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'spelvarde' AND c.relkind = 'r' AND NOT c.relrowsecurity`;
    expect(noRls[0].n).toBe(0);
  });

  it("steg 1 hittar nästa V85 i kalendern och sparar 8 lopp och 102 starter", async () => {
    const atg = makeAtg("upcoming");
    const res = (await fetchGameStep(deps(atg), { userId }))!;
    expect(res.atgGameId).toBe("V85_2026-10-24_7_5");
    expect(res.legs).toHaveLength(8);
    expect(res.hasStreck).toBe(false);
    expect(atg.calls.slice(0, 6)).toEqual(["calendar/day/2026-10-19", "calendar/day/2026-10-20", "calendar/day/2026-10-21", "calendar/day/2026-10-22", "calendar/day/2026-10-23", "calendar/day/2026-10-24"]);
    roundId = res.roundId;
    expect(await db.race.count({ where: { roundId } })).toBe(8);
    expect(await db.start.count({ where: { race: { roundId } } })).toBe(102);
    expect(await db.roundSnapshot.count({ where: { roundId } })).toBe(0);
    const race7 = await db.race.findFirstOrThrow({ where: { roundId, leg: 7 } });
    expect(race7).toMatchObject({ atgRaceId: "2026-10-24_7_11", distance: 2640, startMethod: "AUTO", classLabel: "Gr. II Int. Gulddivisionen" });
    const round = await db.round.findUniqueOrThrow({ where: { id: roundId } });
    expect(round).toMatchObject({ trackName: "Jägersro", fetchStatus: "PARTIAL" });
  });

  it("steg 2–9: ett fel stoppar loppet, Försök igen tar bara om det som saknas", async () => {
    const failing = makeAtg("upcoming", { failStarts: new Set(["2026-10-24_7_11/2"]) });
    const first = await fetchRaceStep(deps(failing), { roundId, leg: 7, userId });
    expect(first.ok).toBe(false);
    expect(first.failed.map((f) => f.number)).toEqual([2]);
    expect(first.fetched).toBe(11);
    const recordsAfterFirst = await db.horseRecord.count();
    expect(recordsAfterFirst).toBeGreaterThan(0);

    const ok = makeAtg("upcoming");
    const retry = await fetchRaceStep(deps(ok), { roundId, leg: 7, userId });
    expect(retry).toMatchObject({ ok: true, fetched: 1, skipped: 11, failed: [] });
    expect(ok.calls).toEqual(["races/2026-10-24_7_11/start/2"]);
    // Samma tidigare lopp för alla hästar i fixturen, men per häst – inga dubbletter vid omkörning.
    const again = await fetchRaceStep(deps(ok), { roundId, leg: 7, userId });
    expect(again.fetched).toBe(0);
    expect(await db.horseRecord.count()).toBe(recordsAfterFirst + (recordsAfterFirst / 11));
    for (let leg = 1; leg <= 8; leg++) if (leg !== 7) expect((await fetchRaceStep(deps(ok), { roundId, leg, userId })).ok).toBe(true);
  });

  it("steg 10: travstatistik visar en annan omgång (Gävle) – sparas som 'Sidan visar en annan omgång'", async () => {
    const res = await fetchStatsStep(deps(makeAtg("upcoming")), { roundId, userId });
    expect(res.ok).toBe(true);
    expect(res.pages.every((p) => !p.ok && p.error === "Sidan visar en annan omgång")).toBe(true);
    expect(res.fetchStatus).toBe("COMPLETE");
  });

  it("användaren markerar, granskar och kommenterar", async () => {
    const s = await db.start.findFirstOrThrow({ where: { race: { roundId, leg: 7 }, number: 1 }, include: { race: true } });
    await db.mark.create({ data: { userId, startId: s.id, interesting: true, interestingAt: sunday } });
    await db.mark.create({ data: { userId: otherUserId, startId: s.id, interesting: false } });
    const r1 = await db.race.findFirstOrThrow({ where: { roundId, leg: 1 } });
    await db.raceReview.create({ data: { userId, raceId: r1.id, noneInteresting: true } });
    await db.horseComment.create({ data: { userId, horseId: s.horseId, startId: s.id, roundId, kind: "NOTE", tags: [], text: "Stark avslutning senast", clientId: "3b241101-e2bb-4255-8caf-4136c566a962" } });
    await db.horseComment.create({ data: { userId: otherUserId, horseId: s.horseId, kind: "NOTE", tags: [], text: "Inte min", clientId: "3b241101-e2bb-4255-8caf-4136c566a963" } });
  });

  it("Hämta igen: kuskbyte och strykning syns, inget dubbleras och markeringar finns kvar", async () => {
    const bettable = structuredClone(games.bettable) as { races: { starts: { number: number; scratched?: boolean }[] }[] };
    bettable.races[2].starts.find((s) => s.number === 4)!.scratched = true;
    const atg = makeAtg("bettable");
    const orig = games.bettable;
    games.bettable = bettable;
    const later = new Date("2026-10-20T19:00:00Z");
    const res = (await fetchGameStep(deps(atg, later), { gameId: "V85_2026-10-24_7_5", userId }))!;
    games.bettable = orig;
    expect(atg.calls).toEqual(["games/V85_2026-10-24_7_5"]);
    expect(res.roundId).toBe(roundId);
    expect(res.changes.driverChanges).toEqual([expect.objectContaining({ leg: 8, number: 11, newDriver: "Ole Johan Östre" })]);
    expect(res.changes.driverChanges[0].oldDriver).toMatch(/Uhrberg/);
    expect(res.changes.scratched).toEqual([expect.objectContaining({ leg: 3, number: 4 })]);
    expect(res.hasStreck).toBe(true);
    expect(await db.race.count({ where: { roundId } })).toBe(8);
    expect(await db.start.count({ where: { race: { roundId } } })).toBe(102);
    expect(await db.mark.count({ where: { userId, interesting: true } })).toBe(1);
    expect(await db.streckValue.count()).toBe(102);
    const changed = await db.start.findFirstOrThrow({ where: { race: { roundId, leg: 8 }, number: 11 }, include: { driver: true, prevDriver: true } });
    expect(changed.driver!.lastName).toBe("Östre");
    expect(changed.prevDriver!.lastName).toBe("Uhrberg");
    // Ändrade lopp ska hämtas om; resten är färska.
    expect((await db.race.findFirstOrThrow({ where: { roundId, leg: 8 } })).recordsFetchedAt).toBeNull();
    expect((await db.race.findFirstOrThrow({ where: { roundId, leg: 1 } })).recordsFetchedAt).not.toBeNull();
  });

  it("GET /api/rounds/[id]: hela omgången för användaren", async () => {
    const res = (await buildRoundResponse(db, roundId, userId, new Date("2026-10-20T20:00:00Z")))!;
    expect(res.phase).toBe("ANALYS");
    expect(res.races).toHaveLength(8);
    expect(res.round.fetchStatus).toBe("PARTIAL");
    expect(res.nextStep.kind).toBe("RESUME_FETCH");
    expect(res.fetch.resumeFrom).toEqual({ step: "RACE", leg: 3 });
    expect(res.fetch.lastChanges!.driverChanges).toHaveLength(1);
    const avd7 = res.races[6];
    expect(avd7.starts).toHaveLength(12);
    expect(avd7.reviewed).toBe(true);
    expect(avd7.counts.interesting).toBe(1);
    const nr1 = avd7.starts[0];
    expect(nr1.mark!.interesting).toBe(true);
    expect(nr1.form.boxes).toHaveLength(5);
    expect(nr1.form.boxes.slice(0, 2).map((b) => b.char)).toEqual(["7", "2"]);
    expect(nr1.form.fewStarts).toBe(false);
    expect(nr1.streck).toBeGreaterThan(0);
    expect(res.races[0]).toMatchObject({ reviewed: true, review: { noneInteresting: true } });
    expect(res.races[2].starts.find((s) => s.number === 4)).toMatchObject({ scratched: true });
    expect(res.races[2].counts.scratched).toBe(1);
    expect(res.races[7].starts.find((s) => s.number === 11)!.prevDriver!.lastName).toBe("Uhrberg");
    expect(avd7.statsLine.ok).toBe(false);
    // Den andra användarens markering syns inte.
    const other = (await buildRoundResponse(db, roundId, otherUserId, new Date("2026-10-20T20:00:00Z")))!;
    expect(other.races[6].starts[0].mark!.interesting).toBe(false);
    expect(other.races[6].counts.interesting).toBe(0);
  });

  it("GET /api/starts/[id]: hästkort med 10 senaste, galopp och bara egna kommentarer", async () => {
    const s = await db.start.findFirstOrThrow({ where: { race: { roundId, leg: 7 }, number: 1 } });
    const d = (await buildStartDetail(db, s.id, userId, sunday))!;
    expect(d.records).toHaveLength(10);
    expect(d.records[0]).toMatchObject({ date: "2026-10-06", trackName: "Halmstad", place: 7 });
    expect(d.recordsTotal).toBeGreaterThan(10);
    expect(d.comments.map((c) => c.text)).toEqual(["Stark avslutning senast"]);
    expect(d.comments[0]).toMatchObject({ leg: 7, round: { trackName: "Jägersro", date: "2026-10-24" } });
    expect(d.stats.driver!.year).toBe("2026");
    expect(d.stats.horse.thisYear).not.toBeNull();
    expect(d.start.started).toBe(false);
  });

  it("en spelad omgång med rätt travstatistik: statistikrad, loppstatistik och kopplade namn", async () => {
    const at = new Date("2026-10-17T08:00:00Z");
    const g = (await fetchGameStep(deps(makeAtg("results"), at), { gameId: "V85_2026-10-17_16_5", userId }))!;
    for (let leg = 1; leg <= 8; leg++) await fetchRaceStep(deps(makeAtg("results"), at), { roundId: g.roundId, leg, userId });
    const stats = await fetchStatsStep(deps(makeAtg("results"), at), { roundId: g.roundId, userId });
    expect(stats.pages.every((p) => p.ok)).toBe(true);
    expect(stats.fetchStatus).toBe("COMPLETE");
    expect(stats.aliases.linked).toBeGreaterThan(5);

    const round = await db.round.findUniqueOrThrow({ where: { id: g.roundId } });
    expect(round.finishedAt).not.toBeNull();
    const res = (await buildRoundResponse(db, g.roundId, userId, new Date("2026-10-18T10:00:00Z")))!;
    expect(res.phase).toBe("KLART");
    const line = res.races[0].statsLine;
    expect(line.ok).toBe(true);
    expect(line.number1Pct).toBe(15.8);
    expect(line.bestNumber).toEqual({ number: 1, pct: 15.8 });
    expect(line.favoriteWinPct).not.toBeNull();
    expect(res.races[0].starts.find((s) => s.number === 6)!.result).toMatchObject({ place: 1 });

    const rs = (await buildRaceStats(db, g.roundId, 1, new Date()))!;
    expect(rs.startnr.ok).toBe(true);
    expect(rs.startnr.leg!.races).toBe(234);
    expect(rs.startnr.group!.distance).toBe(1640);
    expect(rs.favorites.overallWinPct).toBe(36.7);
    expect(rs.drivers.rows.length).toBeGreaterThan(5);
    expect(rs.drivers.rows.some((r) => r.linked && r.league)).toBe(true);
    const djuse = rs.drivers.rows.find((r) => r.name === "Mats E Djuse");
    if (djuse) expect(djuse).toMatchObject({ linked: true, rawName: "Djuse M E" });
  });

  it("GET /api/rounds/current: den senaste omgången som inte är klar", async () => {
    const res = await buildCurrentResponse(db, userId, new Date("2026-10-20T20:00:00Z"), async () => {
      throw new Error("ska inte anropas när omgången inte är klar");
    });
    expect(res.round!.atgGameId).toBe("V85_2026-10-24_7_5");
    expect(res.legs).toHaveLength(8);
    expect(res.legs[6]).toMatchObject({ interesting: 1, reviewed: true });
    expect(res.nextAvailable).toBeNull();
  });
  it("utländska hästar utan id (2026-10-31): Hämta igen fyller i det som saknades, utan falska kuskbyten", async () => {
    // Läget i drift före rättelsen: bara hästar med ATG-id sparades, och
    // utländska kuskar (id 0) blev en och samma person med id 0.
    const full = games.foreign as { races: { starts: { horse: { id?: number } }[] }[] };
    const pruned = structuredClone(full);
    for (const r of pruned.races) r.starts = r.starts.filter((st) => st.horse.id);
    games.foreignPruned = pruned;
    const now = new Date("2026-10-27T10:00:00Z");
    const gameId = "V85_2026-10-31_78_5";
    const first = (await fetchGameStep(deps(makeAtg("foreignPruned" as never), now), { gameId, userId }))!;
    expect(await db.start.count({ where: { race: { roundId: first.roundId } } })).toBe(50);
    const zero = await db.person.create({ data: { atgPersonId: 0, firstName: "Per Oleg", lastName: "Midtfjeld" } });
    const moved = await db.start.updateMany({ where: { race: { roundId: first.roundId }, driver: { atgPersonId: { lt: 0 } } }, data: { driverId: zero.id } });
    expect(moved.count).toBeGreaterThan(0);

    const again = (await fetchGameStep(deps(makeAtg("foreign"), now), { gameId, userId }))!;
    expect(again.roundId).toBe(first.roundId);
    expect(again.legs.map((l) => l.starts)).toEqual([12, 11, 12, 10, 15, 12, 10, 15]);
    expect(await db.start.count({ where: { race: { roundId: first.roundId } } })).toBe(97);
    expect(again.changes.driverChanges).toEqual([]);
    expect(again.changes.skipped).toEqual([]);
    expect(await db.start.count({ where: { race: { roundId: first.roundId }, OR: [{ driverId: null }, { trainerId: null }, { driverId: zero.id }] } })).toBe(0);
    // Hästar som inte går att läsa alls: hämtningen stoppas och inget sparas.
    const broken = structuredClone(full) as { races: { starts: { horse: { name?: string } }[] }[] };
    delete broken.races[1].starts[0].horse.name;
    games.foreignBroken = broken;
    await expect(fetchGameStep(deps(makeAtg("foreignBroken" as never), now), { gameId, userId })).rejects.toThrow("ATG:s startlista gick inte att läsa helt (lopp 2: 10 av 11 hästar). Inget sparades.");
    expect(await db.start.count({ where: { race: { roundId: first.roundId } } })).toBe(97);
    // Steg 2–9 klarar starter där ATG inte har något häst-id.
    expect((await fetchRaceStep(deps(makeAtg("foreign"), now), { roundId: first.roundId, leg: 2, userId })).ok).toBe(true);
  });
});
