"use client";

// X-faktor och källstöd (specen 6.8, E2.1, och analysvy-layout 3.4 och 5.2).
// - XFactorSeg: lägesväljaren (radiogroup) med effektraden, i valraden på
//   desktop och i mobilens sektion Riktodds.
// - SourceSupport: källstödet med stegare.
// - XCycleButton: knappen i S4:s hästkort som stegar Ingen → Tror på →
//   Stark känsla → Ingen.
// All visning räknas i klienten (lib/xfactor.ts) och ändras direkt. Varje
// ändring sparas optimistiskt via utkorgen (RoundProvider).

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
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

const X_HELP = "Din egen känsla. Sänker riktoddset, så att hästen lättare blir spelbar. Appen sätter aldrig X-faktorn.";

// Knappen i bredvid etiketten (16 px, träffyta 44) med hjälptexten i en
// popover. Esc och ett klick utanför stänger, och fokus går tillbaka till knappen.
function InfoPop({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      btn.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span className="ipop" ref={box}>
      <button ref={btn} type="button" className="ibtn16" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        i
      </button>
      <span id={id} className="ipop-b" role="note" hidden={!open}>
        {text}
      </span>
    </span>
  );
}

// X-faktorn som segment (analysvy-layout 3.4 valraden, 5.2 mobilens sektion
// Riktodds). Etikettraden har etiketten, i-knappen och effekttexten.
// Hästkortet monterar den med key={start.id}, så att "förra läget" för
// effektraden alltid gäller samma häst. onTouch = första ändringen (sparstatusen).
export function XFactorSeg({ race, start, factors, tolerance, layout, onTouch }: { race: RaceDto; start: StartDto; factors: XFactorSettings; tolerance: number; layout: "row" | "block"; onTouch: () => void }) {
  const { setXFactor } = useRound();
  const hid = useId();
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

  const choose = (v: XFactor) => {
    if (locked || v === x) return;
    onTouch();
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
    // Piltangenterna byter annars avdelning och häst (RaceWorkspace).
    e.preventDefault();
    e.stopPropagation();
    if (locked) return;
    choose(XFACTORS[to]);
    refs.current[to]?.focus();
  };

  const effect = xEffectText({ riktodds: start.riktodds, unibetOdds: start.mark?.unibetOdds ?? null, x, prev, factors, tolerance });
  return (
    <div className={layout === "row" ? "vg vg-x" : "mg"}>
      <span className="vl">
        <span id={hid}>X-faktor</span>
        <InfoPop text={X_HELP} label="Om X-faktor" />
        <span className="st" aria-live="polite">
          <span className="sr">X-faktor: {X_LABEL[x]}. </span>
          {effect ?? "sänker riktoddset"}
        </span>
      </span>
      <div className="vc">
        <div className="seg xseg" role="radiogroup" aria-labelledby={hid} aria-disabled={locked ? true : undefined} onKeyDown={onKeyDown}>
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
      </div>
      {layout === "block" && locked && <p className="help xlock">{locked}</p>}
    </div>
  );
}

// Kort status i valraden: "inte ifyllt · 3 källor", "2 av 3 källor".
const shortSupport = (n: number | null, m: number) => `${n === null ? "inte ifyllt · " : `${n} av `}${m} ${m === 1 ? "källa" : "källor"}`;

// Källstöd med stegaren (6.8, E5 S3). Förslaget från Hämta tips ("Tips säger
// 2 · Använd") skriver aldrig över Mikaels värde automatiskt.
export function SourceSupport({ race, start, sourcesEnabled, layout, onTouch }: { race: RaceDto; start: StartDto; sourcesEnabled: number; layout: "row" | "block"; onTouch: () => void }) {
  const { setSourceSupport } = useRound();
  const toast = useToast();
  const srcId = useId();
  const locked = xLockReason(race, start);
  const n = start.mark?.sourceSupport ?? null;
  const m = sourcesEnabled;
  const max = Math.min(m, SOURCE_SUPPORT_MAX);
  const support = start.tip?.support ?? 0;
  const sugg = !locked && support >= 1 && support !== n ? Math.min(support, SOURCE_SUPPORT_MAX) : null;
  const step = (delta: 1 | -1) => {
    const next = stepSourceSupport(n, m, delta);
    if (locked || next === n) return;
    onTouch();
    setSourceSupport(race, start, next);
  };
  const use = () => {
    if (sugg === null) return;
    const before = n;
    onTouch();
    setSourceSupport(race, start, sugg);
    toast({ text: `Källstödet är ${sugg}.`, action: { label: "Ångra", onClick: () => setSourceSupport(race, start, before) } });
  };
  const noSources = m === 0 && n === null;
  return (
    <div className={layout === "row" ? "vg vg-k" : "mg"} role="group" aria-labelledby={srcId}>
      <span className="vl">
        <span id={srcId}>Källstöd</span>
        <span className="st">
          {noSources ? (
            <>
              Inga påslagna källor · <Link href="/kallor">Lägg till källor</Link>
            </>
          ) : (
            <>
              {layout === "row" ? shortSupport(n, m) : sourceSupportText(n, m)}
              {n !== null && n > m && <span className="xsrc-over"> · Fler än dina påslagna källor nu</span>}
              {m === 0 && (
                <>
                  {" · "}
                  <Link href="/kallor">Lägg till källor</Link>
                </>
              )}
              {n !== null && !locked && (
                <>
                  {" · "}
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => {
                      onTouch();
                      setSourceSupport(race, start, null);
                    }}
                  >
                    Rensa
                  </button>
                </>
              )}
              {sugg !== null && (
                <>
                  {" · Tips säger "}
                  <b className="num">{sugg}</b>
                  {" · "}
                  <button type="button" className="linkish" aria-label={`Använd källstödet ${sugg} från Hämta tips`} onClick={use}>
                    Använd
                  </button>
                </>
              )}
            </>
          )}
        </span>
      </span>
      <div className="vc">
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
      </div>
      {layout === "block" && locked && <p className="help xlock">{locked}</p>}
    </div>
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
