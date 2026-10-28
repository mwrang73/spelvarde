"use client";

// Klientens kedja för Hämta tips (E5 12): läs varje påslagen källa (högst 2
// samtidigt), tolka sedan nya eller ändrade artiklar med AI en i taget (äldst
// först, så att ersättningarna blir rätt), läs om tipsen och omgången och
// visa banderollen. Ett fel hos en källa eller artikel stoppar inte resten.
// Dygnsgränsen (429 AI_QUOTA) och saknad nyckel stoppar AI-delen.
//
// Lämnar Mikael vyn fortsätter pågående anrop, men inga nya startas
// (stopTipsChain). Nästa gång vyn öppnas visar GET …/tips läget.

import { useSyncExternalStore } from "react";
import { rawPost } from "@/components/api";
import { loadRound } from "@/components/round/roundStore";
import { relTime } from "@/lib/format";
import { chainBanners, scanStepText, type BannerSpec, type ChainArticleResult, type ChainOutcome, type ChainSourceResult } from "@/lib/tips-ui";
import type { QuotaDto, SourceDto, TipInterpretResponse, TipScanArticle, TipScanResponse } from "@/lib/types";
import { getTips, loadTips } from "./tipsStore";

export type ChainStep = { key: string; text: string; state: "ok" | "cur" | "bad" | "wait" };

export type TipsChainState =
  | { kind: "idle" }
  | { kind: "running"; roundId: string; steps: ChainStep[]; done: number; total: number; reading: string[] }
  | { kind: "done"; roundId: string; banners: BannerSpec[]; seq: number };

let state: TipsChainState = { kind: "idle" };
let stopped = false;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const setState = (s: TipsChainState) => {
  state = s;
  emit();
};

export function useTipsChain(): TipsChainState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
    () => state,
  );
}

// Inga nya anrop efter det pågående (vyn lämnas).
export function stopTipsChain() {
  if (state.kind === "running") stopped = true;
}
// Banderollen ligger kvar tills vyn lämnas eller den stängs med ×.
export function clearTipsBanners(index?: number) {
  if (state.kind !== "done") return;
  if (index === undefined) setState({ kind: "idle" });
  else {
    const banners = state.banners.filter((_, i) => i !== index);
    setState(banners.length ? { ...state, banners } : { kind: "idle" });
  }
}

type Run = { roundId: string; roundLabel: string; sources: SourceDto[]; onlyArticleId?: string; onQuota?: (q: QuotaDto) => void };

type ErrBody = { error?: string; code?: string; quota?: QuotaDto; retryAfterSec?: number };
const errOf = (data: unknown): ErrBody => (data && typeof data === "object" ? (data as ErrBody) : {});

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const worker = async () => {
    while (i < items.length && !stopped) {
      const item = items[i++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

export async function startTipsChain(run: Run): Promise<void> {
  if (state.kind === "running") return;
  stopped = false;
  const { roundId } = run;
  const steps: ChainStep[] = [];
  let done = 0;
  let total = run.onlyArticleId ? 3 : run.sources.length;
  const reading = new Set<string>();
  const push = () => setState({ kind: "running", roundId, steps: [...steps], done, total, reading: [...reading] });
  const setStep = (key: string, text: string, st: ChainStep["state"]) => {
    const i = steps.findIndex((s) => s.key === key);
    if (i >= 0) steps[i] = { key, text, state: st };
    else steps.push({ key, text, state: st });
    push();
  };

  // "Inget nytt sedan i dag 21:14": senaste tolkningen före körningen.
  const before = getTips(roundId).data;
  const lastInterp = before?.articles.map((a) => a.interpretedAt).filter((x): x is string => !!x).sort().pop() ?? null;

  const outcome: ChainOutcome = { sources: [], unchanged: 0, articles: [], waiting: 0, notConfigured: false, roundClosed: false, since: lastInterp ? relTime(lastInterp, new Date()) : null, roundLabel: run.roundLabel };
  const toRead: (TipScanArticle & { sourceName: string })[] = [];
  push();

  if (run.onlyArticleId) {
    const a = before?.articles.find((x) => x.id === run.onlyArticleId);
    toRead.push({ articleId: run.onlyArticleId, title: a?.title ?? "artikeln", url: a?.url ?? "", publishedAt: a?.publishedAt ?? null, stage: a?.stage ?? "EARLY", change: "changed", needsAi: true, sourceName: a?.sourceName ?? "" });
  } else {
    await pool(run.sources, 2, async (src) => {
      reading.add(src.id);
      setStep(`s-${src.id}`, `Läser ${src.name}`, "cur");
      let res: ChainSourceResult;
      try {
        const { status, data } = await rawPost(`/api/rounds/${roundId}/tips/sources/${src.id}/scan`);
        if (status === 200) {
          const r = data as TipScanResponse;
          if (r.quota) run.onQuota?.(r.quota);
          if (!r.ok || r.status === "error") {
            res = { sourceId: src.id, name: src.name, status: "error", error: r.error };
            setStep(`s-${src.id}`, `${src.name}: kunde inte läsas`, "bad");
          } else {
            const need = r.articles.filter((a) => a.needsAi);
            outcome.unchanged += r.articles.length - need.length;
            for (const a of need) toRead.push({ ...a, sourceName: src.name });
            total += need.length * 3;
            res = { sourceId: src.id, name: src.name, status: r.status };
            setStep(`s-${src.id}`, scanStepText(src.name, r.status === "noArticle" ? "noArticle" : "ok", need.length, r.articles.length), "ok");
          }
        } else {
          const e = errOf(data);
          if (e.code === "ROUND_CLOSED") outcome.roundClosed = true;
          res = { sourceId: src.id, name: src.name, status: status === 429 ? "locked" : "skipped", error: e.error };
          setStep(`s-${src.id}`, status === 429 ? `${src.name}: nyss läst` : `${src.name}: ${e.error ?? "kunde inte läsas"}`, status === 429 ? "ok" : "bad");
        }
      } catch {
        res = { sourceId: src.id, name: src.name, status: "error", error: "Ingen uppkoppling." };
        setStep(`s-${src.id}`, `${src.name}: kunde inte läsas`, "bad");
      }
      outcome.sources.push(res);
      reading.delete(src.id);
      done += 1;
      push();
    });
  }

  // Äldst först, så att en senare artikel ersätter en tidigare (6.11).
  toRead.sort((a, b) => (a.publishedAt ? Date.parse(a.publishedAt) : Infinity) - (b.publishedAt ? Date.parse(b.publishedAt) : Infinity));

  let quotaHit = false;
  for (let i = 0; i < toRead.length; i++) {
    const a = toRead[i];
    if (stopped || quotaHit || outcome.notConfigured || outcome.roundClosed) {
      if (quotaHit) outcome.waiting += 1;
      continue;
    }
    setStep(`r-${a.articleId}`, `Läser "${a.title}"`, "ok");
    setStep(`a-${a.articleId}`, "Tolkar med AI", "cur");
    let res: ChainArticleResult;
    try {
      const { status, data } = await rawPost(`/api/tips/articles/${a.articleId}/interpret`, {});
      const e = errOf(data);
      if (e.quota) run.onQuota?.(e.quota);
      if (status === 200) {
        const r = data as TipInterpretResponse;
        run.onQuota?.(r.quota);
        res = {
          articleId: a.articleId,
          title: a.title,
          kind: "ok",
          created: r.created,
          horses: r.tips.map((t) => t.startId ?? `x-${t.rawHorseName}`),
          unlinked: r.unlinked ?? r.tips.filter((t) => !t.startId).length,
          discardedQuote: r.discardedBy?.quote ?? 0,
          truncated: r.truncated,
          cutOff: r.cutOff,
        };
        setStep(`a-${a.articleId}`, `Tolkat: ${r.created} tips`, "ok");
      } else if (status === 429 && e.code === "AI_QUOTA") {
        quotaHit = true;
        outcome.waiting += 1;
        res = { articleId: a.articleId, title: a.title, kind: "skipped" };
        setStep(`a-${a.articleId}`, "Dagens gräns är nådd", "bad");
      } else if (e.code === "AI_NOT_CONFIGURED") {
        outcome.notConfigured = true;
        res = { articleId: a.articleId, title: a.title, kind: "skipped" };
        setStep(`a-${a.articleId}`, "AI-tolkning är inte inställd", "bad");
      } else if (e.code === "ROUND_CLOSED") {
        outcome.roundClosed = true;
        res = { articleId: a.articleId, title: a.title, kind: "skipped" };
        setStep(`a-${a.articleId}`, "Alla lopp har startat", "bad");
      } else if (status === 409) {
        // UNCHANGED, DUPLICATE eller BUSY: inget att läsa nu.
        outcome.unchanged += 1;
        res = { articleId: a.articleId, title: a.title, kind: "skipped" };
        setStep(`a-${a.articleId}`, "Redan läst", "ok");
      } else {
        res = { articleId: a.articleId, title: a.title, kind: "failed", error: e.error ?? `AI:n kunde inte tolka "${a.title}". AI-tjänsten svarade med fel. Försök igen räknas som en ny läsning.` };
        setStep(`a-${a.articleId}`, "AI:n kunde inte tolka", "bad");
      }
    } catch {
      res = { articleId: a.articleId, title: a.title, kind: "failed", error: `AI:n kunde inte tolka "${a.title}". Ingen uppkoppling. Försök igen räknas som en ny läsning.` };
      setStep(`a-${a.articleId}`, "AI:n kunde inte tolka", "bad");
    }
    outcome.articles.push(res);
    done += 3;
    push();
  }

  await Promise.allSettled([loadTips(roundId), loadRound(roundId)]);
  seq += 1;
  setState(stopped ? { kind: "idle" } : { kind: "done", roundId, banners: chainBanners(outcome), seq });
  stopped = false;
}
