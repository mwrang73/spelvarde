"use client";

// Arken i V85-raden (E6 S6b): Ändra avdelning (A4), Välj egen spik (A5), Välj
// lopp att prioritera (E6b 5.3, ersätter Välj avdelning att allgardera) och
// Spela hos ATG (A6). Arken räknar sin
// förhandsvisning med buildRad på den tänkta ändringen; inget sparas förrän
// handlingen är gjord.

import { useEffect, useMemo, useRef, useState } from "react";
import { Banner, FlapNumber } from "@/components/ui/board";
import { IconCopy, IconExt } from "@/components/ui/icons";
import { hhmm, thousands } from "@/lib/format";
import { buildRad, type TippaHorse, type TippaLeg, type TippaLegResult, type TippaResult, type TippaRules } from "@/lib/tippa";
import { krText, legSubline, pctText, previewChangeText, previewPickedLabel, prioSheetValue, spikPreviewTexts } from "@/lib/tippa-text";
import { Kupong, type KupongLeg } from "./Kupong";
import { Bold, HorseMarks, ReasonTags } from "./RadLegCard";
import { legName } from "@/lib/game-type";

// Låsning av en avdelning som regeländring (A4 och A5): låses det valda
// prioriterade loppet blir det prioriterade loppet Auto.
export function withLock(rules: TippaRules, leg: number, picked: number[]): TippaRules {
  const locked = { ...rules.locked };
  if (picked.length) locked[leg] = [...picked].sort((a, b) => a - b);
  else delete locked[leg];
  const allg = rules.allgMode === "CHOSEN" && rules.allgLeg === leg && picked.length ? { allgMode: "AUTO" as const, allgLeg: null } : {};
  return { ...rules, locked, ...allg };
}

// Antal egna spikar om leg låses med en häst.
export const ownAfterSpik = (r: TippaResult, leg: number) => r.ownSpikes + (r.legs.find((l) => l.leg === leg)?.kind === "OWN_SPIK" ? 0 : 1);

// Fokus efter att <dialog> har öppnats (Sheet öppnar i sin effekt, efter barnens).
function useFocusOnOpen(ref: React.RefObject<HTMLElement>, selector: string) {
  useEffect(() => {
    const t = window.requestAnimationFrame(() => {
      const el = ref.current?.querySelector<HTMLElement>(selector) ?? ref.current?.querySelector<HTMLElement>("button:not(:disabled)");
      el?.focus();
    });
    return () => window.cancelAnimationFrame(t);
    // Bara när arket öppnas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function HorseChipBody({ h, on, extra }: { h: TippaHorse; on: boolean; extra?: React.ReactNode }) {
  return (
    <>
      <FlapNumber n={h.number} size="sm" />
      <span className="hcm">
        <span className="hl">
          <span className="sr">Nr {h.number}, </span>
          <span className="hc-name">{h.name}</span>
          <HorseMarks h={h} />
        </span>
        <ReasonTags codes={h.reasons} after={extra} />
      </span>
      <span className="hc-b">
        <span className="num hc-st">
          <span className="sr">Streck </span>
          {h.streck !== null ? pctText(h.streck) : "–"}
        </span>
        <span className="hc-ok" aria-hidden="true">
          {on ? "✓" : ""}
        </span>
      </span>
    </>
  );
}

function StruckChipBody({ s }: { s: { number: number; name: string } }) {
  return (
    <>
      <FlapNumber n={s.number} size="sm" />
      <span className="hcm">
        <span className="hl">
          <span className="sr">Nr {s.number}, </span>
          <span className="hc-name struck">{s.name}</span>
        </span>
        <span className="rsn">
          <span className="rs scr">Struken</span>
        </span>
      </span>
      <span className="hc-b">
        <span className="num hc-st">–</span>
        <span className="hc-ok" aria-hidden="true" />
      </span>
    </>
  );
}

// ---- A4: Ändra avdelning ----------------------------------------------------------------------

export function RadLegSheet({
  l,
  before,
  legs,
  rules,
  picked,
  touched,
  locked,
  onToggle,
  onDone,
  onRelease,
}: {
  l: TippaLegResult;
  before: TippaResult;
  legs: TippaLeg[];
  rules: TippaRules;
  picked: number[];
  touched: boolean;
  locked: boolean;
  onToggle: (n: number) => void;
  onDone: () => void;
  onRelease: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusOnOpen(ref, '.hchips button[aria-pressed="true"]');
  const after = useMemo(() => (touched ? buildRad(legs, withLock(rules, l.leg, picked)) : before), [touched, legs, rules, l.leg, picked, before]);
  const n = picked.length;
  const left = touched || locked ? previewPickedLabel(n) : `${n} ${n === 1 ? "häst" : "hästar"}`;
  const dontFit = after.status === "RULES_DONT_FIT";
  return (
    <div ref={ref} className="radsh">
      <div className="prev brd" aria-live="polite">
        <div>
          <small>{legName(rules.gameType, l.leg)}</small>
          <b>{left}</b>
        </div>
        <div>
          <small>Efter omräkning</small>
          <b className="num">{dontFit ? "Ryms inte" : `${thousands(after.rows)} ${after.rows === 1 ? "rad" : "rader"}`}</b>
          <small className="num">{dontFit ? `minst ${krText(after.minCost)}` : krText(after.cost)}</small>
        </div>
        <p>
          <Bold text={previewChangeText(before, after, l.leg, touched ? picked : undefined)} />
        </p>
      </div>
      <ul className="hchips" aria-label={`Hästar i ${legName(rules.gameType, l.leg)}, i appens ordning`}>
        {l.field.map((h) => {
          const on = picked.includes(h.number);
          const lim = l.favBanned && l.favorite?.number === h.number;
          return (
            <li key={h.number}>
              <button type="button" className="hchip hc2" aria-pressed={on} onClick={() => onToggle(h.number)}>
                <HorseChipBody h={h} on={on} extra={lim ? <span className="rs lim">Spärr</span> : undefined} />
              </button>
            </li>
          );
        })}
        {l.scratched.map((s) => {
          const on = picked.includes(s.number);
          return (
            <li key={`s${s.number}`}>
              <button type="button" className="hchip hc2" aria-pressed={on} disabled={!on} onClick={() => onToggle(s.number)}>
                <StruckChipBody s={s} />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="shbtns">
        <button type="button" className="btn primary" onClick={onDone}>
          Klar · räkna om resten
        </button>
        {(locked || touched) && (
          <button type="button" className="btn ghost" onClick={onRelease}>
            Släpp eget val
          </button>
        )}
      </div>
    </div>
  );
}

// ---- A5: Välj egen spik -----------------------------------------------------------------------

export function RadSpikSheet({ r, legs, rules, initialLeg, onConfirm, onCancel }: { r: TippaResult; legs: TippaLeg[]; rules: TippaRules; initialLeg?: number | null; onConfirm: (leg: number, number: number) => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const usable = (l: TippaLegResult) => l.kind !== "CANCELLED" && l.kind !== "NO_STARTERS";
  const firstLeg = useMemo(() => {
    if (initialLeg) return initialLeg;
    const own = new Set(r.ownSpikLegs);
    return r.spikLegs.find((x) => !own.has(x)) ?? r.legs.find((l) => usable(l) && l.kind !== "OWN_SPIK")?.leg ?? 1;
    // Bara när arket öppnas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [leg, setLeg] = useState(firstLeg);
  const cur = r.legs.find((l) => l.leg === leg)!;
  const ownNow = cur.kind === "OWN_SPIK" ? cur.selection[0] : null;
  const [pick, setPick] = useState<number | null>(ownNow);
  useFocusOnOpen(ref, '.avd-t[aria-selected="true"]');

  const chooseLeg = (x: number, focus = false) => {
    setLeg(x);
    const lx = r.legs.find((l) => l.leg === x);
    setPick(lx?.kind === "OWN_SPIK" ? lx.selection[0] : null);
    if (focus) window.requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`#rsp-t${x}`)?.focus());
  };
  const onTabKey = (e: React.KeyboardEvent) => {
    const ok = r.legs.filter(usable).map((l) => l.leg);
    const i = ok.indexOf(leg);
    let next: number | undefined;
    if (e.key === "ArrowRight") next = ok[(i + 1) % ok.length];
    else if (e.key === "ArrowLeft") next = ok[(i - 1 + ok.length) % ok.length];
    else if (e.key === "Home") next = ok[0];
    else if (e.key === "End") next = ok[ok.length - 1];
    if (next === undefined) return;
    e.preventDefault();
    chooseLeg(next, true);
  };

  const radios = cur.field.map((h) => h.number);
  const onRadioKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = pick === null ? -1 : radios.indexOf(pick);
    const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
    const next = radios[(i + d + radios.length) % radios.length];
    setPick(next);
    window.requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-n="${next}"]`)?.focus());
  };

  const after = useMemo(() => {
    if (pick === null) return null;
    const lr = withLock(rules, leg, [pick]);
    return buildRad(legs, { ...lr, spikCount: Math.max(r.spikEffective, ownAfterSpik(r, leg)) });
  }, [pick, rules, leg, legs, r]);
  const notes = after && pick !== null && pick !== ownNow ? spikPreviewTexts(r, after, leg, pick) : [];
  const appSpik = cur.kind === "SPIK" ? cur.selection[0] : null;
  const tabStop = pick ?? radios[0];

  return (
    <div ref={ref} className="radsh">
      <div className="avd" role="tablist" aria-label="Lopp" onKeyDown={onTabKey}>
        {r.legs.map((l) => {
          const has = l.kind === "OWN_SPIK";
          const off = !usable(l);
          return (
            <button
              key={l.leg}
              id={`rsp-t${l.leg}`}
              type="button"
              role="tab"
              className="avd-t"
              aria-selected={l.leg === leg}
              aria-controls="rsp-p"
              aria-disabled={off || undefined}
              aria-label={has ? `${legName(r.gameType, l.leg)}, har egen spik` : `${legName(r.gameType, l.leg)}`}
              title={l.kind === "CANCELLED" ? "Inställt lopp" : undefined}
              tabIndex={l.leg === leg ? 0 : -1}
              onClick={() => !off && chooseLeg(l.leg)}
            >
              {l.leg}
              {has && (
                <span className="tick" aria-hidden="true">
                  ✓ spik
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div id="rsp-p" role="tabpanel" aria-labelledby={`rsp-t${leg}`} className="radsh">
        {notes.length > 0 && (
          <div aria-live="polite">
            <Banner tone="warn">
              {notes.map((t, i) => (
                <span key={i}>
                  {i > 0 && " "}
                  <Bold text={t} />
                </span>
              ))}
            </Banner>
          </div>
        )}
        <ul className="hchips" role="radiogroup" aria-label={`Hästar i ${legName(r.gameType, leg)}`} onKeyDown={onRadioKey}>
          {cur.field.map((h) => {
            const on = pick === h.number;
            return (
              <li key={h.number}>
                <button type="button" role="radio" data-n={h.number} className="hchip hc2" aria-checked={on} tabIndex={h.number === tabStop ? 0 : -1} onClick={() => setPick(h.number)}>
                  <HorseChipBody h={h} on={on} extra={appSpik === h.number ? <span className="rs st">Appens spik nu</span> : undefined} />
                </button>
              </li>
            );
          })}
          {cur.scratched.map((s) => (
            <li key={`s${s.number}`}>
              <button type="button" role="radio" className="hchip hc2" aria-checked={false} disabled tabIndex={-1}>
                <StruckChipBody s={s} />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="shbtns">
        <button type="button" className="btn primary" disabled={pick === null} onClick={() => pick !== null && onConfirm(leg, pick)}>
          {ownNow !== null ? "Byt spik" : "Lägg till som spik"}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Avbryt
        </button>
      </div>
    </div>
  );
}

// ---- Välj lopp att prioritera (E6b 5.3) -------------------------------------------------------

export function RadPrioSheet({ r, legs, rules, onConfirm, onCancel }: { r: TippaResult; legs: TippaLeg[]; rules: TippaRules; onConfirm: (leg: number) => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const autoLeg = useMemo(() => buildRad(legs, { ...rules, allgMode: "AUTO", allgLeg: null }).prioLeg, [legs, rules]);
  const options = useMemo(
    () =>
      r.legs.map((l) => {
        const locked = l.kind === "OWN" || l.kind === "OWN_SPIK";
        const off = locked || l.kind === "CANCELLED" || l.kind === "NO_STARTERS";
        const res = off ? null : buildRad(legs, { ...rules, allgMode: "CHOSEN", allgLeg: l.leg });
        const wide = l.field.filter((h) => h.v >= 5 - 1e-9).length;
        const spikNow = l.kind === "SPIK" ? `Spik nu · ${l.prelim || !l.favorite ? "streck saknas" : `fav ${pctText(l.favorite.streck)}`}` : null;
        const sub = locked
          ? "Ditt val, låst"
          : l.kind === "CANCELLED"
            ? "Inställt lopp"
            : l.kind === "NO_STARTERS"
              ? "Inga startande"
              : (spikNow ?? `${legSubline(l)} · ${wide} med minst 5 %`).replace(/ %/g, "\u00a0%");
        const value = res ? prioSheetValue(res, l.leg) : null;
        return { l, off, res, sub, value };
      }),
    [r, legs, rules],
  );
  const [pick, setPick] = useState<number | null>(r.prioLeg);
  useFocusOnOpen(ref, '[role="radio"][aria-checked="true"]');
  const ok = options.filter((o) => !o.off).map((o) => o.l.leg);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = pick === null ? -1 : ok.indexOf(pick);
    const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
    const next = ok[(i + d + ok.length) % ok.length];
    setPick(next);
    window.requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-leg="${next}"]`)?.focus());
  };
  const tabStop = pick !== null && ok.includes(pick) ? pick : ok[0];
  return (
    <div ref={ref} className="radsh">
      <ul className="hchips" role="radiogroup" aria-label="Lopp" onKeyDown={onKey}>
        {options.map(({ l, off, res, sub, value }) => {
          const on = pick === l.leg;
          const fits = res && res.status !== "RULES_DONT_FIT";
          return (
            <li key={l.leg}>
              <button type="button" role="radio" data-leg={l.leg} className="hchip hc2" aria-checked={on} disabled={off} tabIndex={l.leg === tabStop ? 0 : -1} onClick={() => setPick(l.leg)}>
                <FlapNumber n={l.leg} size="sm" />
                <span className="hcm">
                  <span className="hl">
                    <span className="hc-name">
                      {legName(r.gameType, l.leg)}
                      {l.startAt ? ` · ${hhmm(l.startAt)}` : ""}
                    </span>
                    {l.leg === autoLeg && <span className="rs st">Mest öppna</span>}
                  </span>
                  <span className="help">{sub}</span>
                </span>
                <span className="hc-b">
                  {res &&
                    (fits ? (
                      <span className="num hc-st">
                        {value}
                        <small>
                          {thousands(res.rows)} {res.rows === 1 ? "rad" : "rader"}
                        </small>
                      </span>
                    ) : (
                      <span className="rs lim">Ryms inte</span>
                    ))}
                  <span className="hc-ok" aria-hidden="true">
                    {on ? "✓" : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="shbtns">
        <button type="button" className="btn primary" disabled={pick === null || !ok.includes(pick)} onClick={() => pick !== null && onConfirm(pick)}>
          {pick !== null && ok.includes(pick) ? `Prioritera ${legName(r.gameType, pick)}` : "Prioritera"}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Avbryt
        </button>
      </div>
    </div>
  );
}

// ---- A6: Spela hos ATG ------------------------------------------------------------------------

export function RadAtgSheet({
  kupong,
  rows,
  cost,
  left,
  favText,
  allgLeg,
  gameType,
  onCopy,
}: {
  kupong: KupongLeg[];
  rows: number;
  cost: number;
  left: number;
  favText: string | null;
  allgLeg: number | null;
  gameType: string;
  onCopy: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusOnOpen(ref, ".btn.primary");
  return (
    <div ref={ref} className="radsh">
      <Kupong gameType={gameType} legs={kupong} rows={rows} cost={cost} left={left} favText={favText} className="mini flat" />
      <p className="help">
        {allgLeg !== null && (
          <>
            {legName(gameType, allgLeg)} är allgarderad. Hos ATG trycker du på <b>Alla</b> i {legName(gameType, allgLeg)}.{" "}
          </>
        )}
        Texten som kopieras har loppen i ordning, och sist rader och kostnad.
      </p>
      <div className="shbtns">
        <button type="button" className="btn primary" onClick={onCopy}>
          <IconCopy />
          Kopiera texten
        </button>
        <a className="btn secondary" href={`https://www.atg.se/spel/${gameType}`} target="_blank" rel="noopener noreferrer" aria-label="Öppna ATG (öppnas i ny flik)">
          Öppna ATG
          <IconExt />
        </a>
      </div>
    </div>
  );
}
