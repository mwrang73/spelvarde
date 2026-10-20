"use client";

// S4 Unibets platsodds som lista (standardläget): alla hästar markerade
// Intressant (och hästar med Bet), en grupp per avdelning, med fältet för
// Unibet-oddset direkt i raden (samma rad som Platsspel). "En i taget" byter
// till knappsatsen (?lage=guide). Hästar utan odds står först i varje avdelning.

import Link from "next/link";
import { useIsDesktop } from "@/components/hooks";
import { StreckRefresh } from "@/components/round/StreckRefresh";
import { AppHeader } from "@/components/shell/AppHeader";
import { PlatsGroup, type Item } from "@/components/spel/PlatsPanel";
import { EmptyState } from "@/components/ui/board";
import { IconFlag } from "@/components/ui/icons";
import { hhmm } from "@/lib/format";
import type { RoundResponse } from "@/lib/types";

export function OddsList({ data, now, onGuide }: { data: RoundResponse; now: number; onGuide: () => void }) {
  const isDesktop = useIsDesktop();
  const base = `/omgang/${data.round.id}`;
  const guideline = data.settings?.spelbarGuideline ?? 2;
  const legs = data.races
    .map((race) => ({
      race,
      items: race.starts
        .filter((s) => s.mark?.interesting || s.mark?.bet)
        .map((start) => ({ race, start }) as Item)
        .sort((a, b) => Number(a.start.mark?.unibetOdds != null) - Number(b.start.mark?.unibetOdds != null) || a.start.number - b.start.number),
    }))
    .filter((l) => l.items.length > 0);
  const all = legs.flatMap((l) => l.items);
  const filled = all.filter((i) => i.start.mark?.unibetOdds != null).length;
  const spelbara = all.filter((i) => i.start.mark?.spelbar).length;

  return (
    <>
      <AppHeader title="Unibets platsodds" sub={`${data.round.gameType} · ${data.round.trackName}`} back={{ href: base, label: "Tillbaka till omgången" }} />
      <main className="page odds-list" id="main">
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
              Odds ifyllda <b className="num">{filled}</b> av <b className="num">{all.length}</b> · <b className="num">{spelbara}</b> spelbara
            </p>
          )}
        </div>
        <StreckRefresh data={data} />
        {!all.length ? (
          <EmptyState icon={<IconFlag />} title="Inga intressanta hästar än" text="Markera Intressant i avdelningarna eller i Trollspöt först.">
            <Link className="btn primary" href={`${base}/spel?flik=trollspot`}>
              Till Trollspöt
            </Link>
          </EmptyState>
        ) : (
          <>
            <p className="help spel-help">Fyll i Unibets platsodds direkt i raden. Spelbar räknas om direkt. Minst X är det lägsta odds som ger spelvärde.</p>
            {legs.map(({ race, items }) => (
              <PlatsGroup
                key={race.id}
                title={`Avd ${race.leg} · ${hhmm(race.startAt)}`}
                right={`${items.filter((i) => i.start.mark?.unibetOdds != null).length} av ${items.length} ifyllda`}
                items={items}
                now={now}
                guideline={guideline}
                desk={isDesktop}
              />
            ))}
          </>
        )}
      </main>
    </>
  );
}
