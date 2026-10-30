// Kortet Regler för raden (E6 S6b, E6b 5.2): Spikar (stegare), Egna spikar
// (lista med × och knappen Välj egen spik), Max hästar per lopp (stegare) och
// Prioriterat lopp (Auto | Välj avd), och Favoritspärren med en ruta per
// avdelning.

import { forwardRef, useId } from "react";
import { FlapNumber } from "@/components/ui/board";
import { IconPlus, IconX } from "@/components/ui/icons";
import type { TippaResult } from "@/lib/tippa";
import { MAX_PER_LEG_DB_MAX, MAX_PER_LEG_MIN } from "@/lib/coupon";
import { capHelp, capValue, favHelp, favOverLimit, favStrip, favStripLabel, favValue, ownSpikValue, prioHelp, prioHelpStarted, shownCap, spikHelp } from "@/lib/tippa-text";
import { Bold } from "./RadLegCard";
import { legName } from "@/lib/game-type";

// Reglerna som de sparades vid spelstopp. prio ur legRoles (count = valda,
// field = löpande i avdelningen).
export type FrozenRules = {
  spikCount: number | null;
  allgMode: "AUTO" | "CHOSEN" | null;
  maxPerLeg: number | null;
  prio: { leg: number; kind: "ALLG" | "PRIO"; count: number; field: number } | null;
};

type Props = {
  r: TippaResult;
  // Efter spelstopp: bara Spikar, Max hästar per lopp och Prioriterat lopp, avstängda, med de sparade värdena.
  frozen?: FrozenRules | null;
  onSpik: (n: number) => void;
  onRemoveOwn: (leg: number) => void;
  onAddOwn: () => void;
  // Nytt tak: 3–30, eller null = Alla.
  onCap: (n: number | null) => void;
  onPrioAuto: () => void;
  onPrioChoose: () => void;
};

// Stegarens steg (E6b 5.2): − från Alla till största fältet − 1, + till
// största fältet eller mer ger Alla.
function capSteps(r: TippaResult): { down: number | null; up: number | null | undefined } {
  const n = shownCap(r);
  const F = r.fieldMax;
  if (n === null) return { down: F <= MAX_PER_LEG_MIN ? null : Math.max(MAX_PER_LEG_MIN, F - 1), up: undefined };
  const next = n + 1;
  return { down: n <= MAX_PER_LEG_MIN ? null : n - 1, up: next >= F || next > MAX_PER_LEG_DB_MAX ? null : next };
}

export const RadRules = forwardRef<HTMLDivElement, Props>(function RadRules({ r, frozen, onSpik, onRemoveOwn, onAddOwn, onCap, onPrioAuto, onPrioChoose }, ref) {
  const id = useId();
  const off = !!frozen;
  const own = r.legs.filter((l) => l.kind === "OWN_SPIK");
  const chosen = frozen ? frozen.allgMode === "CHOSEN" : r.allgMode === "CHOSEN" && !r.prioFallback;
  const spikValue = frozen ? (frozen.spikCount ?? "–") : r.spikEffective;
  const fullOwn = r.ownSpikes >= r.spikCap;
  const steps = capSteps(r);
  const capShown = frozen ? (frozen.maxPerLeg === null ? "Alla" : String(frozen.maxPerLeg)) : capValue(r);
  const capWord = capShown === "Alla";
  const cap = off ? null : capHelp(r);
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
                  <small>{legName(r.gameType, l.leg)}</small>
                  <button type="button" className="ibtn" aria-label={`Ta bort egen spik ${name}, ${legName(r.gameType, l.leg)}`} onClick={() => onRemoveOwn(l.leg)}>
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
        <span className="flbl" id={`${id}m`}>
          Max hästar per lopp
        </span>
        <div className="stp" role="group" aria-labelledby={`${id}m`}>
          <button type="button" aria-label="En häst färre per lopp" disabled={off || steps.down === null} onClick={() => steps.down !== null && onCap(steps.down)}>
            −
          </button>
          <output className={`num${capWord ? " word" : ""}`}>{capShown}</output>
          <button type="button" aria-label="En häst till per lopp" disabled={off || steps.up === undefined} onClick={() => steps.up !== undefined && onCap(steps.up)}>
            +
          </button>
        </div>
        {cap && (
          <p className="help">
            <Bold text={cap.text} />
            {cap.over && (
              <>
                {" "}
                <span className="rs wrn rs-inline">Över taket</span>
                {cap.over}
              </>
            )}
          </p>
        )}
      </div>

      <div className="rl">
        <span className="flbl" id={`${id}a`}>
          Prioriterat lopp
        </span>
        <span className="seg" role="group" aria-labelledby={`${id}a`}>
          <button type="button" aria-pressed={!chosen} disabled={off} onClick={onPrioAuto}>
            Auto
          </button>
          <button type="button" aria-pressed={chosen} aria-haspopup="dialog" disabled={off} onClick={onPrioChoose}>
            Välj lopp
          </button>
        </span>
        <p className="help">
          {frozen ? (
            <Bold text={prioHelpStarted(frozen.prio, frozen.allgMode, r.gameType)} />
          ) : (
            <>
              <Bold text={prioHelp(r)} />
              {chosen && (
                <>
                  {" "}
                  <button type="button" className="linkish" aria-haspopup="dialog" onClick={onPrioChoose}>
                    Byt lopp
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
