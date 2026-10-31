"use client";

// Rutan "Omgången" på Live, bredvid resultatlistan: värdet på alla rätt, summan
// för raden och en rad per lopp. Visas bara när loppet har resultatet framme.
// Allt innehåll kommer från roundPanel, som håller resultatskyddet.

import { forwardRef } from "react";
import { FlapNumber } from "@/components/ui/board";
import { kr, thousands } from "@/lib/format";
import type { PanelRow, PanelSummary } from "@/lib/round-panel";
import { SUBMITTED_ROW_NONE } from "@/lib/submitted-row";

export const VALUE_MISSING_TEXT = "Värdet kunde inte hämtas. Det försöks igen när nästa lopp är klart.";

function Row({ row, hasRow, onSelect }: { row: PanelRow; hasRow: boolean; onSelect: (leg: number) => void }) {
  const c = row.cell;
  return (
    <li>
      <button type="button" className={`omg-row${row.current ? " cur" : ""}`} aria-current={row.current ? "true" : undefined} aria-label={row.label} onClick={() => onSelect(row.leg)}>
        <span className="omg-leg">{row.name}</span>
        {c.kind === "win" ? (
          <>
            <FlapNumber n={c.number} size="sm" />
            <span className="omg-nm" title={c.name}>
              {c.name}
            </span>
          </>
        ) : (
          <>
            <span className="nr sm off" aria-hidden="true" />
            <span className={`omg-tx${c.struck ? " struck" : ""}`}>
              {c.running && <i className="pulse" aria-hidden="true" />}
              {c.text}
            </span>
          </>
        )}
        {hasRow && <span className={`omg-v${c.kind === "win" ? (c.hit ? " y" : " n") : ""}`} aria-hidden="true">{c.kind === "win" ? (c.hit ? "✓" : "✗") : null}</span>}
      </button>
    </li>
  );
}

export const LiveRoundPanel = forwardRef<HTMLElement, { panel: PanelSummary; pending: boolean; onSelect: (leg: number) => void }>(function LiveRoundPanel({ panel, pending, onSelect }, ref) {
  const { value, score } = panel;
  return (
    <section className={`omg${score ? "" : " norow"}`} aria-label="Omgången" ref={ref}>
      <div className="brd">
        <div className="omg-val">
          <div className="omg-l">
            <span>{value?.label ?? panel.valueLabel}</span>
            {value && <span>{value.after}</span>}
          </div>
          <div className="omg-n">
            <b>{value ? kr(value.value) : "–"}</b>
            {value && <span>{thousands(value.systems)}&nbsp;system</span>}
          </div>
          {!value && !pending && <p className="omg-miss">{VALUE_MISSING_TEXT}</p>}
        </div>
        <div className="omg-r">
          {score ? (
            <>
              <span className="rad">RAD</span>
              <b>{score.text}</b>
              <span className={`omg-x ${score.verdict.tone}`}>{score.verdict.text}</span>
            </>
          ) : (
            <span className="omg-none">{SUBMITTED_ROW_NONE}</span>
          )}
        </div>
      </div>
      <ol className="omg-list">
        {panel.rows.map((r) => (
          <Row key={r.leg} row={r} hasRow={!!score} onSelect={onSelect} />
        ))}
      </ol>
    </section>
  );
});
