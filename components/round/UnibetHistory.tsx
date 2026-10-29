// Hästkortet (S3, e2.2 5b, analysvy-layout 3.4): "Unibets odds över tid". Kurvan på tavlan med
// grönt fält ovanför riktoddset och ett svagare fält för "nära", och listan
// med alla hämtningar, senaste först. Datan kommer med hästkortet
// (GET /api/starts/[id], unibetHistory, äldst först).

import { Sv } from "@/components/odds/OddsMark";
import { Skeleton } from "@/components/ui/board";
import { odds } from "@/lib/format";
import { historyChart, historyRows } from "@/lib/odds-history";
import type { MarkDto, UnibetHistoryPoint } from "@/lib/types";

type Props = {
  horseName: string;
  history: UnibetHistoryPoint[] | null;
  loading: boolean;
  // Riktoddset med X-faktor.
  rikt: number | null;
  tolerance: number;
  mark: MarkDto | null;
};

function Missing({ loading, onRetry }: { loading: boolean; onRetry?: () => void }) {
  if (loading)
    return (
      <div className="sk-block" aria-busy="true" aria-label="Laddar">
        <Skeleton width="85%" height={16} />
        <Skeleton width="75%" height={16} />
      </div>
    );
  return (
    <div className="stat-empty">
      <p>Kunde inte hämta</p>
      {onRetry && (
        <button type="button" className="btn secondary sm" onClick={onRetry}>
          Försök igen
        </button>
      )}
    </div>
  );
}

const NONE_TEXT = "Inga odds från Unibet än. Kurvan visas från två hämtningar, efter Hämta streck och odds.";

// Hela historiken: kurvan och alla hämtningar (mobilens sektion Odds och dialogen "Alla N").
export function UnibetHistory({ horseName, history, loading, rikt, tolerance, mark, onRetry }: Props & { onRetry?: () => void }) {
  if (!history) return <Missing loading={loading} onRetry={onRetry} />;
  if (!history.length) return <p className="help">{NONE_TEXT}</p>;
  return <Content horseName={horseName} history={history} rikt={rikt} tolerance={tolerance} mark={mark} />;
}

// R2 K1 på desktop (analysvy-layout 3.4): kurvan (64 px) med förklaringen på
// raden ovanför och de två senaste hämtningarna. Resten nås via "Alla N".
export function UnibetHistoryCompact({ horseName, history, loading, rikt, tolerance, mark, onRetry }: Props & { onRetry?: () => void }) {
  if (!history) return <Missing loading={loading} onRetry={onRetry} />;
  if (!history.length) return <p className="help">{NONE_TEXT}</p>;
  const chart = historyChart(history, rikt, tolerance, horseName);
  const rows = historyRows(history, rikt, tolerance, mark?.bet && mark.betAt ? { at: mark.betAt, odds: mark.betOdds } : null).slice(0, 2);
  const days = chart?.days.map((d) => d.label.toLowerCase()) ?? [];
  const span = days.length > 1 ? `${days[0]}–${days[days.length - 1]}` : (days[0] ?? "");
  return (
    <>
      {chart ? (
        <div className="tl-board tlc brd">
          <div className="k">
            <span>Plats{span && ` · ${span}`}</span>
            {chart.band && (
              <span className="lg" aria-hidden="true">
                <span>
                  <i className="lg-over" />
                  Spelbar
                </span>
                <span>
                  <i className="lg-near" />
                  Nära
                </span>
                <span>
                  <i className="lg-rikt" />
                  Rikt {odds(rikt)}
                </span>
              </span>
            )}
          </div>
          <svg viewBox={`0 0 ${chart.w} ${chart.h}`} preserveAspectRatio="none" role="img" aria-label={chart.aria}>
            {chart.band && (
              <>
                <rect className="tl-over" x={chart.band.x} y={chart.band.top} width={chart.band.w} height={Math.max(0, chart.band.riktY - chart.band.top)} />
                <rect className="tl-near" x={chart.band.x} y={chart.band.riktY} width={chart.band.w} height={Math.max(0, chart.band.nearY - chart.band.riktY)} />
                <line className="tl-nearline" x1={chart.band.x} x2={chart.w} y1={chart.band.nearY} y2={chart.band.nearY} vectorEffect="non-scaling-stroke" />
                <line className="tl-rikt" x1={chart.band.x} x2={chart.w} y1={chart.band.riktY} y2={chart.band.riktY} vectorEffect="non-scaling-stroke" />
              </>
            )}
            <polyline className="tl-line" points={chart.points.map((p) => `${p.x},${p.y}`).join(" ")} vectorEffect="non-scaling-stroke" />
            {/* Punkterna som linjer utan längd, så att de förblir runda när kurvan sträcks. */}
            {chart.points.map((p, i) => (
              <line key={i} className={`tl-dot ${p.cls ?? "none"}`} x1={p.x} x2={p.x} y1={p.y} y2={p.y} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        </div>
      ) : (
        <p className="help">Kurvan visas från två hämtningar.</p>
      )}
      <HistoryList rows={rows} label="Senaste hämtningarna" />
    </>
  );
}

function HistoryList({ rows, label }: { rows: ReturnType<typeof historyRows>; label: string }) {
  return (
    <ul className="utl" aria-label={label}>
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
      <HistoryList rows={rows} label="Alla hämtningar, senaste först" />
    </>
  );
}
