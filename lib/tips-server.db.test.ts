// Integrationstest av Hämta tips (E5) mot en riktig Postgres, i samma stil
// som lib/fetch-round.db.test.ts: en egen, tillfällig Postgres
// (embedded-postgres), migreringarna med `prisma migrate deploy`, och allt
// tas bort efteråt. Travstugan och AI:n matas från fixturläget i lib/deps.ts
// (test/fixtures/travstugan och test/fixtures/tips-ai) – inga nätverksanrop
// och ingen nyckel. Hoppa över med SKIP_DB_TESTS=1.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AtgFetch } from "@/lib/atg";
import { fixtureAi, fixtureFetchPage, fixtureRobots } from "@/lib/deps";
import { fetchGameStep } from "@/lib/fetch-round";
import { buildRoundResponse, buildStartDetail } from "@/lib/round-server";
import { AiError, type TipsAi } from "@/lib/tips/ai";
import { textHash } from "@/lib/tips/text";
import {
  approveSure,
  approveTip,
  buildTipsResponse,
  editTip,
  interpretArticle,
  previewSource,
  rejectTip,
  scanSource,
  undoTips,
  type ErrorBody,
  type Reply,
  type TipsDeps,
} from "@/lib/tips-server";
import type { TipActionResponse, TipDto, TipInterpretResponse, TipPreviewResponse, TipScanResponse, TipsResponse } from "@/lib/types";

const ROOT = path.join(__dirname, "..");
const FX = path.join(ROOT, "test", "fixtures");
const skip = process.env.SKIP_DB_TESTS === "1";
const game = JSON.parse(readFileSync(path.join(FX, "atg", "game-V85_2026-10-31_78_5-foreign.json"), "utf8"));
const GAME_ID = "V85_2026-10-31_78_5";
const html = (f: string) => readFileSync(path.join(FX, "travstugan", f), "utf8");

// Svaret när det är 200, annars ett fel i testet.
function body<T>(r: Reply<T>): T {
  if (r.status !== 200) throw new Error(`status ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body as T;
}
const errOf = (r: Reply<unknown>) => r.body as ErrorBody;

describe.skipIf(skip)("Hämta tips mot Postgres", () => {
  let pg: { stop(): Promise<void> } | null = null;
  let db: PrismaClientType;
  let dir = "";
  let userId = "";
  let otherUserId = "";
  let roundId = "";
  let tsId = "";
  let syntId = "";
  let offId = "";
  // Klockan styrs av testet: tisdag 27 okt 21:00 svensk tid.
  let clock = new Date("2026-10-27T20:00:00Z");
  const tick = (ms: number) => (clock = new Date(clock.getTime() + ms));

  // Sidorna: fixturerna, plus det som ett test lägger till (slutliga tips, ändrad text).
  const extraPages = new Map<string, string>();
  const fetchPage: TipsDeps["fetchPage"] = async (url) => {
    const p = new URL(url).pathname;
    if (extraPages.has(p)) return { url, html: extraPages.get(p)! };
    return fixtureFetchPage(url);
  };
  // AI:n: fixturerna, plus svar per textHash som ett test lägger till. Räknar anropen.
  const extraAi = new Map<string, unknown>();
  let aiCalls = 0;
  const ai: TipsAi = async (req) => {
    aiCalls++;
    const extra = extraAi.get(req.textHash);
    if (extra instanceof Error) throw extra;
    if (extra) return { input: extra, stopReason: "tool_use", inputTokens: 9000, outputTokens: 800, model: "claude-sonnet-5-5" };
    return fixtureAi(req);
  };
  const deps = (over: Partial<TipsDeps> = {}): TipsDeps => ({ db, fetchPage, fetchRobots: fixtureRobots, ai, settings: { limit: 20, priceIn: 3, priceOut: 15 }, now: () => clock, warn: () => {}, ...over });

  beforeAll(async () => {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    dir = mkdtempSync(path.join(os.tmpdir(), "spelvarde-tips-"));
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
    const atg: AtgFetch = async (p) => {
      if (p.startsWith("games/")) return structuredClone(game);
      throw new Error(`okänd sökväg ${p}`);
    };
    const res = await fetchGameStep({ db, atg, ts: async () => "", now: () => clock }, { gameId: GAME_ID, userId, skipRiktodds: true });
    roundId = res!.roundId;
    tsId = (await db.source.create({ data: { userId, name: "Travstugan", url: "https://travstugan.se/v85", sortOrder: 0 } })).id;
    // En sida som läses direkt: den syntetiska artikeln (mockupens meningar).
    syntId = (await db.source.create({ data: { userId, name: "Syntet", url: "https://travstugan.se/syntetisk-tidiga", kind: "PAGE", sortOrder: 1 } })).id;
    offId = (await db.source.create({ data: { userId, name: "Av", url: "https://travstugan.se/v85?x=1", enabled: false, sortOrder: 2 } })).id;
  });

  afterAll(async () => {
    await db?.$disconnect();
    await pg?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const tips = async () => body(await buildTipsResponse(deps(), { userId, roundId }));
  const tipBy = (list: TipDto[], name: string, sourceId = tsId) => list.find((t) => t.rawHorseName.toLowerCase() === name.toLowerCase() && t.sourceId === sourceId)!;
  const startId = async (leg: number, number: number) => (await db.start.findFirstOrThrow({ where: { race: { roundId, leg }, number } })).id;
  const startTip = async (leg: number, number: number) => {
    const r = (await buildRoundResponse(db, roundId, userId, clock))!;
    return r.races.find((x) => x.leg === leg)!.starts.find((s) => s.number === number)!.tip ?? null;
  };

  it("de nya tabellerna har RLS, och TipFact är orörd", async () => {
    const rows = await db.$queryRaw<{ relname: string; rls: boolean }[]>`SELECT c.relname, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'spelvarde' AND c.relname IN ('TipArticle', 'Tip', 'AiUsage', 'TipFact') ORDER BY c.relname`;
    expect(rows).toEqual([
      { relname: "AiUsage", rls: true },
      { relname: "Tip", rls: true },
      { relname: "TipArticle", rls: true },
      { relname: "TipFact", rls: true },
    ]);
    expect(await db.source.findUniqueOrThrow({ where: { id: tsId } })).toMatchObject({ kind: null, lastArticleCount: null });
  });

  it("Provläs visar länkarna och skälen utan att spara något", async () => {
    const r = body<TipPreviewResponse>(await previewSource(deps(), { userId, sourceId: tsId, roundId }));
    expect(r.ok).toBe(true);
    expect(r.links[0]).toMatchObject({ url: "https://travstugan.se/tidiga-v85-baronen-ar-guldet", title: "TIDIGA V85: Baronen är Guldet!?", relevant: true, reason: null });
    expect(r.links.find((l) => l.url.endsWith("/korrigering-pa-v85"))).toMatchObject({ relevant: false, reason: "nämner 0 av omgångens hästar" });
    expect(r.links.find((l) => l.url.endsWith("/fem-tippar-v85-hemmastallet-i-slutet"))?.reason).toBe("artikeln innehöll för lite text, kanske kräver den inloggning.");
    expect(await db.tipArticle.count()).toBe(0);
    expect((await db.source.findUniqueOrThrow({ where: { id: tsId } })).lastReadAt).toBeNull();
    expect(errOf(await previewSource(deps(), { userId, sourceId: tsId, roundId: null })).code).toBe("NO_ROUND");
  });

  let tidigaId = "";
  it("hämta källa: samlingssidan ger veckans artikel, och spärren gäller i 60 s", async () => {
    const r = body<TipScanResponse>(await scanSource(deps(), { userId, roundId, sourceId: tsId }));
    expect(r).toMatchObject({ ok: true, status: "ok", quota: { used: 0, limit: 20, resetsAt: "2026-10-27T23:00:00.000Z" } });
    const a = r.articles.find((x) => x.url.endsWith("/tidiga-v85-baronen-ar-guldet"))!;
    expect(a).toMatchObject({ change: "new", needsAi: true, stage: "EARLY", title: "TIDIGA V85: Baronen är Guldet!?" });
    expect(r.irrelevant).toBeGreaterThan(0);
    tidigaId = a.articleId;
    expect(await db.source.findUniqueOrThrow({ where: { id: tsId } })).toMatchObject({ lastStatus: "OK", lastError: null, lastArticleCount: r.articles.length, lastReadAt: clock });

    const again = await scanSource(deps(), { userId, roundId, sourceId: tsId });
    expect(again.status).toBe(429);
    expect(errOf(again)).toMatchObject({ code: "SCAN_LOCKED", retryAfterSec: 60, error: "Nyss läst. Försök igen om 60 s." });
    tick(61_000);
    const third = body<TipScanResponse>(await scanSource(deps(), { userId, roundId, sourceId: tsId }));
    expect(third.articles.find((x) => x.articleId === tidigaId)).toMatchObject({ change: "unchanged", needsAi: true });
    expect(errOf(await scanSource(deps(), { userId, roundId, sourceId: offId })).code).toBe("SOURCE_DISABLED");
  });

  it("tolka artikel: 8 tips att granska, 5 säkra, och läsningen räknas med tokens och kostnad", async () => {
    aiCalls = 0;
    const r = body<TipInterpretResponse>(await interpretArticle(deps(), { userId, articleId: tidigaId }));
    expect(r).toMatchObject({ ok: true, created: 8, discarded: 0, skippedStarted: 0, truncated: false, cutOff: false, unlinked: 0, quota: { used: 1, limit: 20 } });
    expect(r.tips.every((t) => t.review === "PENDING")).toBe(true);
    expect(r.tips.filter((t) => t.match === "SURE").map((t) => t.horseName).sort()).toEqual(["Gigant Tider", "Jaguar Godiva", "Mimosa to Martini", "Peacekeeper", "Peggy Boko"]);
    expect(tipBy(r.tips, "Baron Tilly")).toMatchObject({ match: "UNSURE", flagText: 'Osäker roll: texten säger "lösningen", som tolkades som Spik.', startLeg: 4, startNumber: 1 });
    const usage = await db.aiUsage.findMany({ where: { userId } });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ ok: true, purpose: "TIPS", model: "claude-sonnet-5-5", inputTokens: 9000, outputTokens: 800, articleId: tidigaId, roundId });
    expect(Number(usage[0].costUsd)).toBe(0.039);
    expect(await db.tipArticle.findUniqueOrThrow({ where: { id: tidigaId } })).toMatchObject({ status: "INTERPRETED", tipCount: 8, discarded: 0 });
    expect((await db.source.findUniqueOrThrow({ where: { id: tsId } })).lastFactCount).toBe(8);
  });

  it("samma text skickas inte två gånger", async () => {
    const before = aiCalls;
    const r = await interpretArticle(deps(), { userId, articleId: tidigaId });
    expect(r.status).toBe(409);
    expect(errOf(r)).toMatchObject({ code: "UNCHANGED", error: "Artikeln är redan läst." });
    tick(61_000);
    const scan = body<TipScanResponse>(await scanSource(deps(), { userId, roundId, sourceId: tsId }));
    expect(scan.articles.find((x) => x.articleId === tidigaId)).toMatchObject({ change: "unchanged", needsAi: false });
    expect(aiCalls).toBe(before);
    expect(await db.aiUsage.count({ where: { userId } })).toBe(1);
  });

  it("listan: inget räknas eller syns förrän det är godkänt", async () => {
    const r = await tips();
    expect(r.counts).toEqual({ pending: 8, pendingSure: 5, pendingUnsure: 3, approved: 0, approvedHorses: 0 });
    expect(r.articles.map((a) => a.title)).toContain("TIDIGA V85: Baronen är Guldet!?");
    expect(r.lastSourceName).toBe("Travstugan");
    expect(await startTip(6, 3)).toBeNull();
    const round = (await buildRoundResponse(db, roundId, userId, clock))!;
    expect(round.tips).toMatchObject({ approved: 0, horses: 0, pending: 8, lastSourceName: "Travstugan", sourcesRead: 1 });
    const detail = (await buildStartDetail(db, await startId(6, 3), userId, clock))!;
    expect(detail).toMatchObject({ tips: [], tipSourceCount: null, tipsPending: 1 });
    // Den andra användaren ser inget och kan inte röra tipsen.
    expect(body(await buildTipsResponse(deps(), { userId: otherUserId, roundId })).tips).toEqual([]);
    expect((await approveTip(deps(), { userId: otherUserId, tipId: tipBy(r.tips, "Peggy Boko").id })).status).toBe(404);
  });

  it("samma text på en annan adress: DUPLICATE, ingen AI-läsning", async () => {
    const before = aiCalls;
    extraPages.set("/kopia-av-tidiga", html("tidiga-v85-baronen-ar-guldet.html").replaceAll('"https://travstugan.se/tidiga-v85-baronen-ar-guldet"', '"https://travstugan.se/kopia-av-tidiga"'));
    const copySrc = (await db.source.create({ data: { userId, name: "Kopia", url: "https://travstugan.se/kopia-av-tidiga", kind: "PAGE", sortOrder: 3 } })).id;
    const copy = body<TipScanResponse>(await scanSource(deps(), { userId, roundId, sourceId: copySrc }));
    expect(copy.articles[0]).toMatchObject({ change: "duplicate", needsAi: false, url: "https://travstugan.se/kopia-av-tidiga" });
    expect(errOf(await interpretArticle(deps(), { userId, articleId: copy.articles[0].articleId })).code).toBe("DUPLICATE");
    expect(aiCalls).toBe(before);
    expect(await db.aiUsage.count({ where: { userId } })).toBe(1);
    await db.source.delete({ where: { id: copySrc } });
  });

  it("godkänn alla säkra, och ångra", async () => {
    const r = body<TipActionResponse>(await approveSure(deps(), { userId, roundId }));
    expect(r.tips).toHaveLength(5);
    expect(r.tips.every((t) => t.review === "APPROVED" && t.canUndo)).toBe(true);
    expect(r.affected.find((a) => a.startId === tipBy(r.tips, "Peggy Boko").startId)?.tip).toEqual({ role: "SPIK", sources: 1, support: 1 });
    expect(await startTip(1, 1)).toEqual({ role: "NAMND", sources: 1, support: 0 });
    expect((await tips()).counts).toEqual({ pending: 3, pendingSure: 0, pendingUnsure: 3, approved: 5, approvedHorses: 5 });

    const undo = body<TipActionResponse>(await undoTips(deps(), { userId, ids: r.tips.map((t) => t.id) }));
    expect(undo.tips.every((t) => t.review === "PENDING" && !t.canUndo && t.reviewedAt === null)).toBe(true);
    expect(await startTip(6, 3)).toBeNull();
    expect(errOf(await undoTips(deps(), { userId, ids: r.tips.map((t) => t.id) })).code).toBe("NOTHING_TO_UNDO");
    // Godkänn igen inför resten av testet.
    expect(body<TipActionResponse>(await approveSure(deps(), { userId, roundId })).tips).toHaveLength(5);
  });

  it("rätta: ny roll godkänner och gör tipset säkert", async () => {
    const baron = tipBy((await tips()).tips, "Baron Tilly");
    expect(errOf(await editTip(deps(), { userId, tipId: baron.id, role: "LÅS" })).error).toBe("Okänd roll.");
    expect(errOf(await editTip(deps(), { userId, tipId: baron.id, startId: "c0000000000000000000000x" })).error).toBe("Starten finns inte i omgången.");
    const r = body<TipActionResponse>(await editTip(deps(), { userId, tipId: baron.id, role: "FAVORIT" }));
    expect(r.tips[0]).toMatchObject({ review: "APPROVED", role: "FAVORIT", aiRole: "SPIK", editedByUser: true, match: "SURE", flags: [], flagText: null });
    expect(r.affected).toEqual([{ startId: baron.startId, tip: { role: "FAVORIT", sources: 1, support: 1 } }]);
  });

  it("en andra källa: källstödet räknar varje källa en gång, och bara godkända", async () => {
    body<TipScanResponse>(await scanSource(deps(), { userId, roundId, sourceId: syntId }));
    const art = await db.tipArticle.findFirstOrThrow({ where: { sourceId: syntId } });
    const r = body<TipInterpretResponse>(await interpretArticle(deps(), { userId, articleId: art.id }));
    expect(r.created).toBe(7);
    // I den riktiga omgången finns ingen Mellby Harley: ej kopplad och utan förslag.
    const mh = tipBy(r.tips, "Mellby Harly", syntId);
    expect(mh).toMatchObject({ match: "NONE", startId: null, suggestion: null, flagText: "Kunde inte kopplas till en häst i omgången." });
    expect(errOf(await approveTip(deps(), { userId, tipId: mh.id })).code).toBe("NOT_LINKED");
    expect(await startTip(6, 3)).toEqual({ role: "SPIK", sources: 1, support: 1 });
    body(await approveSure(deps(), { userId, roundId, articleId: art.id }));
    expect(await startTip(6, 3)).toEqual({ role: "SPIK", sources: 2, support: 2 });
    // Välj: koppla det ej kopplade tipset till en häst.
    const choose = body<TipActionResponse>(await editTip(deps(), { userId, tipId: mh.id, startId: await startId(3, 5) }));
    expect(choose.tips[0]).toMatchObject({ review: "APPROVED", horseName: "Lapin Kulta Sox", match: "SURE", editedByUser: true });
    // En avstängd källa räknas inte.
    await db.source.update({ where: { id: syntId }, data: { enabled: false } });
    expect(await startTip(6, 3)).toEqual({ role: "SPIK", sources: 1, support: 1 });
    await db.source.update({ where: { id: syntId }, data: { enabled: true } });
    const detail = (await buildStartDetail(db, await startId(6, 3), userId, clock))!;
    expect(detail.tips.map((t) => t.sourceName).sort()).toEqual(["Syntet", "Travstugan"]);
    expect(detail).toMatchObject({ tipSourceCount: 2, tipsPending: 0, start: { tip: { role: "SPIK", sources: 2, support: 2 } } });
  });

  let finalPeggy = "";
  it("en senare artikel från samma källa ersätter rollen, och ta bort gör den gamla gällande igen", async () => {
    // Slutliga tips: en ny artikel på samlingssidan.
    tick(24 * 3600_000);
    const finalHtml = html("syntetisk-tidiga.html")
      .replaceAll("Tidiga V85: Baronen är guldet", "Slutliga V85: Bjerke lördag")
      .replace("2026-10-27T08:30:00+01:00", "2026-10-28T18:00:00+01:00")
      .replace("https://travstugan.se/syntetisk-tidiga", "https://travstugan.se/slutliga-v85-bjerke");
    extraPages.set("/slutliga-v85-bjerke", finalHtml);
    extraPages.set("/v85", html("v85.html").replace("<article", '<a href="/slutliga-v85-bjerke">Slutliga V85 tips</a><article'));
    const scan = body<TipScanResponse>(await scanSource(deps(), { userId, roundId, sourceId: tsId }));
    const fin = scan.articles.find((a) => a.url.endsWith("/slutliga-v85-bjerke"))!;
    expect(fin).toMatchObject({ change: "new", needsAi: true, stage: "FINAL" });
    const fa = await db.tipArticle.findUniqueOrThrow({ where: { id: fin.articleId } });
    extraAi.set(fa.textHash, {
      tips: [
        { leg: 6, number: 3, horseName: "Peggy Boko", role: "NAMND", roleWord: null, quote: "Peggy Boko är ett lås i sexan." },
        { leg: 7, number: 3, horseName: "Blizzard Diamant", role: "FAVORIT", roleWord: "favorit", quote: "Blizzard Diamant är rättmätig favorit, men vi gillar inte spåret." },
      ],
    });
    const r = body<TipInterpretResponse>(await interpretArticle(deps(), { userId, articleId: fin.articleId }));
    expect(r.created).toBe(2);
    const list = (await tips()).tips;
    const early = list.find((t) => t.articleId === tidigaId && t.horseName === "Peggy Boko")!;
    const pend = list.find((t) => t.articleId === fin.articleId && t.horseName === "Peggy Boko")!;
    finalPeggy = pend.id;
    expect(pend.replaces).toMatchObject({ id: early.id, role: "SPIK", stage: "EARLY", articleTitle: "TIDIGA V85: Baronen är Guldet!?" });
    // Det väntande tidiga tipset om Blizzard Diamant ersätts direkt av det slutliga.
    const oldBlizzard = list.find((t) => t.articleId === tidigaId && t.horseName === "Blizzard Diamant")!;
    expect(oldBlizzard).toMatchObject({ review: "PENDING", superseded: { role: "FAVORIT", articleTitle: "Slutliga V85: Bjerke lördag" } });

    const ok1 = body<TipActionResponse>(await approveTip(deps(), { userId, tipId: pend.id }));
    expect(ok1.message).toBeUndefined();
    // Travstugan säger nu Nämnd, Syntet säger fortfarande Spik.
    expect(await startTip(6, 3)).toEqual({ role: "SPIK", sources: 2, support: 1 });
    const hist = (await buildStartDetail(db, await startId(6, 3), userId, clock))!.tips;
    // Gällande först, nyast först: de slutliga tipsen (28 okt) före Syntet (27 okt), sist historiken.
    expect(hist.map((t) => [t.sourceName, t.role, t.superseded === null])).toEqual([
      ["Travstugan", "NAMND", true],
      ["Syntet", "SPIK", true],
      ["Travstugan", "SPIK", false],
    ]);

    // Godkänn den tidiga igen: ett nyare tips gäller redan, så den blir historik direkt.
    const older = body<TipActionResponse>(await approveTip(deps(), { userId, tipId: early.id }));
    expect(older.message).toBe("Ett nyare tips från Travstugan gäller redan.");
    expect(older.tips[0].superseded?.byId).toBe(pend.id);

    const del = body<TipActionResponse>(await rejectTip(deps(), { userId, tipId: pend.id }));
    expect(del.tips[0].review).toBe("REJECTED");
    expect(await startTip(6, 3)).toEqual({ role: "SPIK", sources: 2, support: 2 });
    expect((await tips()).tips.find((t) => t.id === pend.id)).toBeUndefined();

    const back = body<TipActionResponse>(await undoTips(deps(), { userId, ids: [pend.id] }));
    expect(back.tips[0]).toMatchObject({ review: "APPROVED", superseded: null });
    expect(await startTip(6, 3)).toEqual({ role: "SPIK", sources: 2, support: 1 });
  });

  it("ändrad artikel: läses igen, väntande tips från förra versionen tas bort, godkända står kvar", async () => {
    tick(61_000);
    const changed = html("tidiga-v85-baronen-ar-guldet.html").replace("Jag tror han minst är ett platsbud här", "Jag tror han minst är ett platsbud här, och han kan vinna");
    extraPages.set("/tidiga-v85-baronen-ar-guldet", changed);
    const scan = body<TipScanResponse>(await scanSource(deps(), { userId, roundId, sourceId: tsId }));
    expect(scan.articles.find((a) => a.articleId === tidigaId)).toMatchObject({ change: "changed", needsAi: true });
    const approvedBefore = await db.tip.count({ where: { articleId: tidigaId, review: "APPROVED" } });
    const pendingBefore = await db.tip.findMany({ where: { articleId: tidigaId, review: "PENDING" }, select: { id: true } });
    expect(pendingBefore.length).toBeGreaterThan(0);
    const usage = await db.aiUsage.count({ where: { userId } });
    const r = body<TipInterpretResponse>(await interpretArticle(deps(), { userId, articleId: tidigaId }));
    expect(r.created).toBe(0);
    expect(await db.aiUsage.count({ where: { userId } })).toBe(usage + 1);
    expect(await db.tip.count({ where: { id: { in: pendingBefore.map((t) => t.id) } } })).toBe(0);
    expect(await db.tip.count({ where: { articleId: tidigaId, review: "APPROVED" } })).toBe(approvedBefore);
    extraPages.delete("/tidiga-v85-baronen-ar-guldet");
  });

  it("dygnsgränsen: misslyckade anrop räknas, den 21:a nekas, parallella anrop vid 19 ger en lyckad och en 429, och gränsen nollställs vid midnatt", async () => {
    // Saknad nyckel: inget anrop, inget räknas.
    const mk = async (text: string) =>
      (
        await db.tipArticle.create({
          data: { userId, sourceId: tsId, roundId, url: `https://travstugan.se/x-${textHash(text).slice(0, 8)}`, title: "X", stage: "FINAL", text, textHash: textHash(text) },
        })
      ).id;
    const a1 = await mk("Artikel ett om Peggy Boko och Baron Tilly på Bjerke.");
    const used0 = await db.aiUsage.count({ where: { userId } });
    const todayBefore = (await tips()).quota.used;
    expect(errOf(await interpretArticle(deps({ ai: null }), { userId, articleId: a1 })).code).toBe("AI_NOT_CONFIGURED");
    expect(await db.aiUsage.count({ where: { userId } })).toBe(used0);

    // Ett misslyckat anrop räknas och ger FAILED.
    const t1 = await db.tipArticle.findUniqueOrThrow({ where: { id: a1 } });
    extraAi.set(t1.textHash, new AiError(504, "AI:n svarade inte inom 50 sekunder."));
    const failed = await interpretArticle(deps(), { userId, articleId: a1 });
    expect(failed.status).toBe(504);
    expect(errOf(failed)).toMatchObject({ code: "AI_ERROR", error: 'AI:n kunde inte tolka "X". AI:n svarade inte inom 50 sekunder. Försök igen räknas som en ny läsning.', quota: { used: todayBefore + 1 } });
    expect(await db.aiUsage.findFirstOrThrow({ where: { articleId: a1 } })).toMatchObject({ ok: false, error: "AI:n svarade inte inom 50 sekunder." });
    expect((await db.tipArticle.findUniqueOrThrow({ where: { id: a1 } })).status).toBe("FAILED");

    // Fyll upp till 19 av 20 i dag, och lägg en gammal rad från i går som inte räknas.
    const today = await db.aiUsage.count({ where: { userId, startedAt: { gte: new Date("2026-10-27T23:00:00Z") } } });
    await db.aiUsage.createMany({ data: Array.from({ length: 19 - today }, () => ({ userId, purpose: "TIPS", model: "claude-sonnet-5-5", startedAt: clock, finishedAt: clock, ok: true })) });
    await db.aiUsage.create({ data: { userId, purpose: "TIPS", model: "claude-sonnet-5-5", startedAt: new Date("2026-10-27T22:59:00Z"), ok: true } });
    const a2 = await mk("Artikel två om Peacekeeper på Bjerke.");
    const a3 = await mk("Artikel tre om Gigant Tider på Bjerke.");
    const [r2, r3] = await Promise.all([interpretArticle(deps(), { userId, articleId: a2 }), interpretArticle(deps(), { userId, articleId: a3 })]);
    expect([r2.status, r3.status].sort()).toEqual([200, 429]);
    const denied = [r2, r3].find((r) => r.status === 429)!;
    expect(errOf(denied)).toMatchObject({ code: "AI_QUOTA", error: "Dagens gräns för AI-läsning är nådd.", quota: { used: 20, limit: 20, resetsAt: "2026-10-28T23:00:00.000Z" } });
    expect((await tips()).quota).toEqual({ used: 20, limit: 20, resetsAt: "2026-10-28T23:00:00.000Z" });

    // Midnatt svensk tid: gränsen nollställs.
    const saved = clock;
    clock = new Date("2026-10-28T23:00:00Z");
    expect((await tips()).quota.used).toBe(0);
    clock = saved;
  });

  it("efter loppets start går tipsen i loppet inte att ändra", async () => {
    clock = new Date("2026-10-31T14:00:01Z"); // avd 1 startade 15:00 svensk tid
    const list = (await tips()).tips;
    const fly = tipBy(list, "Fly Express", syntId);
    expect(fly.locked).toBe(true);
    expect(errOf(await editTip(deps(), { userId, tipId: fly.id, role: "SKRALL" }))).toMatchObject({ code: "RACE_STARTED", error: "Loppet har startat." });
    expect((await rejectTip(deps(), { userId, tipId: fly.id })).status).toBe(409);
    // Rätta till en start i ett lopp som har startat.
    const baron = tipBy(list, "Baron Tilly");
    expect((await editTip(deps(), { userId, tipId: baron.id, startId: await startId(1, 2) })).status).toBe(409);
    // Godkänn alla hoppar över låsta.
    expect(body<TipActionResponse>(await approveSure(deps(), { userId, roundId })).tips.every((t) => t.startLeg !== 1)).toBe(true);
    const after = await tips();
    expect(after.counts.pendingSure).toBe(0);
    expect(after.tips.find((t) => t.id === fly.id)).toMatchObject({ review: "PENDING", locked: true, canUndo: false });
  });

  it("alla lopp har startat: inga fler läsningar", async () => {
    clock = new Date("2026-10-31T17:00:00Z");
    expect(errOf(await scanSource(deps(), { userId, roundId, sourceId: tsId }))).toMatchObject({ code: "ROUND_CLOSED", error: "Alla lopp har startat. Tips kan inte längre hämtas för omgången." });
    expect(finalPeggy).not.toBe("");
  });
});
