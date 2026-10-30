// Hämta tips (E5, docs/specs/e5-hamta-tips.md 6.11, 10.6, 10.7 och 12): läsning
// av källorna, AI-tolkningen, granskningen och läsningen för Källor, S1, S2
// och S3. Rutterna i app/api är tunna omslag; reglerna ligger här, så att de
// testas mot en riktig Postgres (lib/tips-server.db.test.ts).
//
// - Allt är per användare: varje fråga filtrerar på userId från sessionen.
// - Ingenting syns eller räknas förrän det är godkänt (Mikaels beslut 1).
// - Varje anrop som når Anthropic räknas mot dygnsgränsen, även misslyckade.
//   Reservationen görs under ett advisory lock per användare, så att två
//   parallella anrop vid 19 av 20 ger en lyckad och en 429.
// - Granskningens åtgärder tar ett advisory lock per användare och omgång,
//   så att ersättningskedjan (supersededById) inte kan blandas ihop av två
//   samtidiga anrop.

import { Prisma, type PrismaClient } from "@prisma/client";
import { TS_USER_AGENT } from "@/lib/travstatistik";
import { aiErrorOf, AI_ERR, TIPS_MODEL, type TipsAi } from "@/lib/tips/ai";
import { compareOrder, resolveSupersede, roundTipCounts, startTipSummary, type OrderInput } from "@/lib/tips/aggregate";
import { findArticleLinks, isRelevant, readerFor, type RelevanceRound } from "@/lib/tips/collection";
import { FETCH_ERR, TipFetchError } from "@/lib/tips/errors";
import type { FetchPage, FetchRobots } from "@/lib/tips/fetch-page";
import { flagShort, flagText } from "@/lib/tips/flags";
import { isTipFlag, type StartRef } from "@/lib/tips/match";
import { buildUserContent, systemPrompt } from "@/lib/tips/prompt";
import { aiSettings, costUsd, dayStart, nextDayStart } from "@/lib/tips/quota";
import { isAllowed } from "@/lib/tips/robots";
import { isTipRole, type TipRole } from "@/lib/tips/roles";
import { extractArticle, stageOf, textHash, type ExtractedArticle } from "@/lib/tips/text";
import { validateTips } from "@/lib/tips/validate";
import { DEFAULT_GAME_TYPE } from "@/lib/game-type";
import type {
  QuotaDto,
  RoundTipsDto,
  StartTipDto,
  TipActionResponse,
  TipArticleDto,
  TipDto,
  TipFlag,
  TipInterpretResponse,
  TipPreviewResponse,
  TipScanArticle,
  TipScanResponse,
  TipsResponse,
} from "@/lib/types";

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

export type TipsDeps = {
  db: Db;
  fetchPage: FetchPage;
  fetchRobots: FetchRobots;
  // null = ANTHROPIC_API_KEY saknas (503 AI_NOT_CONFIGURED, inget räknas).
  ai: TipsAi | null;
  aiModel?: string;
  settings?: { limit: number; priceIn: number; priceOut: number };
  warn?: (m: string) => void;
  now?: () => Date;
};

export type ErrorBody = { error: string; code?: string; retryAfterSec?: number; quota?: QuotaDto };
export type Reply<T> = { status: number; body: T | ErrorBody };

const ok = <T>(body: T): Reply<T> => ({ status: 200, body });
const fail = (status: number, error: string, extra: Omit<ErrorBody, "error"> = {}): Reply<never> => ({ status, body: { error, ...extra } });

export const SCAN_LOCK_MS = 60_000;
// Prismas standard (5 s) räcker inte för många tips mot driftdatabasen.
const TX_OPTS = { maxWait: 10_000, timeout: 30_000 };
export const MSG = {
  roundNotFound: "Omgången finns inte.",
  sourceNotFound: "Källan finns inte.",
  articleNotFound: "Artikeln finns inte.",
  tipNotFound: "Tipset finns inte.",
  sourceDisabled: "Källan är avstängd.",
  roundClosed: "Alla lopp har startat. Tips kan inte längre hämtas för omgången.",
  unchanged: "Artikeln är redan läst.",
  duplicate: "Artikeln har samma text som en annan artikel och läses inte.",
  busy: "Artikeln läses redan.",
  quota: "Dagens gräns för AI-läsning är nådd.",
  notConfigured: "Hämta tips är inte inställt. ANTHROPIC_API_KEY saknas i Vercel. Inget skickades.",
  raceStarted: "Loppet har startat.",
  notLinked: "Välj häst först.",
  rejected: "Tipset är borttaget.",
  nothingToUndo: "Det finns inget att ångra.",
  unknownRole: "Okänd roll.",
  unknownStart: "Starten finns inte i omgången.",
  emptyPatch: "Ange häst eller roll.",
} as const;

export const STEP_SCAN = "TIPS_SCAN";
export const STEP_AI = "TIPS_AI";

const nowOf = (deps: { now?: () => Date }) => deps.now?.() ?? new Date();
const settingsOf = (deps: TipsDeps) => deps.settings ?? aiSettings();
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const warnOf = (deps: TipsDeps) => deps.warn ?? ((m: string) => console.warn("[tips]", m));

// ---- Gemensamt ------------------------------------------------------------------------

export async function quotaOf(db: Db | Tx, userId: string, now: Date, limit: number): Promise<QuotaDto> {
  const used = await db.aiUsage.count({ where: { userId, startedAt: { gte: dayStart(now) } } });
  return { used, limit, resetsAt: nextDayStart(now).toISOString() };
}

const roundRaces = { races: { orderBy: { leg: "asc" }, include: { starts: { orderBy: { number: "asc" }, include: { horse: true } } } } } satisfies Prisma.RoundInclude;
type RoundWithStarts = Prisma.RoundGetPayload<{ include: typeof roundRaces }>;

const started = (startAt: Date, now: Date) => startAt.getTime() <= now.getTime();

function roundClosed(round: { finishedAt: Date | null; races: { startAt: Date }[] }, now: Date): boolean {
  if (round.finishedAt) return true;
  return round.races.length > 0 && round.races.every((r) => started(r.startAt, now));
}

function startRefs(round: RoundWithStarts): StartRef[] {
  return round.races.flatMap((r) => r.starts.map((s) => ({ startId: s.id, leg: r.leg, number: s.number, name: s.horse.name, scratched: s.scratched })));
}

function relevanceRound(round: RoundWithStarts): RelevanceRound {
  return { gameType: round.gameType, trackName: round.trackName, date: round.date.toISOString().slice(0, 10), horses: round.races.flatMap((r) => r.starts.map((s) => s.horse.name)) };
}

async function log(db: Db | Tx, data: { roundId: string; userId: string; step: string; startedAt: Date; ok: boolean; message: string | null; sourceId?: string; articleId?: string }) {
  const { sourceId, articleId, ...rest } = data;
  await db.fetchLog.create({ data: { ...rest, message: rest.message?.slice(0, 500) ?? null, finishedAt: new Date(), changes: { sourceId: sourceId ?? null, articleId: articleId ?? null } } });
}

async function refreshFactCount(db: Db | Tx, sourceId: string, roundId: string, userId: string) {
  const n = await db.tip.count({ where: { userId, sourceId, roundId, review: { in: ["PENDING", "APPROVED"] } } });
  await db.source.updateMany({ where: { id: sourceId, userId }, data: { lastFactCount: n } });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---- Läsning av en källa (10.6) ------------------------------------------------------------

type ReadItem = { url: string; title: string; publishedAt: Date | null; article: ExtractedArticle | null; relevant: boolean; reason: string | null };
type ReadResult = { ok: true; items: ReadItem[] } | { ok: false; error: string };

const reasonOf = (e: unknown) => (e instanceof TipFetchError ? e.reason : FETCH_ERR.unreachable);

async function readSource(deps: TipsDeps, source: { url: string; kind: "COLLECTION" | "PAGE" | null }, round: RelevanceRound, now: Date): Promise<ReadResult> {
  const robots = new Map<string, string | null>();
  const allowed = async (url: string) => {
    const u = new URL(url);
    if (!robots.has(u.origin)) robots.set(u.origin, await deps.fetchRobots(u.origin));
    return isAllowed(robots.get(u.origin), u.pathname + u.search, TS_USER_AGENT);
  };
  const asItem = (url: string, fallbackTitle: string, html: string): ReadItem => {
    const ex = extractArticle(html, url);
    if (!ex.ok) return { url, title: fallbackTitle, publishedAt: null, article: null, relevant: false, reason: ex.error };
    const rel = isRelevant(ex.article, round, now);
    return { url: ex.article.url, title: ex.article.title, publishedAt: ex.article.publishedAt, article: ex.article, relevant: rel.relevant, reason: rel.reason };
  };
  try {
    if (!(await allowed(source.url))) throw new TipFetchError(FETCH_ERR.robots);
    const page = await deps.fetchPage(source.url);
    if (readerFor(source) === "PAGE") {
      const item = asItem(page.url, source.url, page.html);
      if (!item.article) throw new TipFetchError(item.reason ?? FETCH_ERR.tooShort);
      return { ok: true, items: [item] };
    }
    const links = findArticleLinks(page.html, page.url, round);
    const items = await mapLimit(links, 3, async (l): Promise<ReadItem> => {
      try {
        if (!(await allowed(l.url))) return { url: l.url, title: l.title, publishedAt: null, article: null, relevant: false, reason: FETCH_ERR.robots };
        const p = await deps.fetchPage(l.url);
        return asItem(p.url, l.title, p.html);
      } catch (e) {
        warnOf(deps)(`${l.url}: ${reasonOf(e)}`);
        return { url: l.url, title: l.title, publishedAt: null, article: null, relevant: false, reason: reasonOf(e) };
      }
    });
    // Två länkar kan leda till samma kanoniska adress.
    const seen = new Set<string>();
    return { ok: true, items: items.filter((i) => (seen.has(i.url) ? false : (seen.add(i.url), true))) };
  } catch (e) {
    return { ok: false, error: reasonOf(e) };
  }
}

export async function scanSource(deps: TipsDeps, input: { userId: string; roundId: string; sourceId: string }): Promise<Reply<TipScanResponse>> {
  const { db } = deps;
  const now = nowOf(deps);
  const { userId } = input;
  const source = await db.source.findFirst({ where: { id: input.sourceId, userId } });
  if (!source) return fail(404, MSG.sourceNotFound);
  const round = await db.round.findUnique({ where: { id: input.roundId }, include: roundRaces });
  if (!round) return fail(404, MSG.roundNotFound);
  if (!source.enabled) return fail(409, MSG.sourceDisabled, { code: "SOURCE_DISABLED" });
  if (roundClosed(round, now)) return fail(409, MSG.roundClosed, { code: "ROUND_CLOSED" });

  // Spärren: högst en läsning per källa och 60 s. Villkorad uppdatering, så att två tryck inte båda går igenom.
  const claim = await db.source.updateMany({
    where: { id: source.id, userId, OR: [{ lastReadAt: null }, { lastReadAt: { lte: new Date(now.getTime() - SCAN_LOCK_MS) } }] },
    data: { lastReadAt: now },
  });
  if (claim.count === 0) {
    const fresh = await db.source.findUnique({ where: { id: source.id }, select: { lastReadAt: true } });
    const left = fresh?.lastReadAt ? fresh.lastReadAt.getTime() + SCAN_LOCK_MS - now.getTime() : SCAN_LOCK_MS;
    const retryAfterSec = Math.min(60, Math.max(1, Math.ceil(left / 1000)));
    return fail(429, `Nyss läst. Försök igen om ${retryAfterSec} s.`, { code: "SCAN_LOCKED", retryAfterSec });
  }

  const quota = () => quotaOf(db, userId, now, settingsOf(deps).limit);
  const read = await readSource(deps, source, relevanceRound(round), now);
  if (!read.ok) {
    await db.source.update({ where: { id: source.id }, data: { lastStatus: "ERROR", lastError: read.error } });
    await log(db, { roundId: round.id, userId, step: STEP_SCAN, startedAt: now, ok: false, message: read.error, sourceId: source.id });
    return ok({ sourceId: source.id, ok: false, status: "error", error: read.error, articles: [], irrelevant: 0, quota: await quota() });
  }

  const relevant = read.items.filter((i) => i.relevant && i.article);
  const articles: TipScanArticle[] = [];
  for (const item of relevant) {
    const a = item.article!;
    const hash = textHash(a.text);
    const existing = await db.tipArticle.findUnique({ where: { userId_roundId_url: { userId, roundId: round.id, url: a.url } } });
    const dup = await db.tipArticle.findFirst({ where: { userId, roundId: round.id, interpretedHash: hash, ...(existing ? { NOT: { id: existing.id } } : {}) }, select: { id: true } });
    let status: "NEW" | "INTERPRETED" | "FAILED" | "DUPLICATE";
    let change: TipScanArticle["change"];
    if (!existing) {
      [status, change] = dup ? ["DUPLICATE", "duplicate"] : ["NEW", "new"];
    } else if (existing.interpretedHash === hash) {
      [status, change] = ["INTERPRETED", "unchanged"];
    } else if (dup) {
      [status, change] = ["DUPLICATE", "duplicate"];
    } else if (existing.textHash === hash) {
      status = existing.status === "FAILED" ? "FAILED" : "NEW";
      change = "unchanged";
    } else {
      [status, change] = ["NEW", "changed"];
    }
    const data = {
      title: a.title,
      publishedAt: a.publishedAt,
      stage: stageOf(a.title),
      text: a.text,
      truncated: a.truncated,
      textHash: hash,
      status,
      error: status === "FAILED" ? existing?.error ?? null : null,
      lastSeenAt: now,
    } as const;
    const row = await db.tipArticle.upsert({
      where: { userId_roundId_url: { userId, roundId: round.id, url: a.url } },
      create: { ...data, userId, roundId: round.id, sourceId: source.id, url: a.url, firstSeenAt: now },
      update: data,
    });
    articles.push({ articleId: row.id, title: row.title, url: row.url, publishedAt: iso(row.publishedAt), stage: row.stage, change, needsAi: status === "NEW" || status === "FAILED" });
  }

  const status = articles.length ? "ok" : "noArticle";
  await db.source.update({ where: { id: source.id }, data: { lastStatus: articles.length ? "OK" : "NO_ARTICLE", lastError: null, lastArticleCount: articles.length } });
  await refreshFactCount(db, source.id, round.id, userId);
  await log(db, { roundId: round.id, userId, step: STEP_SCAN, startedAt: now, ok: true, message: `${articles.length} artiklar, ${read.items.length - relevant.length} gällde inte omgången`, sourceId: source.id });
  return ok({ sourceId: source.id, ok: true, status, articles, irrelevant: read.items.length - relevant.length, quota: await quota() });
}

// Provläs (POST /api/sources/[id]/preview): läser utan att spara något, utan AI och utan spärren.
export async function previewSource(deps: TipsDeps, input: { userId: string; sourceId: string; roundId: string | null }): Promise<Reply<TipPreviewResponse>> {
  const { db } = deps;
  const now = nowOf(deps);
  const source = await db.source.findFirst({ where: { id: input.sourceId, userId: input.userId } });
  if (!source) return fail(404, MSG.sourceNotFound);
  if (!input.roundId) return fail(409, "Hämta omgången först. Tips läses för en omgång i taget.", { code: "NO_ROUND" });
  const round = await db.round.findUnique({ where: { id: input.roundId }, include: roundRaces });
  if (!round) return fail(409, "Hämta omgången först. Tips läses för en omgång i taget.", { code: "NO_ROUND" });
  const read = await readSource(deps, source, relevanceRound(round), now);
  if (!read.ok) return ok({ sourceId: source.id, ok: false, error: read.error, links: [] });
  return ok({
    sourceId: source.id,
    ok: true,
    links: read.items.map((i) => ({ url: i.url, title: i.title, publishedAt: iso(i.publishedAt), relevant: i.relevant, reason: i.reason })),
  });
}

// ---- AI-tolkningen (10.7) -----------------------------------------------------------------

export async function interpretArticle(deps: TipsDeps, input: { userId: string; articleId: string }): Promise<Reply<TipInterpretResponse>> {
  const { db } = deps;
  const now = nowOf(deps);
  const { userId } = input;
  const { limit, priceIn, priceOut } = settingsOf(deps);
  const model = deps.aiModel ?? TIPS_MODEL;
  const article = await db.tipArticle.findFirst({ where: { id: input.articleId, userId }, include: { source: true, round: { include: roundRaces } } });
  if (!article) return fail(404, MSG.articleNotFound);
  const round = article.round;
  if (roundClosed(round, now)) return fail(409, MSG.roundClosed, { code: "ROUND_CLOSED" });
  if (article.status === "DUPLICATE") return fail(409, MSG.duplicate, { code: "DUPLICATE" });
  if (article.interpretedHash === article.textHash) return fail(409, MSG.unchanged, { code: "UNCHANGED" });
  const dup = await db.tipArticle.findFirst({ where: { userId, roundId: round.id, interpretedHash: article.textHash, NOT: { id: article.id } }, select: { id: true } });
  if (dup) {
    await db.tipArticle.update({ where: { id: article.id }, data: { status: "DUPLICATE" } });
    return fail(409, MSG.duplicate, { code: "DUPLICATE" });
  }
  if (!deps.ai) return fail(503, MSG.notConfigured, { code: "AI_NOT_CONFIGURED" });

  // 1. Reservation under lås: räkna dagens läsningar och skapa raden.
  const reserved = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"ai:" + userId}))`;
    const busy = await tx.aiUsage.findFirst({ where: { articleId: article.id, finishedAt: null, startedAt: { gte: new Date(now.getTime() - 70_000) } }, select: { id: true } });
    if (busy) return { kind: "busy" as const };
    const used = await tx.aiUsage.count({ where: { userId, startedAt: { gte: dayStart(now) } } });
    if (used >= limit) return { kind: "full" as const };
    const row = await tx.aiUsage.create({ data: { userId, roundId: round.id, articleId: article.id, purpose: "TIPS", model, startedAt: now } });
    return { kind: "ok" as const, usageId: row.id };
  }, TX_OPTS);
  if (reserved.kind === "busy") return fail(409, MSG.busy, { code: "BUSY" });
  const quota = () => quotaOf(db, userId, now, limit);
  if (reserved.kind === "full") return fail(429, MSG.quota, { code: "AI_QUOTA", quota: await quota() });

  const failWith = async (status: number, reason: string, tokens = { inputTokens: 0, outputTokens: 0 }) => {
    await db.aiUsage.update({
      where: { id: reserved.usageId },
      data: { finishedAt: nowOf(deps), ok: false, error: reason, ...tokens, costUsd: costUsd(tokens.inputTokens, tokens.outputTokens, priceIn, priceOut) },
    });
    await db.tipArticle.update({ where: { id: article.id }, data: { status: "FAILED", error: reason } });
    await log(db, { roundId: round.id, userId, step: STEP_AI, startedAt: now, ok: false, message: reason, sourceId: article.sourceId, articleId: article.id });
    return fail(status, `AI:n kunde inte tolka "${article.title}". ${reason} Försök igen räknas som en ny läsning.`, { code: "AI_ERROR", quota: await quota() });
  };

  // 2. Anropet, utanför transaktionen.
  const prompt = buildUserContent(
    { gameType: round.gameType, trackName: round.trackName, date: round.date.toISOString().slice(0, 10) },
    round.races.map((r) => ({ leg: r.leg, raceNumber: r.raceNumber, startAt: r.startAt, starts: r.starts.map((s) => ({ number: s.number, name: s.horse.name, scratched: s.scratched })) })),
    { title: article.title, publishedAt: article.publishedAt, text: article.text },
  );
  let res;
  try {
    res = await deps.ai({ system: systemPrompt(round.gameType), user: prompt, textHash: article.textHash });
  } catch (e) {
    const err = aiErrorOf(e);
    return failWith(err.status, err.message);
  }
  const tokens = { inputTokens: Math.max(0, Math.floor(res.inputTokens || 0)), outputTokens: Math.max(0, Math.floor(res.outputTokens || 0)) };
  if (res.input === null || res.input === undefined) {
    const reason = res.stopReason === "max_tokens" ? AI_ERR.cutOff : res.stopReason === "end_turn" ? AI_ERR.noTool : AI_ERR.unreadable;
    console.error("[tips-ai] inget verktygssvar", res.stopReason, `${tokens.outputTokens} tokens ut`);
    return failWith(502, reason, tokens);
  }

  // 3. Validera och spara (en transaktion).
  const after = nowOf(deps);
  const starts = startRefs(round);
  const startedLegs = round.races.filter((r) => started(r.startAt, after)).map((r) => r.leg);
  const v = validateTips(res.input, article.text, starts, startedLegs);
  const horseOf = new Map(round.races.flatMap((r) => r.starts.map((s) => [s.id, s.horseId] as const)));
  const discarded = v.discarded.shape + v.discarded.quote + v.discarded.duplicate + v.discarded.overflow;
  if (v.discarded.overflow) warnOf(deps)(`${article.url}: ${v.discarded.overflow} tips över taket kastades`);

  const createdIds = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"tips:" + userId + ":" + round.id}))`;
    await tx.tip.deleteMany({ where: { articleId: article.id, userId, review: "PENDING" } });
    // Ett anrop för alla tips: ett och ett tog för lång tid mot driftdatabasen.
    const rows = await tx.tip.createManyAndReturn({
      select: { id: true },
      data: v.tips.map((t) => ({
        userId,
        sourceId: article.sourceId,
        roundId: round.id,
        articleId: article.id,
        leg: t.leg,
        number: t.number,
        rawHorseName: t.rawHorseName,
        role: t.role,
        roleWord: t.roleWord,
        quote: t.quote,
        startId: t.startId,
        horseId: t.startId ? horseOf.get(t.startId) ?? null : null,
        match: t.match,
        flags: t.flags,
        suggestedStartId: t.suggestedStartId,
        aiStartId: t.startId,
        aiRole: t.role,
      })),
    });
    const ids = rows.map((r) => r.id);
    // 4. Väntande tips från samma källa på samma start i andra artiklar: det äldre ersätts.
    const mine = await tx.tip.findMany({ where: { id: { in: ids }, startId: { not: null } }, include: { article: true } });
    const startIds = mine.map((t) => t.startId!);
    if (startIds.length) {
      const others = await tx.tip.findMany({
        where: { userId, roundId: round.id, sourceId: article.sourceId, review: "PENDING", supersededById: null, startId: { in: startIds }, articleId: { not: article.id } },
        include: { article: true },
      });
      for (const o of others) {
        const t = mine.find((m) => m.startId === o.startId)!;
        if (compareOrder(orderOf(t), orderOf(o)) > 0) await tx.tip.update({ where: { id: o.id }, data: { supersededById: t.id } });
        else await tx.tip.update({ where: { id: t.id }, data: { supersededById: o.id } });
      }
    }
    // 5. Artikeln och kostnaden.
    await tx.tipArticle.update({ where: { id: article.id }, data: { status: "INTERPRETED", interpretedHash: article.textHash, interpretedAt: after, tipCount: ids.length, discarded, error: null } });
    await tx.aiUsage.update({ where: { id: reserved.usageId }, data: { finishedAt: after, ok: true, error: null, ...tokens, costUsd: costUsd(tokens.inputTokens, tokens.outputTokens, priceIn, priceOut) } });
    await refreshFactCount(tx, article.sourceId, round.id, userId);
    await log(tx, { roundId: round.id, userId, step: STEP_AI, startedAt: now, ok: true, message: `${ids.length} tips, ${discarded} kastade`, sourceId: article.sourceId, articleId: article.id });
    return ids;
  }, TX_OPTS);

  const ctx = await loadContext(db, userId, round.id, after);
  const created = createdIds.map((id) => ctx.byId.get(id)!).filter(Boolean);
  return ok({
    articleId: article.id,
    ok: true,
    tips: created.map((t) => tipDto(ctx, t)),
    created: created.length,
    discarded,
    discardedBy: v.discarded,
    skippedStarted: v.skippedStarted,
    truncated: article.truncated,
    cutOff: res.stopReason === "max_tokens",
    unlinked: created.filter((t) => !t.startId).length,
    quota: await quota(),
  });
}

// ---- Kontext: alla tips i omgången för användaren ---------------------------------------------

const tipInclude = {
  article: { select: { title: true, url: true, publishedAt: true, firstSeenAt: true, stage: true } },
  source: { select: { name: true, enabled: true } },
} satisfies Prisma.TipInclude;
type TipRow = Prisma.TipGetPayload<{ include: typeof tipInclude }>;
type StartInfo = StartRef & { startAt: Date; horseId: string };

type Ctx = {
  gameType: string;
  now: Date;
  roundId: string;
  tips: TipRow[];
  byId: Map<string, TipRow>;
  starts: Map<string, StartInfo>;
  legStartAt: Map<number, Date>;
  lastStartAt: Date | null;
};

async function loadContext(db: Db | Tx, userId: string, roundId: string, now: Date): Promise<Ctx> {
  const [round, tips, races] = await Promise.all([
    db.round.findUnique({ where: { id: roundId }, select: { gameType: true } }),
    db.tip.findMany({ where: { userId, roundId }, include: tipInclude, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    db.race.findMany({ where: { roundId }, include: { starts: { include: { horse: { select: { name: true } } } } } }),
  ]);
  const starts = new Map<string, StartInfo>();
  const legStartAt = new Map<number, Date>();
  let lastStartAt: Date | null = null;
  for (const r of races) {
    legStartAt.set(r.leg, r.startAt);
    if (!lastStartAt || r.startAt > lastStartAt) lastStartAt = r.startAt;
    for (const s of r.starts) starts.set(s.id, { startId: s.id, leg: r.leg, number: s.number, name: s.horse.name, scratched: s.scratched, startAt: r.startAt, horseId: s.horseId });
  }
  return { gameType: round?.gameType ?? DEFAULT_GAME_TYPE, now, roundId, tips, byId: new Map(tips.map((t) => [t.id, t])), starts, legStartAt, lastStartAt };
}

function orderOf(t: { id: string; createdAt: Date; article: { publishedAt: Date | null; firstSeenAt: Date } }): OrderInput {
  return { id: t.id, createdAt: t.createdAt, articlePublishedAt: t.article.publishedAt, articleFirstSeenAt: t.article.firstSeenAt };
}

// Ett ej kopplat tips låses när loppet i dess avdelning startar, och utan avdelning när sista loppet startar.
function lockedOf(ctx: Ctx, t: { startId: string | null; leg: number | null }): boolean {
  const s = t.startId ? ctx.starts.get(t.startId) : null;
  const at = s ? s.startAt : t.leg !== null ? ctx.legStartAt.get(t.leg) ?? ctx.lastStartAt : ctx.lastStartAt;
  return !!at && started(at, ctx.now);
}

const isCurrentApproved = (t: TipRow) => t.review === "APPROVED" && t.supersededById === null && t.startId !== null;
const articleAt = (t: TipRow) => (t.article.publishedAt ?? t.article.firstSeenAt).toISOString();

function replacesOf(ctx: Ctx, t: TipRow): TipRow | null {
  if (!t.startId) return null;
  if (isCurrentApproved(t)) {
    return ctx.tips.filter((x) => x.supersededById === t.id && x.review === "APPROVED").sort((a, b) => compareOrder(orderOf(b), orderOf(a)))[0] ?? null;
  }
  if (t.review === "PENDING" && t.supersededById === null) {
    const u = ctx.tips.find((x) => x.id !== t.id && x.sourceId === t.sourceId && x.startId === t.startId && isCurrentApproved(x));
    return u && compareOrder(orderOf(t), orderOf(u)) > 0 ? u : null;
  }
  return null;
}

function tipDto(ctx: Ctx, t: TipRow): TipDto {
  const s = t.startId ? ctx.starts.get(t.startId) ?? null : null;
  const sug = t.suggestedStartId ? ctx.starts.get(t.suggestedStartId) ?? null : null;
  const by = t.supersededById ? ctx.byId.get(t.supersededById) ?? null : null;
  const rep = replacesOf(ctx, t);
  const flags = t.flags.filter(isTipFlag) as TipFlag[];
  const flagInput = {
    flags,
    rawHorseName: t.rawHorseName,
    role: t.role,
    roleWord: t.roleWord,
    leg: t.leg,
    number: t.number,
    start: s ? { leg: s.leg, number: s.number, name: s.name } : null,
    suggestion: sug ? { leg: sug.leg, number: sug.number, name: sug.name } : null,
  };
  const locked = lockedOf(ctx, t);
  return {
    id: t.id,
    articleId: t.articleId,
    sourceId: t.sourceId,
    sourceName: t.source.name,
    leg: t.leg,
    number: t.number,
    rawHorseName: t.rawHorseName,
    role: t.role,
    roleWord: t.roleWord,
    quote: t.quote,
    startId: s ? s.startId : null,
    horseName: s ? s.name : null,
    startLeg: s ? s.leg : null,
    startNumber: s ? s.number : null,
    match: s ? t.match : "NONE",
    flags,
    flagText: flagText(flagInput, ctx.gameType),
    flagShort: flagShort(flagInput),
    suggestion: sug ? { startId: sug.startId, leg: sug.leg, number: sug.number, name: sug.name } : null,
    review: t.review,
    reviewedAt: iso(t.reviewedAt),
    editedByUser: t.editedByUser,
    aiRole: t.aiRole,
    superseded: by ? { byId: by.id, role: by.role, articleTitle: by.article.title, at: articleAt(by) } : null,
    replaces: rep ? { id: rep.id, role: rep.role, articleTitle: rep.article.title, at: articleAt(rep), stage: rep.article.stage } : null,
    article: { title: t.article.title, url: t.article.url, publishedAt: iso(t.article.publishedAt), firstSeenAt: t.article.firstSeenAt.toISOString(), stage: t.article.stage },
    locked,
    canUndo: t.undo !== null && t.undo !== undefined && !locked,
  };
}

function summaryTips(ctx: Ctx, startId: string) {
  return ctx.tips
    .filter((t) => t.startId === startId)
    .map((t) => ({ sourceId: t.sourceId, role: t.role, review: t.review, supersededById: t.supersededById, startId: t.startId, sourceEnabled: t.source.enabled }));
}

function affectedOf(ctx: Ctx, startIds: Iterable<string | null>): TipActionResponse["affected"] {
  return [...new Set([...startIds].filter((s): s is string => !!s))].map((startId) => ({ startId, tip: startTipSummary(summaryTips(ctx, startId)) }));
}

// ---- Granskningen (12) -------------------------------------------------------------------------

type UndoState = {
  review: "PENDING" | "APPROVED" | "REJECTED";
  reviewedAt: string | null;
  startId: string | null;
  horseId: string | null;
  role: TipRole;
  match: "SURE" | "UNSURE" | "NONE";
  flags: string[];
  editedByUser: boolean;
  supersededById: string | null;
  supersededIds: string[];
  releasedIds: string[];
};

function snapshot(t: TipRow): Omit<UndoState, "supersededIds" | "releasedIds"> {
  return { review: t.review, reviewedAt: iso(t.reviewedAt), startId: t.startId, horseId: t.horseId, role: t.role, match: t.match, flags: t.flags, editedByUser: t.editedByUser, supersededById: t.supersededById };
}

function parseUndo(v: Prisma.JsonValue | null): UndoState | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const strOrNull = (x: unknown) => (typeof x === "string" ? x : null);
  const ids = (x: unknown) => (Array.isArray(x) ? x.filter((i): i is string => typeof i === "string") : []);
  if (!["PENDING", "APPROVED", "REJECTED"].includes(o.review as string) || !isTipRole(o.role) || !["SURE", "UNSURE", "NONE"].includes(o.match as string)) return null;
  return {
    review: o.review as UndoState["review"],
    reviewedAt: strOrNull(o.reviewedAt),
    startId: strOrNull(o.startId),
    horseId: strOrNull(o.horseId),
    role: o.role,
    match: o.match as UndoState["match"],
    flags: ids(o.flags),
    editedByUser: o.editedByUser === true,
    supersededById: strOrNull(o.supersededById),
    supersededIds: ids(o.supersededIds),
    releasedIds: ids(o.releasedIds),
  };
}

// Uppdaterar raden i databasen och i kontexten.
async function setTip(tx: Tx, ctx: Ctx, id: string, data: Partial<Pick<TipRow, "review" | "reviewedAt" | "startId" | "horseId" | "role" | "match" | "flags" | "editedByUser" | "supersededById">> & { undo?: UndoState | null }) {
  const { undo, ...rest } = data;
  await tx.tip.update({ where: { id }, data: { ...rest, ...(undo !== undefined ? { undo: undo === null ? Prisma.DbNull : (undo as unknown as Prisma.InputJsonValue) } : {}) } });
  const row = ctx.byId.get(id);
  if (row) Object.assign(row, rest, undo !== undefined ? { undo } : {});
}

type ApproveChange = { startId?: string; role?: TipRole; edited?: boolean };

// Godkänner T (6.11 "Ersatt roll"). Sparar Ångra-läget och returnerar meddelandet om T blev historik direkt.
async function approveCore(tx: Tx, ctx: Ctx, t: TipRow, change: ApproveChange): Promise<{ message?: string; touched: (string | null)[] }> {
  const before = snapshot(t);
  const released: string[] = [];
  const superseded: string[] = [];
  const newStartId = change.startId ?? t.startId;
  const touched: (string | null)[] = [t.startId, newStartId];
  // Flyttas ett gällande tips till en annan start blir tipset det ersatte gällande igen.
  if (isCurrentApproved(t) && newStartId !== t.startId) {
    for (const p of ctx.tips.filter((x) => x.supersededById === t.id && x.review === "APPROVED")) {
      await setTip(tx, ctx, p.id, { supersededById: null });
      released.push(p.id);
    }
  }
  const current = ctx.tips.find((x) => x.id !== t.id && x.sourceId === t.sourceId && x.startId === newStartId && isCurrentApproved(x)) ?? null;
  const decision = resolveSupersede(orderOf(t), current ? orderOf(current) : null);
  let own: string | null = null;
  let message: string | undefined;
  if (decision.kind === "replaces") {
    await setTip(tx, ctx, decision.supersededId, { supersededById: t.id });
    superseded.push(decision.supersededId);
  } else if (decision.kind === "older") {
    own = decision.currentId;
    message = `Ett nyare tips från ${t.source.name} gäller redan.`;
  }
  const start = newStartId ? ctx.starts.get(newStartId) : null;
  await setTip(tx, ctx, t.id, {
    review: "APPROVED",
    reviewedAt: ctx.now,
    startId: newStartId,
    horseId: start?.horseId ?? null,
    role: change.role ?? t.role,
    ...(change.edited ? { match: "SURE" as const, flags: [], editedByUser: true } : {}),
    supersededById: own,
    undo: { ...before, supersededIds: superseded, releasedIds: released },
  });
  return { message, touched };
}

async function actionTx<T>(deps: TipsDeps, userId: string, roundId: string, fn: (tx: Tx, ctx: Ctx) => Promise<T>): Promise<{ result: T; ctx: Ctx }> {
  const now = nowOf(deps);
  const result = await deps.db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"tips:" + userId + ":" + roundId}))`;
    const ctx = await loadContext(tx, userId, roundId, now);
    return fn(tx, ctx);
  }, TX_OPTS);
  return { result, ctx: await loadContext(deps.db, userId, roundId, now) };
}

class ActionError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function runAction(
  deps: TipsDeps,
  userId: string,
  roundId: string,
  fn: (tx: Tx, ctx: Ctx) => Promise<{ ids: string[]; touched: (string | null)[]; message?: string }>,
): Promise<Reply<TipActionResponse>> {
  try {
    const { result, ctx } = await actionTx(deps, userId, roundId, fn);
    const tips = result.ids.map((id) => ctx.byId.get(id)).filter((t): t is TipRow => !!t);
    return ok({ tips: tips.map((t) => tipDto(ctx, t)), affected: affectedOf(ctx, result.touched), ...(result.message ? { message: result.message } : {}) });
  } catch (e) {
    if (e instanceof ActionError) return fail(e.status, e.message, e.code ? { code: e.code } : {});
    throw e;
  }
}

async function tipOwner(db: Db, userId: string, id: string) {
  return db.tip.findFirst({ where: { id, userId }, select: { id: true, roundId: true } });
}

const raceStartedErr = () => new ActionError(409, MSG.raceStarted, "RACE_STARTED");

// POST /api/tips/[id]/approve
export async function approveTip(deps: TipsDeps, input: { userId: string; tipId: string }): Promise<Reply<TipActionResponse>> {
  const own = await tipOwner(deps.db, input.userId, input.tipId);
  if (!own) return fail(404, MSG.tipNotFound);
  return runAction(deps, input.userId, own.roundId, async (tx, ctx) => {
    const t = ctx.byId.get(own.id)!;
    if (lockedOf(ctx, t)) throw raceStartedErr();
    if (t.review === "REJECTED") throw new ActionError(409, MSG.rejected, "REJECTED");
    if (!t.startId) throw new ActionError(409, MSG.notLinked, "NOT_LINKED");
    const r = await approveCore(tx, ctx, t, {});
    return { ids: [t.id], touched: r.touched, message: r.message };
  });
}

// POST /api/rounds/[id]/tips/approve { articleId? }: alla väntande säkra tips som inte är låsta eller ersatta.
export async function approveSure(deps: TipsDeps, input: { userId: string; roundId: string; articleId?: string | null }): Promise<Reply<TipActionResponse>> {
  const round = await deps.db.round.findUnique({ where: { id: input.roundId }, select: { id: true } });
  if (!round) return fail(404, MSG.roundNotFound);
  if (input.articleId) {
    const a = await deps.db.tipArticle.findFirst({ where: { id: input.articleId, userId: input.userId, roundId: round.id }, select: { id: true } });
    if (!a) return fail(404, MSG.articleNotFound);
  }
  return runAction(deps, input.userId, round.id, async (tx, ctx) => {
    const list = ctx.tips
      .filter((t) => t.review === "PENDING" && t.match === "SURE" && t.startId && t.supersededById === null && !lockedOf(ctx, t) && (!input.articleId || t.articleId === input.articleId))
      .sort((a, b) => compareOrder(orderOf(a), orderOf(b)));
    const touched: (string | null)[] = [];
    for (const t of list) touched.push(...(await approveCore(tx, ctx, t, {})).touched);
    return { ids: list.map((t) => t.id), touched };
  });
}

// PATCH /api/tips/[id] { startId?, role? }: Rätta och Välj. Sparar och godkänner.
export async function editTip(deps: TipsDeps, input: { userId: string; tipId: string; startId?: string; role?: string }): Promise<Reply<TipActionResponse>> {
  if (input.startId === undefined && input.role === undefined) return fail(400, MSG.emptyPatch);
  if (input.role !== undefined && !isTipRole(input.role)) return fail(400, MSG.unknownRole);
  const own = await tipOwner(deps.db, input.userId, input.tipId);
  if (!own) return fail(404, MSG.tipNotFound);
  const role = input.role as TipRole | undefined;
  return runAction(deps, input.userId, own.roundId, async (tx, ctx) => {
    const t = ctx.byId.get(own.id)!;
    if (input.startId !== undefined && !ctx.starts.has(input.startId)) throw new ActionError(400, MSG.unknownStart);
    if (lockedOf(ctx, t)) throw raceStartedErr();
    if (input.startId !== undefined && lockedOf(ctx, { startId: input.startId, leg: null })) throw raceStartedErr();
    if (t.review === "REJECTED") throw new ActionError(409, MSG.rejected, "REJECTED");
    const r = await approveCore(tx, ctx, t, { startId: input.startId, role, edited: true });
    return { ids: [t.id], touched: r.touched, message: r.message };
  });
}

// DELETE /api/tips/[id]: review = REJECTED. Var det gällande blir tipset det ersatte gällande igen.
export async function rejectTip(deps: TipsDeps, input: { userId: string; tipId: string }): Promise<Reply<TipActionResponse>> {
  const own = await tipOwner(deps.db, input.userId, input.tipId);
  if (!own) return fail(404, MSG.tipNotFound);
  return runAction(deps, input.userId, own.roundId, async (tx, ctx) => {
    const t = ctx.byId.get(own.id)!;
    if (lockedOf(ctx, t)) throw raceStartedErr();
    if (t.review === "REJECTED") throw new ActionError(409, MSG.rejected, "REJECTED");
    const before = snapshot(t);
    const released: string[] = [];
    if (isCurrentApproved(t)) {
      for (const p of ctx.tips.filter((x) => x.supersededById === t.id && x.review === "APPROVED")) {
        await setTip(tx, ctx, p.id, { supersededById: null });
        released.push(p.id);
      }
    }
    await setTip(tx, ctx, t.id, { review: "REJECTED", reviewedAt: ctx.now, undo: { ...before, supersededIds: [], releasedIds: released } });
    return { ids: [t.id], touched: [t.startId] };
  });
}

// POST /api/tips/undo { ids }: återställer läget före senaste åtgärden per tips.
export async function undoTips(deps: TipsDeps, input: { userId: string; ids: string[] }): Promise<Reply<TipActionResponse>> {
  const owned = await deps.db.tip.findMany({ where: { id: { in: input.ids }, userId: input.userId }, select: { id: true, roundId: true } });
  if (!owned.length) return fail(404, MSG.tipNotFound);
  const roundIds = [...new Set(owned.map((t) => t.roundId))];
  if (roundIds.length > 1) return fail(400, "Tipsen ska höra till samma omgång.");
  return runAction(deps, input.userId, roundIds[0], async (tx, ctx) => {
    const list = owned
      .map((o) => ctx.byId.get(o.id)!)
      .map((t) => ({ t, undo: parseUndo(t.undo) }))
      .filter((x): x is { t: TipRow; undo: UndoState } => !!x.undo)
      // Senast ändrade först, så att kedjan rullas tillbaka i omvänd ordning.
      .sort((a, b) => b.t.updatedAt.getTime() - a.t.updatedAt.getTime() || compareOrder(orderOf(b.t), orderOf(a.t)));
    if (!list.length) throw new ActionError(409, MSG.nothingToUndo, "NOTHING_TO_UNDO");
    for (const { t, undo } of list) {
      if (lockedOf(ctx, t) || (undo.startId && lockedOf(ctx, { startId: undo.startId, leg: null }))) throw raceStartedErr();
    }
    const touched: (string | null)[] = [];
    for (const { t, undo } of list) {
      touched.push(t.startId, undo.startId);
      for (const id of undo.supersededIds) {
        const x = ctx.byId.get(id);
        if (x && x.supersededById === t.id) await setTip(tx, ctx, id, { supersededById: null });
      }
      for (const id of undo.releasedIds) {
        const x = ctx.byId.get(id);
        if (x && x.supersededById === null) await setTip(tx, ctx, id, { supersededById: t.id });
      }
      const flags = undo.flags.filter(isTipFlag);
      await setTip(tx, ctx, t.id, {
        review: undo.review,
        reviewedAt: undo.reviewedAt ? new Date(undo.reviewedAt) : null,
        startId: undo.startId && ctx.starts.has(undo.startId) ? undo.startId : null,
        horseId: undo.startId && ctx.starts.has(undo.startId) ? undo.horseId : null,
        role: undo.role,
        match: undo.match,
        flags,
        editedByUser: undo.editedByUser,
        supersededById: undo.supersededById && ctx.byId.has(undo.supersededById) ? undo.supersededById : null,
        undo: null,
      });
    }
    return { ids: list.map((x) => x.t.id), touched };
  });
}

// ---- Läsningen för Källor, S1, S2 och S3 ----------------------------------------------------------

async function lastRead(db: Db, userId: string, roundId: string): Promise<{ at: Date | null; name: string | null; sources: number }> {
  const logs = await db.fetchLog.findMany({ where: { roundId, userId, step: STEP_SCAN }, orderBy: { startedAt: "desc" }, select: { startedAt: true, changes: true }, take: 200 });
  const ids = logs.map((l) => (l.changes && typeof l.changes === "object" && !Array.isArray(l.changes) ? (l.changes as Record<string, unknown>).sourceId : null)).filter((x): x is string => typeof x === "string");
  if (!logs.length) return { at: null, name: null, sources: 0 };
  const latest = ids[0] ? await db.source.findFirst({ where: { id: ids[0], userId }, select: { name: true } }) : null;
  return { at: logs[0].startedAt, name: latest?.name ?? null, sources: new Set(ids).size };
}

function articleDto(a: Prisma.TipArticleGetPayload<{ include: { source: { select: { name: true } } } }>): TipArticleDto {
  return {
    id: a.id,
    sourceId: a.sourceId,
    sourceName: a.source.name,
    url: a.url,
    title: a.title,
    publishedAt: iso(a.publishedAt),
    stage: a.stage,
    firstSeenAt: a.firstSeenAt.toISOString(),
    lastSeenAt: a.lastSeenAt.toISOString(),
    interpretedAt: iso(a.interpretedAt),
    status: a.status,
    error: a.error,
    tipCount: a.tipCount,
    discarded: a.discarded,
    truncated: a.truncated,
  };
}

function countsOf(ctx: Ctx) {
  return roundTipCounts(
    ctx.tips.map((t) => ({ review: t.review, match: t.startId ? t.match : "NONE", startId: t.startId, supersededById: t.supersededById, locked: lockedOf(ctx, t), sourceEnabled: t.source.enabled })),
  );
}

// GET /api/rounds/[id]/tips
export async function buildTipsResponse(deps: TipsDeps, input: { userId: string; roundId: string }): Promise<Reply<TipsResponse>> {
  const { db } = deps;
  const now = nowOf(deps);
  const round = await db.round.findUnique({ where: { id: input.roundId }, select: { id: true } });
  if (!round) return fail(404, MSG.roundNotFound);
  const [ctx, articles, quota, read] = await Promise.all([
    loadContext(db, input.userId, round.id, now),
    db.tipArticle.findMany({ where: { userId: input.userId, roundId: round.id }, include: { source: { select: { name: true } } }, orderBy: [{ firstSeenAt: "desc" }] }),
    quotaOf(db, input.userId, now, settingsOf(deps).limit),
    lastRead(db, input.userId, round.id),
  ]);
  articles.sort((a, b) => (b.publishedAt ?? b.firstSeenAt).getTime() - (a.publishedAt ?? a.firstSeenAt).getTime());
  return ok({
    roundId: round.id,
    articles: articles.map(articleDto),
    tips: ctx.tips.filter((t) => t.review !== "REJECTED").map((t) => tipDto(ctx, t)),
    counts: countsOf(ctx),
    quota,
    lastReadAt: iso(read.at),
    lastSourceName: read.name,
  });
}

// StartDto.tip för alla starter i omgången (S2-taggen och förslaget i S3).
export async function startTipsByStart(db: Db, userId: string, roundId: string): Promise<Map<string, StartTipDto>> {
  const tips = await db.tip.findMany({
    where: { userId, roundId, review: "APPROVED", supersededById: null, startId: { not: null }, source: { enabled: true } },
    select: { startId: true, sourceId: true, role: true, review: true, supersededById: true },
  });
  const byStart = new Map<string, typeof tips>();
  for (const t of tips) byStart.set(t.startId!, [...(byStart.get(t.startId!) ?? []), t]);
  const out = new Map<string, StartTipDto>();
  for (const [startId, list] of byStart) {
    const s = startTipSummary(list.map((t) => ({ ...t, sourceEnabled: true })));
    if (s) out.set(startId, s);
  }
  return out;
}

// RoundResponse.tips och CurrentRoundResponse.tips (tipsraden i S1).
export async function roundTipsSummary(db: Db, userId: string, roundId: string, now: Date): Promise<RoundTipsDto | null> {
  const [ctx, read] = await Promise.all([loadContext(db, userId, roundId, now), lastRead(db, userId, roundId)]);
  const c = countsOf(ctx);
  if (!ctx.tips.length && !read.at) return null;
  return { approved: c.approved, horses: c.approvedHorses, pending: c.pending, lastReadAt: iso(read.at), lastSourceName: read.name, sourcesRead: read.sources };
}

// StartDetailResponse.tips, tipSourceCount och tipsPending (S3).
export async function startTipsDetail(db: Db, userId: string, startId: string, roundId: string, now: Date): Promise<{ tips: TipDto[]; tip: StartTipDto | null; tipSourceCount: number | null; tipsPending: number }> {
  const ctx = await loadContext(db, userId, roundId, now);
  const mine = ctx.tips.filter((t) => t.startId === startId);
  const approved = mine
    .filter((t) => t.review === "APPROVED")
    .sort((a, b) => Number(b.supersededById === null) - Number(a.supersededById === null) || compareOrder(orderOf(b), orderOf(a)));
  const summary = startTipSummary(summaryTips(ctx, startId));
  const pending = mine.filter((t) => t.review === "PENDING" && t.supersededById === null && !lockedOf(ctx, t)).length;
  return { tips: approved.map((t) => tipDto(ctx, t)), tip: summary, tipSourceCount: summary ? summary.support : null, tipsPending: pending };
}
