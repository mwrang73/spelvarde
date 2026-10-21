"use client";

// Resultathämtningen från klienten (specen e4a 6.10): POST
// /api/rounds/[id]/results, ett anrop i taget per omgång. Pollningen
// (useResultPolling i RoundProvider), knappen Hämta resultat och Försök igen
// delar samma körning och samma läge, så att resultatvyn i S2 och S1 visar
// samma "Senast kollat" och samma fel. Mönstret är detsamma som
// streckOddsStore: ett modulglobalt lager som läses med useSyncExternalStore.
//
// Läser om omgången (loadRound) när servern säger att något ändrades, eller
// när svaret visar ett annat rev eller andra resultat än cachen.

import { useEffect, useSyncExternalStore } from "react";
import { rawPost } from "@/components/api";
import { useOnline } from "@/components/hooks";
import { FAILS_FOR_ERROR, initialDelay, nextWakeAt, pollActive, retryDelay } from "@/lib/results-ui";
import type { RoundResponse, ResultsSyncResponse } from "@/lib/types";
import { getRound, loadRound } from "./roundStore";

export type ResultSync = {
  running: boolean;
  // Fel i rad (0 = senaste anropet lyckades).
  failures: number;
  // Läget "Resultatet kunde inte hämtas": 3 fel i rad, eller fel vid Hämta resultat.
  failed: boolean;
  lastAttemptAt: number | null;
  // Senaste lyckade hämtning från ATG enligt servern (Round.liveOkAt).
  syncedAt: string | null;
  // När pollningen gör nästa anrop (null = ingen pollning just nu).
  nextAt: number | null;
};

const EMPTY: ResultSync = { running: false, failures: 0, failed: false, lastAttemptAt: null, syncedAt: null, nextAt: null };
const states = new Map<string, ResultSync>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const getResultSync = (roundId: string): ResultSync => states.get(roundId) ?? EMPTY;

function patch(roundId: string, p: Partial<ResultSync>) {
  const cur = getResultSync(roundId);
  const next = { ...cur, ...p };
  if ((Object.keys(p) as (keyof ResultSync)[]).every((k) => cur[k] === next[k])) return;
  states.set(roundId, next);
  emit();
}

export function useResultSync(roundId: string): ResultSync {
  return useSyncExternalStore(
    subscribe,
    () => getResultSync(roundId),
    () => EMPTY,
  );
}

function differs(cached: RoundResponse | null, body: ResultsSyncResponse): boolean {
  if (!cached) return true;
  if (body.rev !== cached.rev) return true;
  return body.races.some((r) => {
    const c = cached.races.find((x) => x.leg === r.leg);
    return !!c && ((c.resultAt ?? null) !== (r.resultAt ?? null) || c.cancelled !== r.cancelled);
  });
}

export type SyncOutcome = "ok" | "failed" | "busy" | "stopped";

// Ett anrop. force = Hämta resultat och Försök igen (claim 15 s i stället för 50 s).
export async function syncResults(roundId: string, force = false): Promise<SyncOutcome> {
  const cur = getResultSync(roundId);
  if (cur.running) return "busy";
  patch(roundId, { running: true, lastAttemptAt: Date.now() });
  let res: { status: number; data: unknown };
  try {
    res = await rawPost(`/api/rounds/${roundId}/results`, force ? { force: true } : {});
  } catch {
    return fail(roundId, force);
  }
  if (res.status === 401 || res.status === 404 || res.status === 400) {
    // Utloggad (rawPost skickar till inloggningen) eller okänd omgång: sluta.
    patch(roundId, { running: false });
    return "stopped";
  }
  if (res.status < 200 || res.status >= 300) return fail(roundId, force);
  const body = res.data as ResultsSyncResponse;
  patch(roundId, { running: false, failures: 0, failed: false, syncedAt: body.syncedAt ?? null });
  if (body.changed || differs(getRound(roundId), body)) {
    try {
      await loadRound(roundId);
    } catch {
      // Läses om vid nästa runda eller när sidan syns igen.
    }
  }
  return "ok";
}

function fail(roundId: string, force: boolean): SyncOutcome {
  const failures = getResultSync(roundId).failures + 1;
  patch(roundId, { running: false, failures, failed: force || failures >= FAILS_FOR_ERROR });
  return "failed";
}

// Längsta fördröjningen setTimeout klarar (cirka 24 dygn).
const MAX_TIMEOUT = 2 ** 31 - 1;

// Pollningen (6.10), i RoundProvider så att den gäller i S1 och S2: var 60:e
// sekund medan ett lopp har passerat starttiden utan resultat, i högst 30 min
// efter start. Pausar när sidan inte syns och när webbläsaren är offline, och
// hämtar direkt när sidan syns igen. Efter fel 5, 10 och 15 s.
export function useResultPolling(roundId: string, data: RoundResponse | null) {
  const online = useOnline();
  // Bara det som avgör pollningen: ny data med samma lopp startar inte om den.
  const key = data ? data.races.map((r) => `${r.leg}:${r.startAt}:${r.resultAt ?? ""}:${r.cancelled ? 1 : 0}`).join("|") : "";

  useEffect(() => {
    if (!key) return;
    if (!online) {
      patch(roundId, { nextAt: null });
      return;
    }
    let timer: number | undefined;
    let dead = false;
    const races = () => getRound(roundId)?.races ?? [];
    const clear = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const wait = (ms: number, polling: boolean) => {
      clear();
      patch(roundId, { nextAt: polling ? Date.now() + ms : null });
      timer = window.setTimeout(() => void tick(), Math.min(Math.max(0, ms), MAX_TIMEOUT));
    };
    const idle = () => {
      const now = Date.now();
      const wake = nextWakeAt(races(), now);
      if (wake === null) {
        clear();
        patch(roundId, { nextAt: null });
      } else wait(wake - now + 1_000, false);
    };
    const tick = async () => {
      timer = undefined;
      if (dead || document.visibilityState === "hidden") return;
      if (!pollActive(races(), Date.now())) return idle();
      patch(roundId, { nextAt: null });
      await syncResults(roundId, false);
      if (dead) return;
      if (pollActive(races(), Date.now())) wait(retryDelay(getResultSync(roundId).failures), true);
      else idle();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        clear();
        void tick();
      } else {
        clear();
        patch(roundId, { nextAt: null });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    if (document.visibilityState !== "hidden") {
      if (pollActive(races(), Date.now())) {
        const s = getResultSync(roundId);
        wait(initialDelay(s.lastAttemptAt, s.failures, Date.now()), true);
      } else idle();
    }
    return () => {
      dead = true;
      clear();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [roundId, online, key]);
}
