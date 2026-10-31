// Delarna i efteranalysen (mockupen efteranalys-tips, del 1 A): tavlan,
// slutsatserna, Mot väntat, Dina spel, Spelbara du inte spelade, taggarna och
// trenden. Används av omgångens analys och av Statistik · Över tid.

import Link from "next/link";
import { BetBadge, Badge, FlapNumber } from "@/components/ui/board";
import { IconCheck, IconChev, IconInfo, IconWarn, IconX } from "@/components/ui/icons";
import { type Board, type Conclusion, type Group, type Missed, type OverTime, type Play, type RoundAnalysis, supportLabel, UNIT_KR } from "@/lib/analysis";
import { dayDate, ordinal } from "@/lib/format";
import { legName } from "@/lib/game-type";

const fmt = (x: number, d = 2) => x.toFixed(d).replace(".", ",");
export const signedU = (x: number) => `${x > 0.004 ? "+" : x < -0.004 ? "−" : "±"}${fmt(Math.abs(x))}`;
const pct = (x: number) => `${Math.round(x * 100)} %`;
const kr = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toLocaleString("sv-SE")} kr`;
const cls = (x: number) => (x > 0.004 ? "apos" : x < -0.004 ? "aneg" : "");

export function BoardView({ b, wide }: { b: Board; wide?: boolean }) {
  return (
    <div className={`eah brd${wide ? " w4" : ""}`} role="group" aria-label="Resultat för Bet">
      <div className="bx">
        <small>Bet</small>
        <strong>{b.bets ? `${b.hits}/${b.bets}` : "–"}</strong>
        <span>{b.bets ? `träff · ${pct(b.hits / b.bets)}` : "inga spel"}</span>
      </div>
      <div className="bx">
        <small>Resultat</small>
        <strong className={cls(b.units)}>{b.counted ? signedU(b.units) : "–"}</strong>
        <span>{b.counted ? `enheter · ${kr(b.kr)}` : "inga odds"}</span>
      </div>
      {wide && (
        <>
          <div className="bx">
            <small>Snittodds</small>
            <strong>{b.avgOdds !== null ? fmt(b.avgOdds) : "–"}</strong>
            <span>på dina Bet</span>
          </div>
          <div className="bx">
            <small>Jämnt vid</small>
            <strong>{b.breakEven !== null ? pct(b.breakEven) : "–"}</strong>
            <span>träff med de oddsen</span>
          </div>
        </>
      )}
      {!wide && b.breakEven !== null && (
        <p>
          Snittodds <b>{fmt(b.avgOdds!)}</b>, så <b>{pct(b.breakEven)}</b> träff räcker för att gå jämnt. Kronor räknas med {UNIT_KR} kr per spel.
        </p>
      )}
      {b.noOdds > 0 && (
        <p>
          {b.noOdds} Bet saknar odds och räknas i träff men inte i enheter.
        </p>
      )}
    </div>
  );
}

const TONE_ICON = { good: <IconCheck />, warn: <IconWarn />, info: <IconInfo /> };
const TONE_SR = { good: "Bra: ", warn: "Se upp: ", info: "Info: " };

export function Conclusions({ list, grid }: { list: Conclusion[]; grid?: boolean }) {
  if (!list.length) return <p className="help pad">Inga slutsatser än.</p>;
  return (
    <ul className={`ccl${grid ? " g2" : ""}`} aria-label="Slutsatser">
      {list.map((c, i) => (
        <li key={i} className={c.tone}>
          <span className="ci" aria-hidden="true">
            {TONE_ICON[c.tone]}
          </span>
          <div>
            <span className="sr">{TONE_SR[c.tone]}</span>
            <p>{c.title}</p>
            <p className="s">{c.text}</p>
            {c.thin && <span className="tag thin">Tunt underlag</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Compare({ groups, flat }: { groups: Group[]; flat?: boolean }) {
  if (!groups.length) return <p className="help pad">Inga markerade hästar med resultat.</p>;
  return (
    <div className={`cmp brd${flat ? " flat" : ""}`} role="group" aria-label="Mot väntat">
      {groups.map((g) => {
        const f = g.n ? (g.hits / g.n) * 100 : 0;
        const e = g.n ? Math.min(100, (g.expected / g.n) * 100) : 0;
        const label = supportLabel(g.support);
        return (
          <div className="cr" key={g.key}>
            <span className="cl">{g.label}</span>
            <span className="antr" aria-hidden="true">
              <i style={{ width: `${f.toFixed(1)}%` }} />
              <em style={{ left: `${e.toFixed(1)}%` }} />
            </span>
            <span className="cv">
              {g.hits} av {g.n}
            </span>
            <span className="cs">
              <span className="sr">
                {g.label}: {g.hits} av {g.n} topp 3,{" "}
              </span>
              väntat <b>{fmt(g.expected, 1)}</b>{" "}
              <span className={`anvt${g.verdict === "better" ? " up" : g.verdict === "worse" ? " dn" : ""}${label ? " thin" : ""}`}>
                {g.verdict === "better" ? "Bättre" : g.verdict === "worse" ? "Sämre" : "I linje"}
                {label ? ` · ${label.toLowerCase()}` : ""}
              </span>
            </span>
          </div>
        );
      })}
      <div className="leg" aria-hidden="true">
        <span>
          <i />
          topp 3
        </span>
        <span>
          <em />
          väntat enligt riktoddset
        </span>
      </div>
    </div>
  );
}

const placeTxt = (p: { place: number | null; disqualified: boolean; galloped: boolean; hit: boolean | null }) =>
  p.hit === null ? "–" : p.disqualified ? "Diskad" : p.place && p.place >= 1 ? ordinal(p.place) : p.galloped ? "Galopp" : "Oplacerad";

export function Plays({ plays, href, gameType }: { plays: Play[]; href: (p: Play) => string; gameType: string }) {
  if (!plays.length) return <p className="help pad">Inga Bet i omgången.</p>;
  return (
    <ul className="plays" aria-label="Dina spel">
      {plays.map((p) => (
        <li key={p.startId} className="play is-b">
          <FlapNumber n={p.number} size="sm" />
          <div className="pmain">
            <span className="hl">
              <span className="sr">
                {legName(gameType, p.leg)}, nr {p.number},{" "}
              </span>
              <Link className="hn tlink" href={href(p)}>
                {p.horseName}
              </Link>
              <BetBadge odds={p.betOdds} />
              {p.xFactor !== "NONE" && <Badge kind={p.xFactor === "STARK" ? "xp" : "x"} />}
            </span>
            <span className="pm">
              {legName(gameType, p.leg)} · rikt m X <b>{(p.riktoddsX ?? p.riktodds) !== null ? fmt((p.riktoddsX ?? p.riktodds)!) : "–"}</b>
            </span>
            <span className="why">
              {p.quality && <span className={`tag ${p.quality === "good" ? "good" : "bad"}`}>{p.quality === "good" ? "Bra spel" : "Svagt spel"}</span>}
              {p.reason}
              {p.tags.length > 0 && ` · ${p.tags.join(" · ")}`}
            </span>
          </div>
          <div className="res">
            {p.hit === null ? null : p.hit ? (
              <span className="hit y">
                <IconCheck />
                Träff
              </span>
            ) : (
              <span className="hit n">
                <IconX />
                Miss
              </span>
            )}
            <span className="plx">{placeTxt(p)}</span>
            {p.units !== null && <b className={`u ${cls(p.units)}`}>{signedU(p.units)}</b>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MissedList({ list, total, gameType }: { list: Missed[]; total: number; gameType: string }) {
  if (!list.length) return null;
  return (
    <>
      <ul className="plays" aria-label="Spelbara du inte spelade">
        {list.map((m) => (
          <li key={m.startId} className="miss2">
            <FlapNumber n={m.number} size="sm" />
            <div className="pmain">
              <span className="hl">
                <span className="hn">{m.horseName}</span>
                <Badge kind="s" />
              </span>
              <span className="pm">
                {legName(gameType, m.leg)} · Unibet <b>{m.unibetOdds !== null ? fmt(m.unibetOdds) : "–"}</b> · rikt <b>{(m.riktoddsX ?? m.riktodds) !== null ? fmt((m.riktoddsX ?? m.riktodds)!) : "–"}</b>
              </span>
            </div>
            <div className="res">
              <span className="plx">{placeTxt(m)}</span>
              <b className={`u ${cls(m.units)}`}>{signedU(m.units)}</b>
            </div>
          </li>
        ))}
      </ul>
      <p className="help pad">
        {`Hade du spelat ${list.length === 1 ? "den" : `alla ${list.length}`}: ${signedU(total)} enheter. Räknat på Unibet-oddset vid start.`}
      </p>
    </>
  );
}

export function Tags({ tags, flat }: { tags: RoundAnalysis["tags"]; flat?: boolean }) {
  if (!tags.tagged) return <p className="help pad">Inga taggar. Tagga hästarna i Live efter start.</p>;
  const chips = (list: { tag: string; count: number }[]) => (
    <div className="tgc">
      {list.map((t) => (
        <span key={t.tag} className="tag">
          {t.tag} <b>×{t.count}</b>
        </span>
      ))}
    </div>
  );
  return (
    <div className={`tgw${flat ? " flat" : ""}`}>
      {tags.placed.length > 0 && (
        <div>
          <h4>
            <span className="hit y">
              <IconCheck />
              Topp 3
            </span>
          </h4>
          {chips(tags.placed)}
        </div>
      )}
      {tags.unplaced.length > 0 && (
        <div>
          <h4>
            <span className="hit n">
              <IconX />
              Utanför
            </span>
          </h4>
          {chips(tags.unplaced)}
        </div>
      )}
      <p className="help">
        Räknat på {tags.tagged} av dina {tags.horses} markerade hästar (I, S, B eller Trollspöt) som du har taggat.
      </p>
    </div>
  );
}

export function TrendBars({ rounds, trend, flat }: { rounds: OverTime["rounds"]; trend: OverTime["trend"]; flat?: boolean }) {
  const list = [...rounds].reverse();
  if (list.length < 2) return null;
  const mx = Math.max(1, ...list.map((r) => Math.abs(r.units)));
  const H = 40;
  return (
    <div className={`antrend brd${flat ? " flat" : ""}`} role="img" aria-label={`Netto i enheter per omgång: ${list.map((r) => signedU(r.units)).join(", ")}`}>
      <h3>
        <span>Netto per omgång · enheter</span>
        <span>Bet träff</span>
      </h3>
      <div className="tbars" style={{ gridTemplateColumns: `repeat(${list.length}, 1fr)` }}>
        {list.map((r) => {
          const h = (Math.abs(r.units) / mx) * H;
          return (
            <div className="tb" key={r.roundId}>
              <i className={r.units >= 0 ? "p" : "n"} style={{ height: `${h.toFixed(0)}px` }} />
              <b style={r.units >= 0 ? { bottom: `calc(50% + ${(h + 3).toFixed(0)}px)` } : { top: `calc(50% + ${(h + 3).toFixed(0)}px)` }}>{signedU(r.units)}</b>
            </div>
          );
        })}
      </div>
      <div className="tlab" style={{ gridTemplateColumns: `repeat(${list.length}, 1fr)` }}>
        {list.map((r) => (
          <span key={r.roundId}>
            {r.date.slice(8, 10)}/{Number(r.date.slice(5, 7))}
            <small>
              {r.hits}/{r.bets}
            </small>
          </span>
        ))}
      </div>
      {trend && (
        <p>
          Senaste 4: <b>{trend.recent.hitPct !== null ? pct(trend.recent.hitPct) : "–"}</b> och <b>{signedU(trend.recent.units)}</b>. De 4 före: <b>{trend.before.hitPct !== null ? pct(trend.before.hitPct) : "–"}</b> och <b>{signedU(trend.before.units)}</b>.
        </p>
      )}
    </div>
  );
}

export function RoundList({ rounds }: { rounds: OverTime["rounds"] }) {
  return (
    <ul className="olist" aria-label="Omgångar">
      {rounds.map((r) => (
        <li key={r.roundId}>
          <Link className="orow ar" href={`/omgang/${r.roundId}/analys`}>
            <span className="o-mid">
              <span className="on">
                {r.gameType} {r.trackName} · {dayDate(r.date)}
              </span>
              <span className="om">
                Bet {r.hits}/{r.bets} · efteranalys
              </span>
            </span>
            <b className={`u ${cls(r.units)}`}>{signedU(r.units)}</b>
            <IconChev />
          </Link>
        </li>
      ))}
    </ul>
  );
}
