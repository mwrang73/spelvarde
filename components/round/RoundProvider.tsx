"use client";

// RoundProvider (specen 9.1): hela omgången i klienten. Cachen visas direkt
// (localStorage), och omgången hämtas på nytt när providern monteras och
// när sidan syns igen. Utkorgens poster läggs ovanpå (lib/round-overlay.ts),
// så att byte av avdelning och häst aldrig behöver något nätverksanrop.
//
// Alla användaråtgärder (Intressant, Spelbar, Bet, odds, granskning och
// V85-raden) läggs i utkorgen här och syns direkt.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ApiFailure } from "@/components/api";
import { addToOutbox } from "@/components/outbox/outbox-client";
import { useOutbox } from "@/components/outbox/OutboxProvider";
import { useToast } from "@/components/ui/Toast";
import type { MarkChange } from "@/lib/marks";
import { applyPending, type CouponBody } from "@/lib/round-overlay";
import type { SpelbarInput } from "@/lib/spelbar";
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
  // E2. Spelbar "on" gör också hästen Intressant (6.1).
  setSpelbar: (race: RaceDto, start: StartDto, want: SpelbarInput) => void;
  setBet: (race: RaceDto, start: StartDto, bet: boolean) => void;
  setOdds: (race: RaceDto, start: StartDto, unibetOdds: number | null) => void;
  saveCoupon: (body: CouponBody) => void;
};

// Loppet har startat enligt klockan (RaceDto.started gäller vid hämtningen).
export const raceStarted = (race: RaceDto, now: number = Date.now()) => race.started || Date.parse(race.startAt) <= now;

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

  const toast = useToast();

  const changeMark = useCallback(
    (race: RaceDto, start: StartDto, change: MarkChange) => {
      addToOutbox({
        method: "PUT",
        url: `/api/marks/${start.id}`,
        body: change,
        meta: { kind: "mark", roundId, raceId: race.id, startId: start.id, horseName: start.horse.name },
      });
    },
    [roundId],
  );

  const setInteresting = useCallback(
    (race: RaceDto, start: StartDto, interesting: boolean) => {
      changeMark(race, start, { interesting });
      // Spelbar är en delmängd av Intressant (6.1): den försvinner med, med Ångra.
      const m = start.mark;
      if (!interesting && m?.spelbar) {
        const undo: MarkChange = m.spelbarOverride === "ON" ? { interesting: true, spelbar: "on" } : { interesting: true };
        toast({ text: "Spelbar togs också bort", action: { label: "Ångra", onClick: () => changeMark(race, start, undo) } });
      }
    },
    [changeMark, toast],
  );

  const setSpelbar = useCallback(
    (race: RaceDto, start: StartDto, want: SpelbarInput) => changeMark(race, start, want === "on" ? { interesting: true, spelbar: "on" } : { spelbar: want }),
    [changeMark],
  );
  const setBet = useCallback((race: RaceDto, start: StartDto, bet: boolean) => changeMark(race, start, { bet }), [changeMark]);
  const setOdds = useCallback((race: RaceDto, start: StartDto, unibetOdds: number | null) => changeMark(race, start, { unibetOdds }), [changeMark]);

  const saveCoupon = useCallback(
    (body: CouponBody) => addToOutbox({ method: "PUT", url: `/api/rounds/${roundId}/coupon`, body, meta: { kind: "coupon", roundId } }),
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

  const value = useMemo<RoundContextValue>(
    () => ({ roundId, data, load, refresh, setInteresting, setReviewed, setSpelbar, setBet, setOdds, saveCoupon }),
    [roundId, data, load, refresh, setInteresting, setReviewed, setSpelbar, setBet, setOdds, saveCoupon],
  );
  return <RoundContext.Provider value={value}>{children}</RoundContext.Provider>;
}

export function useRound(): RoundContextValue {
  const ctx = useContext(RoundContext);
  if (!ctx) throw new Error("useRound måste användas inom RoundProvider.");
  return ctx;
}
