"use client";

// Lägena för loppet i Live (E8 6.2 och 6.3). Högst det som gäller just nu, och
// aldrig något om utfallet: "Resultatet har kommit" säger bara att det finns.

import { useOnline } from "@/components/hooks";
import { syncResults, useResultSync } from "@/components/round/resultsStore";
import { Banner } from "@/components/ui/board";
import { legName } from "@/lib/game-type";
import { READ_FAILED_TEXT, READ_FAILED_TITLE } from "@/lib/live-view";
import type { ResultMode } from "@/lib/results-ui";
import type { RaceDto } from "@/lib/types";

type Props = {
  roundId: string;
  gameType: string;
  race: RaceDto;
  mode: ResultMode;
  shown: boolean;
  // Resultatet kom medan loppet var öppet.
  arrived: boolean;
  onReveal: () => void;
  // Nytt lopp har startat medan ett annat är öppet.
  startedLeg: number | null;
  onLeg: (leg: number) => void;
  readFailed: boolean;
  onRetryRead: () => void;
};

export function LiveBanners({ roundId, gameType, race, mode, shown, arrived, onReveal, startedLeg, onLeg, readFailed, onRetryRead }: Props) {
  const sync = useResultSync(roundId);
  const online = useOnline();
  const pending = mode === "waiting" || mode === "late";
  const busy = sync.running;
  const retry = () => void syncResults(roundId, true);
  return (
    <div className="lv-bans">
      {readFailed && (
        <Banner
          tone="err"
          role="alert"
          actions={
            <button type="button" className="btn secondary sm" onClick={onRetryRead}>
              Försök igen
            </button>
          }
        >
          <b>{READ_FAILED_TITLE}</b> {READ_FAILED_TEXT}
        </Banner>
      )}
      {startedLeg !== null && (
        <Banner
          tone="warn"
          actions={
            <button type="button" className="btn secondary sm" onClick={() => onLeg(startedLeg)}>
              Byt till {legName(gameType, startedLeg)}
            </button>
          }
        >
          <b>{legName(gameType, startedLeg)} har startat.</b> Du taggar fortfarande {legName(gameType, race.leg)}.
        </Banner>
      )}
      {pending && !online && (
        <Banner tone="warn" icon="offline">
          Ingen uppkoppling. Resultatet hämtas när du är uppkopplad igen.
        </Banner>
      )}
      {pending && online && sync.failed && (
        <Banner
          tone="err"
          role="alert"
          actions={
            <button type="button" className="btn secondary sm" disabled={busy} onClick={retry}>
              {busy ? "Hämtar …" : "Försök igen"}
            </button>
          }
        >
          <b>Resultatet kunde inte hämtas.</b> ATG svarade inte. Försök igen om en stund.
        </Banner>
      )}
      {mode === "late" && online && !sync.failed && (
        <Banner
          tone="warn"
          actions={
            <button type="button" className="btn secondary sm" disabled={busy} onClick={retry}>
              {busy ? "Hämtar …" : "Hämta resultat"}
            </button>
          }
        >
          <b>Resultatet har inte kommit än.</b> ATG har inte publicerat placeringen. Den hämtas också i kväll.
        </Banner>
      )}
      {arrived && mode === "result" && !shown && (
        <Banner
          tone="info"
          actions={
            <button type="button" className="btn secondary sm" onClick={onReveal}>
              Visa resultat
            </button>
          }
        >
          <b>Resultatet har kommit.</b> Det är dolt tills du väljer att visa det.
        </Banner>
      )}
    </div>
  );
}
