// Loppstatistiken (S2b, GET /api/rounds/[id]/races/[leg]/stats) i minnet.
// Hämtas när arket öppnas i mobilen, och för alla 8 avdelningar i förväg på
// desktop (statistikrutorna), så att avdelningsbyte inte behöver nätet.

import { useSyncExternalStore } from "react";
import { apiGet } from "@/components/api";
import type { RaceStatsResponse } from "@/lib/types";

export type RaceStatsEntry = { data: RaceStatsResponse | null; error: string | null; loading: boolean };

const cache = new Map<string, RaceStatsEntry>();
const listeners = new Set<() => void>();
const EMPTY: RaceStatsEntry = { data: null, error: null, loading: false };
const key = (roundId: string, leg: number) => `${roundId}:${leg}`;

function set(k: string, e: RaceStatsEntry) {
  cache.set(k, e);
  listeners.forEach((fn) => fn());
}

export function loadRaceStats(roundId: string, leg: number, force = false) {
  const k = key(roundId, leg);
  const cur = cache.get(k);
  if (cur?.loading || (cur?.data && !force)) return;
  set(k, { data: cur?.data ?? null, error: null, loading: true });
  apiGet<RaceStatsResponse>(`/api/rounds/${roundId}/races/${leg}/stats`)
    .then((data) => set(k, { data, error: null, loading: false }))
    .catch((e: unknown) => set(k, { data: cur?.data ?? null, error: e instanceof Error ? e.message : "Kunde inte hämta statistiken.", loading: false }));
}

export function clearRaceStats(roundId: string) {
  for (const k of [...cache.keys()]) if (k.startsWith(`${roundId}:`)) cache.delete(k);
  listeners.forEach((fn) => fn());
}

export function useRaceStats(roundId: string, leg: number): RaceStatsEntry {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => cache.get(key(roundId, leg)) ?? EMPTY,
    () => EMPTY,
  );
}
