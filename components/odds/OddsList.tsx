"use client";

// S4 Unibets odds som lista (standardläget, specen S4 och e2.2 S4): alla
// hästar markerade Intressant (och hästar med Bet), en grupp per avdelning
// sorterad på startnummer, med fältet för Unibet-oddset i raden. Oddsen
// hämtas med tavelknappen. Sist gruppen "Inte markerade (n)" (#omarkerade,
// e4a avsnitt 18: Trollspöt-hästar först, sedan spelbara odds). "En i
// taget" byter till knappsatsen (?lage=guide).

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useIsDesktop, useStoredFlag } from "@/components/hooks";
import { RefreshBanner, RefreshBoardButton } from "@/components/round/StreckOdds";
import { clearNew, useStreckOddsRun } from "@/components/round/streckOddsStore";
import { AppHeader } from "@/components/shell/AppHeader";
import { PlatsGroup, UNMARKED_HELP, unmarkedTitle, type Item } from "@/components/spel/PlatsPanel";
import { Badge, EmptyState } from "@/components/ui/board";
import { IconFlag } from "@/components/ui/icons";
import { hhmm, odds } from "@/lib/format";
import { legName } from "@/lib/game-type";
import { showWhenPlayable, unmarkedItems } from "@/lib/odds-ui";
import { toleranceOf } from "@/lib/round-overlay";
import type { RoundResponse } from "@/lib/types";

const PLAYABLE_KEY = "sv-visa-spelbara";

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
  const common = { now, guideline, tolerance, desk: isDesktop, variant: "odds" as const, latestFetchId: data.latestOdds?.fetchId ?? null, newIds, gameType: data.round.gameType };

  // Visa spelbara: sparas i webbläsaren. Rättar du ett odds under gränsen ligger
  // hästen kvar tills filtret slås av, så att raden inte hoppar bort under fingret.
  const [playableOnly, setPlayableOnly] = useStoredFlag(PLAYABLE_KEY);
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const everyone = [...all, ...unmarked];
  const playable = everyone.filter((i) => showWhenPlayable(i.start, tolerance));
  useEffect(() => {
    if (!playableOnly) return;
    const add = playable.filter((i) => !kept.has(i.start.id));
    if (add.length) setKept((k) => new Set([...k, ...add.map((i) => i.start.id)]));
  }, [playableOnly, playable, kept]);
  const toggleFilter = () => {
    setKept(new Set());
    setPlayableOnly(!playableOnly);
  };
  const shows = (i: Item) => !playableOnly || kept.has(i.start.id) || showWhenPlayable(i.start, tolerance);
  const shownLegs = legs.map((l) => ({ ...l, items: l.items.filter(shows) })).filter((l) => l.items.length > 0);
  const shownUnmarked = unmarked.filter(shows);
  const shownCount = everyone.filter(shows).length;

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
          <div className="ol-tools">
          <div className="seg" role="group" aria-label="Visa">
            <button type="button" aria-pressed="true">
              Lista
            </button>
            <button type="button" aria-pressed="false" onClick={onGuide} disabled={!all.length}>
              En i taget
            </button>
          </div>
          {everyone.length > 0 && (
            <button type="button" className="qf" aria-pressed={playableOnly} onClick={toggleFilter}>
              <span className="ck" aria-hidden="true">
                ✓
              </span>
              <Badge kind="s" />
              Visa spelbara <span className="num">{playable.length}</span>
            </button>
          )}
          </div>
          {everyone.length > 0 && (
            <p className="ol-count" role="status">
              {playableOnly ? (
                <>
                  Visar <b className="num">{shownCount}</b> av <b className="num">{everyone.length}</b> · <b className="num">{everyone.length - shownCount}</b> dolda
                </>
              ) : (
                <>
                  Odds <b className="num">{filled}</b> av <b className="num">{all.length}</b> · <b className="num">{spelbara}</b> spelbara
                </>
              )}
            </p>
          )}
        </div>
        {!all.length ? (
          <EmptyState icon={<IconFlag />} title="Inga intressanta hästar än" text="Markera Intressant i avdelningarna eller i Trollspöt först.">
            <Link className="btn primary" href={`${base}/spel?flik=trollspot`}>
              Till Trollspöt
            </Link>
          </EmptyState>
        ) : playableOnly && shownCount === 0 ? (
          <EmptyState icon={<IconFlag />} title="Inga spelbara odds än" text={`Ingen häst har nått riktoddset eller ligger högst ${odds(tolerance)} under det. Hämta oddsen igen, eller visa alla hästar.`}>
            <button type="button" className="btn primary" onClick={toggleFilter}>
              Visa alla hästar
            </button>
          </EmptyState>
        ) : (
          <>
            <p className="help spel-help">Hämta Unibets odds med knappen på tavlan. Du kan också rätta ett odds i raden.</p>
            {shownLegs.map(({ race, items }) => (
              <PlatsGroup key={race.id} title={`${legName(data.round.gameType, race.leg)} · ${hhmm(race.startAt)}`} right={`${items.filter((i) => i.start.mark?.spelbar).length} spelbara`} items={items} {...common} />
            ))}
          </>
        )}
        <PlatsGroup id="omarkerade" title={unmarkedTitle(unmarked.length)} help={UNMARKED_HELP} items={shownUnmarked} unmarked {...common} />
      </main>
    </>
  );
}
