// Grön markering (e2.2 6.1, variant 1 · Ram) och rörelsen sedan första
// hämtningen (S4). Klassen på oddsfältet sätts av den som ritar fältet
// (`oin over|near`); här finns skillnaden `sv`, kurvan och rörelsetexten.

import { odds } from "@/lib/format";
import { movementOf, movementShort, movementSr, signedOdds, sparkPoints, svSr } from "@/lib/odds-ui";
import type { OddsClass } from "@/lib/spelbar";
import { weekdayTime } from "@/lib/streck-odds";
import type { StartDto } from "@/lib/types";

// "+0,31", "−0,07 NÄRA" eller "−0,15" under fältet (desktop: kolumnen Skillnad).
export function Sv({ diff, cls }: { diff: number | null; cls: OddsClass | null }) {
  if (diff === null) return <span className="sv">&nbsp;</span>;
  return (
    <span className={`sv${cls ? ` ${cls}` : ""}`}>
      {signedOdds(diff)}
      {cls === "near" && <i aria-hidden="true">nära</i>}
      <span className="sr">{svSr(cls, diff)}</span>
    </span>
  );
}

// Liten kurva från första hämtningen till nu, med riktoddset streckat.
export function Spark({ values, rikt, w = 44, h = 20 }: { values: number[]; rikt: number | null; w?: number; h?: number }) {
  const p = sparkPoints(values, rikt, w, h);
  if (!p) return null;
  return (
    <svg className="spk" viewBox={`0 0 ${w} ${h}`} style={{ width: w, height: h }} aria-hidden="true" focusable="false">
      {p.riktY !== null && <line x1="0" x2={w} y1={p.riktY} y2={p.riktY} />}
      <polyline points={p.points} />
      <circle cx={p.last[0]} cy={p.last[1]} r="2.4" />
    </svg>
  );
}

// Mobilen: kurvan och "▲ fr 2,20" under. Skärmläsaren får meningen.
export function MovementCell({ start, rikt }: { start: StartDto; rikt: number | null }) {
  const cur = start.mark?.unibetOdds ?? null;
  const mv = movementOf(start);
  if (mv.kind === "none") return <span className="spkc" />;
  return (
    <span className="spkc">
      {mv.kind !== "new" && <Spark values={[mv.from, cur!]} rikt={rikt} />}
      <small className={`mic${mv.kind === "up" ? " up-t" : mv.kind === "down" ? " dn-t" : ""}`} aria-hidden="true">
        {movementShort(mv, cur)}
      </small>
      <span className="sr">{movementSr(mv, weekdayTime)}</span>
    </span>
  );
}

// Desktop: kurvan 58 px, "▲ +0,25" och "från 2,20" (eller "Ny" och "första i dag 21:05").
export function TrendCell({ start, rikt, firstLabel }: { start: StartDto; rikt: number | null; firstLabel: (iso: string) => string }) {
  const cur = start.mark?.unibetOdds ?? null;
  const mv = movementOf(start);
  if (mv.kind === "none") return <span className="dim">–</span>;
  if (mv.kind === "new")
    return (
      <div className="trend">
        <div>
          <span>Ny</span>
          {mv.at && <small>första {firstLabel(mv.at)}</small>}
        </div>
      </div>
    );
  return (
    <div className="trend">
      <Spark values={[mv.from, cur!]} rikt={rikt} w={40} />
      <div>
        <span className={mv.kind === "up" ? "up-t" : mv.kind === "down" ? "dn-t" : undefined} aria-hidden="true">
          {mv.kind === "up" ? "▲\u00a0" : mv.kind === "down" ? "▼\u00a0" : "=\u00a0"}
          {signedOdds(mv.delta)}
        </span>
        <small aria-hidden="true">från&nbsp;{odds(mv.from)}</small>
        <span className="sr">{movementSr(mv, weekdayTime)}</span>
      </div>
    </div>
  );
}
