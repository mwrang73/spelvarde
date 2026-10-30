// Kupongbilden i arket Spela hos ATG (E6 S6b, A6): en kolumn per avdelning som
// på ATG:s kupong, valda nummer bärnstensgula och favoriten med ring. Rutnätet
// är dolt för skärmläsare; en .sr-text upprepar innehållet.

import { krText } from "@/lib/tippa-text";
import { thousands } from "@/lib/format";
import { legName } from "@/lib/game-type";

export type KupongLeg = {
  leg: number;
  // Rubrikens lilla text: "3 st", "Spik", "Egen", "Alla", "Eget", "Inst.".
  label: string;
  selection: number[];
  fav: number | null;
  // Alla startnummer i loppet och de strukna.
  all: number[];
  scratched: number[];
  allg: boolean;
};

export function Kupong({ gameType, legs, rows, cost, left, favText, className }: { gameType: string; legs: KupongLeg[]; rows: number; cost: number; left: number; favText: string | null; className?: string }) {
  const max = Math.max(1, ...legs.flatMap((l) => l.all));
  const srText = legs
    .map((l) => {
      if (l.allg && l.all.length) return `${legName(gameType, l.leg)}: alla, ${l.all[0]} till ${l.all[l.all.length - 1]}`;
      return `${legName(gameType, l.leg)}: ${l.selection.length ? l.selection.join(", ") : "ingen häst"}`;
    })
    .join(". ");
  const cols = { gridTemplateColumns: `repeat(${legs.length}, minmax(0, 1fr))` };
  return (
    <div className={`kup brd${className ? ` ${className}` : ""}`} role="group" aria-label="Kupongen">
      <div className="kst">
        <span>
          <b className="num">{thousands(rows)}</b> {rows === 1 ? "rad" : "rader"} · <b className="num">{krText(cost)}</b>
        </span>
        <span>
          {left < 0 ? `över ${krText(-left)}` : `kvar ${krText(left)}`}
          {favText && (
            <>
              {" "}
              · favoriten <b className="num sm">{favText}</b>
            </>
          )}
        </span>
      </div>
      <div className="kg" style={cols} aria-hidden="true">
        {legs.map((l) => (
          <span className="kh" key={`h${l.leg}`}>
            {l.leg}
            <small>{l.label}</small>
          </span>
        ))}
        {Array.from({ length: max }, (_, i) => i + 1).flatMap((n) =>
          legs.map((l) => {
            if (!l.all.includes(n)) return <span key={`${l.leg}-${n}`} className="kc nil" />;
            const cls = ["kc", l.selection.includes(n) ? "on" : "", l.fav === n ? "fv" : "", l.scratched.includes(n) ? "scr" : ""].filter(Boolean).join(" ");
            return (
              <span key={`${l.leg}-${n}`} className={cls}>
                {n}
              </span>
            );
          }),
        )}
      </div>
      <span className="sr">{srText}.</span>
      <div className="kleg" aria-hidden="true">
        <span>
          <i />
          med i raden
        </span>
        <span>
          <i className="f" />
          ring = favoriten
        </span>
      </div>
    </div>
  );
}
