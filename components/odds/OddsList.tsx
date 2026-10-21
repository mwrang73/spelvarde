"use client";

// S4 Unibets odds som lista (standardläget, specen S4 och e2.2 S4): alla
// hästar markerade Intressant (och hästar med Bet), en grupp per avdelning
// sorterad på startnummer, med fältet för Unibet-oddset i raden. Oddsen
// hämtas med tavelknappen. Sist gruppen "Inte markerade (n)" (#omarkerade,
// e4a avsnitt 18: Trollspöt-hästar först, sedan spelbara odds). "En i
// taget" byter till knappsatsen (?lage=guide).

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useIsDesktop } from "@/components/hooks";
import { RefreshBanner, RefreshBoardButton } from "@/components/round/StreckOdds";
import { clearNew, useStreckOddsRun } from "@/components/round/streckOddsStore";
import { AppHeader } from "@/components/shell/AppHeader";
import { PlatsGroup, UNMARKED_HELP, unmarkedTitle, type Item } from "@/components/spel/PlatsPanel";
import { EmptyState } from "@/components/ui/board";
import { IconFlag } from "@/components/ui/icons";
import { hhmm } from "@/lib/format";
import { unmarkedItems } from "@/lib/odds-ui";
import { toleranceOf } from "@/lib/round-overlay";
import type { RoundResponse } from "@/lib/types";

export function OddsList({ data, now, onGuide }: { data: RoundResponse; now: number; onGuide: () => void }) {
  const isDesktop = useIsDesktop();
  const roundId = data.round.id;
  const base = `/omgang/${roundId}`;
  const guideline = data.settings?.spelbarGuideline ?? 2;
  const tolerance = toleranceOf(data.settings);
  const run = useStreckOddsRun(roundId);
  const newIds = useMemo(() => new Set(run?.newIds ?? []), [run?.newIds]);
  const legs = data.races
    .map((race) => ({
      race,
      items: race.starts
        .filter((s) => s.mark?.interesting || s.mark?.bet)
        .map((start) => ({ race, start }) as Item)
        .sort((a, b) => a.start.number - b.start.number),
    }))
    .filter((l) => l.items.length > 0);
  const all = legs.flatMap((l) => l.items);
  const filled = all.filter((i) => i.start.mark?.unibetOdds != null).length;
  const spelbara = all.filter((i) => i.start.mark?.spelbar).length;
  const unmarked = unmarkedItems(data.races, now, tolerance);
  const common = { now, guideline, tolerance, desk: isDesktop, variant: "odds" as const, latestFetchId: data.latestOdds?.fetchId ?? null, newIds };

  // Taggen "Ny" gäller tills vyn lämnas.
  useEffect(() => () => clearNew(roundId), [roundId]);

  // Länken "Visa n omarkerade" från en annan vy: /odds#omarkerade.
  const hasUnmarked = unmarked.length > 0;
  useEffect(() => {
    if (!hasUnmarked || window.location.hash !== "#omarkerade") return;
    const el = document.getElementById("omarkerade");
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    el.querySelector<HTMLElement>("h3, caption")?.focus({ preventScroll: true });
  }, [hasUnmarked]);

  return (
    <>
      <AppHeader title="Unibets odds" sub={`${data.round.gameType} · ${data.round.trackName}`} back={{ href: base, label: "Tillbaka till omgången" }} refresh={<RefreshBoardButton data={data} />} />
      <main className="page odds-list" id="main">
        <RefreshBanner data={data} className="m10" />
        <div className="ol-head">
          <div className="seg" role="group" aria-label="Visa">
            <button type="button" aria-pressed="true">
              Lista
            </button>
            <button type="button" aria-pressed="false" onClick={onGuide} disabled={!all.length}>
              En i taget
            </button>
          </div>
          {all.length > 0 && (
            <p className="ol-count" role="status">
              Odds <b className="num">{filled}</b> av <b className="num">{all.length}</b> · <b className="num">{spelbara}</b> spelbara
            </p>
          )}
        </div>
        {!all.length ? (
          <EmptyState icon={<IconFlag />} title="Inga intressanta hästar än" text="Markera Intressant i avdelningarna eller i Trollspöt först.">
            <Link className="btn primary" href={`${base}/spel?flik=trollspot`}>
              Till Trollspöt
            </Link>
          </EmptyState>
        ) : (
          <>
            <p className="help spel-help">Hämta Unibets odds med knappen på tavlan. Du kan också rätta ett odds i raden.</p>
            {legs.map(({ race, items }) => (
              <PlatsGroup key={race.id} title={`Avd ${race.leg} · ${hhmm(race.startAt)}`} right={`${items.filter((i) => i.start.mark?.spelbar).length} spelbara`} items={items} {...common} />
            ))}
          </>
        )}
        <PlatsGroup id="omarkerade" title={unmarkedTitle(unmarked.length)} help={UNMARKED_HELP} items={unmarked} unmarked {...common} />
      </main>
    </>
  );
}
