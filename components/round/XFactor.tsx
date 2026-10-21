"use client";

// X-faktor och källstöd (specen 6.8, E2.1).
// - XFactorBlock: sektionen i hästkortet (S3 punkt 4) med lägesväljaren
//   (radiogroup), effektraden och källstödet med stegare.
// - XCycleButton: knappen i S4:s hästkort som stegar Ingen → Tror på →
//   Stark känsla → Ingen.
// All visning räknas i klienten (lib/xfactor.ts) och ändras direkt. Varje
// ändring sparas optimistiskt via utkorgen (RoundProvider).

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useOutbox } from "@/components/outbox/OutboxProvider";
import type { RaceDto, StartDto } from "@/lib/types";
import { factorText, sourceSupportText, SOURCE_SUPPORT_MAX, stepSourceSupport, X_BADGE, X_LABEL, XFACTORS, type XFactor, type XFactorSettings } from "@/lib/xfactor";
import { xEffectText, xOf } from "@/lib/xfactor-ui";
import { raceStarted, useRound } from "./RoundProvider";

// Varför X-faktorn och källstödet är låsta, eller null.
export function xLockReason(race: RaceDto, start: StartDto, now: number = Date.now()): string | null {
  if (raceStarted(race, now)) return "Loppet har startat";
  if (start.scratched) return "Hästen är struken";
  return null;
}

// Hästkortet monterar blocket med key={start.id}, så att "förra läget" för
// effektraden alltid gäller samma häst.
export function XFactorBlock({ race, start, factors, sourcesEnabled, tolerance }: { race: RaceDto; start: StartDto; factors: XFactorSettings; sourcesEnabled: number; tolerance: number }) {
  const { setXFactor, setSourceSupport } = useRound();
  const { status } = useOutbox();
  const hid = useId();
  const srcId = useId();
  const x = xOf(start.mark);
  const locked = xLockReason(race, start);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // Förra läget (för " · nu föreslagen som Spelbar"). Följer också byten
  // med tangenten X och från andra vyer.
  const seen = useRef(x);
  const [prev, setPrev] = useState<XFactor | null>(null);
  useEffect(() => {
    if (seen.current !== x) setPrev(seen.current);
    seen.current = x;
  }, [x]);

  // Statusraden ("Sparas …", "I kö (n)", "Sparat") efter första ändringen här.
  const [touched, setTouched] = useState(false);

  const choose = (v: XFactor) => {
    if (locked || v === x) return;
    setTouched(true);
    setXFactor(race, start, v);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = XFACTORS.indexOf(x);
    let to: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") to = (i + 1) % XFACTORS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") to = (i + XFACTORS.length - 1) % XFACTORS.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = XFACTORS.length - 1;
    else return;
    // Piltangenterna byter annars avdelning (RaceWorkspace).
    e.preventDefault();
    e.stopPropagation();
    if (locked) return;
    choose(XFACTORS[to]);
    refs.current[to]?.focus();
  };

  const effect = xEffectText({ riktodds: start.riktodds, unibetOdds: start.mark?.unibetOdds ?? null, x, prev, factors, tolerance });
  const n = start.mark?.sourceSupport ?? null;
  const m = sourcesEnabled;
  const max = Math.min(m, SOURCE_SUPPORT_MAX);
  const step = (delta: 1 | -1) => {
    const next = stepSourceSupport(n, m, delta);
    if (locked || next === n) return;
    setTouched(true);
    setSourceSupport(race, start, next);
  };

  return (
    <section className="hk-sec xblock" aria-labelledby={hid}>
      <h3 id={hid}>X-faktor</h3>
      <p className="help">Din egen känsla. Sänker riktoddset, så att hästen lättare blir spelbar. Appen sätter aldrig X-faktorn.</p>
      <div className="seg full xseg" role="radiogroup" aria-labelledby={hid} aria-disabled={locked ? true : undefined} onKeyDown={onKeyDown}>
        {XFACTORS.map((v, i) => {
          const on = v === x;
          return (
            <button
              key={v}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-disabled={locked ? true : undefined}
              tabIndex={on ? 0 : -1}
              onClick={() => choose(v)}
            >
              <span className="xl">
                {on && <span aria-hidden="true">✓ </span>}
                {X_LABEL[v]}
              </span>
              <span className="xf num">{factorText(v, factors)}</span>
            </button>
          );
        })}
      </div>
      {locked && <p className="help xlock">{locked}</p>}
      <p className="xeff" aria-live="polite">
        <span className="sr">X-faktor: {X_LABEL[x]}. </span>
        {effect && <span className="xeff-t">{effect}</span>}
      </p>

      <div className="xsrc" role="group" aria-labelledby={srcId}>
        <span className="flbl" id={srcId}>
          Källstöd
        </span>
        {m === 0 && n === null ? (
          <p className="xsrc-t">
            Inga påslagna källor. <Link href="/kallor">Lägg till källor</Link>
          </p>
        ) : (
          <div className="xsrc-row">
            <p className="xsrc-t">
              {sourceSupportText(n, m)}
              {n !== null && n > m && <span className="xsrc-over"> · Fler än dina påslagna källor nu</span>}
              {m === 0 && (
                <>
                  {" · "}
                  <Link href="/kallor">Lägg till källor</Link>
                </>
              )}
            </p>
            {m > 0 && (
              <div className="stp">
                <button type="button" aria-label="En källa färre" disabled={!!locked || n === 0} onClick={() => step(-1)}>
                  −
                </button>
                <output aria-live="polite" aria-label={n === null ? "Källstöd inte ifyllt" : `${n} källor`}>
                  {n ?? "–"}
                </output>
                <button type="button" aria-label="En källa till" disabled={!!locked || (n !== null && n >= max)} onClick={() => step(1)}>
                  +
                </button>
              </div>
            )}
            {n !== null && !locked && (
              <button
                type="button"
                className="linkish xsrc-clr"
                onClick={() => {
                  setTouched(true);
                  setSourceSupport(race, start, null);
                }}
              >
                Rensa
              </button>
            )}
          </div>
        )}
        {locked && <p className="help xlock">{locked}</p>}
      </div>
      {touched && <p className="help status">{status.text}</p>}
    </section>
  );
}

// Knappen i S4. Med X satt får den bärnstensgul kant och märket X/X+ i
// stället för ordet "X".
export function XCycleButton({ x, horseName, locked, onCycle }: { x: XFactor; horseName: string; locked: boolean; onCycle: (e: React.MouseEvent<HTMLButtonElement>) => void }) {
  const badge = X_BADGE[x];
  return (
    <button
      type="button"
      className={`btn secondary sm xcyc${badge ? " on" : ""}`}
      aria-label={`X-faktor för ${horseName}: ${X_LABEL[x]}. Tryck för att byta.`}
      aria-disabled={locked || undefined}
      onClick={onCycle}
    >
      {badge ? (
        <span className={`bdg ${x === "STARK" ? "xp" : "x"}`} aria-hidden="true">
          {badge}
        </span>
      ) : (
        <span aria-hidden="true">X</span>
      )}
      <span aria-hidden="true">· {X_LABEL[x]}</span>
    </button>
  );
}
