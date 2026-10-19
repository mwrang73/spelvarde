"use client";

// "/": S1 för den aktuella omgången. Senast kända omgång (localStorage)
// visas direkt, och /api/rounds/current talar om vilken som gäller och vad
// Nästa steg är när ingen omgång finns.

import { useEffect, useState, useSyncExternalStore } from "react";
import { AppHeader } from "@/components/shell/AppHeader";
import { Banner, EmptyState } from "@/components/ui/board";
import { IconFlag } from "@/components/ui/icons";
import { useOnline } from "@/components/hooks";
import { dayDate, hhmm } from "@/lib/format";
import type { CurrentRoundResponse } from "@/lib/types";
import { useFetchChain } from "./fetchChain";
import { FetchBanners, FetchSteps, runChain } from "./FetchUi";
import { HeaderActions, OverviewSkeleton, RoundOverview } from "./RoundOverview";
import { RoundProvider } from "./RoundProvider";
import { getCurrent, getCurrentId, loadCurrent, subscribeRounds } from "./roundStore";

export function CurrentRound() {
  const current = useSyncExternalStore(subscribeRounds, getCurrent, () => null);
  const [cachedId, setCachedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setCachedId(getCurrentId());
    loadCurrent()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Kunde inte hämta omgången."))
      .finally(() => setChecked(true));
  }, []);

  const id = current ? current.round?.id ?? null : cachedId;
  if (id) {
    return (
      <RoundProvider key={id} roundId={id}>
        <RoundOverview />
      </RoundProvider>
    );
  }
  if (current && !current.round) return <NoRound current={current} />;
  return (
    <>
      <AppHeader brand title="Omgången" sub={current?.gameType ?? ""} actions={<HeaderActions roundId={null} gameId={null} />} />
      <main className="page" id="main">
        {checked && error ? (
          <Banner tone="err" className="m10" actions={<button type="button" className="btn secondary sm" onClick={() => window.location.reload()}>Försök igen</button>}>
            {error}
          </Banner>
        ) : (
          <OverviewSkeleton />
        )}
      </main>
    </>
  );
}

// Ingen omgång hämtad (EmptyState) och lägena för första hämtningen. Nästa
// steg (3.2 punkt 1) är här samma sak som tomt läge, så bara EmptyState
// visas, med nästa spel från ATG:s kalender när den är känd.
function NoRound({ current }: { current: CurrentRoundResponse }) {
  const chain = useFetchChain();
  const online = useOnline();
  const running = chain.kind === "running";
  const action = current.nextStep.action;
  const gameId = action?.type === "fetch" ? action.gameId : null;
  const game = current.nextAvailable?.game ?? null;
  return (
    <>
      <AppHeader brand title="Omgången" sub={`${current.gameType} · ingen omgång hämtad`} actions={<HeaderActions roundId={null} gameId={null} />} />
      <main className="page" id="main">
        <FetchBanners onRetry={(from, rid) => runChain(from, gameId, rid)} />
        <EmptyState icon={<IconFlag />} title="Ingen omgång hämtad" text={`Hämta veckans ${current.gameType} från ATG. Startlistan brukar finnas från söndag kväll.`}>
          {game && (
            <p className="help">
              Nästa: {game.gameType} {game.trackName ?? ""} {dayDate(game.date)}, första start {hhmm(game.firstStartAt)}
            </p>
          )}
          <button type="button" className="btn primary" disabled={!online || running} onClick={() => runChain({ step: "GAME" }, gameId, null)}>
            {running ? "Hämtar …" : "Hämta omgång"}
          </button>
          <FetchSteps state={chain} />
        </EmptyState>
      </main>
    </>
  );
}
