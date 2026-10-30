"use client";

// Trollspöt (mockupen spelforslag-sparfordel-mockup, punkt 2 A): de 10 hästar
// som bäst matchar kriterierna för spel, innan Unibets odds finns
// (lib/trollspot.ts). Samma rader och kort per lopp som Platsspel, med
// Intressant-lampan i stället för Bet. Rangordningen finns kvar med kryssrutan
// "Högst chans först" och märket #placering.

import { useIsDesktop, useStoredFlag } from "@/components/hooks";
import { PlatsGroup, type Item } from "@/components/spel/PlatsPanel";
import { odds } from "@/lib/format";
import { byLegNumber } from "@/lib/odds-ui";
import { toleranceOf } from "@/lib/round-overlay";
import { oddsFacts, TROLL_MIN_EST, trollspot } from "@/lib/trollspot";
import type { RoundResponse } from "@/lib/types";

const CHANCE_KEY = "sv-troll-chans";

export function TrollPanel({ data, now }: { data: RoundResponse; now: number }) {
  const isDesktop = useIsDesktop();
  const tolerance = toleranceOf(data.settings);
  const { items, hasStreck, qualified } = trollspot(data.races, now, tolerance);
  const [byChance, setByChance] = useStoredFlag(CHANCE_KEY);
  const ranked: Item[] = items.map((t, i) => ({ race: t.race, start: t.start, troll: { rank: i + 1, minOdds: t.minOdds }, facts: oddsFacts(t.race, t.start, tolerance) }));
  const list = byChance ? ranked : [...ranked].sort(byLegNumber<Item>);
  const spelbara = items.filter((i) => i.start.mark?.spelbar).length;

  return (
    <>
      <div className="dsec-h">
        <h2 id="h-troll">Trollspöt · 10 hästar att bevaka</h2>
        {items.length > 0 && <span className="help">{spelbara} spelbara</span>}
      </div>
      {!hasStreck ? (
        <p className="stat-empty spel-empty">Trollspöt behöver strecket. Det kommer när V-spelet öppnar, oftast måndag. Tryck sedan Uppdatera streck.</p>
      ) : !items.length ? (
        <p className="stat-empty spel-empty">Inga hästar klarar gränsen just nu (troligt platsodds minst {odds(TROLL_MIN_EST)}), eller så har loppen startat.</p>
      ) : (
        <>
          {qualified < 10 && <p className="help spel-help">{qualified} hästar klarar gränsen.</p>}
          <details className="why">
            <summary>Så väljs listan</summary>
            <p>De 10 hästarna med högst chans till topp 3 enligt modellen, bland dem som enligt strecket troligen får minst {odds(TROLL_MIN_EST)} i platsodds.</p>
            <p>
              <b>Minst</b> är det lägsta Unibet-odds som ger spelvärde: det högsta av 2,00, riktoddset med X-faktor minus toleransen ({odds(tolerance)}) och marknadens odds.
            </p>
            <p className="help">I backtestet kom de här hästarna topp 3 i 29 % av fallen, mot 18 % för alla hästar med odds över 2,0. Listan är ett stöd att bevaka, inget spelbeslut. Du avgör själv, bland annat med X-faktorn i hästkortet.</p>
          </details>
          <div className="sortbar">
            <label className="chk">
              <input type="checkbox" checked={byChance} onChange={(e) => setByChance(e.target.checked)} />
              Högst chans först
            </label>
            <span className="help">{byChance ? "Sorterat på chans till topp 3" : "Sorterat per lopp"}</span>
          </div>
          <PlatsGroup
            title={`${items.length} hästar att bevaka`}
            items={list}
            now={now}
            guideline={data.settings?.spelbarGuideline ?? 2}
            tolerance={tolerance}
            desk={isDesktop}
            variant="spel"
            lamp
            byRace={!byChance}
            countLabel={(n) => `${n} att bevaka`}
            latestFetchId={data.latestOdds?.fetchId ?? null}
            gameType={data.round.gameType}
          />
        </>
      )}
    </>
  );
}
