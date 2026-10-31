"use client";

// Efteranalysen för en omgång (/omgang/[id]/analys, mockupen efteranalys-tips
// del 1 A). Mobil: en kolumn. Desktop: tavlan, slutsatserna och spelen till
// vänster, Mot väntat och taggarna till höger.

import { useEffect, useState } from "react";
import { apiGet } from "@/components/api";
import { AppHeader } from "@/components/shell/AppHeader";
import { Banner, Skeleton } from "@/components/ui/board";
import type { RoundAnalysisResponse } from "@/lib/analysis-server";
import { dayDate } from "@/lib/format";
import { BoardView, Compare, Conclusions, MissedList, Plays, Tags } from "./parts";

const SHOWN = 4;

export function RoundAnalysisView({ roundId }: { roundId: string }) {
  const [data, setData] = useState<RoundAnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    apiGet<RoundAnalysisResponse>(`/api/rounds/${roundId}/analysis`)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Kunde inte hämta efteranalysen."));
  }, [roundId]);
  const back = { href: `/omgang/${roundId}`, label: "Tillbaka till omgången" };
  const sub = data ? `${data.round.gameType} · ${data.round.trackName} · ${dayDate(data.round.date)}` : "Laddar …";

  if (!data)
    return (
      <>
        <AppHeader title="Efteranalys" sub={sub} back={back} />
        <main className="page an" id="main">
          {error ? (
            <Banner tone="err" className="m10" actions={<button type="button" className="btn secondary sm" onClick={() => window.location.reload()}>Försök igen</button>}>
              Kunde inte hämta efteranalysen. {error}
            </Banner>
          ) : (
            <div className="sk-block m10" aria-busy="true" aria-label="Laddar efteranalysen">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} width={`${90 - i * 8}%`} height={18} />
              ))}
            </div>
          )}
        </main>
      </>
    );

  const a = data.analysis;
  const list = all ? a.conclusions : a.conclusions.slice(0, SHOWN);
  return (
    <>
      <AppHeader title="Efteranalys" sub={sub} back={back} />
      <main className="page an" id="main">
        <p className="help pad">Efteranalysen visar resultatet för alla lopp, också de du inte har visat.</p>
        {a.pending > 0 && (
          <Banner tone="info" className="m10">
            <b>Alla lopp har inte resultat än.</b> Analysen gäller det som är klart och uppdateras när resultaten kommer.
          </Banner>
        )}
        <div className="d2">
          <div style={{ minWidth: 0 }}>
            <BoardView b={a.board} />
            <h2 className="sl">
              <span>Slutsatser</span>
              {a.conclusions.length > SHOWN && (
                <span>
                  {SHOWN} av {a.conclusions.length} ·{" "}
                  <button type="button" className="linkish" onClick={() => setAll((v) => !v)}>
                    {all ? "Visa färre" : "Visa alla"}
                  </button>
                </span>
              )}
            </h2>
            <Conclusions list={list} />
            <h2 className="sl">
              <span>Dina spel ({a.plays.length})</span>
            </h2>
            <Plays plays={a.plays} gameType={data.round.gameType} href={(p) => `/omgang/${roundId}/avd/${p.leg}/hast/${p.startId}`} />
            {a.missed.length > 0 && (
              <>
                <h2 className="sl">
                  <span>Spelbara du inte spelade ({a.missed.length})</span>
                </h2>
                <MissedList list={a.missed} total={a.missedUnits} gameType={data.round.gameType} />
              </>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <h2 className="sl">
              <span>Mot väntat</span>
            </h2>
            <Compare groups={a.groups} />
            <h2 className="sl">
              <span>Taggar</span>
            </h2>
            <Tags tags={a.tags} />
          </div>
        </div>
      </main>
    </>
  );
}
