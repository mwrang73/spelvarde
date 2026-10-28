// Tippa V85 (docs/specs/e6-v85-rad.md, 6.5): räknar V85-raden (och V75, V86,
// GS75) ur budgeten och reglerna. Rena, deterministiska funktioner utan React
// och utan nätverk. Raden räknas i klienten; servern sparar och kontrollerar
// den (PUT /api/rounds/[id]/coupon). Texterna ligger i lib/tippa-text.ts.
//
// Ordningen i buildRad:
//   6.5.2 legFacts  → 6.5.3 typ per avdelning → 6.5.4 chooseAllg →
//   6.5.5 chooseSpikes → 6.5.6 applyFavLimit → 6.5.7 minimumPicks →
//   6.5.8 maximizeHorses (budgeten, exakt) → 6.5.9 avslut och legRoles.
//
// Alla jämförelser som avgör raden görs med heltal (rangpoäng i hundradelar,
// rader och öre), så att resultatet inte beror på flyttalsavrundning.
//
// Prestanda (6.5.8, mätt i lib/tippa.property.test.ts 2026-10-28): antalet
// tillstånd i maximizeHorses (största Map under ett steg) är 24 i typfallet
// (Bjerke, R = 50, i snitt 0,5 ms per buildRad), 2 554 för 7 öppna lopp med 16
// löpande, budget 100 000 kr och radpris 0,01 (R = 625 000 efter
// allgarderingen, 5 ms) och 6 242 vid det hårda taket R = 10 000 000 med sju
// lopp à 3–16 hästar (7 ms).

import { BUDGET_MAX, couponCost, type Selections } from "@/lib/coupon";
import { favLimitFor, legsFor, spikMaxFor } from "@/lib/game-type";
import { LOW_STRECK_MIN } from "@/lib/positive-signals";
import type { AllgMode, LegRoleDto, LegRoleKind, LegRolesDto, ReasonCode } from "@/lib/types";

export type { AllgMode, LegRolesDto, ReasonCode } from "@/lib/types";

// ---- Indata (6.5.1) ---------------------------------------------------------------------------

export type TippaStart = {
  number: number;
  name: string;
  scratched: boolean;
  // Procent, två decimaler. null = saknas.
  streck: number | null;
  // Riktoddset med X-faktor (riktX i lib/xfactor-ui.ts). null = saknas.
  riktX: number | null;
  // Antal positiva signaler (StartDto.signals?.count). null = saknas.
  signals: number | null;
  interesting: boolean;
  spelbar: boolean;
  bet: boolean;
  betOdds: number | null;
  xFactor: "NONE" | "TROR" | "STARK";
};

export type TippaLeg = { leg: number; startAt: string; cancelled: boolean; starts: TippaStart[] };

export type TippaRules = {
  gameType: string;
  budget: number;
  rowPrice: number;
  // Önskat antal spikar totalt (egna och appens).
  spikCount: number;
  allgMode: AllgMode;
  allgLeg: number | null;
  // Låsta avdelningar och deras val (egen spik = en häst, eget val = flera).
  locked: Record<number, number[]>;
};

export type TippaOpts = { favLimit?: number };

// ---- Per häst och avdelning (6.5.2) ------------------------------------------------------------

export type Group = "T3" | "MEL" | "SKR";

export type HorseFact = {
  number: number;
  name: string;
  streck: number | null;
  riktX: number | null;
  // Modellens andel av fältet i procent. null utan riktX.
  share: number | null;
  // Jämförelsetalet: strecket, eller modellens andel när avdelningen är preliminär.
  v: number;
  // Streckplats, 1 = mest streckad. Delad vid lika v.
  place: number;
  group: Group;
  favorite: boolean;
  fel: boolean;
  signals: number;
  // Rangpoäng i hundradelar.
  score: number;
  // Kvoten för favoritspärren (andel / streck, preliminär: andel).
  kvot: number;
  interesting: boolean;
  spelbar: boolean;
  bet: boolean;
  betOdds: number | null;
  xFactor: TippaStart["xFactor"];
};

export type LegFacts = {
  leg: number;
  // Ingen löpande häst har streck > 0.
  prelim: boolean;
  // Löpande (ej strukna) hästar i rangordning.
  runners: HorseFact[];
  favorite: HorseFact | null;
  // Strukna hästar, stigande startnummer.
  scratched: { number: number; name: string }[];
};

const EPS = 1e-9;
const byNumber = <T extends { number: number }>(a: T, b: T) => a.number - b.number;

// Modellens andel (6.5.2 punkt 1) för löpande hästar. null utan riktX.
export function modelShares(runners: Pick<TippaStart, "number" | "riktX">[]): Map<number, number | null> {
  const inv = new Map<number, number>();
  let sum = 0;
  for (const s of runners) {
    if (s.riktX !== null && Number.isFinite(s.riktX) && s.riktX > 0) {
      inv.set(s.number, 1 / s.riktX);
      sum += 1 / s.riktX;
    }
  }
  const out = new Map<number, number | null>();
  for (const s of runners) {
    const i = inv.get(s.number);
    out.set(s.number, i === undefined || sum <= 0 ? null : (100 * i) / sum);
  }
  return out;
}

// Streckplats (6.5.2 punkt 3): 1 + antal med strikt större v.
export function streckPlaces(values: { number: number; v: number }[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const a of values) out.set(a.number, 1 + values.filter((b) => b.v > a.v).length);
  return out;
}

// Rangpoäng i hundradelar (6.5.2 punkt 8). En häst med X är alltid Intressant.
export function rankScore(h: { riktX: number | null; signals: number | null; fel: boolean; bet: boolean; spelbar: boolean; interesting: boolean; xFactor?: TippaStart["xFactor"] }): number {
  const base = h.riktX !== null && h.riktX > 0 ? Math.round(10000 / h.riktX) : 0;
  const interesting = h.interesting || (h.xFactor !== undefined && h.xFactor !== "NONE");
  const mark = h.bet ? 1500 : h.spelbar ? 1000 : interesting ? 500 : 0;
  return base + 300 * (h.signals ?? 0) + (h.fel ? 1000 : 0) + mark;
}

// Värde (Mikael 2026-10-29: spela för stor utdelning): hur mycket bättre
// chans modellen ger hästen än strecket, i hundradelar av procentenheter,
// plus signaler och markeringar. X-faktorn ingår redan via riktX → share.
// Understreckade hästar och halvskrällar med signaler hamnar före en tredje
// favorit. Används för vilka extra hästar som läggs till.
export function valueScore(h: Pick<HorseFact, "share" | "v" | "signals" | "bet" | "spelbar" | "interesting" | "xFactor">): number {
  const edge = h.share !== null ? Math.round((h.share - h.v) * 100) : 0;
  const interesting = h.interesting || h.xFactor !== "NONE";
  const mark = h.bet ? 1500 : h.spelbar ? 1000 : interesting ? 500 : 0;
  return edge + 300 * h.signals + mark;
}
export const isUnderbet = (h: Pick<HorseFact, "share" | "v">) => h.share !== null && h.share > h.v;
const byValue = (a: HorseFact, b: HorseFact) => valueScore(b) - valueScore(a) || compareRank(a, b);

const nullLast = (a: number | null, b: number | null, dir: 1 | -1) => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir * (a - b);
};

// Rangordningen (6.5.2 punkt 9): poäng fallande, riktX stigande (null sist),
// streck fallande (null sist), nummer stigande.
export function compareRank(a: Pick<HorseFact, "score" | "riktX" | "streck" | "number">, b: Pick<HorseFact, "score" | "riktX" | "streck" | "number">): number {
  return b.score - a.score || nullLast(a.riktX, b.riktX, 1) || nullLast(a.streck, b.streck, -1) || a.number - b.number;
}

export function rankOrder<T extends Pick<HorseFact, "score" | "riktX" | "streck" | "number">>(horses: T[]): T[] {
  return [...horses].sort(compareRank);
}

// Fakta per avdelning och häst (6.5.2).
export function legFacts(leg: TippaLeg): LegFacts {
  const starts = [...leg.starts].sort(byNumber);
  const run = starts.filter((s) => !s.scratched);
  const scratched = starts.filter((s) => s.scratched).map((s) => ({ number: s.number, name: s.name }));
  const prelim = !run.some((s) => s.streck !== null && s.streck > 0);
  const shares = modelShares(run);
  const vOf = (s: TippaStart) => (prelim ? (shares.get(s.number) ?? 0) : (s.streck ?? 0));
  const places = streckPlaces(run.map((s) => ({ number: s.number, v: vOf(s) })));
  const top = run.filter((s) => places.get(s.number) === 1).sort((a, b) => nullLast(a.riktX, b.riktX, 1) || a.number - b.number);
  const favNumber = top[0]?.number ?? null;
  const horses: HorseFact[] = run.map((s) => {
    const share = shares.get(s.number) ?? null;
    const v = vOf(s);
    const place = places.get(s.number)!;
    const group: Group = run.length <= 3 || place <= 3 ? "T3" : v >= 5 - EPS ? "MEL" : "SKR";
    const fel = !prelim && share !== null && s.streck !== null && share >= 1.5 * s.streck - EPS && share - s.streck >= 3 - EPS;
    const signals = s.signals ?? 0;
    const interesting = s.interesting || s.xFactor !== "NONE";
    const score = rankScore({ riktX: s.riktX, signals, fel, bet: s.bet, spelbar: s.spelbar, interesting });
    const kvot = share === null ? 0 : prelim ? share : s.streck !== null && s.streck > 0 ? share / s.streck : Number.POSITIVE_INFINITY;
    return {
      number: s.number,
      name: s.name,
      streck: s.streck,
      riktX: s.riktX,
      share,
      v,
      place,
      group,
      favorite: s.number === favNumber,
      fel,
      signals,
      score,
      kvot,
      interesting,
      spelbar: s.spelbar,
      bet: s.bet,
      betOdds: s.betOdds,
      xFactor: s.xFactor,
    };
  });
  const runners = rankOrder(horses);
  return { leg: leg.leg, prelim, runners, favorite: runners.find((h) => h.favorite) ?? null, scratched };
}

const SIG_CODES: ReasonCode[] = ["SIG4", "SIG5", "SIG6", "SIG7", "SIG8", "SIG9", "SIG10"];
export const REASON_ORDER: readonly ReasonCode[] = ["PRE", "T3", "MEL", "SKR", "LOW", "NOMEL", "FEL", ...SIG_CODES, "FAV"];

// Skälen för en häst i taggordningen (6.5.2). sub ersätter gruppens tagg för
// ersättarna i 6.5.7.
export function reasonsOf(h: HorseFact, prelim: boolean, sub?: "LOW" | "NOMEL"): ReasonCode[] {
  const out: ReasonCode[] = [];
  if (prelim) out.push("PRE");
  out.push(sub ?? h.group);
  if (h.fel) out.push("FEL");
  if (h.signals >= LOW_STRECK_MIN) out.push(SIG_CODES[Math.min(h.signals, 10) - 4]);
  if (h.favorite) out.push("FAV");
  return out;
}

// ---- Minsta val i en öppen avdelning (6.5.7) ---------------------------------------------------

export type MinPicks = {
  // Valda i valordningen (Topp 3, Mellan, Skräll, ersättare).
  picks: number[];
  lo: number;
  // Fortsättningen A(L): övriga löpande i rangordning, utan spärrad favorit.
  rest: HorseFact[];
  // Ersättarna: LOW (ingen skräll) och NOMEL (ingen mellan).
  sub: Record<number, "LOW" | "NOMEL">;
  few: boolean;
};

export function minimumPicks(facts: LegFacts, favBanned: boolean): MinPicks {
  const run = facts.runners;
  if (run.length <= 3) return { picks: run.map((h) => h.number), lo: run.length, rest: [], sub: {}, few: true };
  const pool = run.filter((h) => !(favBanned && h.favorite));
  const chosen = new Set<number>();
  const sub: Record<number, "LOW" | "NOMEL"> = {};
  const picks: number[] = [];
  const take = (h: HorseFact | undefined) => {
    if (!h) return false;
    chosen.add(h.number);
    picks.push(h.number);
    return true;
  };
  const free = () => pool.filter((h) => !chosen.has(h.number));
  take(free().find((h) => h.group === "T3") ?? free()[0]);
  const mel = take(free().find((h) => h.group === "MEL"));
  const skr = take(free().find((h) => h.group === "SKR"));
  if (!skr) {
    const low = [...free()].sort((a, b) => a.v - b.v || b.score - a.score || a.number - b.number)[0];
    if (take(low)) sub[low.number] = "LOW";
  }
  if (!mel) {
    const nm = free()[0];
    if (take(nm)) sub[nm.number] = "NOMEL";
  }
  return { picks, lo: picks.length, rest: [...free()].sort(byValue), sub, few: false };
}

// ---- Allgardering (6.5.4) ---------------------------------------------------------------------

export type AllgFallback = "LOCKED" | "CANCELLED" | "MISSING";

export function chooseAllg(
  legs: { leg: number; base: BaseKind; facts: LegFacts }[],
  mode: AllgMode,
  chosen: number | null,
): { leg: number | null; fallback: AllgFallback | null; auto: boolean } {
  let fallback: AllgFallback | null = null;
  if (mode === "CHOSEN") {
    const l = chosen === null ? undefined : legs.find((x) => x.leg === chosen);
    if (l && l.base === "FREE") return { leg: l.leg, fallback: null, auto: false };
    fallback = l?.base === "LOCKED" ? "LOCKED" : l?.base === "CANCELLED" ? "CANCELLED" : "MISSING";
  }
  const free = legs.filter((l) => l.base === "FREE" && l.facts.favorite);
  const favV = (l: (typeof free)[number]) => l.facts.favorite!.v;
  const wide = (l: (typeof free)[number]) => l.facts.runners.filter((h) => h.v >= 5 - EPS).length;
  const best = [...free].sort((a, b) => favV(a) - favV(b) || wide(b) - wide(a) || b.facts.runners.length - a.facts.runners.length || a.leg - b.leg)[0];
  return { leg: best?.leg ?? null, fallback, auto: true };
}

// ---- Spikar (6.5.5) --------------------------------------------------------------------------

export type SpikCandidate = { leg: number; horse: HorseFact; isFav: boolean };

// Spikhästen: lägst riktX (lika: högre poäng, lägre nummer). null utan riktX.
export function spikHorse(facts: LegFacts): HorseFact | null {
  const withX = facts.runners.filter((h) => h.riktX !== null);
  return [...withX].sort((a, b) => a.riktX! - b.riktX! || b.score - a.score || a.number - b.number)[0] ?? null;
}

export function chooseSpikes(
  candidates: SpikCandidate[],
  appSpikes: number,
  quota: number,
): { spikes: SpikCandidate[]; skipped: number[]; overSpikes: boolean } {
  const order = [...candidates].sort((a, b) => a.horse.riktX! - b.horse.riktX! || a.leg - b.leg);
  const spikes: SpikCandidate[] = [];
  const skipped: SpikCandidate[] = [];
  let q = quota;
  for (const c of order) {
    if (spikes.length >= appSpikes) break;
    if (c.isFav) {
      if (q > 0) {
        q -= 1;
        spikes.push(c);
      } else skipped.push(c);
    } else spikes.push(c);
  }
  let overSpikes = false;
  while (spikes.length < appSpikes && skipped.length) {
    spikes.push(skipped.shift()!);
    overSpikes = true;
  }
  return { spikes, skipped: skipped.map((c) => c.leg), overSpikes };
}

// ---- Favoritspärren (6.5.6) -------------------------------------------------------------------

// De första `quota` öppna avdelningarna (minst 4 löpande) i behållordningen får
// ha favoriten, övriga får den spärrad.
export function applyFavLimit(open: LegFacts[], quota: number): { allowed: number[]; banned: number[] } {
  const eligible = open.filter((f) => f.runners.length >= 4 && f.favorite);
  const marked = (f: LegFacts) => (f.favorite!.spelbar || f.favorite!.bet ? 0 : 1);
  const order = [...eligible].sort((a, b) => marked(a) - marked(b) || b.favorite!.kvot - a.favorite!.kvot || a.leg - b.leg);
  const q = Math.max(0, quota);
  return { allowed: order.slice(0, q).map((f) => f.leg), banned: order.slice(q).map((f) => f.leg).sort((a, b) => a - b) };
}

// ---- Flest hästar inom budget (6.5.8) ---------------------------------------------------------

// gains[j] = summan av poängen för de första j hästarna i A(L), j = 0 … hi − lo.
export type MaxLeg = { lo: number; hi: number; gains: number[] };

// Bara allgarderingen får ha alla hästar (Mikael 2026-10-28): ett öppet lopp
// får högst hälften av de löpande, men aldrig färre än minsta valet.
export const OPEN_SHARE_MAX = 0.5;
export function openHiOf(lo: number, restLen: number, runners: number): number {
  return Math.max(lo, Math.min(lo + restLen, Math.floor(runners * OPEN_SHARE_MAX)));
}
const openHi = (o: { min: { lo: number; rest: unknown[] }; prep: { facts: { runners: unknown[] } } }) => openHiOf(o.min.lo, o.min.rest.length, o.prep.facts.runners.length);
export type MaxResult = { k: number[]; horses: number; score: number; product: number; states: number };

// Exakt lösning med dynamisk programmering över produkten: välj k(L) i
// [lo, hi] så att Π k ≤ R med största Σ k, vid lika störst poäng, sedan minst
// produkt. null när inte ens Π lo ryms.
export function maximizeHorses(legs: MaxLeg[], R: number): MaxResult | null {
  const loProd = legs.reduce((a, l) => a * l.lo, 1);
  if (loProd > R) return null;
  const hiProd = legs.reduce((a, l) => a * l.hi, 1);
  if (hiProd <= R) {
    return {
      k: legs.map((l) => l.hi),
      horses: legs.reduce((a, l) => a + l.hi, 0),
      score: legs.reduce((a, l) => a + l.gains[l.hi - l.lo], 0),
      product: hiProd,
      states: 1,
    };
  }
  const cap = Math.min(R, hiProd);
  type St = { h: number; s: number; prev: number; k: number };
  const stages: Map<number, St>[] = [];
  let cur = new Map<number, St>([[1, { h: 0, s: 0, prev: 0, k: 0 }]]);
  let states = 1;
  for (const l of legs) {
    const next = new Map<number, St>();
    for (const [p, st] of cur) {
      for (let k = l.lo; k <= l.hi; k++) {
        const p2 = p * k;
        if (p2 > cap) break;
        const h2 = st.h + k;
        const s2 = st.s + l.gains[k - l.lo];
        const ex = next.get(p2);
        if (!ex || h2 > ex.h || (h2 === ex.h && s2 > ex.s)) next.set(p2, { h: h2, s: s2, prev: p, k });
      }
    }
    stages.push(next);
    states = Math.max(states, next.size);
    cur = next;
  }
  let bestP = -1;
  let best: St | null = null;
  for (const [p, st] of cur) {
    if (!best || st.h > best.h || (st.h === best.h && (st.s > best.s || (st.s === best.s && p < bestP)))) {
      best = st;
      bestP = p;
    }
  }
  if (!best) return null;
  const k: number[] = new Array(legs.length);
  let p = bestP;
  for (let i = legs.length - 1; i >= 0; i--) {
    const st = stages[i].get(p)!;
    k[i] = st.k;
    p = st.prev;
  }
  return { k, horses: best.h, score: best.s, product: bestP, states };
}

// ---- Resultatet ------------------------------------------------------------------------------

export type BaseKind = "FREE" | "LOCKED" | "CANCELLED" | "NO_STARTERS";
export type LegKind = LegRoleKind | "NO_STARTERS";
export type TippaStatus = "OK" | "OWN_OVER_BUDGET" | "RULES_DONT_FIT";
export type FavOver = "SPIKES" | "OWN" | null;

export type TippaSuggestion = { kind: "BUDGET"; budget: number } | { kind: "SPIKES"; spikCount: number; minCost: number } | { kind: "EDIT_LEG"; leg: number };

export type TippaHorse = HorseFact & { reasons: ReasonCode[] };

export type TippaLegResult = {
  leg: number;
  startAt: string;
  kind: LegKind;
  prelim: boolean;
  // Valda startnummer, stigande (det som sparas och kopieras).
  selection: number[];
  // Valda hästar i rangordning med skälen (för kortet). Struken egen spik: tom.
  horses: TippaHorse[];
  // Alla löpande i rangordning med skälen (för arken).
  field: TippaHorse[];
  scratched: { number: number; name: string }[];
  favorite: TippaHorse | null;
  // Favoriten spärrad av favoritspärren (öppen avdelning, minst 4 löpande).
  favBanned: boolean;
  // Öppen avdelning med 1–3 löpande: alla är med.
  few: boolean;
  // Öppna avdelningar: minsta och största antal hästar (6.5.7). Övriga: antalet.
  lo: number;
  hi: number;
  // Appens spik: platsen i spikordningen (0 = säkrast). Annars null.
  spikRank: number | null;
  struckOwnSpik: boolean;
  struckRemoved: number[];
  unlocked: boolean;
};

export type TippaResult = {
  // Avvikelser från mallen för att nå budgeten (Mikael 2026-10-28):
  // hästar som allgarderingen tappade och öppna lopp med bara 2 hästar.
  allgDropped: number;
  relaxedLegs: number[];
  underbet: number;
  gameType: string;
  legCount: number;
  favLimit: number;
  // Spelformens tak för spikar (SPIK_MAX).
  spikCap: number;
  status: TippaStatus;
  // Någon avdelning saknar streck (preliminär rad).
  prelim: boolean;
  // Varken riktodds eller streck i omgången: raden kan inte räknas än.
  noData: boolean;
  // Inga riktodds i omgången.
  noRikt: boolean;
  legs: TippaLegResult[];
  selections: Selections;
  rows: number;
  cost: number;
  horses: number;
  budget: number;
  rowPrice: number;
  maxRows: number;
  minRows: number;
  minCost: number;
  allFit: boolean;
  ownSpikes: number;
  spikMin: number;
  spikMax: number;
  spikEffective: number;
  appSpikes: number;
  // Appens spikar i valordningen.
  spikLegs: number[];
  ownSpikLegs: number[];
  skippedSpik: number[];
  allgMode: AllgMode;
  allgLeg: number | null;
  // true = appen valde allgarderingen (AUTO eller reserv för CHOSEN).
  allgAuto: boolean;
  allgFallback: AllgFallback | null;
  // Avdelningen Mikael valde (rules.allgLeg), för texten vid reserv.
  allgRequested: number | null;
  favCount: number;
  favOver: FavOver;
  favBanned: number[];
  favAllowed: number[];
  // Tvingade favoriter F0 (6.5.6).
  forcedFav: number;
  struckOwnSpik: number[];
  struckRemoved: { leg: number; numbers: number[] }[];
  unlockedLegs: number[];
  noStarters: number[];
  cancelled: number[];
  // Låsningen efter strykningar (det som sparas som lockedLegs och selections).
  locked: Record<number, number[]>;
  lockedLegs: number[];
  canCopy: boolean;
  suggestions: TippaSuggestion[];
  legRoles: LegRolesDto;
  // Antal tillstånd i maximizeHorses (prestandatestet).
  dpStates: number;
};

// ---- Förberedelse (6.5.2–6.5.3) och regelbeslut (6.5.4–6.5.7) ---------------------------------

type Prep = {
  leg: number;
  startAt: string;
  facts: LegFacts;
  base: BaseKind;
  // Låst val efter strykningar (LOCKED och CANCELLED med låsning).
  lockedSel: number[] | null;
  struckOwnSpik: boolean;
  struckRemoved: number[];
  unlocked: boolean;
  cancelledSel: number[];
};

function prepare(input: TippaLeg[], gameType: string, locked: Record<number, number[]>): Prep[] {
  const n = legsFor(gameType);
  const out: Prep[] = [];
  for (let leg = 1; leg <= n; leg++) {
    const raw = input.find((l) => l.leg === leg) ?? { leg, startAt: "", cancelled: false, starts: [] };
    const facts = legFacts(raw);
    const lockRaw = [...new Set(locked[leg] ?? [])].sort((a, b) => a - b);
    const runSet = new Set(facts.runners.map((h) => h.number));
    const p: Prep = { leg, startAt: raw.startAt, facts, base: "FREE", lockedSel: null, struckOwnSpik: false, struckRemoved: [], unlocked: false, cancelledSel: [] };
    if (raw.cancelled) {
      p.base = "CANCELLED";
      const kept = lockRaw.filter((x) => runSet.has(x));
      const first = facts.runners[0]?.number ?? [...raw.starts].sort(byNumber)[0]?.number;
      p.cancelledSel = kept.length ? kept : first !== undefined ? [first] : [];
    } else if (!facts.runners.length) {
      p.base = "NO_STARTERS";
    } else if (lockRaw.length) {
      const scratchedSet = new Set(facts.scratched.map((s) => s.number));
      const kept = lockRaw.filter((x) => runSet.has(x));
      const struck = lockRaw.filter((x) => scratchedSet.has(x));
      if (kept.length) {
        p.base = "LOCKED";
        p.lockedSel = kept;
        p.struckRemoved = struck;
      } else if (struck.length && lockRaw.length === 1) {
        p.base = "LOCKED";
        p.lockedSel = lockRaw;
        p.struckOwnSpik = true;
      } else {
        p.unlocked = true;
      }
    }
    out.push(p);
  }
  return out;
}

type Decision = {
  allg: ReturnType<typeof chooseAllg>;
  ownSpikes: number;
  spikMin: number;
  spikMax: number;
  spikEffective: number;
  spikes: SpikCandidate[];
  candidates: SpikCandidate[];
  skipped: number[];
  favOver: FavOver;
  forcedFav: number;
  favAllowed: number[];
  favBanned: number[];
  // Öppna avdelningar och deras minsta val.
  open: { prep: Prep; min: MinPicks; banned: boolean }[];
  // Π antal i alla avdelningar som inte är öppna, och samma med eget val som 1.
  fast: number;
  fastOwnAs1: number;
  loProd: number;
};

function decide(prep: Prep[], rules: TippaRules, favLimit: number, spikCount: number): Decision {
  const allg = chooseAllg(prep, rules.allgMode, rules.allgLeg);
  const lockedPreps = prep.filter((p) => p.base === "LOCKED");
  const ownSpikes = lockedPreps.filter((p) => p.lockedSel!.length === 1).length;
  const candidates: SpikCandidate[] = [];
  for (const p of prep) {
    if (p.base !== "FREE" || p.leg === allg.leg) continue;
    const h = spikHorse(p.facts);
    if (h) candidates.push({ leg: p.leg, horse: h, isFav: h.favorite });
  }
  const spikMin = ownSpikes;
  const spikMax = Math.max(spikMin, Math.min(spikMaxFor(rules.gameType), ownSpikes + candidates.length));
  const spikEffective = Math.min(spikMax, Math.max(spikMin, Math.floor(Number.isFinite(spikCount) ? spikCount : 0)));
  const appSpikes = spikEffective - ownSpikes;
  const lockedWithFav = lockedPreps.filter((p) => !p.struckOwnSpik && p.facts.favorite && p.lockedSel!.includes(p.facts.favorite.number)).length;
  const quota = favLimit - lockedWithFav - (allg.leg !== null ? 1 : 0);
  const sp = chooseSpikes(candidates, appSpikes, quota);
  const spikSet = new Set(sp.spikes.map((c) => c.leg));
  const openPreps = prep.filter((p) => p.base === "FREE" && p.leg !== allg.leg && !spikSet.has(p.leg));
  const fewOpen = openPreps.filter((p) => p.facts.runners.length <= 3).length;
  const forcedFav = lockedWithFav + (allg.leg !== null ? 1 : 0) + sp.spikes.filter((c) => c.isFav).length + fewOpen;
  let favOver: FavOver = sp.overSpikes ? "SPIKES" : null;
  if (!favOver && forcedFav > favLimit) favOver = "OWN";
  const fl = applyFavLimit(
    openPreps.map((p) => p.facts),
    favLimit - forcedFav,
  );
  const bannedSet = new Set(fl.banned);
  const open = openPreps.map((p) => {
    const banned = bannedSet.has(p.leg);
    return { prep: p, min: minimumPicks(p.facts, banned), banned };
  });
  let fast = 1;
  let fastOwnAs1 = 1;
  for (const p of prep) {
    if (openPreps.includes(p)) continue;
    let f = 1;
    if (p.base === "LOCKED") f = p.lockedSel!.length;
    else if (p.base === "CANCELLED") f = Math.max(1, p.cancelledSel.length);
    else if (p.base === "FREE" && p.leg === allg.leg) f = p.facts.runners.length;
    fast *= f;
    fastOwnAs1 *= p.base === "LOCKED" ? 1 : f;
  }
  const loProd = open.reduce((a, o) => a * o.min.lo, 1);
  return { allg, ownSpikes, spikMin, spikMax, spikEffective, spikes: sp.spikes, candidates, skipped: sp.skipped, favOver, forcedFav, favAllowed: fl.allowed, favBanned: fl.banned, open, fast, fastOwnAs1, loProd };
}

const priceOre = (rowPrice: number) => Math.max(1, Math.round(rowPrice * 100));
const maxRowsOf = (budget: number, rowPrice: number) => Math.max(0, Math.floor(Math.round(Math.max(0, budget) * 100) / priceOre(rowPrice)));

// minRader för ett visst antal spikar (6.5.10 och 6.5.14).
function minRowsFor(prep: Prep[], rules: TippaRules, favLimit: number, spikCount: number): { minRows: number; d: Decision } {
  const d = decide(prep, rules, favLimit, spikCount);
  const t = targetParts(prep, d);
  return { minRows: t.fastX * t.minProd, d };
}

// Standardantalet spikar för en ny rad (6.5.14): det minsta s i [ownSpikes,
// spikMax] där minsta raden ryms. Finns inget: spikMax.
export function defaultSpikCount(legs: TippaLeg[], rules: TippaRules, opts: TippaOpts = {}): number {
  const favLimit = opts.favLimit ?? favLimitFor(rules.gameType);
  const prep = prepare(legs, rules.gameType, rules.locked);
  const maxRows = upperRowsOf(rules.budget, rules.rowPrice);
  const first = decide(prep, rules, favLimit, 0);
  for (let s = first.spikMin; s <= first.spikMax; s++) {
    if (minRowsFor(prep, rules, favLimit, s).minRows <= maxRows) return s;
  }
  return first.spikMax;
}

// Förslagen när raden inte ryms (6.5.10). Tom lista för OK.
export function suggestions(legs: TippaLeg[], rules: TippaRules, result: Pick<TippaResult, "status" | "minRows" | "cost" | "spikEffective" | "spikMax" | "legs" | "maxRows">, opts: TippaOpts = {}): TippaSuggestion[] {
  const out: TippaSuggestion[] = [];
  if (result.status === "RULES_DONT_FIT") {
    const budget = Math.ceil((result.minRows * priceOre(rules.rowPrice)) / 100);
    if (budget <= BUDGET_MAX) out.push({ kind: "BUDGET", budget });
    const favLimit = opts.favLimit ?? favLimitFor(rules.gameType);
    const prep = prepare(legs, rules.gameType, rules.locked);
    for (let s = result.spikEffective + 1; s <= result.spikMax; s++) {
      const m = minRowsFor(prep, rules, favLimit, s).minRows;
      if (m <= upperRowsOf(rules.budget, rules.rowPrice)) {
        out.push({ kind: "SPIKES", spikCount: s, minCost: couponCost(m, rules.rowPrice) });
        break;
      }
    }
  } else if (result.status === "OWN_OVER_BUDGET") {
    const own = result.legs.filter((l) => l.kind === "OWN").sort((a, b) => b.selection.length - a.selection.length || a.leg - b.leg)[0];
    if (own) out.push({ kind: "EDIT_LEG", leg: own.leg });
    const budget = Math.ceil(result.cost - EPS);
    if (budget <= BUDGET_MAX) out.push({ kind: "BUDGET", budget });
  }
  return out;
}

// ---- Budgeten som mål (Mikael 2026-10-28) ------------------------------------------------------
// Kostnaden ska komma så nära budgeten som möjligt, högst BUDGET_OVER_MAX
// över. För att nå dit får raden avvika från mallen: allgarderingen tappar
// högst ALLG_DROP_MAX hästar (de lägst rankade) och ett öppet lopp får gå ned
// till 2 hästar (bästa Topp 3 + högst rankade av övriga). Varje avvikelse
// kostar en poäng, och vid samma avstånd till budgeten vinner minst avvikelse,
// sedan flest hästar och högst rangpoäng.
export const BUDGET_OVER_MAX = 0.05;
// Bandet under budgeten: inom [BUDGET_UNDER_MAX, BUDGET_OVER_MAX] runt summan
// väljs flest hästar, inte närmast summan.
export const BUDGET_UNDER_MAX = 0.1;
export const ALLG_DROP_MAX = 2;
export const OPEN_RELAXED_MIN = 2;

type Open = Decision["open"][number];
type Opt = { k: number; pen: number; score: number };

// Valda startnummer i ett öppet lopp för k hästar.
function openSelection(o: Open, k: number): number[] {
  if (k >= o.min.lo) return [...o.min.picks, ...o.min.rest.slice(0, k - o.min.lo).map((h) => h.number)];
  const first = o.min.picks[0];
  const pool = o.prep.facts.runners.filter((h) => h.number !== first && !(o.banned && h.favorite));
  return [first, ...pool.slice(0, k - 1).map((h) => h.number)].filter((n) => n !== undefined);
}
function openOptions(o: Open): Opt[] {
  const byNum = new Map(o.prep.facts.runners.map((h) => [h.number, valueScore(h)]));
  const lo = o.min.few ? o.min.lo : Math.min(o.min.lo, OPEN_RELAXED_MIN);
  const out: Opt[] = [];
  for (let k = lo; k <= openHi(o); k++) {
    out.push({ k, pen: k < o.min.lo ? 1 : 0, score: openSelection(o, k).reduce((a, n) => a + (byNum.get(n) ?? 0), 0) });
  }
  return out;
}
function allgOptions(runners: HorseFact[]): Opt[] {
  const n = runners.length;
  const out: Opt[] = [];
  for (let k = Math.max(1, n - ALLG_DROP_MAX); k <= n; k++) out.push({ k, pen: n - k, score: runners.slice(0, k).reduce((a, h) => a + valueScore(h), 0) });
  return out;
}
const minK = (opts: Opt[]) => Math.min(...opts.map((o) => o.k));

type Target = { k: number[]; product: number; pen: number; states: number };
// Exakt: välj ett alternativ per lopp. Kostnaden ska ligga i bandet
// [lower, upper] rader; där vinner minst avvikelse, flest hästar, högst värde
// och sist närmast B. Når ingen kombination bandet: den närmast under upper.
export function targetRows(legOpts: Opt[][], fast: number, B: number, upper: number, lower = 0): Target | null {
  const capP = Math.floor(upper / fast);
  type St = { pen: number; h: number; s: number; prev: number; k: number };
  const stages: Map<number, St>[] = [];
  let cur = new Map<number, St>([[1, { pen: 0, h: 0, s: 0, prev: 0, k: 0 }]]);
  let states = 1;
  const better = (a: St, b: St) => a.pen < b.pen || (a.pen === b.pen && (a.h > b.h || (a.h === b.h && a.s > b.s)));
  for (const opts of legOpts) {
    const next = new Map<number, St>();
    for (const [p, st] of cur) {
      for (const o of opts) {
        const p2 = p * o.k;
        if (p2 > capP) continue;
        const cand = { pen: st.pen + o.pen, h: st.h + o.k, s: st.s + o.score, prev: p, k: o.k };
        const ex = next.get(p2);
        if (!ex || better(cand, ex)) next.set(p2, cand);
      }
    }
    stages.push(next);
    states = Math.max(states, next.size);
    cur = next;
  }
  let bestP = -1;
  let best: St | null = null;
  const anyInBand = [...cur.keys()].some((p) => fast * p >= lower);
  for (const [p, st] of cur) {
    if (anyInBand && fast * p < lower) continue;
    if (!best) {
      best = st;
      bestP = p;
      continue;
    }
    const d = Math.abs(fast * p - B);
    const db = Math.abs(fast * bestP - B);
    const wins = anyInBand
      ? better(st, best) || (!better(best, st) && (d < db || (d === db && p < bestP)))
      : p > bestP || (p === bestP && better(st, best));
    if (wins) {
      best = st;
      bestP = p;
    }
  }
  if (!best) return null;
  const k: number[] = new Array(legOpts.length);
  let p = bestP;
  for (let i = legOpts.length - 1; i >= 0; i--) {
    const st = stages[i].get(p)!;
    k[i] = st.k;
    p = st.prev;
  }
  return { k, product: bestP, pen: best.pen, states };
}

// Allgarderingens lopp (fritt, med löpande) och produkten av övriga fasta lopp.
function targetParts(prep: Prep[], d: Decision) {
  const allgPrep = d.allg.leg ? prep.find((p) => p.leg === d.allg.leg && p.base === "FREE" && p.facts.runners.length > 0) ?? null : null;
  const n = allgPrep?.facts.runners.length ?? 1;
  const fastX = allgPrep ? d.fast / n : d.fast;
  const fastOwnX = allgPrep ? d.fastOwnAs1 / n : d.fastOwnAs1;
  const legOpts: Opt[][] = d.open.map(openOptions);
  if (allgPrep) legOpts.push(allgOptions(allgPrep.facts.runners));
  const minProd = legOpts.reduce((a, o) => a * minK(o), 1);
  return { allgPrep, fastX, fastOwnX, legOpts, minProd };
}
const lowerRowsOf = (budget: number, rowPrice: number) => Math.max(0, Math.ceil((Math.round(Math.max(0, budget) * 100) * (1 - BUDGET_UNDER_MAX)) / priceOre(rowPrice) - EPS));
const upperRowsOf = (budget: number, rowPrice: number) => Math.max(0, Math.floor((Math.round(Math.max(0, budget) * 100) * (1 + BUDGET_OVER_MAX)) / priceOre(rowPrice) + EPS));

// ---- buildRad --------------------------------------------------------------------------------

export function buildRad(legs: TippaLeg[], rules: TippaRules, opts: TippaOpts = {}): TippaResult {
  const favLimit = opts.favLimit ?? favLimitFor(rules.gameType);
  const legCount = legsFor(rules.gameType);
  const prep = prepare(legs, rules.gameType, rules.locked);
  const d = decide(prep, rules, favLimit, rules.spikCount);
  const maxRows = maxRowsOf(rules.budget, rules.rowPrice);
  const upperRows = upperRowsOf(rules.budget, rules.rowPrice);
  const tp = targetParts(prep, d);
  const minRows = tp.fastX * tp.minProd;

  let status: TippaStatus = "OK";
  // Utan rad (ryms inte): minsta tillåtna, som texterna och kostnaden visar.
  let ks: number[] = tp.legOpts.slice(0, d.open.length).map(minK);
  let allgK = tp.allgPrep ? minK(tp.legOpts[d.open.length]) : 0;
  let allFit = false;
  let dpStates = 0;
  if (minRows <= upperRows) {
    const t = targetRows(tp.legOpts, tp.fastX, maxRows, upperRows, lowerRowsOf(rules.budget, rules.rowPrice))!;
    ks = t.k.slice(0, d.open.length);
    if (tp.allgPrep) allgK = t.k[d.open.length];
    dpStates = t.states;
    allFit = d.open.length > 0 && tp.fastX * tp.legOpts.reduce((a, o) => a * Math.max(...o.map((x) => x.k)), 1) <= maxRows;
  } else if (tp.fastOwnX * tp.minProd <= upperRows) {
    status = "OWN_OVER_BUDGET";
  } else {
    status = "RULES_DONT_FIT";
  }

  const spikRank = new Map(d.spikes.map((c, i) => [c.leg, i]));
  const spikHorseOf = new Map(d.spikes.map((c) => [c.leg, c.horse.number]));
  const openIdx = new Map(d.open.map((o, i) => [o.prep.leg, i]));
  const results: TippaLegResult[] = prep.map((p) => {
    const f = p.facts;
    const oi = openIdx.get(p.leg);
    const open = oi === undefined ? null : d.open[oi];
    const sub = open?.min.sub ?? {};
    const tagged = (h: HorseFact): TippaHorse => ({ ...h, reasons: reasonsOf(h, f.prelim, sub[h.number]) });
    const field = f.runners.map(tagged);
    const byNum = new Map(field.map((h) => [h.number, h]));
    let kind: LegKind;
    let selection: number[];
    let lo = 0;
    let hi = 0;
    if (p.base === "CANCELLED") {
      kind = "CANCELLED";
      selection = p.cancelledSel;
    } else if (p.base === "NO_STARTERS") {
      kind = "NO_STARTERS";
      selection = [];
    } else if (p.base === "LOCKED") {
      kind = p.lockedSel!.length === 1 ? "OWN_SPIK" : "OWN";
      selection = p.lockedSel!;
    } else if (p.leg === d.allg.leg) {
      kind = "ALLG";
      selection = f.runners.slice(0, tp.allgPrep && p.leg === tp.allgPrep.leg ? allgK : f.runners.length).map((h) => h.number);
    } else if (spikHorseOf.has(p.leg)) {
      kind = "SPIK";
      selection = [spikHorseOf.get(p.leg)!];
    } else {
      kind = "OPEN";
      const k = ks[oi!];
      selection = openSelection(open!, k);
      lo = minK(tp.legOpts[oi!]);
      hi = openHi(open!);
    }
    selection = [...selection].sort((a, b) => a - b);
    if (kind !== "OPEN") lo = hi = Math.max(1, selection.length);
    const horses = selection.map((n) => byNum.get(n)).filter((h): h is TippaHorse => !!h).sort(compareRank);
    return {
      leg: p.leg,
      startAt: p.startAt,
      kind,
      prelim: f.prelim,
      selection,
      horses,
      field,
      scratched: f.scratched,
      favorite: f.favorite ? byNum.get(f.favorite.number)! : null,
      favBanned: !!open?.banned,
      few: !!open?.min.few,
      lo,
      hi,
      spikRank: spikRank.get(p.leg) ?? null,
      struckOwnSpik: p.struckOwnSpik,
      struckRemoved: p.struckRemoved,
      unlocked: p.unlocked,
    };
  });

  const selections: Selections = {};
  let rows = 1;
  let horses = 0;
  for (const l of results) {
    if (l.selection.length) selections[l.leg] = l.selection;
    rows *= l.kind === "NO_STARTERS" ? 1 : Math.max(1, l.selection.length);
    horses += l.selection.length;
  }
  const cost = couponCost(rows, rules.rowPrice);
  const favCount = results.filter((l) => l.kind !== "CANCELLED" && l.kind !== "NO_STARTERS" && l.favorite && l.selection.includes(l.favorite.number)).length;
  const struckOwnSpik = results.filter((l) => l.struckOwnSpik).map((l) => l.leg);
  const noStarters = results.filter((l) => l.kind === "NO_STARTERS").map((l) => l.leg);
  const allRunners = results.flatMap((l) => l.field);
  const noRikt = !allRunners.some((h) => h.riktX !== null);
  const noData = noRikt && !allRunners.some((h) => h.streck !== null && h.streck > 0);
  const locked: Record<number, number[]> = {};
  for (const l of results) if (l.kind === "OWN" || l.kind === "OWN_SPIK" || (l.kind === "CANCELLED" && (rules.locked[l.leg]?.length ?? 0) > 0)) locked[l.leg] = l.selection;

  const result: TippaResult = {
    gameType: rules.gameType,
    legCount,
    favLimit,
    spikCap: spikMaxFor(rules.gameType),
    status,
    prelim: results.some((l) => l.field.length > 0 && l.prelim),
    noData,
    noRikt,
    legs: results,
    selections,
    rows,
    cost,
    horses,
    budget: rules.budget,
    rowPrice: rules.rowPrice,
    maxRows,
    minRows,
    minCost: couponCost(minRows, rules.rowPrice),
    allFit,
    ownSpikes: d.ownSpikes,
    spikMin: d.spikMin,
    spikMax: d.spikMax,
    spikEffective: d.spikEffective,
    appSpikes: d.spikes.length,
    spikLegs: d.spikes.map((c) => c.leg),
    ownSpikLegs: results.filter((l) => l.kind === "OWN_SPIK").map((l) => l.leg),
    skippedSpik: d.skipped,
    allgMode: rules.allgMode,
    allgLeg: d.allg.leg,
    allgAuto: d.allg.auto,
    allgFallback: d.allg.fallback,
    allgRequested: rules.allgMode === "CHOSEN" ? rules.allgLeg : null,
    favCount,
    favOver: d.favOver,
    favBanned: d.favBanned,
    favAllowed: [...d.favAllowed].sort((a, b) => a - b),
    forcedFav: d.forcedFav,
    struckOwnSpik,
    struckRemoved: results.filter((l) => l.struckRemoved.length).map((l) => ({ leg: l.leg, numbers: l.struckRemoved })),
    unlockedLegs: results.filter((l) => l.unlocked).map((l) => l.leg),
    noStarters,
    cancelled: results.filter((l) => l.kind === "CANCELLED").map((l) => l.leg),
    locked,
    lockedLegs: Object.keys(locked).map(Number).sort((a, b) => a - b),
    canCopy: (status === "OK" || status === "OWN_OVER_BUDGET") && !struckOwnSpik.length && !noStarters.length && !noData,
    suggestions: [],
    legRoles: { v: 1, prelim: false, favLimit, legs: {} },
    dpStates,
    // Understreckade bland valda hästar utanför allgarderingen (radens "värde").
    underbet: results.filter((l) => l.kind !== "ALLG").reduce((a, l) => a + l.horses.filter(isUnderbet).length, 0),
    allgDropped: tp.allgPrep ? tp.allgPrep.facts.runners.length - allgK : 0,
    relaxedLegs: d.open.filter((o, i) => !o.min.few && ks[i] < o.min.lo).map((o) => o.prep.leg).sort((a, b) => a - b),
  };
  result.suggestions = suggestions(legs, rules, result, opts);
  result.legRoles = legRolesOf(result);
  return result;
}

// legRoles version 1 (8.5): skälen per avdelning och vald häst.
export function legRolesOf(r: Pick<TippaResult, "legs" | "prelim" | "favLimit">): LegRolesDto {
  const legs: Record<string, LegRoleDto> = {};
  for (const l of r.legs) {
    if (l.kind === "NO_STARTERS") continue;
    const role: LegRoleDto = { k: l.kind };
    if (l.kind === "ALLG") {
      if (l.favorite) role.fav = l.favorite.number;
    } else {
      const h: Record<string, ReasonCode[]> = {};
      for (const n of l.selection) h[String(n)] = l.horses.find((x) => x.number === n)?.reasons ?? [];
      role.h = h;
      if (l.favBanned && l.favorite) role.favOut = l.favorite.number;
    }
    legs[String(l.leg)] = role;
  }
  return { v: 1, prelim: r.prelim, favLimit: r.favLimit, legs };
}
