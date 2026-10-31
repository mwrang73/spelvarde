// Handlingsraden längst ned i mobilen (E6 S6b): rader och kostnad till
// vänster, Spela hos ATG till höger. Ingen aria-live (vyns live-region
// läser upp summan).

import { forwardRef, useId } from "react";
import { IconTicket } from "@/components/ui/icons";
import { thousands } from "@/lib/format";
import { BUDGET_OVER_MAX } from "@/lib/tippa";
import { SUBMITTED_ROW_STAMP } from "@/lib/submitted-row";
import { krText, wholeKr } from "@/lib/tippa-text";
import type { SubmittedRowDto } from "@/lib/types";

type Props = { rows: number; cost: number; budget: number; dontFit: boolean; blocked: string | null; submitted: SubmittedRowDto | null; started: boolean; onOpen: () => void };

export const RadActionBar = forwardRef<HTMLButtonElement, Props>(function RadActionBar({ rows, cost, budget, dontFit, blocked, submitted, started, onOpen }, ref) {
  const id = useId();
  const left = Math.round((budget - cost) * 100) / 100;
  return (
    <div className="actbar m-only">
      <div className="ab">
        {submitted ? (
          <>
            <span>
              <b className="ab-st">{SUBMITTED_ROW_STAMP}</b>
            </span>
            <span>
              <b className="num">{thousands(submitted.rows)}</b> {submitted.rows === 1 ? "rad" : "rader"} · <b className="num">{krText(submitted.cost)}</b>
            </span>
          </>
        ) : dontFit ? (
          <>
            <span>
              <b>Ingen rad</b>
            </span>
            <span>Ryms inte i {wholeKr(budget)}</span>
          </>
        ) : (
          <>
            <span>
              <b className="num">{thousands(rows)}</b> {rows === 1 ? "rad" : "rader"} · <b className="num">{krText(cost)}</b>
            </span>
            {left < 0 ? <span className={cost > budget * (1 + BUDGET_OVER_MAX) + 1e-9 ? "down" : undefined}>{krText(-left)} över {wholeKr(budget)}</span> : <span>Inte markerad som inlämnad</span>}
          </>
        )}
      </div>
      <button ref={ref} type="button" className={`btn ${started ? "secondary" : "primary"}`} aria-haspopup="dialog" disabled={!!blocked} aria-describedby={blocked ? `${id}b` : undefined} onClick={onOpen}>
        <IconTicket />
        {started ? "Visa kupongen" : "Spela hos ATG"}
      </button>
      {blocked && (
        <span className="sr" id={`${id}b`}>
          {blocked}
        </span>
      )}
    </div>
  );
});
