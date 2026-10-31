"use client";

// Resultatskyddet (E8 8.1): valet Visa resultat per lopp på enheten. Ett
// modulglobalt lager som läses med useSyncExternalStore. Serverns ögonblicksbild
// är "inget visat", så ingen ritning kan blinka resultat före hydreringen.
// Tål blockerad lagring: valet gäller då till omladdning. `storage` synkar flikar.

import { useSyncExternalStore } from "react";
import { FEATURES } from "@/lib/features";
import { EMPTY_REVEAL, hideLeg, isShown, parseReveal, REVEAL_STORAGE_KEY, shownLegsOf, showLeg, type RevealState } from "@/lib/reveal";
import type { RaceDto } from "@/lib/types";

let state: RevealState | null = null;
const listeners = new Set<() => void>();
let hooked = false;

function read(): RevealState {
  if (state) return state;
  try {
    state = parseReveal(window.localStorage.getItem(REVEAL_STORAGE_KEY));
  } catch {
    state = EMPTY_REVEAL;
  }
  return state;
}

function subscribe(fn: () => void) {
  if (!hooked && typeof window !== "undefined") {
    hooked = true;
    window.addEventListener("storage", (e) => {
      if (e.key !== REVEAL_STORAGE_KEY && e.key !== null) return;
      state = parseReveal(e.newValue);
      listeners.forEach((l) => l());
    });
  }
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function write(next: RevealState) {
  if (next === state) return;
  state = next;
  try {
    window.localStorage.setItem(REVEAL_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Blockerad lagring: valet gäller till omladdning.
  }
  listeners.forEach((l) => l());
}

export const revealLeg = (roundId: string, leg: number) => write(showLeg(read(), roundId, leg));
export const concealLeg = (roundId: string, leg: number) => write(hideLeg(read(), roundId, leg));

export function useReveal(): RevealState {
  return useSyncExternalStore(subscribe, read, () => EMPTY_REVEAL);
}

// Loppen som är valda på enheten. Med flaggan av räknas alla lopp som visade.
export function useShownLegs(roundId: string, races?: readonly Pick<RaceDto, "leg">[]): readonly number[] {
  const s = useReveal();
  if (!FEATURES.raceView) return races?.map((r) => r.leg) ?? [];
  return shownLegsOf(s, roundId);
}

export { isShown };
