// Integrationstest av E8 Inlämnad rad mot en riktig Postgres (samma upplägg som
// lib/e2.db.test.ts): upsert, tider, isolering mellan användare, kopian mot
// kupongen, RLS, kaskad och GET /api/rounds/[id]. Hoppa över med SKIP_DB_TESTS=1.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AtgFetch } from "@/lib/atg";
import { saveCoupon } from "@/lib/e2-server";
import { fetchGameStep, type FetchDeps } from "@/lib/fetch-round";
import { buildRoundResponse } from "@/lib/round-server";
import { deleteSubmittedRow, saveSubmittedRow } from "@/lib/submitted-row-server";
import { winnersInRow } from "@/lib/submitted-row";
import type { SubmittedRowDto } from "@/lib/types";

const ROOT = path.join(__dirname, "..");
const skip = process.env.SKIP_DB_TESTS === "1";
const game = JSON.parse(readFileSync(path.join(ROOT, "test", "fixtures", "atg", "game-V85_2026-10-24_7_5-bettable.json"), "utf8"));
const GAME_ID = "V85_2026-10-24_7_5";
const atg: AtgFetch = async () => structuredClone(game);
const ts = async () => {
  throw new Error("travstatistik behövs inte här");
};

describe.skipIf(skip)("E8 Inlämnad rad mot Postgres", () => {
  let pg: { stop(): Promise<void> } | null = null;
  let db: PrismaClientType;
  let dir = "";
  let userA = "";
  let userB = "";
  let roundId = "";
  let firstStart = new Date(0);
  let selections: Record<string, number[]> = {};
  const sunday = new Date("2026-10-19T19:00:00Z");

  const rowOf = (res: { status: number; body: unknown }) => {
    expect(res.status).toBe(200);
    return (res.body as { submittedRow: SubmittedRowDto }).submittedRow;
  };
  const errorOf = (res: { body: unknown }) => (res.body as { error: string }).error;
  const body = (over: Record<string, unknown> = {}) => ({ selections, rowPrice: 0.5, markedAt: "2026-10-19T18:00:00.000Z", ...over });
  const put = (userId: string, over: Record<string, unknown> = {}, now = sunday, id = roundId) => saveSubmittedRow(db, userId, id, body(over), now);

  beforeAll(async () => {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    dir = mkdtempSync(path.join(os.tmpdir(), "spelvarde-e8-"));
    const port = 56000 + Math.floor(Math.random() * 500);
    const server = new EmbeddedPostgres({ databaseDir: dir, user: "t", password: "t", port, persistent: false, onLog: () => {}, onError: () => {} });
    await server.initialise();
    await server.start();
    await server.createDatabase("spelvarde_e8");
    pg = server;
    const url = `postgresql://t:t@127.0.0.1:${port}/spelvarde_e8?schema=spelvarde`;
    execFileSync(path.join(ROOT, "node_modules", ".bin", "prisma"), ["migrate", "deploy"], { cwd: ROOT, env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: "pipe" });
    const { PrismaClient } = await import("@prisma/client");
    db = new PrismaClient({ datasourceUrl: url });
    userA = (await db.user.create({ data: { email: "a@example.local", name: "A", passwordHash: "x", status: "APPROVED" } })).id;
    userB = (await db.user.create({ data: { email: "b@example.local", name: "B", passwordHash: "x", status: "APPROVED" } })).id;
    const deps: FetchDeps = { db, atg, ts, now: () => sunday };
    roundId = (await fetchGameStep(deps, { gameId: GAME_ID, userId: userA }))!.roundId;
    const races = await db.race.findMany({ where: { roundId }, orderBy: { leg: "asc" }, include: { starts: { orderBy: { number: "asc" }, select: { number: true } } } });
    firstStart = new Date(Math.min(...races.map((r) => r.startAt.getTime())));
    selections = Object.fromEntries(races.map((r) => [String(r.leg), [r.starts[0].number]]));
  }, 180_000);

  afterAll(async () => {
    await db?.$disconnect();
    await pg?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("PUT skapar, och PUT igen uppdaterar samma rad", async () => {
    const first = rowOf(await put(userA));
    expect(first).toMatchObject({ roundId, rows: 1, cost: 0.5, rowPrice: 0.5, markedAt: "2026-10-19T18:00:00.000Z", markedLate: false });
    const before = await db.submittedRow.findFirstOrThrow({ where: { userId: userA, roundId } });

    const wider = { ...selections, "1": [selections["1"][0], selections["1"][0] + 1] };
    const second = rowOf(await put(userA, { selections: wider, rowPrice: 1 }));
    expect(second).toMatchObject({ rows: 2, cost: 2, rowPrice: 1 });
    const after = await db.submittedRow.findMany({ where: { userId: userA, roundId } });
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    expect(after[0].createdAt).toEqual(before.createdAt);
    await deleteSubmittedRow(db, userA, roundId);
  });

  it("omsändning med samma kropp ger samma rad", async () => {
    const a = rowOf(await put(userA));
    const b = rowOf(await put(userA));
    expect({ ...b, updatedAt: "" }).toEqual({ ...a, updatedAt: "" });
    await deleteSubmittedRow(db, userA, roundId);
  });

  it("två användare hindrar inte varandra, och en ser aldrig den andres", async () => {
    rowOf(await put(userA));
    const wider = { ...selections, "2": [selections["2"][0], selections["2"][0] + 1] };
    rowOf(await put(userB, { selections: wider }));
    expect(await db.submittedRow.count({ where: { roundId } })).toBe(2);

    const a = await buildRoundResponse(db, roundId, userA, sunday);
    const b = await buildRoundResponse(db, roundId, userB, sunday);
    expect(a!.submittedRow!.rows).toBe(1);
    expect(b!.submittedRow!.rows).toBe(2);

    // A kan inte ta bort B:s rad, och ett userId i kroppen avvisas.
    await deleteSubmittedRow(db, userA, roundId);
    expect(await db.submittedRow.count({ where: { roundId, userId: userB } })).toBe(1);
    expect((await buildRoundResponse(db, roundId, userA, sunday))!.submittedRow).toBeNull();
    const forged = await put(userA, { userId: userB });
    expect(forged.status).toBe(400);
    expect(errorOf(forged)).toBe("Okänt fält i raden.");
    await deleteSubmittedRow(db, userB, roundId);
  });

  it("markedLate räknas av servern ur markedAt, vid varje PUT", async () => {
    const after = new Date(firstStart.getTime() + 60_000);
    // Andra PUT med markedAt vid start ger markedLate.
    rowOf(await put(userA));
    const late = rowOf(await put(userA, { markedAt: firstStart.toISOString() }, after));
    expect(late.markedLate).toBe(true);
    // Köad: skickas efter start men trycktes före. markedAt avgör.
    const queued = rowOf(await put(userA, { markedAt: new Date(firstStart.getTime() - 1).toISOString() }, after));
    expect(queued.markedLate).toBe(false);
    await deleteSubmittedRow(db, userA, roundId);
  });

  it("ingen tidsspärr: PUT efter sista start svarar 200", async () => {
    const later = new Date(firstStart.getTime() + 24 * 3600_000);
    const row = rowOf(await put(userA, { markedAt: later.toISOString() }, later));
    expect(row.markedLate).toBe(true);
    await deleteSubmittedRow(db, userA, roundId);
  });

  it("struken häst är tillåten och kopian ändras inte när hästen stryks efteråt", async () => {
    const race = await db.race.findFirstOrThrow({ where: { roundId, leg: 1 }, include: { starts: { orderBy: { number: "asc" } } } });
    const start = race.starts[0];
    rowOf(await put(userA));
    await db.start.update({ where: { id: start.id }, data: { scratched: true } });
    const res = await buildRoundResponse(db, roundId, userA, sunday);
    expect(res!.submittedRow!.selections["1"]).toEqual([start.number]);
    expect(res!.submittedRow!.rows).toBe(1);
    // Ny markering av en redan struken häst går också.
    rowOf(await put(userA));
    await db.start.update({ where: { id: start.id }, data: { scratched: false } });
    await deleteSubmittedRow(db, userA, roundId);
  });

  it("fel: nummer, lopp, omgång", async () => {
    const legOne = await db.race.findFirstOrThrow({ where: { roundId, leg: 1 }, include: { starts: true } });
    const bad = Math.max(...legOne.starts.map((s) => s.number)) + 1;
    const noStart = await put(userA, { selections: { ...selections, "1": [bad] } });
    expect(noStart.status).toBe(400);
    expect(errorOf(noStart)).toBe(`Startnummer ${bad} finns inte i V85-1.`);

    const { "3": _drop, ...noLeg } = selections;
    const empty = await put(userA, { selections: noLeg });
    expect(empty.status).toBe(400);
    expect(errorOf(empty)).toBe("V85-3 har inga hästar i raden.");

    const nine = await put(userA, { selections: { ...selections, "9": [1] } });
    expect(errorOf(nine)).toBe("V85-9 finns inte i omgången.");

    const missing = await put(userA, {}, sunday, "c".repeat(25));
    expect(missing.status).toBe(404);
    expect(errorOf(missing)).toBe("Omgången finns inte.");

    expect(await db.submittedRow.count({ where: { userId: userA } })).toBe(0);
  });

  it("V75 har sju lopp", async () => {
    await db.round.update({ where: { id: roundId }, data: { gameType: "V75" } });
    const res = await put(userA);
    await db.round.update({ where: { id: roundId }, data: { gameType: "V85" } });
    expect(res.status).toBe(400);
    expect(errorOf(res)).toBe("V75-8 finns inte i omgången.");
  });

  it("DELETE utan rad svarar ok, med och utan omgång", async () => {
    expect(await deleteSubmittedRow(db, userA, roundId)).toEqual({ status: 200, body: { ok: true } });
    expect(await deleteSubmittedRow(db, userA, "c".repeat(25))).toEqual({ status: 200, body: { ok: true } });
  });

  it("befintlig Coupon med copiedSelections är oförändrad, åt båda hållen", async () => {
    const saved = await saveCoupon(db, userA, roundId, { budget: 100, rowPrice: 0.5, selections, lockedLegs: [], copiedAt: "2026-10-19T17:00:00.000Z", copiedSelections: selections }, sunday);
    expect(saved.status).toBe(200);
    const coupon = await db.coupon.findUniqueOrThrow({ where: { userId_roundId: { userId: userA, roundId } } });

    rowOf(await put(userA));
    await deleteSubmittedRow(db, userA, roundId);
    rowOf(await put(userA));
    const untouched = await db.coupon.findUniqueOrThrow({ where: { userId_roundId: { userId: userA, roundId } } });
    expect(untouched).toEqual(coupon);

    // Arbetsraden ändras: kopian står kvar.
    const changed = { ...selections, "1": [selections["1"][0], selections["1"][0] + 1] };
    expect((await saveCoupon(db, userA, roundId, { budget: 100, rowPrice: 0.5, selections: changed, lockedLegs: [] }, sunday)).status).toBe(200);
    const res = await buildRoundResponse(db, roundId, userA, sunday);
    expect(res!.submittedRow!.selections).toEqual(selections);
    expect(res!.coupon!.selections["1"]).toHaveLength(2);
    expect(res!.coupon!.copiedSelections).toEqual(selections);
    await deleteSubmittedRow(db, userA, roundId);
    await db.coupon.delete({ where: { id: coupon.id } });
  });

  it("databasen stoppar ogiltiga värden", async () => {
    const base = { userId: userA, roundId, selections, rows: 1, cost: 1, rowPrice: 1, markedAt: sunday };
    await expect(db.submittedRow.create({ data: { ...base, rows: 0 } })).rejects.toThrow();
    await expect(db.submittedRow.create({ data: { ...base, cost: -1 } })).rejects.toThrow();
    await expect(db.submittedRow.create({ data: { ...base, rowPrice: 0 } })).rejects.toThrow();
    await db.submittedRow.create({ data: base });
    await expect(db.submittedRow.create({ data: base })).rejects.toThrow(/Unique constraint/);
    await db.submittedRow.deleteMany({ where: { userId: userA } });
  });

  it("RLS är på och tabellen saknar policies", async () => {
    const [t] = await db.$queryRaw<{ rls: boolean }[]>`SELECT c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'spelvarde' AND c.relname = 'SubmittedRow'`;
    expect(t.rls).toBe(true);
    const [p] = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'spelvarde' AND tablename = 'SubmittedRow'`;
    expect(p.n).toBe(0);
    const [none] = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'spelvarde' AND c.relkind = 'r' AND NOT c.relrowsecurity`;
    expect(none.n).toBe(0);
  });

  it("en roll utan ägarskap ser inga rader, och får inte skriva", async () => {
    rowOf(await put(userA));
    await db.$executeRawUnsafe(`CREATE ROLE e8_klient NOLOGIN`);
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "spelvarde" TO e8_klient`);
    await db.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON "spelvarde"."SubmittedRow" TO e8_klient`);
    // Även med full GRANT, som Supabases API-roller kan ha, stänger RLS utan policy.
    const seen = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE e8_klient`);
      return tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "spelvarde"."SubmittedRow"`);
    });
    expect(seen[0].n).toBe(0);
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE e8_klient`);
        await tx.$executeRawUnsafe(`INSERT INTO "spelvarde"."SubmittedRow" ("id","userId","roundId","selections","rows","cost","rowPrice","markedAt","updatedAt") VALUES ('x','${userB}','${roundId}','{}',1,1,1,now(),now())`);
      }),
    ).rejects.toThrow(/row-level security/);
    await db.submittedRow.deleteMany({ where: { userId: userA } });
  });

  it("GET /api/rounds/[id] innehåller submittedRow, null utan rad, och träffräkningen tar svaret", async () => {
    const none = await buildRoundResponse(db, roundId, userA, sunday);
    expect(none!.submittedRow).toBeNull();
    rowOf(await put(userA));
    const res = await buildRoundResponse(db, roundId, userA, sunday);
    expect(res!.submittedRow).toMatchObject({ roundId, rows: 1, cost: 0.5, rowPrice: 0.5, markedLate: false });
    expect(Object.keys(res!.submittedRow!).sort()).toEqual(["cost", "markedAt", "markedLate", "roundId", "rowPrice", "rows", "selections", "updatedAt"]);
    // RaceDto och SubmittedRowDto passar winnersInRow. Inget är visat än.
    expect(winnersInRow(res!.submittedRow, res!.races, []).text).toBe("Raden: 0 rätt av 0 visade");
    await deleteSubmittedRow(db, userA, roundId);
  });

  it("fasraden visar första start, och fasen är Odds fram till dess", async () => {
    const just = new Date(firstStart.getTime() - 1000);
    const res = await buildRoundResponse(db, roundId, userA, just);
    expect(res!.phase).toBe("ODDS");
    expect(res!.phaseRail.find((s) => s.phase === "LIVE")!.from).toBe(firstStart.toISOString());
    const at = await buildRoundResponse(db, roundId, userA, firstStart);
    expect(at!.phase).toBe("LIVE");
  });

  it("radering av omgång och användare tar bort raden", async () => {
    rowOf(await put(userA));
    rowOf(await put(userB));
    await db.user.delete({ where: { id: userB } });
    expect(await db.submittedRow.count({ where: { userId: userB } })).toBe(0);
    expect(await db.submittedRow.count({ where: { userId: userA } })).toBe(1);
    await db.round.delete({ where: { id: roundId } });
    expect(await db.submittedRow.count()).toBe(0);
  });
});
