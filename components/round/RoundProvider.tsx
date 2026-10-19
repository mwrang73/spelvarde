"use client";

// RoundProvider (specen 9.1): hela omgången i klienten. Cachen visas direkt
// (localStorage), och omgången hämtas på nytt när providern monteras och
// när sidan syns igen. Utkorgens poster läggs ovanpå (lib/round-overlay.ts),
// så att byte av avdelning och häst aldrig behöver något nätverksanrop.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ApiFailure } from "@/components/api";
import { addToOutbox } from "@/components/outbox/outbox-client";
import { useOutbox } from "@/components/outbox/OutboxProvider";
import { applyPending } from "@/lib/round-overlay";
import type { RaceDto, RoundResponse, StartDto } from "@/lib/types";
import { getRound, loadRound, subscribeRounds } from "./roundStore";

type LoadState = { loading: boolean; error: string | null; notFound: boolean };

export type RoundContextValue = {
  roundId: string;
  // Cachen med utkorgens ändringar ovanpå. null tills något finns.
  data: RoundResponse | null;
  load: LoadState;
  refresh: () => Promise<void>;
  setInteresting: (race: RaceDto, start: StartDto, interesting: boolean) => void;
  setReviewed: (race: RaceDto, reviewed: boolean) => void;
};

const RoundContext = createContext<RoundContextValue | null>(null);

export function useRoundData(roundId: string): RoundResponse | null {
  return useSyncExternalStore(
    subscribeRounds,
    () => getRound(roundId),
    () => null,
  );
}

export function RoundProvider({ roundId, children }: { roundId: string; children: React.ReactNode }) {
  const base = useRoundData(roundId);
  const { queue } = useOutbox();
  const [load, setLoad] = useState<LoadState>({ loading: true, error: null, notFound: false });

  const refresh = useCallback(async () => {
    setLoad((s) => ({ ...s, loading: true }));
    try {
      await loadRound(roundId);
      setLoad({ loading: false, error: null, notFound: false });
    } catch (e) {
      const status = e instanceof ApiFailure ? e.status : 0;
      setLoad({ loading: false, error: e instanceof Error ? e.message : "Kunde inte hämta omgången.", notFound: status === 404 || status === 400 });
    }
  }, [roundId]);

  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const data = useMemo(() => (base ? applyPending(base, queue) : null), [base, queue]);

  const setInteresting = useCallback(
    (race: RaceDto, start: StartDto, interesting: boolean) => {
      addToOutbox({
        method: "PUT",
        url: `/api/marks/${start.id}`,
        body: { interesting },
        meta: { kind: "mark", roundId, raceId: race.id, startId: start.id, horseName: start.horse.name, interesting },
      });
    },
    [roundId],
  );

  const setReviewed = useCallback(
    (race: RaceDto, reviewed: boolean) => {
      addToOutbox({
        method: "PUT",
        url: `/api/races/${race.id}/review`,
        body: { reviewed, noneInteresting: reviewed },
        meta: { kind: "review", roundId, raceId: race.id, reviewed, noneInteresting: reviewed },
      });
    },
    [roundId],
  );

  const value = useMemo<RoundContextValue>(() => ({ roundId, data, load, refresh, setInteresting, setReviewed }), [roundId, data, load, refresh, setInteresting, setReviewed]);
  return <RoundContext.Provider value={value}>{children}</RoundContext.Provider>;
}

export function useRound(): RoundContextValue {
  const ctx = useContext(RoundContext);
  if (!ctx) throw new Error("useRound måste användas inom RoundProvider.");
  return ctx;
}
