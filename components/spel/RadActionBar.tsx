// Handlingsraden längst ned i mobilen (E6 S6b): rader och kostnad till
// vänster, Kopiera till ATG till höger. Ingen aria-live (vyns live-region
// läser upp summan).

import { forwardRef, useId } from "react";
import { IconCopy } from "@/components/ui/icons";
import { thousands } from "@/lib/format";
import { krText, wholeKr } from "@/lib/tippa-text";

type Props = { rows: number; cost: number; budget: number; dontFit: boolean; blocked: string | null; onCopy: () => void };

export const RadActionBar = forwardRef<HTMLButtonElement, Props>(function RadActionBar({ rows, cost, budget, dontFit, blocked, onCopy }, ref) {
  const id = useId();
  const left = Math.round((budget - cost) * 100) / 100;
  return (
    <div className="actbar m-only">
      <div className="ab">
        {dontFit ? (
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
            {left < 0 ? <span className="down">Över budget med {krText(-left)}</span> : <span>Kvar {krText(left)} av {wholeKr(budget)}</span>}
          </>
        )}
      </div>
      <button ref={ref} type="button" className="btn primary" aria-haspopup="dialog" disabled={!!blocked} aria-describedby={blocked ? `${id}b` : undefined} onClick={onCopy}>
        <IconCopy />
        Kopiera till ATG
      </button>
      {blocked && (
        <span className="sr" id={`${id}b`}>
          {blocked}
        </span>
      )}
    </div>
  );
});
