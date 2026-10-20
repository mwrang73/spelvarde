"use client";

// Delar som flera vyer i omgången använder: PhaseRail, RaceTabs,
// räknarna I/S/B, märkena och riktoddset i raderna och länkarna till S4/S6.

import Link from "next/link";
import { useRef } from "react";
import { Badge, XBadge } from "@/components/ui/board";
import { IconChev } from "@/components/ui/icons";
import { odds, shortRaceName } from "@/lib/format";
import type { PhaseStep } from "@/lib/phase";
import type { RaceDto, StartDto } from "@/lib/types";
import type { XFactor } from "@/lib/xfactor";
import { riktLabel, riktX, xOf } from "@/lib/xfactor-ui";

// ---- PhaseRail --------------------------------------------------------------------------

// Rutorna är länkar till fasens vy. Live och Klart byggs i E3–E4 och är
// därför vanlig text tills vyerna finns.
export function PhaseRail({ steps, analysHref, oddsHref, className }: { steps: PhaseStep[]; analysHref: string; oddsHref?: string; className?: string }) {
  return (
    <ol className={`phase brd${className ? ` ${className}` : ""}`} aria-label="Veckans faser">
      {steps.map((s) => {
        const inner = (
          <>
            <b>
              {s.state === "done" && <span aria-hidden="true">✓ </span>}
              {s.label}
            </b>
            <small>{s.dayLabel}</small>
            {s.state === "done" && <span className="sr">, klar</span>}
          </>
        );
        return (
          <li key={s.phase} className={s.state === "done" ? "done" : undefined} aria-current={s.state === "current" ? "step" : undefined}>
            {s.phase === "ANALYS" ? <Link href={analysHref}>{inner}</Link> : s.phase === "ODDS" && oddsHref ? <Link href={oddsHref}>{inner}</Link> : <span>{inner}</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function firstTodoLeg(races: RaceDto[]): number {
  return races.find((r) => !r.reviewed)?.leg ?? 1;
}

// ---- RaceTabs ---------------------------------------------------------------------------

export function RaceTabs({ races, selected, onSelect, panelId }: { races: RaceDto[]; selected: number; onSelect: (leg: number) => void; panelId: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (to: number) => {
    const leg = Math.max(1, Math.min(races.length, to));
    onSelect(leg);
    refs.current[leg - 1]?.focus();
  };
  return (
    <div
      className="avd brd"
      role="tablist"
      aria-label="Avdelningar"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") move(selected + 1);
        else if (e.key === "ArrowLeft") move(selected - 1);
        else if (e.key === "Home") move(1);
        else if (e.key === "End") move(races.length);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {races.map((r, i) => {
        const on = r.leg === selected;
        return (
          <button
            key={r.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${r.leg}`}
            className="avd-t"
            aria-selected={on}
            aria-controls={panelId}
            tabIndex={on ? 0 : -1}
            aria-label={`Avdelning ${r.leg}, ${shortRaceName(r.name)}${r.reviewed ? ", genomgången" : ""}`}
            onClick={() => onSelect(r.leg)}
          >
            {r.leg}
            {r.reviewed && (
              <span className="tick" aria-hidden="true">
                ✓
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---- Räknare ---------------------------------------------------------------------------

// I, S och B per avdelning. Noll visas dämpat.
export function Counts({ interesting, spelbar, bet }: { interesting: number; spelbar: number; bet: number }) {
  const one = (kind: "i" | "s" | "b", n: number, label: string) => (
    <span className={n ? undefined : "dim"}>
      <span className={`bdg ${kind}`} aria-hidden="true">
        {kind.toUpperCase()}
      </span>
      <span className="num">{n}</span>
      <span className="sr"> {label}</span>
    </span>
  );
  return (
    <span className="cnt">
      {one("i", interesting, interesting === 1 ? "intressant" : "intressanta")}
      {one("s", spelbar, "spelbara")}
      {one("b", bet, "med Bet")}
    </span>
  );
}

// Märkena S, B och X/X+ efter hästnamnet (I syns som kant och namnfärg).
export function MarkBadges({ s }: { s: StartDto }) {
  return (
    <>
      {s.mark?.spelbar && <Badge kind="s" />}
      {s.mark?.bet && <Badge kind="b" />}
      <XBadge x={xOf(s.mark)} />
    </>
  );
}

// Riktoddset i raderna, "osäkert" med asterisk (S2, Lägen). Med X-faktor
// (6.8) visas riktoddset med X-faktor i --accent (X-märket står i samma rad).
// two = desktop: två rader i cellen, med "3,00 utan X" under.
export function RiktCell({ s, className = "rk num", two }: { s: StartDto; className?: string; two?: boolean }) {
  if (s.riktodds === null || s.scratched)
    return (
      <span className={className}>
        –<span className="sr"> riktodds saknas</span>
      </span>
    );
  const x = xOf(s.mark);
  const rx = riktX(s);
  const withX = x !== "NONE" && rx !== null;
  const text = odds(withX ? rx : s.riktodds);
  const unc = s.uncertain && (
    <>
      <sup aria-hidden="true">*</sup>
      <span className="sr">, osäkert</span>
    </>
  );
  if (!withX)
    return (
      <span className={`${className}${text.length > 4 ? " w" : ""}`} title={s.uncertain ? "Osäkert riktodds" : undefined}>
        <span className="sr">Riktodds </span>
        {text}
        {unc}
      </span>
    );
  const label = riktLabel(s.riktodds, x, rx);
  return (
    <span className={`${className} x${text.length > 4 ? " w" : ""}${two ? " two" : ""}`} title={`${label}${s.uncertain ? " (osäkert)" : ""}`}>
      <span className="sr">{label}</span>
      <span className="rkx" aria-hidden="true">
        {text}
      </span>
      {unc}
      {two && (
        <span className="rk0" aria-hidden="true">
          {odds(s.riktodds)} utan X
        </span>
      )}
    </span>
  );
}

// Kort form i sammanfattningsarket (S4) och S6a mobil: "rikt 3,00 → X 2,40"
// med siffrorna i fetstil (texten är riktShort i lib/xfactor-ui.ts).
export function RiktShort({ riktodds, x, rx }: { riktodds: number | null; x: XFactor; rx: number | null }) {
  const withX = x !== "NONE" && riktodds !== null && rx !== null;
  return (
    <span className="rshort">
      rikt <b>{odds(riktodds)}</b>
      {withX && (
        <>
          {" → X "}
          <b className="rkx">{odds(rx)}</b>
        </>
      )}
    </span>
  );
}

// Länkar till S4 och S6 (navigeringen inom omgången).
export function RoundLinks({ roundId, className }: { roundId: string; className?: string }) {
  return (
    <nav className={`qlinks${className ? ` ${className}` : ""}`} aria-label="Odds och spel">
      <Link className="qlink" href={`/omgang/${roundId}/spel?flik=trollspot`}>
        <span>
          Trollspöt <small className="help">10 hästar att bevaka</small>
        </span>
        <IconChev />
      </Link>
      <Link className="qlink" href={`/omgang/${roundId}/odds`}>
        <span>Unibets odds</span>
        <IconChev />
      </Link>
      <Link className="qlink" href={`/omgang/${roundId}/spel?flik=plats`}>
        <span>Spelförslag</span>
        <IconChev />
      </Link>
    </nav>
  );
}
