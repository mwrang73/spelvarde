// Kortet Regler för raden (E6 S6b): Spikar (stegare), Egna spikar (lista med
// × och knappen Välj egen spik), Allgardering (Auto | Välj avd) och
// Favoritspärren med en ruta per avdelning.

import { forwardRef, useId } from "react";
import { FlapNumber } from "@/components/ui/board";
import { IconPlus, IconX } from "@/components/ui/icons";
import type { TippaResult } from "@/lib/tippa";
import { allgHelp, favHelp, favOverLimit, favStrip, favStripLabel, favValue, ownSpikValue, spikHelp } from "@/lib/tippa-text";
import { Bold } from "./RadLegCard";

export type FrozenRules = { spikCount: number | null; allgMode: "AUTO" | "CHOSEN" | null; allgLeg: number | null };

type Props = {
  r: TippaResult;
  // Efter spelstopp: bara Spikar och Allgardering, avstängda, med de sparade värdena.
  frozen?: FrozenRules | null;
  onSpik: (n: number) => void;
  onRemoveOwn: (leg: number) => void;
  onAddOwn: () => void;
  onAllgAuto: () => void;
  onAllgChoose: () => void;
};

export const RadRules = forwardRef<HTMLDivElement, Props>(function RadRules({ r, frozen, onSpik, onRemoveOwn, onAddOwn, onAllgAuto, onAllgChoose }, ref) {
  const id = useId();
  const off = !!frozen;
  const own = r.legs.filter((l) => l.kind === "OWN_SPIK");
  const chosen = frozen ? frozen.allgMode === "CHOSEN" : r.allgMode === "CHOSEN" && !r.prioFallback;
  const spikValue = frozen ? (frozen.spikCount ?? "–") : r.spikEffective;
  const fullOwn = r.ownSpikes >= r.spikCap;
  return (
    <section className="rules" aria-labelledby={`${id}h`} ref={ref}>
      <h2 id={`${id}h`}>
        Regler för raden <span>{off ? "Låst vid spelstopp" : "Raden räknas om direkt"}</span>
      </h2>

      <div className="rl">
        <span className="flbl" id={`${id}s`}>
          Spikar
        </span>
        <div className="stp" role="group" aria-labelledby={`${id}s`}>
          <button type="button" aria-label="En spik färre" disabled={off || r.spikEffective <= r.spikMin} onClick={() => onSpik(r.spikEffective - 1)}>
            −
          </button>
          <output className="num">{spikValue}</output>
          <button type="button" aria-label="En spik till" disabled={off || r.spikEffective >= r.spikMax} onClick={() => onSpik(r.spikEffective + 1)}>
            +
          </button>
        </div>
        {!off && <p className="help">{spikHelp(r)}</p>}
      </div>

      {!off && (
        <div className="rl own">
          <span className="flbl">Egna spikar</span>
          <span className="rv num">{ownSpikValue(r)}</span>
          {own.length ? (
            own.map((l) => {
              const n = l.selection[0];
              const name = l.horses[0]?.name ?? l.scratched.find((s) => s.number === n)?.name ?? `Nr ${n}`;
              return (
                <div className="full osp" key={l.leg}>
                  <FlapNumber n={n} size="sm" />
                  <span className="hl">
                    <span className={`hn${l.struckOwnSpik ? " struck" : ""}`}>{name}</span>
                    {l.struckOwnSpik && <span className="rs scr">Struken</span>}
                  </span>
                  <small>Avd {l.leg}</small>
                  <button type="button" className="ibtn" aria-label={`Ta bort egen spik ${name}, avd ${l.leg}`} onClick={() => onRemoveOwn(l.leg)}>
                    <IconX />
                  </button>
                </div>
              );
            })
          ) : (
            <p className="help">Inga egna spikar. Appen väljer alla.</p>
          )}
          <button type="button" className="btn secondary add-own" aria-haspopup="dialog" disabled={fullOwn} aria-describedby={fullOwn ? `${id}f` : undefined} onClick={onAddOwn}>
            <IconPlus />
            Välj egen spik
          </button>
          {fullOwn && (
            <p className="help" id={`${id}f`}>
              Alla {r.spikCap} spikar är redan dina egna. Ta bort en först.
            </p>
          )}
        </div>
      )}

      <div className="rl">
        <span className="flbl" id={`${id}a`}>
          Allgardering
        </span>
        <span className="seg" role="group" aria-labelledby={`${id}a`}>
          <button type="button" aria-pressed={!chosen} disabled={off} onClick={onAllgAuto}>
            Auto
          </button>
          <button type="button" aria-pressed={chosen} aria-haspopup="dialog" disabled={off} onClick={onAllgChoose}>
            Välj avd
          </button>
        </span>
        <p className="help">
          {off ? (
            frozen?.allgLeg ? (
              `Avd ${frozen.allgLeg} allgarderades.`
            ) : (
              "Ingen allgardering sparades."
            )
          ) : (
            <>
              <Bold text={allgHelp(r)} />
              {chosen && (
                <>
                  {" "}
                  <button type="button" className="linkish" aria-haspopup="dialog" onClick={onAllgChoose}>
                    Byt avdelning
                  </button>
                </>
              )}
            </>
          )}
        </p>
      </div>

      {!off && (
        <div className="rl">
          <span className="flbl">Favoritspärren</span>
          <span className={`rv num${favOverLimit(r) ? " over" : ""}`}>{favValue(r)}</span>
          <div className="full favs" role="img" aria-label={favStripLabel(r)} style={{ gridTemplateColumns: `repeat(${r.legCount}, minmax(0, 1fr))` }}>
            {favStrip(r).map((c) => (
              <span key={c.leg} className={c.state === "on" ? "on" : c.state === "out" ? "out" : undefined}>
                {c.leg}
                <small>{c.small}</small>
              </span>
            ))}
          </div>
          <p className="help">
            <Bold text={favHelp(r)} />
          </p>
        </div>
      )}
    </section>
  );
});
