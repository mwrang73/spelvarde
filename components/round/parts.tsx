"use client";

// Delar som flera vyer i omgången använder: PhaseRail, RaceTabs och
// räknarna I/S/B.

import Link from "next/link";
import { useRef } from "react";
import { shortRaceName } from "@/lib/format";
import type { PhaseStep } from "@/lib/phase";
import type { RaceDto } from "@/lib/types";

// ---- PhaseRail --------------------------------------------------------------------------

// Rutorna är länkar till fasens vy. Odds, Live och Klart byggs i E2–E4 och
// är därför vanlig text tills vyerna finns.
export function PhaseRail({ steps, analysHref, className }: { steps: PhaseStep[]; analysHref: string; className?: string }) {
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
            {s.phase === "ANALYS" ? <Link href={analysHref}>{inner}</Link> : <span>{inner}</span>}
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

// I, och från E2 även S och B (som "–" tills dess).
export function Counts({ interesting }: { interesting: number }) {
  return (
    <span className="cnt">
      <span>
        <span className="bdg i" aria-hidden="true">
          I
        </span>
        <span className="num">{interesting}</span>
        <span className="sr"> intressanta</span>
      </span>
      <span className="dim" aria-hidden="true">
        <span className="bdg s">S</span>–
      </span>
      <span className="dim" aria-hidden="true">
        <span className="bdg b">B</span>–
      </span>
    </span>
  );
}
