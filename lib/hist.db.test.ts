// Statistikbasen mot en riktig Postgres (samma upplägg som lib/e2.db.test.ts):
// inläsning från en låtsad ATG, idempotens, dagar som misslyckas och
// tabellen över vinst % och plats % per startnummer. Hoppa över med SKIP_DB_TESTS=1.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AtgError, type AtgFetch } from "@/lib/atg";
import { clearPostCache, histStatus, importHist, postTable } from "@/lib/hist";
import { addDaysToDateString } from "@/lib/stockholm-time";

const ROOT = path.join(__dirname, "..");
const skip = process.env.SKIP_DB_TESTS === "1";
const race = JSON.parse(readFileSync(path.join(ROOT, "test", "fixtures", "atg", "race-2026-10-10_5_1.json"), "utf8"));

const NOW = new Date("2026-10-19T08:00:00Z");
// 201 dagar med ett lopp var (Solvalla, 2140 m auto), dagen 2026-10-01 har två: 202 lopp.
const FIRST = "2026-03-31";
const LAST = "2026-10-17";
const FAIL_DAY = "2026-10-05";

function fakeAtg(opts: { failRaceOn?: string } = {}): AtgFetch & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (p: string) => {
    calls.push(p);
    let m = /^calendar\/day\/(\d{4}-\d{2}-\d{2})$/.exec(p);
    if (m) {
      const d = m[1];
      if (d < FIRST || d > LAST) throw new AtgError("ATG hittade inte spelet", 404);
      const races = [{ id: `${d}_5_1`, status: "results" }];
      if (d === "2026-10-01") races.push({ id: `${d}_5_2`, status: "results" });
      return { date: d, tracks: [{ id: 5, name: "Solvalla", countryCode: "SE", sport: "trot", races }, { id: 99, countryCode: "SE", sport: "gallop", races: [{ id: `${d}_99_1`, status: "results" }] }] };
    }
    m = /^races\/(.+)$/.exec(p);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (opts.failRaceOn && id.startsWith(opts.failRaceOn)) throw new AtgError("ATG svarade 503", 503);
      const copy = structuredClone(race);
      copy.id = id;
      copy.date = id.slice(0, 10);
      copy.number = Number(id.split("_")[2]);
      return copy;
    }
    throw new Error(`okänd sökväg ${p}`);
  }) as AtgFetch & { calls: string[] };
  fn.calls = calls;
  return fn;
}

describe.skipIf(skip)("statistikbasen mot Postgres", () => {
  let pg: { stop(): Promise<void> } | null = null;
  let db: PrismaClientType;
  let dir = "";

  beforeAll(async () => {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    dir = mkdtempSync(path.join(os.tmpdir(), "spelvarde-hist-"));
    const port = 55500 + Math.floor(Math.random() * 400);
    const server = new EmbeddedPostgres({ databaseDir: dir, user: "t", password: "t", port, persistent: false, onLog: () => {}, onError: () => {} });
    await server.initialise();
    await server.start();
    await server.createDatabase("spelvarde_hist");
    pg = server;
    const url = `postgresql://t:t@127.0.0.1:${port}/spelvarde_hist?schema=spelvarde`;
    execFileSync(path.join(ROOT, "node_modules", ".bin", "prisma"), ["migrate", "deploy"], { cwd: ROOT, env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: "pipe" });
    const { PrismaClient } = await import("@prisma/client");
    db = new PrismaClient({ datasourceUrl: url });
  });

  afterAll(async () => {
    await db?.$disconnect();
    await pg?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("läser in alla dagar, men inte en dag där ett lopp misslyckas", async () => {
    const atg = fakeAtg({ failRaceOn: FAIL_DAY });
    const res = await importHist(db, atg, { now: NOW, budgetMs: 120_000 });
    expect(res.failedDays.map((d) => d.date)).toEqual([FAIL_DAY]);
    expect(res.races).toBe(201);
    // Galopplopp hämtas aldrig.
    expect(atg.calls.some((c) => c.includes("_99_"))).toBe(false);
    expect(await db.histStart.count()).toBe(201 * 12);
    const st = await histStatus(db, NOW);
    expect(st.daysTotal).toBe(730);
    expect(st.daysDone).toBe(729);
    expect(st.complete).toBe(false);
    expect(st.firstDate).toBe(FIRST);
    expect(st.lastDate).toBe(LAST);
  });

  it("nästa körning tar bara den dag som saknas och dubblerar inget", async () => {
    const atg = fakeAtg();
    const res = await importHist(db, atg, { now: NOW, budgetMs: 120_000 });
    expect(res.days).toBe(1);
    expect(res.races).toBe(1);
    expect(atg.calls.filter((c) => c.startsWith("races/"))).toEqual([`races/${FAIL_DAY}_5_1`]);
    expect(await db.histRace.count()).toBe(202);
    expect((await histStatus(db, NOW)).complete).toBe(true);
    // Allt inläst: inga anrop alls.
    const again = fakeAtg();
    await importHist(db, again, { now: NOW });
    expect(again.calls).toEqual([]);
  });

  it("nästa dag läser cron-jobbet bara in gårdagen", async () => {
    const atg = fakeAtg();
    const res = await importHist(db, atg, { now: new Date(`${addDaysToDateString("2026-10-19", 1)}T08:00:00Z`), maxDays: 14 });
    expect(res.days).toBe(1);
    expect(atg.calls).toEqual(["calendar/day/2026-10-19"]);
  });

  it("vinst % och plats % per startnummer, alla banor och banan", async () => {
    clearPostCache();
    // I fixturen vinner nr 11, tvåa nr 12, trea nr 5; nr 6 och 8 diskas.
    const t = (await postTable(db, { method: "AUTO", distance: 2140, before: NOW }))!;
    expect(t).toMatchObject({ scope: "all", exact: true, races: 202, distanceLabel: "2140 m" });
    const row = (n: number) => t.byNumber.find((r) => r.n === n)!;
    expect(row(11)).toMatchObject({ starts: 202, winPct: 100, placePct: 100 });
    expect(row(12)).toMatchObject({ winPct: 0, placePct: 100 });
    expect(row(5)).toMatchObject({ winPct: 0, placePct: 100 });
    expect(row(6)).toMatchObject({ winPct: 0, placePct: 0 });
    const track = (await postTable(db, { method: "AUTO", distance: 2140, trackId: 5, before: NOW }))!;
    expect(track.scope).toBe("track");
    expect(await postTable(db, { method: "AUTO", distance: 2140, trackId: 7, before: NOW })).toBeNull();
    // Annan distans i samma grupp: distansgruppen.
    const grp = (await postTable(db, { method: "AUTO", distance: 2100, before: NOW }))!;
    expect(grp).toMatchObject({ exact: false, races: 202 });
    expect(await postTable(db, { method: "VOLTE", distance: 2140, before: NOW })).toBeNull();
    // Bara lopp före omgångens datum.
    clearPostCache();
    expect((await postTable(db, { method: "AUTO", distance: 2140, before: new Date("2026-10-02T00:00:00Z") }))!.races).toBe(186);
  });
});
