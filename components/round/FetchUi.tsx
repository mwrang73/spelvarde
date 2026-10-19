"use client";

// Hämta omgång i S1: knappar, stegraden och banderollerna för lägena i
// specens tabell (Hämtar, Delvis klar, Fel, Ingen V85, Offline).

import { useOnline } from "@/components/hooks";
import { Banner } from "@/components/ui/board";
import type { ResumePoint } from "@/lib/types";
import { clearChainError, startFetchChain, useFetchChain, type ChainState } from "./fetchChain";

export function FetchSteps({ state }: { state: ChainState }) {
  const p = state.kind === "running" ? state.progress : null;
  return (
    <div aria-live="polite" className="steps-wrap">
      {p && (
        <ol className="steps" aria-label="Hämtar omgången">
          <li className={p.gameDone ? "ok" : "cur"}>
            Startlista {p.gameDone ? <span aria-label="klar">✓</span> : "…"}
          </li>
          <li className={p.legsDone >= 8 ? "ok" : p.step === "RACE" ? "cur" : undefined}>
            {p.legsDone >= 8 ? (
              <>
                Avdelningar <span aria-label="klara">✓</span>
              </>
            ) : p.step === "RACE" && p.leg ? (
              `Avd ${p.leg} av 8 …`
            ) : (
              "Avdelningar"
            )}
          </li>
          <li className={p.statsDone ? "ok" : p.step === "STATS" ? "cur" : undefined}>
            Statistik {p.statsDone ? <span aria-label="klar">✓</span> : p.step === "STATS" ? "…" : ""}
          </li>
        </ol>
      )}
    </div>
  );
}

// Banderoller för senaste körningen och för offline.
export function FetchBanners({ onRetry }: { onRetry: (from: ResumePoint, roundId: string | null) => void }) {
  const state = useFetchChain();
  const online = useOnline();
  return (
    <>
      {!online && (
        <Banner tone="warn" icon="offline" className="m10">
          <b>Ingen uppkoppling.</b> Du ser senast sparade läge.
        </Banner>
      )}
      {state.kind === "error" && state.result.kind === "NO_V85" && (
        <Banner tone="info" className="m10">
          {state.result.message}
        </Banner>
      )}
      {state.kind === "error" && state.result.kind === "FAILED" && (
        <Banner tone="err" className="m10" role="alert" actions={<RetryButton onClick={() => onRetry(state.result.resumeFrom!, state.result.roundId)} />}>
          {state.result.message}
        </Banner>
      )}
      {state.kind === "error" && state.result.kind === "PARTIAL" && (
        <Banner tone="warn" className="m10" role="alert" actions={<RetryButton onClick={() => onRetry(state.result.resumeFrom!, state.result.roundId)} />}>
          {state.result.message}
        </Banner>
      )}
    </>
  );
}

function RetryButton({ onClick }: { onClick: () => void }) {
  const online = useOnline();
  return (
    <button type="button" className="btn secondary sm" onClick={onClick} disabled={!online}>
      Försök igen
    </button>
  );
}

export function runChain(from: ResumePoint, gameId: string | null, roundId: string | null) {
  clearChainError();
  void startFetchChain({ from, gameId, roundId });
}
