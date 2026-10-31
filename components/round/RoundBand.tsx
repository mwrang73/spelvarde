"use client";

// Zonraden överst i analysvyn på desktop (docs/specs/analysvy-layout.md 3.2):
// Avdelning (kolumn 1–3), Fas (4–5) och Verktyg (6–8). Varje panel har sin
// rubrik inne på raden (h2.bl), och reglagen är 44 px höga.

import type { RoundResponse } from "@/lib/types";
import { PhaseRail, RaceTabs, RoundLinks, firstTodoLeg } from "./parts";

export function RoundBand({ data, leg, onSelect }: { data: RoundResponse; leg: number; onSelect: (leg: number) => void }) {
  const base = `/omgang/${data.round.id}`;
  return (
    <>
      <nav className="pn bandp band-avd" aria-label="Lopp">
        <h2 className="bl">{data.round.gameType}</h2>
        <RaceTabs gameType={data.round.gameType} races={data.races} selected={leg} onSelect={onSelect} panelId="avd-panel" variant="band" />
      </nav>
      <div className="pn bandp band-fas">
        <h2 className="bl">
          Fas
        </h2>
        <PhaseRail steps={data.phaseRail} analysHref={`${base}/avd/${firstTodoLeg(data.races)}`} oddsHref={`${base}/odds`} liveHref={`${base}/live`} activePage="ANALYS" variant="seg" />
      </div>
      <div className="pn bandp band-tool">
        <h2 className="bl">
          Verktyg
        </h2>
        <RoundLinks roundId={data.round.id} analysis={data.phase === "KLART"} variant="row" />
      </div>
    </>
  );
}
