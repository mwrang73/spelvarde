"use client";

// Hämta omgång / Hämta igen / Försök igen (specen 10.1) från klienten. En
// kedja i taget för hela appen, så att stegraden finns kvar om Mikael byter
// vy under tiden. Kedjan själv är lib/fetch-chain.ts.

import { useSyncExternalStore } from "react";
import { rawPost } from "@/components/api";
import { runFetchChain, type ChainProgress, type ChainResult } from "@/lib/fetch-chain";
import type { ResumePoint } from "@/lib/types";
import { clearRaceStats } from "./raceStatsStore";
import { clearDetails, loadCurrent, loadRound } from "./roundStore";

export type ChainState =
  | { kind: "idle" }
  | { kind: "running"; progress: ChainProgress; roundId: string | null }
  | { kind: "done"; roundId: string; at: number }
  | { kind: "error"; result: Extract<ChainResult, { ok: false }> };

let state: ChainState = { kind: "idle" };
const listeners = new Set<() => void>();
const set = (s: ChainState) => {
  state = s;
  listeners.forEach((fn) => fn());
};

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const IDLE: ChainState = { kind: "idle" };

export function useFetchChain(): ChainState {
  return useSyncExternalStore(subscribe, () => state, () => IDLE);
}

export function clearChainError() {
  if (state.kind === "error" || state.kind === "done") set({ kind: "idle" });
}

export async function startFetchChain(opts: { from: ResumePoint; gameId: string | null; roundId: string | null }): Promise<ChainResult | null> {
  if (state.kind === "running") return null;
  set({ kind: "running", roundId: opts.roundId, progress: { step: opts.from.step, leg: null, gameDone: opts.from.step !== "GAME", legsDone: 0, statsDone: opts.from.step === "RIKTODDS", riktoddsDone: false } });
  const result = await runFetchChain(rawPost, opts, (progress) => set({ kind: "running", roundId: opts.roundId, progress }));
  const roundId = result.ok ? result.roundId : result.roundId;
  clearDetails();
  // Läs om omgången och den aktuella omgången efter varje körning, även
  // en som stannade halvvägs (det som hämtats är sparat).
  if (roundId) clearRaceStats(roundId);
  await Promise.allSettled([roundId ? loadRound(roundId) : Promise.resolve(null), loadCurrent()]);
  set(result.ok ? { kind: "done", roundId: result.roundId, at: Date.now() } : { kind: "error", result });
  return result;
}

// "Hämta igen" när statistiken saknas (S2, S2b): bara steg 10.
export function refetchStats(roundId: string) {
  clearChainError();
  return startFetchChain({ from: { step: "STATS" }, gameId: null, roundId });
}
