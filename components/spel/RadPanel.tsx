"use client";

// S6b V85-raden (specen S6b och 6.5): budget, rader, kostnad och kvar på
// tavlan, valda hästar per avdelning med Stepper, arket "Eget val" som låser
// avdelningen, Föreslå inom budget och Kopiera rad.
//
// Kupongen sparas automatiskt: varje ändring visas direkt och läggs i
// utkorgen efter en kort paus (PUT med hela kupongen, idempotent). Rader och
// kostnad räknas i klienten (lib/coupon.ts).

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { apiRequest } from "@/components/api";
import { copyText } from "@/components/clipboard";
import { raceStarted, useRound } from "@/components/round/RoundProvider";
import { patchRound } from "@/components/round/roundStore";
import { Badge, Banner, FlapNumber } from "@/components/ui/board";
import { IconCopy, IconLock, IconPen, IconWarn } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { BUDGET_SLIDER, couponText, DEFAULT_BUDGET, suggestCoupon, type CouponLeg, type Selections } from "@/lib/coupon";
import { BUDGET_ERROR, couponBody, couponLegs, couponSummary, legMax, parseBudget, parseRowPrice, ROW_PRICE_ERROR, selectionsOf, stepLeg, toggleNumber } from "@/lib/coupon-ui";
import { hhmm, odds, pct, shortRaceName, thousands } from "@/lib/format";
import type { CouponBody } from "@/lib/round-overlay";
import type { RaceDto, RoundResponse, SettingsDto } from "@/lib/types";

const SAVE_DELAY_MS = 600;
const krs = (x: number) => `${x.toFixed(2).replace(".", ",")} kr`;

type Draft = { budget: number; rowPrice: number | null; selections: Selections; locked: number[] };

export function RadPanel({ data, now }: { data: RoundResponse; now: number }) {
  const { saveCoupon } = useRound();
  const toast = useToast();
  const roundId = data.round.id;
  const saved = data.coupon;
  const settingsRowPrice = data.settings?.rowPrice ?? 0.5;

  // Ändringar som inte har lagts i utkorgen än (paus på 600 ms).
  const [draft, setDraft] = useState<Draft | null>(null);
  const pending = useRef<Draft | null>(null);
  const timer = useRef<number | null>(null);

  const current: Draft = useMemo(
    () => draft ?? { budget: saved?.budget ?? DEFAULT_BUDGET, rowPrice: saved ? saved.rowPrice : null, selections: selectionsOf(saved), locked: saved?.lockedLegs ?? [] },
    [draft, saved],
  );
  const rowPrice = current.rowPrice ?? settingsRowPrice;

  const flush = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const d = pending.current;
    pending.current = null;
    if (!d) return;
    const body: CouponBody = couponBody(d.budget, d.rowPrice, d.selections, d.locked);
    saveCoupon(body);
    setDraft(null);
  }, [saveCoupon]);

  const change = useCallback(
    (fn: (d: Draft) => Draft) => {
      const next = fn(pending.current ?? current);
      pending.current = next;
      setDraft(next);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
    },
    [current, flush],
  );

  // Sparas också när vyn lämnas och när sidan döljs.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [flush]);

  const legs = useMemo(() => couponLegs(data), [data]);
  const summary = couponSummary(current.selections, current.budget, rowPrice);
  const roundStarted = data.races.some((r) => raceStarted(r, now));
  const [sheetLeg, setSheetLeg] = useState<number | null>(null);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);

  const suggest = () => {
    const started = legs.map((l) => ({ ...l, started: l.started || raceStarted(data.races.find((r) => r.leg === l.leg)!, now) }));
    change((d) => ({ ...d, selections: suggestCoupon(started, { budget: d.budget, rowPrice, locked: d.locked, current: d.selections }) }));
  };

  const copy = async () => {
    const text = couponText({ trackName: data.round.trackName, date: data.round.date }, current.selections, rowPrice);
    if (await copyText(text)) toast({ text: "Raden är kopierad. Klistra in hos ATG." });
    else setCopyFallback(text);
  };

  const openLeg = legs.find((l) => l.leg === sheetLeg) ?? null;
  const openRace = data.races.find((r) => r.leg === sheetLeg) ?? null;

  return (
    <>
      <div className="dsec-h">
        <h2 id="h-rad">V85-rad</h2>
        <span className="help d-only">Spelbara och intressanta först</span>
      </div>
      {roundStarted && (
        <Banner tone="info" className="m10">
          V85 har startat – raden kan inte längre spelas. Den finns kvar för statistiken.
        </Banner>
      )}
      <Budget
        draft={current}
        rowPrice={rowPrice}
        summary={summary}
        disabled={roundStarted}
        onBudget={(b) => change((d) => ({ ...d, budget: b }))}
        onRowPrice={async (p) => {
          change((d) => ({ ...d, rowPrice: p }));
          try {
            const s = await apiRequest<SettingsDto>("PUT", "/api/settings", { rowPrice: p });
            patchRound(roundId, (r) => ({ ...r, settings: { spelbarGuideline: s.spelbarGuideline, rowPrice: s.rowPrice } }));
          } catch {
            toast({ text: "Radpriset gäller för raden men kunde inte sparas i inställningarna." });
          }
        }}
      />
      <h3 className="sl">
        <span>Per avdelning</span>
        <span>Spelbara först</span>
      </h3>
      <ul className="vlist2" aria-label="Valda hästar per avdelning">
        {legs.map((l) => {
          const race = data.races.find((r) => r.leg === l.leg)!;
          return (
            <LegRow
              key={l.leg}
              leg={l}
              race={race}
              picks={current.selections[l.leg] ?? []}
              locked={current.locked.includes(l.leg)}
              started={raceStarted(race, now)}
              onOpen={() => setSheetLeg(l.leg)}
              onStep={(delta) => change((d) => ({ ...d, selections: { ...d.selections, [l.leg]: stepLeg(l, d.selections[l.leg] ?? [], delta) } }))}
            />
          );
        })}
      </ul>
      <div className="vfoot">
        <button type="button" className="btn primary" disabled={roundStarted} onClick={suggest}>
          Föreslå inom budget
        </button>
        <button type="button" className="btn secondary" disabled={summary.rows === 0} onClick={() => void copy()}>
          <IconCopy />
          Kopiera rad
        </button>
      </div>

      <Sheet
        open={openLeg !== null}
        onClose={() => setSheetLeg(null)}
        title={openLeg ? `Avd ${openLeg.leg} · välj hästar` : ""}
        sub={openRace ? `${shortRaceName(openRace.name)} · ${hhmm(openRace.startAt)}` : undefined}
      >
        {openLeg && openRace && (
          <LegSheet
            leg={openLeg}
            race={openRace}
            picks={current.selections[openLeg.leg] ?? []}
            locked={current.locked.includes(openLeg.leg)}
            onToggle={(n) =>
              change((d) => ({
                ...d,
                selections: { ...d.selections, [openLeg.leg]: toggleNumber(d.selections[openLeg.leg] ?? [], n) },
                locked: d.locked.includes(openLeg.leg) ? d.locked : [...d.locked, openLeg.leg],
              }))
            }
            onUnlock={() => change((d) => ({ ...d, locked: d.locked.filter((x) => x !== openLeg.leg) }))}
            onDone={() => setSheetLeg(null)}
          />
        )}
      </Sheet>

      <Sheet open={copyFallback !== null} onClose={() => setCopyFallback(null)} title="Kopiera raden" sub="Kopieringen fungerade inte i den här webbläsaren. Markera texten och kopiera den själv.">
        <textarea className="copybox num" readOnly rows={11} value={copyFallback ?? ""} aria-label="V85-raden som text" onFocus={(e) => e.currentTarget.select()} />
      </Sheet>
    </>
  );
}

function Budget({
  draft,
  rowPrice,
  summary,
  disabled,
  onBudget,
  onRowPrice,
}: {
  draft: Draft;
  rowPrice: number;
  summary: ReturnType<typeof couponSummary>;
  disabled: boolean;
  onBudget: (b: number) => void;
  onRowPrice: (p: number) => void;
}) {
  const id = useId();
  const [exact, setExact] = useState(String(draft.budget));
  const [exactErr, setExactErr] = useState<string | null>(null);
  const editingExact = useRef(false);
  const [editPrice, setEditPrice] = useState(false);
  const [priceText, setPriceText] = useState(odds(rowPrice));
  const [priceErr, setPriceErr] = useState<string | null>(null);

  useEffect(() => {
    if (!editingExact.current) setExact(String(draft.budget));
  }, [draft.budget]);

  const commitExact = () => {
    editingExact.current = false;
    const b = parseBudget(exact);
    if (b === null) return setExactErr(BUDGET_ERROR);
    setExactErr(null);
    setExact(String(b));
    if (b !== draft.budget) onBudget(b);
  };
  const commitPrice = () => {
    const p = parseRowPrice(priceText);
    if (p === null) return setPriceErr(ROW_PRICE_ERROR);
    setPriceErr(null);
    setEditPrice(false);
    if (p !== rowPrice) onRowPrice(p);
  };
  const slider = Math.min(BUDGET_SLIDER.max, Math.max(BUDGET_SLIDER.min, draft.budget));

  return (
    <div className="budget brd">
      <div className="row1">
        <label htmlFor={`${id}-r`}>Budget</label>
        <span className="bv num" aria-hidden="true">
          {thousands(draft.budget)} kr
        </span>
      </div>
      <input
        type="range"
        id={`${id}-r`}
        min={BUDGET_SLIDER.min}
        max={BUDGET_SLIDER.max}
        step={BUDGET_SLIDER.step}
        value={slider}
        disabled={disabled}
        aria-valuetext={`${draft.budget} kronor`}
        aria-describedby={`${id}-s`}
        onChange={(e) => onBudget(Number(e.target.value))}
      />
      <div className="exact">
        <label htmlFor={`${id}-x`}>Exakt belopp</label>
        <input
          id={`${id}-x`}
          className="oin"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={exact}
          disabled={disabled}
          aria-invalid={exactErr ? true : undefined}
          aria-describedby={exactErr ? `${id}-xe` : undefined}
          onFocus={() => (editingExact.current = true)}
          onChange={(e) => {
            setExact(e.target.value);
            if (exactErr) setExactErr(null);
          }}
          onBlur={commitExact}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitExact();
            }
          }}
        />
        <span className="kr">kr</span>
      </div>
      {exactErr && (
        <p className="err-msg on-board" id={`${id}-xe`}>
          <IconWarn />
          {exactErr}
        </p>
      )}
      <div className="sum" id={`${id}-s`} aria-live="polite">
        <div>
          <small>Rader</small>
          <b className="num">{thousands(summary.rows)}</b>
        </div>
        <div>
          <small>Kostnad</small>
          <b className="num">{krs(summary.cost)}</b>
        </div>
        <div className={summary.over ? "over" : undefined}>
          <small>{summary.over ? "Över budget" : "Kvar"}</small>
          <b className="num">{krs(Math.abs(summary.left))}</b>
          {summary.over && <span className="sr">Över budget med {krs(-summary.left)}</span>}
        </div>
      </div>
      {summary.over && (
        <p className="over-line" aria-hidden="true">
          Över budget med {krs(-summary.left)}
        </p>
      )}
      {editPrice ? (
        <div className="rp-edit">
          <label htmlFor={`${id}-p`}>Radpris</label>
          <input
            id={`${id}-p`}
            className="oin"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={priceText}
            aria-invalid={priceErr ? true : undefined}
            aria-describedby={priceErr ? `${id}-pe` : undefined}
            onChange={(e) => setPriceText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitPrice();
              } else if (e.key === "Escape") setEditPrice(false);
            }}
            autoFocus
          />
          <span className="kr">kr</span>
          <button type="button" className="btn ghost sm" onClick={commitPrice}>
            Spara
          </button>
          <button type="button" className="btn ghost sm" onClick={() => setEditPrice(false)}>
            Avbryt
          </button>
          {priceErr && (
            <p className="err-msg on-board" id={`${id}-pe`}>
              <IconWarn />
              {priceErr}
            </p>
          )}
        </div>
      ) : (
        <div className="rp">
          <span>
            Radpris <b className="num">{krs(rowPrice)}</b>
          </span>
          <button
            type="button"
            className="btn ghost sm"
            disabled={disabled}
            onClick={() => {
              setPriceText(odds(rowPrice));
              setPriceErr(null);
              setEditPrice(true);
            }}
            aria-label="Ändra radpriset"
          >
            <IconPen />
            Ändra
          </button>
        </div>
      )}
    </div>
  );
}

function LegRow({
  leg,
  race,
  picks,
  locked,
  started,
  onOpen,
  onStep,
}: {
  leg: CouponLeg;
  race: RaceDto;
  picks: number[];
  locked: boolean;
  started: boolean;
  onOpen: () => void;
  onStep: (delta: 1 | -1) => void;
}) {
  const names = picks.map((n) => race.starts.find((s) => s.number === n)?.horse.name ?? `Nr ${n}`);
  const max = legMax(leg);
  return (
    <li className={`vrow${started ? " started" : ""}`}>
      <FlapNumber n={leg.leg} size="sm" />
      <button type="button" className="vpick" onClick={onOpen} disabled={started} aria-haspopup="dialog" aria-label={`Avd ${leg.leg}: ${picks.length ? `${picks.join(", ")}` : "ingen häst vald"}. Välj hästar själv`}>
        <span className="pk" aria-hidden="true">
          {picks.length ? picks.map((n) => <b key={n}>{n}</b>) : <span className="pk-none">Ingen vald</span>}
          {picks.length === 1 && <span className="tag">Spik</span>}
          {locked && (
            <span className="tag lock">
              <IconLock />
              Eget val
            </span>
          )}
          {started && <span className="tag">Startat</span>}
        </span>
        <span className="pnames" aria-hidden="true">
          {names.join(", ") || `${shortRaceName(race.name)} · ${hhmm(race.startAt)}`}
        </span>
      </button>
      <div className="stp" role="group" aria-label={`Antal hästar i avdelning ${leg.leg}`}>
        <button type="button" disabled={started || picks.length <= 1} onClick={() => onStep(-1)} aria-label={`En häst färre i avdelning ${leg.leg}`}>
          −
        </button>
        <output className="num" aria-live="polite">
          {picks.length}
        </output>
        <button type="button" disabled={started || picks.length >= max} onClick={() => onStep(1)} aria-label={`En häst till i avdelning ${leg.leg}`}>
          +
        </button>
      </div>
    </li>
  );
}

function LegSheet({
  leg,
  race,
  picks,
  locked,
  onToggle,
  onUnlock,
  onDone,
}: {
  leg: CouponLeg;
  race: RaceDto;
  picks: number[];
  locked: boolean;
  onToggle: (n: number) => void;
  onUnlock: () => void;
  onDone: () => void;
}) {
  return (
    <>
      <p className="help">Väljer du själv låses avdelningen, så att Föreslå inom budget inte ändrar den.</p>
      <ul className="hchips" aria-label={`Hästar i avdelning ${leg.leg}`}>
        {race.starts.map((s) => {
          const on = picks.includes(s.number);
          return (
            <li key={s.id}>
              <button type="button" className="hchip" aria-pressed={on} disabled={s.scratched && !on} onClick={() => onToggle(s.number)}>
                <FlapNumber n={s.number} size="sm" />
                <span className="hc-name">{s.horse.name}</span>
                <span className="hc-b">
                  {s.mark?.spelbar && <Badge kind="s" />}
                  {s.mark?.interesting && !s.mark.spelbar && <Badge kind="i" />}
                  {s.scratched ? <span className="tag scr-tag">Struken</span> : <span className="num hc-st">{pct(s.streck)}</span>}
                  <span className="hc-ok" aria-hidden="true">
                    {on ? "✓" : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="vfoot">
        <button type="button" className="btn primary" onClick={onDone}>
          Klar
        </button>
        {locked && (
          <button type="button" className="btn ghost" onClick={onUnlock}>
            Släpp eget val
          </button>
        )}
      </div>
    </>
  );
}
