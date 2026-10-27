"use client";

// Trollspöt (mockupen trollspot-mockup, alternativ A): de 10 hästar som bäst
// matchar kriterierna för spel, innan Unibets odds finns (lib/trollspot.ts).
// Desktop: tabell i full bredd och rutan "Så väljs listan". Mobil: rader.

import Link from "next/link";
import { useIsDesktop } from "@/components/hooks";
import { raceStarted, useRound } from "@/components/round/RoundProvider";
import { Badge, FlapNumber, LampToggle, LowStreckTag, signalsSr } from "@/components/ui/board";
import { odds, pct } from "@/lib/format";
import { signalTags } from "@/lib/signals";
import { TROLL_MIN_EST, trollspot, type TrollItem } from "@/lib/trollspot";
import { toleranceOf } from "@/lib/round-overlay";
import type { RoundResponse } from "@/lib/types";

export function TrollPanel({ data, now }: { data: RoundResponse; now: number }) {
  const isDesktop = useIsDesktop();
  const tolerance = toleranceOf(data.settings);
  const { items, hasStreck, qualified } = trollspot(data.races, now, tolerance);
  const base = `/omgang/${data.round.id}`;
  const spelbara = items.filter((i) => i.start.mark?.spelbar).length;

  const explain = (
    <aside className="troll-why">
      <h3>Så väljs listan</h3>
      <p>De 10 hästarna med högst chans till topp 3 enligt modellen, bland dem som enligt strecket troligen får minst {odds(TROLL_MIN_EST)} i platsodds.</p>
      <p>
        <b>Minst X</b> är det lägsta Unibet-odds som ger spelvärde: det högsta av 2,00, riktoddset minus toleransen ({odds(tolerance)}) och marknadens odds.
      </p>
      <p className="help">I backtestet kom de här hästarna topp 3 i 29 % av fallen, mot 18 % för alla hästar med odds över 2,0. Listan är ett stöd att bevaka, inget spelbeslut. Du avgör själv, bland annat med X-faktorn i hästkortet.</p>
    </aside>
  );

  return (
    <>
      <div className="dsec-h">
        <h2 id="h-troll">Trollspöt · 10 hästar att bevaka</h2>
        {items.length > 0 && (
          <span className="help">
            Sorterade på chans till topp 3 · {spelbara} spelbara
          </span>
        )}
      </div>
      {!hasStreck ? (
        <p className="stat-empty spel-empty">Trollspöt behöver strecket. Det kommer när V-spelet öppnar, oftast måndag. Tryck sedan Uppdatera streck.</p>
      ) : !items.length ? (
        <p className="stat-empty spel-empty">Inga hästar klarar gränsen just nu (troligt platsodds minst {odds(TROLL_MIN_EST)}), eller så har loppen startat.</p>
      ) : (
        <div className="troll">
          <div className="troll-main">
            {qualified < 10 && <p className="help spel-help">{qualified} hästar klarar gränsen.</p>}
            {isDesktop ? (
              <div className="twrap">
                <table className="tbl ttbl">
                  <caption className="sr">Trollspöt, 10 hästar att bevaka, sorterade på chans till topp 3</caption>
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Avd</th>
                      <th scope="col">Nr</th>
                      <th scope="col">Häst · kusk</th>
                      <th scope="col">Signaler</th>
                      <th scope="col" className="r">
                        <abbr title="Chans till topp 3 enligt modellen">Chans</abbr>
                      </th>
                      <th scope="col" className="r">
                        <abbr title="Uppskattat platsodds ur strecket">Odds ≈</abbr>
                      </th>
                      <th scope="col" className="r">
                        <abbr title="Lägsta Unibet-odds för spelvärde">Minst</abbr>
                      </th>
                      <th scope="col">Unibet</th>
                      <th scope="col" className="c">
                        <abbr title="Intressant">Intr.</abbr>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <TrollRow key={it.start.id} item={it} index={i} base={base} now={now} desk />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ul className="plist">
                {items.map((it, i) => (
                  <TrollRow key={it.start.id} item={it} index={i} base={base} now={now} />
                ))}
              </ul>
            )}
          </div>
          {explain}
        </div>
      )}
    </>
  );
}

// Mobil: rutan till höger. Utan Unibet-odds: minst X. Med: Unibets odds, grönt
// över gränsen och dämpat under, med minst X i liten text under.
function MinBox({ it }: { it: TrollItem }) {
  if (it.unibet === null)
    return (
      <span className="tmin" aria-label={`Spela om Unibet ger minst ${odds(it.minOdds)}`}>
        <b className="num">{odds(it.minOdds)}</b>
        <small>minst</small>
      </span>
    );
  return (
    <span className={`tmin ${it.over ? "up" : "dn"}`} aria-label={`Unibet ${odds(it.unibet)}, ${it.over ? "över" : "under"} gränsen ${odds(it.minOdds)}`}>
      <b className="num">{odds(it.unibet)}</b>
      <small>minst {odds(it.minOdds)}</small>
    </span>
  );
}

function UnibetState({ it }: { it: TrollItem }) {
  if (it.unibet === null) return <span className="help">Ej ifyllt</span>;
  return it.over ? (
    <span className="tstate up">✓ {odds(it.unibet)} · över gränsen</span>
  ) : (
    <span className="tstate dn">
      {odds(it.unibet)} · under {odds(it.minOdds)}
    </span>
  );
}

function TrollRow({ item: it, index, base, now, desk }: { item: TrollItem; index: number; base: string; now: number; desk?: boolean }) {
  const { setInteresting } = useRound();
  const { race, start } = it;
  const on = !!start.mark?.interesting;
  const started = raceStarted(race, now);
  const href = `${base}/avd/${race.leg}/hast/${start.id}`;
  const tags = start.signals ? signalTags(start.signals) : [];
  const name = (
    <span className="hl">
      <Link className="hn tlink" href={href}>
        {start.horse.name} ›
      </Link>
      <span className="sr">{signalsSr(start.signals?.count)}</span>
      {start.signals?.lowStreck && <LowStreckTag />}
      {start.mark?.spelbar && <Badge kind="s" />}
    </span>
  );
  const lamp = <LampToggle on={on} horseName={start.horse.name} disabledReason={started ? "Loppet har startat" : null} onToggle={() => setInteresting(race, start, !on)} />;
  const chanceCell = (
    <span className="tchance">
      <b className="num">{pct(it.chance * 100, 0)}</b>
      <i aria-hidden="true" style={{ width: `${Math.round(it.chance * 100)}%` }} />
    </span>
  );
  if (desk)
    return (
      <tr className={on ? "is-i" : undefined}>
        <td className="num">{index + 1}</td>
        <td className="num">{race.leg}</td>
        <td>
          <FlapNumber n={start.number} signals={start.signals?.count} />
        </td>
        <td>
          {name}
          <span className="kt">{start.driver?.name ?? ""}</span>
        </td>
        <td>
          <span className="sigs">
            {tags.map((t) => (
              <span key={t.key} className="tag good">
                {t.text}
              </span>
            ))}
          </span>
        </td>
        <td className="r">{chanceCell}</td>
        <td className="r num">≈ {odds(it.estOdds)}</td>
        <td className="r num">
          <b>{odds(it.minOdds)}</b>
        </td>
        <td>
          <UnibetState it={it} />
        </td>
        <td className="c">{lamp}</td>
      </tr>
    );
  return (
    <li className={`brow trow${on ? " is-i" : ""}`}>
      <FlapNumber n={start.number} size="sm" signals={start.signals?.count} />
      <div className="pmain">
        {name}
        <span className="pm">
          Avd {race.leg} · chans <b className="num">{pct(it.chance * 100, 0)}</b> · ≈ {odds(it.estOdds)}
        </span>
        {tags.length > 0 && (
          <span className="sigs one">
            {tags.map((t) => (
              <span key={t.key} className="tag good">
                {t.text}
              </span>
            ))}
          </span>
        )}
      </div>
      <MinBox it={it} />
      {lamp}
    </li>
  );
}
