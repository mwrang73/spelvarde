// Hästkortet (S3, e2.2 5b): "Unibets odds över tid". Kurvan på tavlan med
// grönt fält ovanför riktoddset och ett svagare fält för "nära", och listan
// med alla hämtningar, senaste först. Datan kommer med hästkortet
// (GET /api/starts/[id], unibetHistory, äldst först).

import { Sv } from "@/components/odds/OddsMark";
import { Skeleton } from "@/components/ui/board";
import { odds } from "@/lib/format";
import { historyChart, historyRows } from "@/lib/odds-history";
import type { MarkDto, UnibetHistoryPoint } from "@/lib/types";

export function UnibetHistory({
  id,
  horseName,
  history,
  loading,
  rikt,
  tolerance,
  mark,
}: {
  id: string;
  horseName: string;
  history: UnibetHistoryPoint[] | null;
  loading: boolean;
  // Riktoddset med X-faktor.
  rikt: number | null;
  tolerance: number;
  mark: MarkDto | null;
}) {
  const hid = `ut-${id}`;
  return (
    <section className="hk-sec" aria-labelledby={hid}>
      <h3 id={hid}>Unibets odds över tid</h3>
      {!history ? (
        loading ? (
          <div className="sk-block" aria-busy="true" aria-label="Laddar">
            <Skeleton width="85%" height={16} />
            <Skeleton width="75%" height={16} />
          </div>
        ) : (
          <p className="help">Kunde inte hämta Unibets odds över tid.</p>
        )
      ) : !history.length ? (
        <p className="help">Inga odds från Unibet än.</p>
      ) : (
        <Content horseName={horseName} history={history} rikt={rikt} tolerance={tolerance} mark={mark} />
      )}
    </section>
  );
}

function Content({ horseName, history, rikt, tolerance, mark }: { horseName: string; history: UnibetHistoryPoint[]; rikt: number | null; tolerance: number; mark: MarkDto | null }) {
  const chart = historyChart(history, rikt, tolerance, horseName);
  const rows = historyRows(history, rikt, tolerance, mark?.bet && mark.betAt ? { at: mark.betAt, odds: mark.betOdds } : null);
  return (
    <>
      {chart ? (
        <div className="tl-board brd">
          <div className="k">
            <span>Plats · {chart.count} hämtningar</span>
            <span>från {chart.from}</span>
          </div>
          <svg viewBox={`0 0 ${chart.w} ${chart.h}`} role="img" aria-label={chart.aria}>
            {chart.band && (
              <>
                <rect className="tl-over" x={chart.band.x} y={chart.band.top} width={chart.band.w} height={Math.max(0, chart.band.riktY - chart.band.top)} />
                <rect className="tl-near" x={chart.band.x} y={chart.band.riktY} width={chart.band.w} height={Math.max(0, chart.band.nearY - chart.band.riktY)} />
                <line className="tl-nearline" x1={chart.band.x} x2={chart.w} y1={chart.band.nearY} y2={chart.band.nearY} />
              </>
            )}
            {chart.ticks.map((t) => (
              <text key={t.v} className="tl-tick" x={chart.band ? chart.band.x - 4 : 24} y={t.y + 4} textAnchor="end">
                {odds(t.v)}
              </text>
            ))}
            {chart.band && <line className="tl-rikt" x1={chart.band.x} x2={chart.w} y1={chart.band.riktY} y2={chart.band.riktY} />}
            <polyline className="tl-line" points={chart.points.map((p) => `${p.x},${p.y}`).join(" ")} />
            {chart.points.map((p, i) => (
              <g key={i}>
                <circle className={`tl-pt ${p.cls ?? "none"}`} cx={p.x} cy={p.y} r={i === chart.points.length - 1 ? 4.2 : 3.4} />
                {p.label && (
                  <text className="tl-val" x={i === 0 ? p.x - 4 : i === chart.points.length - 1 ? p.x + 4 : p.x} y={p.y - 8} textAnchor={i === 0 ? "start" : i === chart.points.length - 1 ? "end" : "middle"}>
                    {odds(p.v)}
                  </text>
                )}
              </g>
            ))}
            {chart.days.map((d, i) => (
              <text key={d.x} className="tl-day" x={d.x} y={chart.h - 6} textAnchor={i === 0 ? "start" : d.x > chart.w - 20 ? "end" : "middle"}>
                {d.label}
              </text>
            ))}
          </svg>
          {chart.band && (
            <div className="lg" aria-hidden="true">
              <span>
                <i className="lg-over" />
                Spelbar
              </span>
              <span>
                <i className="lg-near" />
                Nära, högst {odds(tolerance)} under
              </span>
              <span>
                <i className="lg-rikt" />
                Riktodds {odds(rikt)}
              </span>
            </div>
          )}
        </div>
      ) : (
        <p className="help">Kurvan visas från två hämtningar.</p>
      )}
      <ul className="utl" aria-label="Alla hämtningar, senaste först">
        <li className="h" aria-hidden="true">
          <span>Hämtning</span>
          <span className="r">Plats</span>
          <span className="r">Vinnare</span>
        </li>
        {rows.map((r) => (
          <li key={r.key}>
            <span className="t">
              {r.when}
              {r.tags.map((t) => (
                <span key={t} className="tg">
                  {t}
                </span>
              ))}
            </span>
            <span className="pl">
              {r.place === null ? (
                <span className="dim">Struken</span>
              ) : (
                <>
                  <b className="num">{odds(r.place)}</b>
                  <Sv diff={r.diff} cls={r.cls} />
                </>
              )}
            </span>
            <span className="r num">{odds(r.win)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
