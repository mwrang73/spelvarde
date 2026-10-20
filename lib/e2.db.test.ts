// Integrationstest av E2 mot en riktig Postgres (samma upplägg som
// lib/fetch-round.db.test.ts): riktodds (steg 11) på fixturen V85 Jägersro
// 2026-10-24, markeringar med odds, Spelbar och Bet, V85-raden och
// modellversioner. Hoppa över med SKIP_DB_TESTS=1.
//
// Skriv ut riktoddsen för avd 1 och 7: PRINT_RIKTODDS=1 npx vitest run lib/e2.db.test.ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AtgError, type AtgFetch } from "@/lib/atg";
import { ADMIN_ONLY, getCoupon, getModel, RACE_STARTED, saveCoupon, saveMark, saveModel, saveSettings } from "@/lib/e2-server";
import { fetchGameStep, fetchRaceStep, fetchStatsStep, type FetchDeps } from "@/lib/fetch-round";
import { harvilleTop3, oddsFromP3, softmax } from "@/lib/riktodds";
import { riktoddsStep } from "@/lib/riktodds-server";
import { buildRoundResponse, buildStartDetail, fetchState } from "@/lib/round-server";
import { decodeHtml, TS_PAGES, type TsFetch } from "@/lib/travstatistik";
import { applyPending } from "@/lib/round-overlay";
import type { OutboxItem } from "@/lib/outbox";
import type { CouponResponse, MarkResponse, ModelResponse, SettingsDto } from "@/lib/types";

const ROOT = path.join(__dirname, "..");
const FX = path.join(ROOT, "test", "fixtures");
const skip = process.env.SKIP_DB_TESTS === "1";
const atgFx = (f: string) => JSON.parse(readFileSync(path.join(FX, "atg", f), "utf8"));
const game = atgFx("game-V85_2026-10-24_7_5-bettable.json");
const startFx = atgFx("start-2026-10-24_7_11-1.json");

function makeAtg(g: unknown): AtgFetch {
  const idx = new Map<string, number>();
  for (const r of (g as { races: { id: string; starts: { number: number; horse: { id: number } }[] }[] }).races) for (const s of r.starts) idx.set(`${r.id}/${s.number}`, s.horse.id);
  return async (p: string) => {
    if (p.startsWith("calendar/day/")) {
      if (p.endsWith("2026-10-24")) return atgFx("calendar-2026-10-24.json");
      throw new AtgError("ATG hittade inte spelet", 404);
    }
    if (p.startsWith("games/")) return structuredClone(g);
    const m = /^races\/([^/]+)\/start\/(\d+)$/.exec(p);
    if (m) {
      // Fixturen har tidigare starter för en enda häst; alla hästar får samma
      // lista, så form och galopp blir lika för alla (z = 0) i testet.
      const copy = structuredClone(startFx);
      copy.raceId = decodeURIComponent(m[1]);
      copy.startNumber = Number(m[2]);
      copy.horse.id = idx.get(`${decodeURIComponent(m[1])}/${m[2]}`);
      // Hästens egen statistik från spelet ska stå kvar (inte fixturhästens).
      delete copy.horse.statistics;
      return copy;
    }
    throw new Error(`okänd sökväg ${p}`);
  };
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

describe.skipIf(skip)("E2 mot Postgres", () => {
  let pg: { stop(): Promise<void> } | null = null;
  let db: PrismaClientType;
  let dir = "";
  let admin = { id: "", role: "ADMIN" as const };
  let user = { id: "", role: "USER" as const };
  let roundId = "";
  const sunday = new Date("2026-10-19T19:00:00Z");
  const thursday = new Date("2026-10-22T19:00:00Z");
  const deps = (g: unknown, now = sunday): FetchDeps => ({ db, atg: makeAtg(g), ts, now: () => now });

  beforeAll(async () => {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    dir = mkdtempSync(path.join(os.tmpdir(), "spelvarde-e2-"));
    const port = 55000 + Math.floor(Math.random() * 500);
    const server = new EmbeddedPostgres({ databaseDir: dir, user: "t", password: "t", port, persistent: false, onLog: () => {}, onError: () => {} });
    await server.initialise();
    await server.start();
    await server.createDatabase("spelvarde_e2");
    pg = server;
    const url = `postgresql://t:t@127.0.0.1:${port}/spelvarde_e2?schema=spelvarde`;
    execFileSync(path.join(ROOT, "node_modules", ".bin", "prisma"), ["migrate", "deploy"], { cwd: ROOT, env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: "pipe" });
    const { PrismaClient } = await import("@prisma/client");
    db = new PrismaClient({ datasourceUrl: url });
    admin = { id: (await db.user.create({ data: { email: "m@example.local", name: "M", passwordHash: "x", role: "ADMIN", status: "APPROVED" } })).id, role: "ADMIN" };
    user = { id: (await db.user.create({ data: { email: "o@example.local", name: "O", passwordHash: "x", status: "APPROVED" } })).id, role: "USER" };

    const g = await fetchGameStep(deps(game), { gameId: "V85_2026-10-24_7_5", userId: admin.id });
    roundId = g!.roundId;
    for (let leg = 1; leg <= 8; leg++) await fetchRaceStep(deps(game), { roundId, leg, userId: admin.id });
    await fetchStatsStep(deps(game), { roundId, userId: admin.id });
  });

  afterAll(async () => {
    await db?.$disconnect();
    await pg?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const p3Sums = async (modelVersionId: string) => {
    const rows = await db.riktodds.findMany({ where: { modelVersionId, start: { race: { roundId } } }, include: { start: { select: { race: { select: { leg: true } } } } } });
    const sums = new Map<number, number>();
    for (const r of rows) sums.set(r.start.race.leg, (sums.get(r.start.race.leg) ?? 0) + Number(r.probTop3));
    return { rows, sums };
  };

  it("steg 11 räknar alla ej strukna med v1 (skapas om den saknas) och Σ P3 = 3 per lopp", async () => {
    const res = (await riktoddsStep(db, { roundId, userId: admin.id, now: sunday }))!;
    expect(res.modelKey).toBe("v1");
    expect(res.skippedLegs).toEqual([]);
    const active = await db.modelVersion.findFirstOrThrow({ where: { active: true } });
    const starters = await db.start.count({ where: { race: { roundId }, scratched: false } });
    expect(res.computed).toBe(starters);
    const { rows, sums } = await p3Sums(active.id);
    expect(rows).toHaveLength(starters);
    expect(sums.size).toBe(8);
    for (const s of sums.values()) expect(Math.abs(s - 3)).toBeLessThan(0.01);
    for (const r of rows) expect(Number(r.odds)).toBeGreaterThanOrEqual(1.01);
    const log = await db.fetchLog.findFirstOrThrow({ where: { roundId, step: "RIKTODDS" } });
    expect(log.ok).toBe(true);
    // Idempotent: en omräkning ger samma rader.
    await riktoddsStep(db, { roundId, userId: admin.id, now: sunday });
    expect(await db.riktodds.count()).toBe(starters);
  });

  it("riktoddsen för avd 1 och 7 (fixturen)", async () => {
    const res = (await buildRoundResponse(db, roundId, admin.id, sunday))!;
    for (const leg of [1, 7]) {
      const race = res.races[leg - 1];
      // Jämförelse: samma styrkor med β = 0,5 (bara utskrift, för rimlighetsbedömning).
      const rows = await db.riktodds.findMany({ where: { startId: { in: race.starts.map((s) => s.id) } } });
      const strength = new Map(rows.map((r) => [r.startId, (r.inputs as { strength: number }).strength]));
      const ids = race.starts.filter((s) => strength.has(s.id)).map((s) => s.id);
      const half = harvilleTop3(softmax(ids.map((id) => strength.get(id)!), 0.5));
      const halfBy = new Map(ids.map((id, i) => [id, half[i]]));
      const table = race.starts.map((s) => ({
        nr: s.number,
        häst: s.horse.name,
        "P3 %": s.probTop3 === null ? "–" : (s.probTop3 * 100).toFixed(1),
        riktodds: s.riktodds,
        osäkert: s.uncertain ? "ja" : "",
        struken: s.scratched ? "ja" : "",
        "β=0,5 P3 %": halfBy.has(s.id) ? (halfBy.get(s.id)! * 100).toFixed(1) : "–",
        "β=0,5 rikt": halfBy.has(s.id) ? oddsFromP3(halfBy.get(s.id)!, 0) : null,
      }));
      if (process.env.PRINT_RIKTODDS) {
        console.log(`Avd ${leg} – ${race.name}`);
        console.table(table);
      }
      expect(race.starts.filter((s) => !s.scratched).every((s) => s.riktodds !== null)).toBe(true);
    }
    expect(res.model?.key).toBe("v1");
    expect(res.settings).toEqual({ spelbarGuideline: 2, rowPrice: 0.5, xFactorTror: 1.25, xFactorStark: 1.5 });
    expect(res.sourcesEnabled).toBe(0);
  });

  it("hästkortet: riktodds, högst 3 + 3 skäl och beräkningsraden", async () => {
    const s = await db.start.findFirstOrThrow({ where: { race: { roundId, leg: 7 }, number: 1 } });
    const d = (await buildStartDetail(db, s.id, admin.id, sunday))!;
    expect(d.riktodds).not.toBeNull();
    const r = d.riktodds!;
    expect(r.pros.length).toBeLessThanOrEqual(3);
    expect(r.cons.length).toBeLessThanOrEqual(3);
    expect(r.calcLine).toMatch(/^Chans till topp 3 ≈ \d+ % → 1 \/ \d,\d\d = \d+,\d\d$/);
    expect(r.modelKey).toBe("v1");
    expect(d.start.riktodds).toBe(r.odds);
    if (process.env.PRINT_RIKTODDS) {
      for (const n of [3, 5]) {
        const x = await db.start.findFirstOrThrow({ where: { race: { roundId, leg: 7 }, number: n } });
        const dd = (await buildStartDetail(db, x.id, admin.id, sunday))!;
        console.log(dd.start.horse.name, JSON.stringify({ pros: dd.riktodds!.pros, cons: dd.riktodds!.cons, calc: dd.riktodds!.calcLine, osäkert: dd.riktodds!.uncertainLine }, null, 1));
      }
    }
  });

  it("spår från travstatistik.se när sidan visar rätt omgång (V85 2026-10-17)", async () => {
    const results = atgFx("game-V85_2026-10-17_16_5-results.json");
    const at = new Date("2026-10-17T08:00:00Z");
    const g = (await fetchGameStep(deps(results, at), { gameId: "V85_2026-10-17_16_5", userId: admin.id }))!;
    for (let leg = 1; leg <= 8; leg++) await fetchRaceStep(deps(results, at), { roundId: g.roundId, leg, userId: admin.id });
    await fetchStatsStep(deps(results, at), { roundId: g.roundId, userId: admin.id });
    await riktoddsStep(db, { roundId: g.roundId, userId: admin.id, now: at });
    const rows = await db.riktodds.findMany({ where: { start: { race: { roundId: g.roundId, leg: 1 } } } });
    const spar = rows.map((r) => (r.inputs as { values: { spar: { missing: boolean } } }).values.spar.missing);
    expect(spar.filter((m) => !m).length).toBeGreaterThan(5);
    expect(rows.some((r) => Math.abs((r.contributions as { spar: number }).spar) > 0)).toBe(true);
  });

  it("PUT mark: odds, förslag, Bet och idempotens", async () => {
    const s = await db.start.findFirstOrThrow({ where: { race: { roundId, leg: 7 }, number: 1 } });
    const rikt = Number((await db.riktodds.findFirstOrThrow({ where: { startId: s.id } })).odds);
    const above = Math.min(99.99, Math.round((rikt + 0.7) * 100) / 100);
    const r1 = await saveMark(db, admin.id, s.id, { interesting: true, unibetOdds: above }, thursday);
    expect(r1.status).toBe(200);
    const m1 = (r1.body as MarkResponse).mark;
    expect(m1).toMatchObject({ interesting: true, unibetOdds: above, forslag: true, spelbar: true, riktodds: rikt, spelbarOverride: "NONE" });
    // Samma kropp igen: ingen skrivning.
    const r2 = await saveMark(db, admin.id, s.id, { interesting: true, unibetOdds: above }, new Date("2026-10-23T10:00:00Z"));
    expect((r2.body as MarkResponse).mark.updatedAt).toBe(m1.updatedAt);
    // Ta bort förslaget för hand, och oddset ändras: valet står kvar.
    await saveMark(db, admin.id, s.id, { spelbar: "off" }, thursday);
    const r3 = (await saveMark(db, admin.id, s.id, { unibetOdds: 50 }, thursday)).body as MarkResponse;
    expect(r3.mark).toMatchObject({ spelbarOverride: "OFF", spelbar: false, forslag: true, unibetOddsPrev: above });
    // Bet sätter bet-odds.
    const r4 = (await saveMark(db, admin.id, s.id, { bet: true }, thursday)).body as MarkResponse;
    expect(r4.mark).toMatchObject({ bet: true, betOdds: 50 });
    // Under riktlinjen: taggen, men förslaget påverkas inte.
    const low = (await saveMark(db, admin.id, s.id, { spelbar: "auto", unibetOdds: 1.5 }, thursday)).body as MarkResponse;
    expect(low.mark).toMatchObject({ belowGuideline: true, betOdds: 1.5 });
    // Den andra användaren ser inget av det.
    const other = (await buildRoundResponse(db, roundId, user.id, thursday))!;
    expect(other.races[6].starts[0].mark).toBeNull();
    // Valideringen.
    expect((await saveMark(db, admin.id, s.id, { unibetOdds: 1.0 }, thursday)).status).toBe(400);
    expect((await saveMark(db, admin.id, s.id, { userId: user.id }, thursday)).status).toBe(400);
  });

  it("PUT mark: 409 efter loppets start och 422 på struken häst", async () => {
    const s = await db.start.findFirstOrThrow({ where: { race: { roundId, leg: 1 }, number: 2 }, include: { race: true } });
    const after = new Date(s.race.startAt.getTime() + 1000);
    expect(await saveMark(db, admin.id, s.id, { interesting: true }, after)).toEqual({ status: 409, body: { error: RACE_STARTED } });
    expect((await saveMark(db, admin.id, s.id, { unibetOdds: 3.1 }, s.race.startAt)).status).toBe(409);
    await db.start.update({ where: { id: s.id }, data: { scratched: true } });
    expect((await saveMark(db, admin.id, s.id, { bet: true }, thursday)).status).toBe(422);
    await db.start.update({ where: { id: s.id }, data: { scratched: false } });
  });

  it("Hämta igen med en strykning räknar om avdelningen utan den strukna", async () => {
    const g = structuredClone(game) as { races: { starts: { number: number; scratched?: boolean }[] }[] };
    g.races[0].starts.find((s) => s.number === 3)!.scratched = true;
    const res = (await fetchGameStep(deps(g, new Date("2026-10-20T19:00:00Z")), { gameId: "V85_2026-10-24_7_5", userId: admin.id }))!;
    expect(res.changes.scratched).toEqual([expect.objectContaining({ leg: 1, number: 3 })]);
    const scratched = await db.start.findFirstOrThrow({ where: { race: { roundId, leg: 1 }, number: 3 } });
    expect(await db.riktodds.count({ where: { startId: scratched.id } })).toBe(0);
    const active = await db.modelVersion.findFirstOrThrow({ where: { active: true } });
    const { sums } = await p3Sums(active.id);
    expect(Math.abs(sums.get(1)! - 3)).toBeLessThan(0.01);
  });

  it("V85-raden: spara, läsa, idempotens, bara egen och 409 för en avdelning som har startat", async () => {
    const body = { budget: 150, selections: { "1": [1, 2], "2": [5], "7": [1, 2, 3] }, lockedLegs: [7] };
    const put = await saveCoupon(db, admin.id, roundId, body, thursday);
    expect(put.status).toBe(200);
    const c = (put.body as CouponResponse).coupon!;
    expect(c).toMatchObject({ budget: 150, rowPrice: 0.5, selections: { "1": [1, 2], "2": [5], "7": [1, 2, 3] }, lockedLegs: [7], rows: 0, cost: 0 });
    expect((await saveCoupon(db, admin.id, roundId, body, thursday)).status).toBe(200);
    expect(await db.coupon.count({ where: { userId: admin.id } })).toBe(1);
    const got = (await getCoupon(db, admin.id, roundId)).body as CouponResponse;
    expect(got.coupon!.selections).toEqual(c.selections);
    expect(((await getCoupon(db, user.id, roundId)).body as CouponResponse).coupon).toBeNull();
    expect((await saveCoupon(db, admin.id, roundId, { ...body, selections: { "1": [99] } }, thursday)).status).toBe(400);
    const race1 = await db.race.findFirstOrThrow({ where: { roundId, leg: 1 } });
    const after = new Date(race1.startAt.getTime() + 1000);
    expect((await saveCoupon(db, admin.id, roundId, { ...body, selections: { ...body.selections, "1": [1] } }, after)).status).toBe(409);
    // Budgeten och avdelningar som inte har startat går att ändra.
    expect((await saveCoupon(db, admin.id, roundId, { ...body, budget: 200 }, after)).status).toBe(200);
    const round = (await buildRoundResponse(db, roundId, admin.id, thursday))!;
    expect(round.coupon!.budget).toBe(200);
  });

  it("modellen: bara ADMIN, PUT skapar v1.1 som blir aktiv, v1 finns kvar och omgången räknas om", async () => {
    expect(await getModel(db, user)).toEqual({ status: 403, body: { error: ADMIN_ONLY } });
    expect((await saveModel(db, user, { weights: { plats: 2 } }, thursday)).status).toBe(403);
    expect((await saveModel(db, admin, { weights: { okänd: 1 } }, thursday)).status).toBe(400);
    expect((await saveModel(db, admin, { params: { beta: 0 } }, thursday)).status).toBe(400);

    const before = await db.riktodds.count();
    const res = await saveModel(db, admin, { weights: { plats: 1.2, galopp: -0.5 }, roundId }, thursday);
    expect(res.status).toBe(200);
    const body = res.body as ModelResponse;
    expect(body.active).toMatchObject({ key: "v1.1", weights: { plats: 1.2, galopp: -0.5, vinst: 0.5 } });
    expect(body.versions.map((v) => [v.key, v.active])).toEqual([
      ["v1.1", true],
      ["v1", false],
    ]);
    expect(body.recomputed!.modelKey).toBe("v1.1");
    // Gamla riktodds finns kvar, de nya ligger bredvid.
    expect(await db.riktodds.count()).toBe(before + body.recomputed!.computed);
    const round = (await buildRoundResponse(db, roundId, admin.id, thursday))!;
    expect(round.model!.key).toBe("v1.1");
    // Oförändrade vikter skapar ingen ny version.
    const same = (await saveModel(db, admin, { weights: { plats: 1.2 } }, thursday)).body as ModelResponse;
    expect(same.versions).toHaveLength(2);
    expect(((await getModel(db, admin)).body as ModelResponse).active!.key).toBe("v1.1");
  });

  it("modellen: vikterna utan streck sparas som ny version och kan tas bort", async () => {
    expect((await saveModel(db, admin, { noStreck: "nej" }, thursday)).status).toBe(400);
    const res = (await saveModel(db, admin, { weights: { streck: 0.88 }, noStreck: { pengar: 0.38, plats: 0.1 }, roundId }, thursday)).body as ModelResponse;
    expect(res.active).toMatchObject({ key: "v1.2", params: { noStreck: { pengar: 0.38, plats: 0.1, streck: 0, vinst: 0 } } });
    const off = (await saveModel(db, admin, { noStreck: null, roundId }, thursday)).body as ModelResponse;
    expect(off.active).toMatchObject({ key: "v1.3", params: { noStreck: null } });
  });

  it("ett misslyckat steg 11 ger resumeFrom RIKTODDS", async () => {
    const round = await db.round.findUniqueOrThrow({ where: { id: roundId }, include: { races: true } });
    await db.round.update({ where: { id: roundId }, data: { fetchStatus: "COMPLETE" } });
    await db.fetchLog.create({ data: { roundId, userId: admin.id, step: "RIKTODDS", startedAt: new Date(thursday.getTime() + 60_000), ok: false, message: "test" } });
    const state = await fetchState(db, { ...round, fetchStatus: "COMPLETE" }, round.races);
    expect(state.resumeFrom).toEqual({ step: "RIKTODDS" });
    const res = (await buildRoundResponse(db, roundId, admin.id, thursday))!;
    expect(res.nextStep.kind).toBe("RESUME_FETCH");
  });
  // ---- E2.1: X-faktor och källstöd ----------------------------------------------------------

  const startIn = (leg: number, number: number) => db.start.findFirstOrThrow({ where: { race: { roundId, leg }, number }, include: { race: true } });
  const activeRikt = async (startId: string) => {
    const m = await db.modelVersion.findFirstOrThrow({ where: { active: true } });
    return Number((await db.riktodds.findUniqueOrThrow({ where: { startId_modelVersionId: { startId, modelVersionId: m.id } } })).odds);
  };
  const r2 = (x: number) => Math.round(x * 100) / 100;

  it("E2.1 PUT mark: X tänder Intressant, förslaget räknas mot riktoddsX, override står kvar och idempotens", async () => {
    const s = await startIn(3, 1);
    const rikt = await activeRikt(s.id);
    const rx = Math.max(1.01, r2(rikt / 1.25));
    // Unibet mellan riktoddsX och riktodds: föreslås bara med X.
    const unibet = r2((rikt + rx) / 2);
    expect(unibet).toBeGreaterThan(rx);
    const a = (await saveMark(db, admin.id, s.id, { unibetOdds: unibet }, thursday)).body as MarkResponse;
    expect(a.mark).toMatchObject({ interesting: false, xFactor: "NONE", xFactorValue: 1, riktoddsX: rikt, forslag: false });
    const b = await saveMark(db, admin.id, s.id, { xFactor: "TROR" }, thursday);
    expect(b.status).toBe(200);
    const mb = (b.body as MarkResponse).mark;
    expect(mb).toMatchObject({ interesting: true, xFactor: "TROR", xFactorValue: 1.25, riktodds: rikt, riktoddsX: rx, forslag: true, spelbar: true, xFactorAt: thursday.toISOString() });
    // Samma kropp igen: ingen skrivning.
    const again = (await saveMark(db, admin.id, s.id, { xFactor: "TROR" }, new Date("2026-10-23T10:00:00Z"))).body as MarkResponse;
    expect(again.mark.updatedAt).toBe(mb.updatedAt);
    expect(again.mark.xFactorAt).toBe(thursday.toISOString());
    // Ta bort förslaget för hand: OFF står kvar när X byts.
    await saveMark(db, admin.id, s.id, { spelbar: "off" }, thursday);
    const c = (await saveMark(db, admin.id, s.id, { xFactor: "STARK" }, thursday)).body as MarkResponse;
    expect(c.mark).toMatchObject({ spelbarOverride: "OFF", spelbar: false, forslag: true, xFactorValue: 1.5 });
    // Källstöd, och släckt Intressant nollställer X och override men inte källstödet.
    await saveMark(db, admin.id, s.id, { sourceSupport: 3 }, thursday);
    const d = (await saveMark(db, admin.id, s.id, { interesting: false }, thursday)).body as MarkResponse;
    expect(d.mark).toMatchObject({ interesting: false, spelbarOverride: "NONE", xFactor: "NONE", xFactorAt: null, sourceSupport: 3, riktoddsX: rikt });
    // Ångra i ett anrop.
    const u = (await saveMark(db, admin.id, s.id, { interesting: true, spelbar: "off", xFactor: "STARK" }, thursday)).body as MarkResponse;
    expect(u.mark).toMatchObject({ interesting: true, spelbarOverride: "OFF", xFactor: "STARK", sourceSupport: 3 });
  });

  it("E2.1 PUT mark: 400 för fel värden och för interesting:false + X, 409 efter start, 422 på struken", async () => {
    const s = await startIn(3, 2);
    expect(await saveMark(db, admin.id, s.id, { interesting: false, xFactor: "TROR" }, thursday)).toEqual({ status: 400, body: { error: "X-faktor kräver Intressant." } });
    expect(await saveMark(db, admin.id, s.id, { xFactor: "MAX" }, thursday)).toEqual({ status: 400, body: { error: "Okänt läge för X-faktor." } });
    expect(await saveMark(db, admin.id, s.id, { sourceSupport: 21 }, thursday)).toEqual({ status: 400, body: { error: "Källstödet ska vara ett heltal mellan 0 och 20." } });
    expect(await db.mark.count({ where: { userId: admin.id, startId: s.id } })).toBe(0);
    const after = new Date(s.race.startAt.getTime() + 1000);
    expect(await saveMark(db, admin.id, s.id, { xFactor: "TROR" }, after)).toEqual({ status: 409, body: { error: RACE_STARTED } });
    expect(await saveMark(db, admin.id, s.id, { sourceSupport: 2 }, s.race.startAt)).toEqual({ status: 409, body: { error: RACE_STARTED } });
    await db.start.update({ where: { id: s.id }, data: { scratched: true } });
    expect((await saveMark(db, admin.id, s.id, { xFactor: "STARK" }, thursday)).status).toBe(422);
    expect((await saveMark(db, admin.id, s.id, { sourceSupport: 1 }, thursday)).status).toBe(422);
    // Att släcka eller rensa går.
    expect((await saveMark(db, admin.id, s.id, { xFactor: "NONE", sourceSupport: null }, thursday)).status).toBe(200);
    await db.start.update({ where: { id: s.id }, data: { scratched: false } });
  });

  it("E2.1 databasens villkor: X kräver Intressant, källstöd 0–20, faktorerna 1,05–3,00 och Stark > Tror", async () => {
    const s = await startIn(3, 3);
    await expect(db.mark.create({ data: { userId: admin.id, startId: s.id, xFactor: "TROR", xFactorAt: thursday } })).rejects.toThrow();
    await expect(db.mark.create({ data: { userId: admin.id, startId: s.id, interesting: true, xFactor: "TROR" } })).rejects.toThrow();
    await expect(db.mark.create({ data: { userId: admin.id, startId: s.id, sourceSupport: 21 } })).rejects.toThrow();
    await expect(db.userSettings.create({ data: { userId: user.id, xFactorTror: 1.5, xFactorStark: 1.5 } })).rejects.toThrow();
    await expect(db.userSettings.create({ data: { userId: user.id, xFactorTror: 1.0, xFactorStark: 1.5 } })).rejects.toThrow();
    const outcome = { userId: admin.id, startId: s.id, roundId, interesting: true, spelbar: false, bet: false };
    await expect(db.outcome.create({ data: { ...outcome, xFactor: "NONE", xFactorValue: 1.25 } })).rejects.toThrow();
    // Standardvärdena uppfyller villkoren (så som befintliga rader i drift får dem).
    const m = await db.mark.create({ data: { userId: admin.id, startId: s.id } });
    expect(m).toMatchObject({ xFactor: "NONE", xFactorAt: null, sourceSupport: null });
    const o = await db.outcome.create({ data: outcome });
    expect(o).toMatchObject({ xFactor: "NONE", riktoddsX: null, sourceSupport: null, sourceTotal: null });
    expect(Number(o.xFactorValue)).toBe(1);
    await db.outcome.delete({ where: { id: o.id } });
    await db.mark.delete({ where: { id: m.id } });
  });

  it("E2.1 inställningar: gränser, Stark > Tror mot sparat värde, och omgången räknas om", async () => {
    const bad = async (body: Record<string, unknown>) => (await saveSettings(db, admin.id, body)).body;
    expect(await bad({ xFactorTror: 1.04 })).toEqual({ error: "Faktorn ska ligga mellan 1,05 och 3,00." });
    expect(await bad({ xFactorStark: 3.01 })).toEqual({ error: "Faktorn ska ligga mellan 1,05 och 3,00." });
    expect(await bad({ xFactorTror: 1.5 })).toEqual({ error: "Stark känsla ska vara större än Tror på." });
    expect(await bad({ xFactorTror: 1.6, xFactorStark: 1.6 })).toEqual({ error: "Stark känsla ska vara större än Tror på." });
    const ok = await saveSettings(db, admin.id, { xFactorTror: 1.6, xFactorStark: 2 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ xFactorTror: 1.6, xFactorStark: 2, spelbarGuideline: 2, rowPrice: 0.5 });
    // Nu går Tror på upp till 1,99 utan att Stark skickas.
    expect((await saveSettings(db, admin.id, { xFactorTror: 1.99 })).status).toBe(200);
    expect(((await saveSettings(db, admin.id, { xFactorTror: 1.6 })).body as SettingsDto).xFactorTror).toBe(1.6);

    const s = await startIn(3, 1);
    const rikt = await activeRikt(s.id);
    const res = (await buildRoundResponse(db, roundId, admin.id, thursday))!;
    expect(res.settings).toMatchObject({ xFactorTror: 1.6, xFactorStark: 2 });
    const mark = res.races[2].starts.find((x) => x.id === s.id)!.mark!;
    expect(mark).toMatchObject({ xFactor: "STARK", xFactorValue: 2, riktoddsX: Math.max(1.01, r2(rikt / 2)) });
    const detail = (await buildStartDetail(db, s.id, admin.id, thursday))!;
    expect(detail.start.mark).toMatchObject({ xFactorValue: 2, riktoddsX: mark.riktoddsX });
    // Tillbaka till standard.
    await saveSettings(db, admin.id, { xFactorTror: 1.25, xFactorStark: 1.5 });
  });

  it("E2.1 sourcesEnabled räknar användarens påslagna källor", async () => {
    await db.source.createMany({
      data: [
        { userId: admin.id, name: "A", url: "https://a.example.com/" },
        { userId: admin.id, name: "B", url: "https://b.example.com/", enabled: false },
        { userId: user.id, name: "C", url: "https://c.example.com/" },
      ],
    });
    expect((await buildRoundResponse(db, roundId, admin.id, thursday))!.sourcesEnabled).toBe(1);
    expect((await buildRoundResponse(db, roundId, user.id, thursday))!.sourcesEnabled).toBe(1);
    await db.source.deleteMany({});
  });

  it("E2.1 overlay = server: utkorgens optimistiska läge blir samma Mark som servern sparar", async () => {
    const s = await startIn(4, 2);
    const rikt = await activeRikt(s.id);
    await saveSettings(db, user.id, { xFactorTror: 1.4, xFactorStark: 1.9 });
    const bodies: Record<string, unknown>[] = [
      { unibetOdds: r2(rikt * 0.9) },
      { xFactor: "TROR" },
      { spelbar: "off" },
      { xFactor: "STARK", sourceSupport: 2 },
      { bet: true },
      { interesting: false },
      { interesting: true, spelbar: "off", xFactor: "STARK" },
      { spelbar: "auto" },
    ];
    let cache = (await buildRoundResponse(db, roundId, user.id, thursday))!;
    for (const [i, body] of bodies.entries()) {
      const at = new Date(thursday.getTime() + i * 60_000);
      const item: OutboxItem = { id: `o${i}`, method: "PUT", url: `/api/marks/${s.id}`, body, createdAt: at.getTime(), tries: 0, meta: { kind: "mark", roundId, raceId: s.raceId, startId: s.id, horseName: "H" } };
      const optimistic = applyPending(cache, [item], at).races[3].starts.find((x) => x.id === s.id)!.mark!;
      const res = await saveMark(db, user.id, s.id, body, at);
      expect(res.status).toBe(200);
      const server = (res.body as MarkResponse).mark;
      expect({ ...optimistic, updatedAt: "" }).toEqual({ ...server, updatedAt: "" });
      cache = (await buildRoundResponse(db, roundId, user.id, at))!;
      expect({ ...cache.races[3].starts.find((x) => x.id === s.id)!.mark!, updatedAt: "" }).toEqual({ ...server, updatedAt: "" });
    }
  });
});
