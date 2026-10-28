"use client";

// Tipsen för en omgång i klienten (E5 12, GET /api/rounds/[id]/tips). Ett
// modulglobalt lager som Källor, granskningen och hästkortets Rätta delar,
// så att en ändring syns överallt utan ny hämtning. Bara i minnet: Hämta
// tips och granskningen kräver nät.
//
// Granskningens åtgärder går direkt mot API:t (specen 12, avvikelse från
// 9.3): listan uppdateras optimistiskt, och ett fel rullar tillbaka.

import { useSyncExternalStore } from "react";
import { apiGet, apiRequest } from "@/components/api";
import { clearDetailsFor, patchStartTips } from "@/components/round/roundStore";
import type { RoundTipsDto, TipActionResponse, TipDto, TipRole, TipsResponse } from "@/lib/types";
import { countTips } from "@/lib/tips-ui";

export type TipsEntry = { data: TipsResponse | null; error: string | null; loading: boolean };

const EMPTY: TipsEntry = { data: null, error: null, loading: false };
const entries = new Map<string, TipsEntry>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function subscribeTips(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const getTips = (roundId: string | null): TipsEntry => (roundId ? entries.get(roundId) ?? EMPTY : EMPTY);

function set(roundId: string, entry: TipsEntry) {
  entries.set(roundId, entry);
  emit();
}

export function useTips(roundId: string | null): TipsEntry {
  return useSyncExternalStore(
    subscribeTips,
    () => getTips(roundId),
    () => EMPTY,
  );
}

const inflight = new Map<string, Promise<TipsResponse | null>>();

export function loadTips(roundId: string): Promise<TipsResponse | null> {
  const running = inflight.get(roundId);
  if (running) return running;
  const cur = getTips(roundId);
  set(roundId, { ...cur, loading: true });
  const p = apiGet<TipsResponse>(`/api/rounds/${roundId}/tips`)
    .then((data) => {
      set(roundId, { data, error: null, loading: false });
      return data;
    })
    .catch((e: unknown) => {
      set(roundId, { data: getTips(roundId).data, error: e instanceof Error ? e.message : "Kunde inte hämta tipsen.", loading: false });
      return null;
    })
    .finally(() => inflight.delete(roundId));
  inflight.set(roundId, p);
  return p;
}

// Läs om i bakgrunden en stund efter en åtgärd, så att ersättningar
// (supersededBy, replaces) på andra tips stämmer.
const reloadTimers = new Map<string, number>();
function reloadSoon(roundId: string) {
  window.clearTimeout(reloadTimers.get(roundId));
  reloadTimers.set(
    roundId,
    window.setTimeout(() => {
      reloadTimers.delete(roundId);
      void loadTips(roundId);
    }, 900),
  );
}

function setTipsList(roundId: string, fn: (tips: TipDto[]) => TipDto[]) {
  const cur = getTips(roundId);
  if (!cur.data) return;
  const tips = fn(cur.data.tips);
  const counts = countTips(tips);
  set(roundId, { ...cur, data: { ...cur.data, tips, counts } });
}

// Byter ut tipsen med samma id och tar bort borttagna.
function upsert(roundId: string, changed: TipDto[]) {
  setTipsList(roundId, (tips) => {
    const byId = new Map(changed.map((t) => [t.id, t]));
    const seen = new Set<string>();
    const next = tips.map((t) => {
      const c = byId.get(t.id);
      if (c) seen.add(t.id);
      return c ?? t;
    });
    for (const c of changed) if (!seen.has(c.id)) next.push(c);
    return next.filter((t) => t.review !== "REJECTED");
  });
}

// Omgångens tipsrad (S1) räknad från listan, så att den stämmer direkt.
function roundSummary(roundId: string): Partial<RoundTipsDto> | null {
  const d = getTips(roundId).data;
  if (!d) return null;
  const c = countTips(d.tips);
  return { approved: c.approved, horses: c.approvedHorses, pending: c.pending };
}

function applyResponse(roundId: string, res: TipActionResponse) {
  upsert(roundId, res.tips);
  patchStartTips(roundId, res.affected, roundSummary(roundId));
  clearDetailsFor(res.affected.map((a) => a.startId));
  reloadSoon(roundId);
}

type Optimistic = (tips: TipDto[]) => TipDto[];

async function run(roundId: string, optimistic: Optimistic | null, call: () => Promise<TipActionResponse>): Promise<TipActionResponse> {
  const before = getTips(roundId).data;
  if (optimistic) setTipsList(roundId, optimistic);
  try {
    const res = await call();
    applyResponse(roundId, res);
    return res;
  } catch (e) {
    if (before) set(roundId, { ...getTips(roundId), data: before });
    throw e;
  }
}

const mapTip = (id: string, fn: (t: TipDto) => TipDto): Optimistic => (tips) => tips.map((t) => (t.id === id ? fn(t) : t));
const now = () => new Date().toISOString();

export const tipActions = {
  approve: (roundId: string, tip: TipDto) => run(roundId, mapTip(tip.id, (t) => ({ ...t, review: "APPROVED", reviewedAt: now() })), () => apiRequest<TipActionResponse>("POST", `/api/tips/${tip.id}/approve`)),
  approveSure: (roundId: string, ids: string[], articleId: string | null) =>
    run(
      roundId,
      (tips) => tips.map((t) => (ids.includes(t.id) ? { ...t, review: "APPROVED", reviewedAt: now() } : t)),
      () => apiRequest<TipActionResponse>("POST", `/api/rounds/${roundId}/tips/approve`, articleId ? { articleId } : {}),
    ),
  edit: (roundId: string, tip: TipDto, body: { startId?: string; role?: TipRole }) =>
    run(roundId, mapTip(tip.id, (t) => ({ ...t, role: body.role ?? t.role, review: "APPROVED", reviewedAt: now() })), () => apiRequest<TipActionResponse>("PATCH", `/api/tips/${tip.id}`, body)),
  remove: (roundId: string, tip: TipDto) => run(roundId, (tips) => tips.filter((t) => t.id !== tip.id), () => apiRequest<TipActionResponse>("DELETE", `/api/tips/${tip.id}`)),
  undo: (roundId: string, ids: string[]) => run(roundId, null, () => apiRequest<TipActionResponse>("POST", "/api/tips/undo", { ids })),
};
