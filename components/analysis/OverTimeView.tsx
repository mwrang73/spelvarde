"use client";

// Statistik · Över tid (mockupen efteranalys-tips, del 1 A): 4 eller 8
// omgångar eller säsongen. Visas från 4 klara omgångar eller 20 Bet.

import { useEffect, useState } from "react";
import { apiGet } from "@/components/api";
import { AppHeader } from "@/components/shell/AppHeader";
import { Banner, EmptyState, Skeleton } from "@/components/ui/board";
import { IconStat } from "@/components/ui/icons";
import { OVER_TIME_MIN_BETS, OVER_TIME_MIN_ROUNDS } from "@/lib/analysis";
import type { OverTimeResponse } from "@/lib/analysis-server";
import { BoardView, Compare, Conclusions, RoundList, TrendBars } from "./parts";

type Period = "4" | "8" | "alla";
const KEY = "sv-period";

export function OverTimeView() {
  const [period, setPeriod] = useState<Period>("8");
  const [data, setData] = useState<Record<string, OverTimeResponse>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === "4" || v === "8" || v === "alla") setPeriod(v);
    } catch {
      // ingen lagring
    }
  }, []);
  useEffect(() => {
    if (data[period]) return;
    setError(null);
    apiGet<OverTimeResponse>(`/api/analysis?period=${period}`)
      .then((d) => setData((m) => ({ ...m, [period]: d })))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Kunde inte hämta statistiken."));
  }, [period, data]);
  const choose = (p: Period) => {
    setPeriod(p);
    try {
      localStorage.setItem(KEY, p);
    } catch {
      // ingen lagring
    }
  };
  const d = data[period]?.analysis;
  const seg = (
    <div className="segw">
      <div className="seg" role="group" aria-label="Period">
        {(["4", "8", "alla"] as Period[]).map((p) => (
          <button key={p} type="button" aria-pressed={period === p} onClick={() => choose(p)}>
            {p === "alla" ? "Säsong" : `${p} omg.`}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <>
      <AppHeader brand title="Statistik" sub="Över tid" />
      <main className="page an" id="main">
        {seg}
        {error ? (
          <Banner tone="err" className="m10">
            {error}
          </Banner>
        ) : !d ? (
          <div className="sk-block m10" aria-busy="true" aria-label="Laddar statistiken">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} width={`${90 - i * 8}%`} height={18} />
            ))}
          </div>
        ) : !d.rounds.length ? (
          <EmptyState icon={<IconStat />} title="Ingen statistik än" text="Statistik visas när din första omgång är klar." />
        ) : (
          <>
            {!d.enough && (
              <Banner tone="info" className="m10">
                Slutsatser över tid visas från {OVER_TIME_MIN_ROUNDS} klara omgångar eller {OVER_TIME_MIN_BETS} Bet. Nu: {d.rounds.length} {d.rounds.length === 1 ? "omgång" : "omgångar"} och {d.board.bets} Bet.
              </Banner>
            )}
            <div className="d2">
              <div style={{ minWidth: 0 }}>
                <BoardView b={d.board} wide />
                <TrendBars rounds={d.rounds} trend={d.trend} />
                {d.enough && (
                  <>
                    <h2 className="sl">
                      <span>Slutsatser</span>
                    </h2>
                    <Conclusions list={d.conclusions} />
                  </>
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                {d.enough && (
                  <>
                    <h2 className="sl">
                      <span>Mot väntat</span>
                    </h2>
                    <Compare groups={d.groups} />
                  </>
                )}
                <h2 className="sl">
                  <span>Omgångar</span>
                </h2>
                <RoundList rounds={d.rounds} />
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}
