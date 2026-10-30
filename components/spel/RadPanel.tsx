"use client";

// S6b V85-raden, E6 "Tippa V85" (docs/specs/e6-v85-rad.md): budgetrutan på
// tavlan, Regler för raden, ett kort per avdelning med skälen, arken Ändra
// avd, Välj egen spik, Välj lopp att prioritera (E6b) och Spela hos ATG, samt
// handlingsraden med Kopiera till ATG.
//
// Raden räknas i klienten med buildRad (lib/tippa.ts) ur omgångens cache och
// reglerna. Reglerna (draft) sparas med den räknade raden som hela kupongen i
// utkorgen efter 600 ms paus (PUT, idempotent), när sidan döljs och när vyn
// lämnas. Gamla rader (sparade före E6) och rader efter spelstopp visas som
// de sparades.

import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { apiRequest } from "@/components/api";
import { copyText } from "@/components/clipboard";
import { useOnline } from "@/components/hooks";
import { raceStarted, useRound } from "@/components/round/RoundProvider";
import { patchRound } from "@/components/round/roundStore";
import { Banner } from "@/components/ui/board";
import { IconCopy, IconPen, IconWarn } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { BUDGET_SLIDER, couponDateLabel, couponText, DEFAULT_BUDGET, DEFAULT_MAX_PER_LEG, DEFAULT_ROW_PRICE, sameNumbers, type Selections } from "@/lib/coupon";
import { BUDGET_ERROR, couponBody, parseBudget, parseRowPrice, ROW_PRICE_ERROR, selectionsOf, tippaLegs, toggleNumber } from "@/lib/coupon-ui";
import { hhmm, odds, thousands } from "@/lib/format";
import { legName, legsFor } from "@/lib/game-type";
import { applySettings, xFactorsOf, type CouponBody } from "@/lib/round-overlay";
import { BUDGET_OVER_MAX, buildRad, defaultSpikCount, type TippaLegResult, type TippaResult, type TippaRules, type TippaSuggestion } from "@/lib/tippa";
import {
  allFitText,
  copyBlockedReason,
  copyChangedText,
  desktopSummary,
  krText,
  LEGACY_TEXT,
  leftOf,
  listSummary,
  liveSummary,
  minRowsLine,
  NO_DATA_TEXT,
  NO_RIKT_TEXT,
  OFFLINE_TEXT,
  ownOverText,
  templateDeviationText,
  prelimText,
  prioSheetSub,
  rulesDontFitText,
  scratchNotices,
  startedText,
  suggestionLabel,
  suggestionToast,
  type ScratchNoticeItem,
} from "@/lib/tippa-text";
import type { AllgMode, CouponDto, RoundResponse, SettingsDto } from "@/lib/types";
import { Kupong, type KupongLeg } from "./Kupong";
import { RadActionBar } from "./RadActionBar";
import { Bold, RadLegCard, type CardMode } from "./RadLegCard";
import { RadRules, type FrozenRules } from "./RadRules";
import { ownAfterSpik, RadAtgSheet, RadLegSheet, RadPrioSheet, RadSpikSheet } from "./RadSheets";

const SAVE_DELAY_MS = 600;
const LIVE_DELAY_MS = 500;

// Reglerna för raden (9.3). spikCount null = standardvärdet (ny eller gammal
// rad), som räknas om tills Mikael ändrar något.
type RadDraft = {
  budget: number;
  rowPrice: number | null;
  spikCount: number | null;
  // Prioriterat lopp (E6b, hette allgardering).
  allgMode: AllgMode;
  allgLeg: number | null;
  // E6b: Max hästar per lopp, 3–30. null = Alla.
  maxPerLeg: number | null;
  locked: Record<number, number[]>;
  copiedAt: string | null;
  copiedSelections: Selections | null;
  legacy: boolean;
};

type SheetState =
  | null
  | { kind: "leg"; leg: number; picked: number[]; touched: boolean }
  | { kind: "spik"; leg?: number }
  | { kind: "prio" }
  | { kind: "atg" }
  | { kind: "copy-fallback"; text: string };

type KeptNotice = ScratchNoticeItem & { key: string; prevSel: number[] };

const asSel = (x: Record<string, number[]>): Selections => Object.fromEntries(Object.entries(x).map(([k, v]) => [Number(k), [...v].sort((a, b) => a - b)]));
const noticeKey = (n: ScratchNoticeItem) => `${n.kind}-${n.leg}-${n.numbers.join(",")}`;
const isLegacy = (c: CouponDto | null) => !!c && (c.spikCount === null || c.spikCount === undefined);

function draftOf(c: CouponDto | null): RadDraft {
  if (!c) return { budget: DEFAULT_BUDGET, rowPrice: null, spikCount: null, allgMode: "AUTO", allgLeg: null, maxPerLeg: DEFAULT_MAX_PER_LEG, locked: {}, copiedAt: null, copiedSelections: null, legacy: false };
  const sel = selectionsOf(c);
  const locked: Record<number, number[]> = {};
  for (const leg of c.lockedLegs) if (sel[leg]?.length) locked[leg] = sel[leg];
  const legacy = isLegacy(c);
  return {
    budget: c.budget,
    rowPrice: c.rowPrice,
    spikCount: legacy ? null : (c.spikCount ?? null),
    allgMode: legacy ? "AUTO" : (c.allgMode ?? "AUTO"),
    allgLeg: legacy ? null : (c.allgLeg ?? null),
    // Ny rad och rad från före E6: 7. Sparad E6-kupong utan tak (före E6b): Alla.
    maxPerLeg: legacy ? DEFAULT_MAX_PER_LEG : (c.maxPerLeg ?? null),
    locked,
    copiedAt: c.copiedAt ?? null,
    copiedSelections: c.copiedSelections ? asSel(c.copiedSelections) : null,
    legacy,
  };
}

// Låsning i reglerna (A4, A5): låses det valda prioriterade loppet blir det Auto.
function lockLeg(d: RadDraft, leg: number, picked: number[]): RadDraft {
  const locked = { ...d.locked };
  if (picked.length) locked[leg] = [...picked].sort((a, b) => a - b);
  else delete locked[leg];
  const allg = d.allgMode === "CHOSEN" && d.allgLeg === leg && picked.length ? { allgMode: "AUTO" as const, allgLeg: null } : {};
  return { ...d, locked, ...allg };
}

// Kroppen för en gammal rad (oförändrad, spikCount null).
function legacyBody(c: CouponDto, copiedAt?: string): CouponBody {
  const sel = selectionsOf(c);
  return couponBody(c.budget, c.rowPrice, sel, c.lockedLegs, {
    spikCount: null,
    allgMode: null,
    allgLeg: null,
    maxPerLeg: null,
    legRoles: c.legRoles ?? null,
    copiedAt: copiedAt ?? c.copiedAt ?? null,
    copiedSelections: copiedAt ? sel : c.copiedSelections ? asSel(c.copiedSelections) : null,
  });
}

// Hela kupongen att spara (9.3). Ryms inte reglerna sparas reglerna men inte raden.
function bodyOf(d: RadDraft, r: TippaResult, saved: CouponDto | null): CouponBody {
  const dontFit = r.status === "RULES_DONT_FIT";
  const sel: Selections = dontFit ? { ...selectionsOf(saved), ...r.locked } : r.selections;
  let allgMode: AllgMode = d.allgMode;
  let allgLeg = r.prioLeg;
  if (d.allgMode === "CHOSEN") {
    if (r.prioFallback === "CANCELLED" && d.allgLeg !== null) allgLeg = d.allgLeg;
    else if (r.prioFallback) allgMode = "AUTO";
  }
  return couponBody(d.budget, d.rowPrice, sel, r.lockedLegs, {
    spikCount: r.spikEffective,
    allgMode,
    allgLeg,
    maxPerLeg: d.maxPerLeg,
    legRoles: dontFit ? (saved?.legRoles ?? null) : r.legRoles,
    copiedAt: d.copiedAt,
    copiedSelections: d.copiedSelections,
  });
}

function differs(c: CouponDto, b: CouponBody, legs: number): boolean {
  for (let leg = 1; leg <= legs; leg++) if (!sameNumbers(c.selections[String(leg)], b.selections[String(leg)])) return true;
  return (c.allgLeg ?? null) !== (b.allgLeg ?? null) || !sameNumbers(c.lockedLegs, b.lockedLegs) || (c.spikCount ?? null) !== (b.spikCount ?? null) || (c.maxPerLeg ?? null) !== (b.maxPerLeg ?? null);
}

export function RadPanel({ data, now }: { data: RoundResponse; now: number }) {
  const { saveCoupon } = useRound();
  const toast = useToast();
  const online = useOnline();
  const roundId = data.round.id;
  const gt = data.round.gameType;
  const legCount = legsFor(gt);
  const saved = data.coupon;
  const settingsRowPrice = data.settings?.rowPrice ?? DEFAULT_ROW_PRICE;
  const started = data.races.some((r) => raceStarted(r, now));

  const factors = useMemo(() => xFactorsOf(data.settings), [data.settings]);
  const legs = useMemo(() => tippaLegs(data, factors), [data, factors]);

  // ---- Reglerna och raden ----
  const [draft, setDraft] = useState<RadDraft | null>(null);
  const savedDraft = useMemo(() => draftOf(saved), [saved]);
  const current = draft ?? savedDraft;
  const mode: CardMode = started ? "started" : current.legacy ? "legacy" : "live";
  const rowPrice = current.rowPrice ?? settingsRowPrice;
  const budget = useDeferredValue(current.budget);
  const baseRules = useMemo<TippaRules>(
    () => ({ gameType: gt, budget, rowPrice, spikCount: 0, allgMode: current.allgMode, allgLeg: current.allgLeg, maxPerLeg: current.maxPerLeg, locked: current.locked }),
    [gt, budget, rowPrice, current.allgMode, current.allgLeg, current.maxPerLeg, current.locked],
  );
  const spikCount = useMemo(() => current.spikCount ?? defaultSpikCount(legs, baseRules), [current.spikCount, legs, baseRules]);
  const rules = useMemo<TippaRules>(() => ({ ...baseRules, spikCount }), [baseRules, spikCount]);
  const result = useMemo(() => buildRad(legs, rules), [legs, rules]);

  // Gammal rad och raden efter spelstopp: den sparade raden, alla avdelningar låsta.
  const frozen = useMemo(() => {
    if (mode === "live" || !saved) return null;
    const sel = selectionsOf(saved);
    const locked: Record<number, number[]> = {};
    for (let leg = 1; leg <= legCount; leg++) if (sel[leg]?.length) locked[leg] = sel[leg];
    return buildRad(legs, { ...rules, budget: saved.budget, rowPrice: saved.rowPrice, spikCount: 0, allgMode: "AUTO", allgLeg: null, locked });
  }, [mode, saved, legs, rules, legCount]);
  const view = frozen ?? result;
  const roles = saved?.legRoles ?? null;

  // ---- Sparningen ----
  const curRef = useRef(current);
  curRef.current = current;
  const resultRef = useRef(result);
  resultRef.current = result;
  const body = useMemo(() => (mode === "live" ? bodyOf(current, result, saved) : null), [mode, current, result, saved]);
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);
  const autoSig = useRef<string | null>(null);

  const flush = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    const b = bodyRef.current;
    if (b) saveCoupon(b);
    setDraft(null);
  }, [saveCoupon]);

  const schedule = useCallback(() => {
    dirty.current = true;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
  }, [flush]);

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

  // En ändring av reglerna. Gammal rad räknas först om med reglerna, och
  // standardantalet spikar låses vid första ändringen (utom för budgeten).
  const change = useCallback(
    (fn: (d: RadDraft) => RadDraft, opts: { keepAuto?: boolean } = {}): { prev: RadDraft; prevSaved: CouponDto | null } => {
      const prev = curRef.current;
      let base = prev;
      if (base.legacy) base = { ...base, legacy: false, spikCount: null, allgMode: "AUTO", allgLeg: null, maxPerLeg: DEFAULT_MAX_PER_LEG };
      if (!opts.keepAuto && base.spikCount === null) base = { ...base, spikCount: resultRef.current.spikEffective };
      const next = fn(base);
      curRef.current = next;
      setDraft(next);
      schedule();
      return { prev, prevSaved: saved };
    },
    [schedule, saved],
  );

  const undo = useCallback(
    (u: { prev: RadDraft; prevSaved: CouponDto | null }) => {
      if (u.prev.legacy && u.prevSaved) {
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = null;
        dirty.current = false;
        saveCoupon(legacyBody(u.prevSaved));
        setDraft(null);
        return;
      }
      curRef.current = u.prev;
      setDraft(u.prev);
      schedule();
    },
    [saveCoupon, schedule],
  );

  const toastUndo = useCallback((text: string, u: { prev: RadDraft; prevSaved: CouponDto | null }) => toast({ text, action: { label: "Ångra", onClick: () => undo(u) } }), [toast, undo]);

  // Raden har ändrats sedan den sparades (nytt streck, strykning, ny markering): spara.
  useEffect(() => {
    if (mode !== "live" || draft || !saved || isLegacy(saved) || !body || result.status === "RULES_DONT_FIT") return;
    if (!differs(saved, body, legCount)) return;
    const sig = JSON.stringify([body.selections, body.allgLeg, body.lockedLegs, body.spikCount, body.maxPerLeg]);
    if (autoSig.current === sig) return;
    autoSig.current = sig;
    schedule();
  }, [mode, draft, saved, body, result.status, legCount, schedule]);

  // ---- Strykningsbanderollerna ----
  const live = useMemo(() => (mode === "live" ? scratchNotices(saved ? { selections: saved.selections, rows: saved.rows, cost: saved.cost } : null, result) : []), [mode, saved, result]);
  const [kept, setKept] = useState<KeptNotice[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    const warn = live.filter((n) => n.tone === "warn");
    if (!warn.length) return;
    setKept((k) => {
      const add = warn.filter((n) => !k.some((x) => x.key === noticeKey(n)) && !dismissed.includes(noticeKey(n)));
      return add.length ? [...k, ...add.map((n) => ({ ...n, key: noticeKey(n), prevSel: saved?.selections[String(n.leg)] ?? [] }))] : k;
    });
  }, [live, dismissed, saved]);
  const notices = useMemo(() => {
    if (mode !== "live") return [];
    const errs = live.filter((n) => n.tone === "err").map((n) => ({ ...n, key: noticeKey(n), prevSel: [] as number[] }));
    return [...errs, ...kept.filter((k) => !dismissed.includes(k.key))].sort((a, b) => a.leg - b.leg);
  }, [mode, live, kept, dismissed]);

  // ---- Live-regionen (summan, 500 ms efter senaste ändringen) ----
  const liveText = mode === "live" ? liveSummary(result) : "";
  const [announce, setAnnounce] = useState("");
  const firstLive = useRef(true);
  useEffect(() => {
    if (firstLive.current) {
      firstLive.current = false;
      return;
    }
    const t = window.setTimeout(() => setAnnounce(liveText), LIVE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [liveText]);

  // ---- Ark ----
  const [sheet, setSheet] = useState<SheetState>(null);
  const rulesRef = useRef<HTMLDivElement>(null);
  const sumRef = useRef<HTMLDivElement>(null);

  const openLeg = (leg: number) => {
    const l = view.legs.find((x) => x.leg === leg);
    if (!l) return;
    setSheet({ kind: "leg", leg, picked: [...l.selection], touched: false });
  };
  const closeLeg = () => {
    if (sheet?.kind !== "leg") return;
    const { leg, picked, touched } = sheet;
    setSheet(null);
    if (touched) change((d) => lockLeg(d, leg, picked));
  };
  const releaseLeg = () => {
    if (sheet?.kind !== "leg") return;
    const { leg } = sheet;
    setSheet(null);
    const u = change((d) => lockLeg(d, leg, []));
    toastUndo(`${legName(data.round.gameType, leg)} räknas av appen igen`, u);
  };

  const removeOwn = (leg: number) => {
    const l = result.legs.find((x) => x.leg === leg);
    const n = l?.selection[0];
    const name = l?.horses[0]?.name ?? l?.scratched.find((s) => s.number === n)?.name ?? "";
    const idx = result.legs.filter((x) => x.kind === "OWN_SPIK").findIndex((x) => x.leg === leg);
    const u = change((d) => lockLeg(d, leg, []));
    toastUndo(`Egen spik ${n} ${name} i ${legName(data.round.gameType, leg)} är borttagen`, u);
    window.requestAnimationFrame(() => {
      const xs = rulesRef.current?.querySelectorAll<HTMLElement>(".osp .ibtn");
      const next = xs && xs.length ? xs[Math.min(idx, xs.length - 1)] : null;
      (next ?? rulesRef.current?.querySelector<HTMLElement>(".add-own"))?.focus();
    });
  };

  const confirmSpik = (leg: number, n: number) => {
    const h = result.legs.find((x) => x.leg === leg)?.field.find((x) => x.number === n);
    const spik = Math.max(result.spikEffective, ownAfterSpik(result, leg));
    setSheet(null);
    const u = change((d) => ({ ...lockLeg(d, leg, [n]), spikCount: spik }));
    toastUndo(`Egen spik ${n} ${h?.name ?? ""} i ${legName(data.round.gameType, leg)}`, u);
  };

  const applySuggestion = (s: TippaSuggestion) => {
    if (s.kind === "EDIT_LEG") return openLeg(s.leg);
    const u = s.kind === "BUDGET" ? change((d) => ({ ...d, budget: s.budget })) : change((d) => ({ ...d, spikCount: s.spikCount }));
    const t = suggestionToast(s);
    if (t) toastUndo(t.replace(/ · Ångra$/, ""), u);
    window.requestAnimationFrame(() => sumRef.current?.focus());
  };

  const recountLegacy = () => {
    const u = change((d) => d);
    toastUndo("Raden är räknad med reglerna", u);
  };

  // ---- Kopiera ----
  const numbersByLeg = useMemo(() => Object.fromEntries(legs.map((l) => [l.leg, { all: l.starts.map((s) => s.number), scratched: l.starts.filter((s) => s.scratched).map((s) => s.number) }])), [legs]);
  // Efter spelstopp: avdelningen sparad som ALLG, och bara om alla löpande är med (E6b 5.6).
  const startedPrio = useMemo(() => {
    if (mode !== "started") return null;
    const e = Object.entries(roles?.legs ?? {}).find(([, v]) => v.k === "ALLG" || v.k === "PRIO");
    const l = e ? view.legs.find((x) => x.leg === Number(e[0])) : undefined;
    if (!e || !l) return null;
    const all = l.field.length > 0 && l.field.every((h) => l.selection.includes(h.number));
    return { leg: l.leg, kind: e[1].k === "ALLG" && all ? ("ALLG" as const) : ("PRIO" as const), count: l.selection.length, field: l.field.length };
  }, [mode, roles, view]);
  const allgLegView = mode === "live" ? result.allgLeg : startedPrio?.kind === "ALLG" ? startedPrio.leg : null;
  const roundInfo = { trackName: data.round.trackName, date: data.round.date, gameType: gt };
  const copyString = () => {
    if (mode === "legacy" && saved) return couponText(roundInfo, selectionsOf(saved), saved.rowPrice);
    return couponText(roundInfo, view.selections, view.rowPrice, { allgLeg: allgLegView, numbersByLeg });
  };
  const copyNow = async () => {
    const text = copyString();
    const ok = await copyText(text);
    const at = new Date().toISOString();
    if (mode === "live") change((d) => ({ ...d, copiedAt: at, copiedSelections: result.selections }));
    else if (mode === "legacy" && saved) saveCoupon(legacyBody(saved, at));
    if (ok) toast({ text: "Raden är kopierad. Klistra in hos ATG." });
    else setSheet({ kind: "copy-fallback", text });
  };
  const blocked = mode === "live" ? copyBlockedReason(result) : !saved ? "Ingen rad sparades." : null;

  const kupong: KupongLeg[] = view.legs.map((l) => {
    const info = numbersByLeg[l.leg] ?? { all: [], scratched: [] };
    const kind = mode === "started" ? roles?.legs[String(l.leg)]?.k : mode === "live" ? l.kind : undefined;
    const n = l.selection.length;
    // "Alla" bara när alla löpande är med (E6b 5.6); PRIO visas som "7 st".
    const allg = mode === "started" ? allgLegView === l.leg : kind === "ALLG";
    const label = (() => {
      if (kind === "SPIK") return "Spik";
      if (kind === "OWN_SPIK") return "Egen";
      if (kind === "OWN") return "Eget";
      if (allg) return "Alla";
      if (kind === "CANCELLED") return "Inst.";
      return n === 1 ? "Spik" : `${n} st`;
    })();
    return { leg: l.leg, label, selection: l.selection, fav: l.favorite?.number ?? null, all: [...info.all].sort((a, b) => a - b), scratched: info.scratched, allg };
  });

  // ---- Banderoller ----
  const dateShort = couponDateLabel(data.round.date).replace(/ \d{4}$/, "");
  const nowDate = new Date(now);
  const changedText = mode === "live" || mode === "legacy" ? copyChangedText(current.copiedAt, current.copiedSelections, view, nowDate) : null;
  const viewBanners: React.ReactNode[] = [];
  if (started)
    viewBanners.push(
      <Banner key="st" tone="info" className="m10">
        {startedText(gt)}
      </Banner>,
    );
  if (mode === "legacy")
    viewBanners.push(
      <Banner
        key="lg"
        tone="info"
        className="m10"
        actions={
          <button type="button" className="btn secondary sm" onClick={recountLegacy}>
            Räkna om med reglerna
          </button>
        }
      >
        {LEGACY_TEXT}
      </Banner>,
    );
  if (mode === "live") {
    const t = result.noData ? NO_DATA_TEXT : result.noRikt ? NO_RIKT_TEXT : result.prelim ? prelimText(data.round.date, nowDate) : null;
    if (t)
      viewBanners.push(
        <Banner key="pre" tone="info" className="m10">
          <Bold text={t} />
        </Banner>,
      );
  }
  if (!online && !started)
    viewBanners.push(
      <Banner key="off" tone="warn" icon="offline" className="m10">
        {OFFLINE_TEXT}
      </Banner>,
    );
  if (changedText && !started)
    viewBanners.push(
      <Banner
        key="ch"
        tone="info"
        className="m10"
        actions={
          <button type="button" className="btn secondary sm" aria-haspopup="dialog" onClick={() => setSheet({ kind: "atg" })} disabled={!!blocked}>
            <IconCopy />
            Kopiera till ATG
          </button>
        }
      >
        <Bold text={changedText} />
      </Banner>,
    );

  let budgetBanner: React.ReactNode = null;
  if (mode === "live" && result.status === "RULES_DONT_FIT")
    budgetBanner = (
      <Banner tone="err" role="alert" className="m" actions={result.suggestions.length ? <Suggestions gameType={result.gameType} items={result.suggestions} onUse={applySuggestion} /> : undefined}>
        <Bold text={rulesDontFitText(result)} />
      </Banner>
    );
  else if (mode === "live" && result.status === "OWN_OVER_BUDGET")
    budgetBanner = (
      <Banner tone="warn" className="m" actions={result.suggestions.length ? <Suggestions gameType={result.gameType} items={result.suggestions} onUse={applySuggestion} /> : undefined}>
        <Bold text={ownOverText(result)} />
      </Banner>
    );
  else if (mode === "live" && result.status === "OK" && templateDeviationText(result))
    budgetBanner = (
      <Banner tone="info" className="m">
        {templateDeviationText(result)}
      </Banner>
    );

  const scratchBanners = notices.map((n) => {
    const actions =
      n.kind === "OWN_SPIK" ? (
        <>
          <button type="button" className="btn secondary sm" aria-haspopup="dialog" onClick={() => setSheet({ kind: "spik", leg: n.leg })}>
            Välj ny spik
          </button>
          <button type="button" className="btn secondary sm" onClick={() => change((d) => lockLeg(d, n.leg, []))}>
            Låt appen välja
          </button>
        </>
      ) : undefined;
    const closable = n.tone === "warn";
    return (
      <Banner key={n.key} tone={n.tone} role={n.role} className="m" actions={actions} onClose={closable ? () => setDismissed((x) => [...x, n.key]) : undefined}>
        <Bold text={n.text} />
      </Banner>
    );
  });

  const dontFit = mode === "live" && result.status === "RULES_DONT_FIT";
  const frozenRules: FrozenRules | null = started ? { spikCount: saved?.spikCount ?? null, allgMode: saved?.allgMode ?? null, maxPerLeg: saved?.maxPerLeg ?? null, prio: startedPrio } : null;
  const left = leftOf(view);
  const atgSub = `${gt} ${data.round.trackName} ${dateShort} · ${thousands(view.rows)} ${view.rows === 1 ? "rad" : "rader"} · ${krText(view.cost)}`;
  const legSheet = sheet?.kind === "leg" ? sheet : null;
  const legSheetLeg = legSheet ? result.legs.find((l) => l.leg === legSheet.leg) : undefined;
  const showRows = mode !== "started" || !!saved;

  return (
    <>
      <h2 id="h-rad" className="sr">
        {gt}-rad
      </h2>
      {viewBanners.slice(0, 2)}
      <div className="drad">
        <aside className="drad-l" aria-label="Budget och regler">
          <Budget
            budget={mode === "live" ? current.budget : view.budget}
            rowPrice={mode === "live" ? rowPrice : view.rowPrice}
            rows={view.rows}
            cost={view.cost}
            dontFit={dontFit}
            minCost={result.minCost}
            minRowsText={minRowsLine(result)}
            allFit={mode === "live" && result.allFit}
            allFitText={allFitText(result)}
            disabled={started}
            sumRef={sumRef}
            onBudget={(b) => change((d) => ({ ...d, budget: b }), { keepAuto: true })}
            onRowPrice={async (p) => {
              change((d) => ({ ...d, rowPrice: p }), { keepAuto: true });
              try {
                const s = await apiRequest<SettingsDto>("PUT", "/api/settings", { rowPrice: p });
                patchRound(roundId, (r) => applySettings(r, s));
              } catch {
                toast({ text: "Radpriset gäller för raden men kunde inte sparas i inställningarna." });
              }
            }}
          />
          {budgetBanner}
          <RadRules
            ref={rulesRef}
            r={result}
            frozen={frozenRules}
            onSpik={(n) => change((d) => ({ ...d, spikCount: n }))}
            onRemoveOwn={removeOwn}
            onAddOwn={() => setSheet({ kind: "spik" })}
            onCap={(n) => change((d) => ({ ...d, maxPerLeg: n }))}
            onPrioAuto={() => change((d) => ({ ...d, allgMode: "AUTO", allgLeg: null }))}
            onPrioChoose={() => setSheet({ kind: "prio" })}
          />
          <div className="dact d-only">
            <CopyButton blocked={blocked} onClick={() => setSheet({ kind: "atg" })} />
            <p className="help">Visar kupongbilden och texten att kopiera</p>
          </div>
        </aside>
        <section className="drad-r" aria-labelledby="h-radlist">
          {scratchBanners}
          <h2 className="sl rad-h" id="h-radlist">
            Raden per lopp
            {showRows && (
              <>
                <span className="m-only">{listSummary(view)}</span>
                <small className="d-only">{desktopSummary(view)}</small>
              </>
            )}
          </h2>
          {showRows ? (
            <div className="lgg">
              {view.legs.map((l) => {
                const ks = notices.filter((n) => n.leg === l.leg && n.kind === "SCRATCHED");
                const struck = ks.flatMap((n) => n.numbers.map((x) => l.scratched.find((s) => s.number === x)).filter((s): s is { number: number; name: string } => !!s));
                const fresh = ks.length ? l.selection.filter((x) => !ks.some((n) => n.prevSel.includes(x))) : [];
                return (
                  <RadLegCard
                    key={l.leg}
                    l={l}
                    r={view}
                    mode={mode}
                    all={numbersByLeg[l.leg]?.all.slice().sort((a, b) => a - b) ?? []}
                    cap={saved?.maxPerLeg ?? null}
                    struck={struck}
                    fresh={fresh}
                    role={roles?.legs[String(l.leg)]}
                    onEdit={() => openLeg(l.leg)}
                  />
                );
              })}
            </div>
          ) : (
            <p className="help m10">Ingen rad sparades före spelstopp.</p>
          )}
        </section>
      </div>
      <RadActionBar rows={view.rows} cost={view.cost} budget={view.budget} dontFit={dontFit} blocked={blocked} onCopy={() => setSheet({ kind: "atg" })} />
      <span className="sr" role="status" aria-live="polite">
        {announce}
      </span>

      <Sheet className="rad-sh" open={!!legSheet && !!legSheetLeg} onClose={closeLeg} title={legSheet ? `${legName(data.round.gameType, legSheet.leg)} · välj hästar` : ""} sub={legSheetLeg ? legSheetSub(legSheetLeg) : undefined}>
        {legSheet && legSheetLeg && (
          <RadLegSheet
            l={legSheetLeg}
            before={result}
            legs={legs}
            rules={rules}
            picked={legSheet.picked}
            touched={legSheet.touched}
            locked={!!current.locked[legSheet.leg]}
            onToggle={(n) => setSheet({ ...legSheet, picked: toggleNumber(legSheet.picked, n), touched: true })}
            onDone={closeLeg}
            onRelease={releaseLeg}
          />
        )}
      </Sheet>

      <Sheet className="rad-sh" open={sheet?.kind === "spik"} onClose={() => setSheet(null)} title="Välj egen spik" sub="Loppet låses med en häst. Appen väljer resten av spikarna.">
        {sheet?.kind === "spik" && <RadSpikSheet r={result} legs={legs} rules={rules} initialLeg={sheet.leg} onConfirm={confirmSpik} onCancel={() => setSheet(null)} />}
      </Sheet>

      <Sheet className="rad-sh" open={sheet?.kind === "prio"} onClose={() => setSheet(null)} title="Välj lopp att prioritera" sub={prioSheetSub(result)}>
        {sheet?.kind === "prio" && (
          <RadPrioSheet
            r={result}
            legs={legs}
            rules={rules}
            onConfirm={(leg) => {
              setSheet(null);
              change((d) => ({ ...d, allgMode: "CHOSEN", allgLeg: leg }));
            }}
            onCancel={() => setSheet(null)}
          />
        )}
      </Sheet>

      <Sheet className="rad-sh" open={sheet?.kind === "atg"} onClose={() => setSheet(null)} title="Spela hos ATG" sub={atgSub}>
        {sheet?.kind === "atg" && (
          <RadAtgSheet
            kupong={kupong}
            rows={view.rows}
            cost={view.cost}
            left={left}
            favText={mode === "live" ? `${result.favCount} av ${result.legCount}` : null}
            allgLeg={allgLegView}
            gameType={gt}
            onCopy={() => void copyNow()}
          />
        )}
      </Sheet>

      <Sheet open={sheet?.kind === "copy-fallback"} onClose={() => setSheet(null)} title="Kopiera raden" sub="Kopieringen fungerade inte i den här webbläsaren. Markera texten och kopiera den själv.">
        <textarea className="copybox num" readOnly rows={legCount + 3} value={sheet?.kind === "copy-fallback" ? sheet.text : ""} aria-label="Raden som text" onFocus={(e) => e.currentTarget.select()} />
      </Sheet>
    </>
  );
}

function legSheetSub(l: TippaLegResult): string {
  const time = l.startAt ? `${hhmm(l.startAt)} · ` : "";
  return `${time}${l.field.length} startande · i appens ordning. Väljer du själv låses loppet.`;
}

function Suggestions({ gameType, items, onUse }: { gameType: string; items: TippaSuggestion[]; onUse: (s: TippaSuggestion) => void }) {
  return (
    <>
      {items.map((s) => (
        <button key={`${s.kind}-${s.kind === "BUDGET" ? s.budget : s.kind === "SPIKES" ? s.spikCount : s.leg}`} type="button" className="btn secondary sm" aria-haspopup={s.kind === "EDIT_LEG" ? "dialog" : undefined} onClick={() => onUse(s)}>
          {suggestionLabel(s, gameType)}
        </button>
      ))}
    </>
  );
}

function CopyButton({ blocked, onClick }: { blocked: string | null; onClick: () => void }) {
  const id = useId();
  return (
    <>
      <button type="button" className="btn primary full" aria-haspopup="dialog" disabled={!!blocked} aria-describedby={blocked ? `${id}b` : undefined} onClick={onClick}>
        <IconCopy />
        Kopiera till ATG
      </button>
      {blocked && (
        <span className="sr" id={`${id}b`}>
          {blocked}
        </span>
      )}
    </>
  );
}

// Budgetrutan på tavlan (oförändrad från S6b utom lägena i E6 och .allfit i E6b 5.8).
function Budget({
  budget,
  rowPrice,
  rows,
  cost,
  dontFit,
  minCost,
  minRowsText,
  allFit,
  allFitText,
  disabled,
  sumRef,
  onBudget,
  onRowPrice,
}: {
  budget: number;
  rowPrice: number;
  rows: number;
  cost: number;
  dontFit: boolean;
  minCost: number;
  minRowsText: string;
  allFit: boolean;
  allFitText: string;
  disabled: boolean;
  sumRef: React.RefObject<HTMLDivElement>;
  onBudget: (b: number) => void;
  onRowPrice: (p: number) => void;
}) {
  const id = useId();
  const [exact, setExact] = useState(String(budget));
  const [exactErr, setExactErr] = useState<string | null>(null);
  const editingExact = useRef(false);
  const [editPrice, setEditPrice] = useState(false);
  const [priceText, setPriceText] = useState(odds(rowPrice));
  const [priceErr, setPriceErr] = useState<string | null>(null);

  useEffect(() => {
    if (!editingExact.current) setExact(String(budget));
  }, [budget]);

  const commitExact = () => {
    editingExact.current = false;
    const b = parseBudget(exact);
    if (b === null) return setExactErr(BUDGET_ERROR);
    setExactErr(null);
    setExact(String(b));
    if (b !== budget) onBudget(b);
  };
  const commitPrice = () => {
    const p = parseRowPrice(priceText);
    if (p === null) return setPriceErr(ROW_PRICE_ERROR);
    setPriceErr(null);
    setEditPrice(false);
    if (p !== rowPrice) onRowPrice(p);
  };
  const slider = Math.min(BUDGET_SLIDER.max, Math.max(BUDGET_SLIDER.min, budget));
  const left = Math.round((budget - cost) * 100) / 100;
  // Upp till BUDGET_OVER_MAX över är tillåtet (budgeten är ett mål), och visas neutralt.
  const overAllowed = !dontFit && left < 0 && cost <= budget * (1 + BUDGET_OVER_MAX) + 1e-9;
  const over = !dontFit && left < 0 && !overAllowed;

  return (
    <div className="budget brd">
      <div className="row1">
        <label htmlFor={`${id}-r`}>Budget</label>
        <span className="bv num" aria-hidden="true">
          {thousands(budget)} kr
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
        aria-valuetext={`${budget} kronor`}
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
      <div className="sum" id={`${id}-s`} ref={sumRef} tabIndex={-1}>
        <div>
          <small>Rader</small>
          <b className="num">{dontFit ? "–" : thousands(rows)}</b>
        </div>
        <div>
          <small>Kostnad</small>
          <b className="num">{dontFit ? "–" : krText(cost)}</b>
        </div>
        {dontFit ? (
          <div className="over">
            <small>Behövs minst</small>
            <b className="num">{krText(minCost)}</b>
          </div>
        ) : (
          <div className={over ? "over" : undefined}>
            <small>{over || overAllowed ? "Över budget" : "Kvar"}</small>
            <b className="num">{krText(Math.abs(left))}</b>
          </div>
        )}
      </div>
      {dontFit && <p className="over-line">{minRowsText}</p>}
      {over && <p className="over-line">Över budget med {krText(-left)}</p>}
      {overAllowed && <p className="help near-line">Närmast din budget: {krText(-left)} över (högst 5 % tillåts).</p>}
      {allFit && !over && <p className="allfit">{allFitText}</p>}
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
            Radpris <b className="num">{krText(rowPrice)}</b>
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
