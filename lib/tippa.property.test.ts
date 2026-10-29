// Egenskaper för buildRad (docs/specs/e6-v85-rad.md, 14 "Egenskaper", och
// docs/specs/e6b-max-per-lopp.md 8) med en egen frögenerator (mulberry32,
// fröet 20261028), regressionen mot raden före E6b och prestandatestet.
import { describe, expect, it } from "vitest";
import { spikMaxFor } from "@/lib/game-type";
import { buildRad, legFacts, maximizeHorses, minimumPicks, type TippaLeg, type TippaResult, type TippaRules, type TippaStart, openHiOf, BUDGET_OVER_MAX, PRIO_DROP_MAX, BUDGET_UNDER_MAX } from "@/lib/tippa";
import { bjerkeLegs, bjerkeRules } from "@/lib/tippa.fixture";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rnd = () => number;
const int = (r: Rnd, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const r2 = (x: number) => Math.round(x * 100) / 100;

function genLeg(r: Rnd, leg: number, minN: number, maxN: number, cancelP = 0.05): TippaLeg {
  const n = int(r, minN, maxN);
  const w = Array.from({ length: n }, () => r() ** 2 + 0.01);
  const sum = w.reduce((a, b) => a + b, 0);
  const starts: TippaStart[] = w.map((x, i) => {
    const xf = r() < 0.08 ? (r() < 0.5 ? "TROR" : "STARK") : "NONE";
    const spelbar = r() < 0.1;
    const bet = spelbar && r() < 0.4;
    return {
      number: i + 1,
      name: `H${leg}-${i + 1}`,
      scratched: r() < 0.1,
      streck: r2((100 * x) / sum),
      riktX: r2(1.1 + r() * 28.9),
      signals: int(r, 0, 8),
      interesting: spelbar || xf !== "NONE" || r() < 0.15,
      spelbar,
      bet,
      betOdds: bet ? r2(1.5 + r() * 10) : null,
      xFactor: xf,
    };
  });
  return { leg, startAt: "", cancelled: r() < cancelP, starts };
}

function genRound(r: Rnd, i: number): { legs: TippaLeg[]; rules: TippaRules } {
  const gameType = i % 2 === 0 ? "V85" : "V75";
  const n = gameType === "V85" ? 8 : 7;
  const legs = Array.from({ length: n }, (_, k) => genLeg(r, k + 1, 6, 16));
  const locked: Record<number, number[]> = {};
  for (let j = int(r, 0, 2); j > 0; j--) {
    const l = legs[int(r, 0, n - 1)];
    const k = int(r, 1, 4);
    const nums = [...new Set(Array.from({ length: k }, () => int(r, 1, l.starts.length)))];
    locked[l.leg] = nums;
  }
  const rules: TippaRules = {
    gameType,
    budget: int(r, 0, 2000),
    rowPrice: [0.25, 0.5, 1][int(r, 0, 2)],
    spikCount: int(r, 0, spikMaxFor(gameType)),
    allgMode: r() < 0.8 ? "AUTO" : "CHOSEN",
    allgLeg: int(r, 1, n),
    maxPerLeg: null,
    locked,
  };
  return { legs, rules };
}

// E6b: taket slumpat ur null, 3–10 (hälften null). Dras efter genRound, så
// att genRound (och regressionen) är oförändrad.
const genCap = (r: Rnd): number | null => (r() < 0.5 ? null : int(r, 3, 10));

const reversed = (legs: TippaLeg[]) => [...legs].reverse().map((l) => ({ ...l, starts: [...l.starts].reverse() }));

function checkProperties(legs: TippaLeg[], rules: TippaRules, x: TippaResult) {
  // 1. OK ligger högst BUDGET_OVER_MAX över budgeten.
  if (x.status === "OK") expect(x.cost).toBeLessThanOrEqual(rules.budget * (1 + BUDGET_OVER_MAX) + 1e-9);
  for (const l of x.legs) {
    const raw = legs.find((y) => y.leg === l.leg)!;
    const scratched = new Set(raw.starts.filter((s) => s.scratched).map((s) => s.number));
    const runners = raw.starts.filter((s) => !s.scratched).map((s) => s.number);
    // 2. Grupperna i öppna avdelningar med minst 4 löpande.
    if (l.kind === "OPEN" && runners.length >= 4) {
      const codes = l.horses.flatMap((h) => h.reasons);
      expect(codes.includes("T3")).toBe(true);
      if (x.relaxedLegs.includes(l.leg)) {
        // Avvikelse för budgeten: bästa Topp 3 + högst rankade av övriga.
        expect(l.selection.length).toBe(2);
      } else {
        expect(codes.includes("MEL") || codes.includes("NOMEL")).toBe(true);
        expect(codes.includes("SKR") || codes.includes("LOW")).toBe(true);
      }
    }
    // 4. Låsta avdelningar oförändrade, utom strukna (6.5.3).
    const lock = rules.locked[l.leg];
    if (lock?.length && !raw.cancelled && runners.length) {
      const kept = [...new Set(lock)].filter((n) => runners.includes(n)).sort((a, b) => a - b);
      if (kept.length) expect(l.selection).toEqual(kept);
      else if (lock.some((n) => scratched.has(n)) && new Set(lock).size === 1) expect(l.struckOwnSpik).toBe(true);
      else expect(l.unlocked).toBe(true);
    }
    // 5. Ingen struken häst i en avdelning som appen fyller.
    if (l.kind === "OPEN" || l.kind === "SPIK" || l.kind === "ALLG") for (const n of l.selection) expect(scratched.has(n)).toBe(false);
  }
  // 3. Favoritspärren.
  if (x.favCount > x.favLimit) {
    expect(x.favOver).not.toBeNull();
    expect(x.forcedFav).toBeGreaterThan(x.favLimit);
  }
  // 6. Antal spikavdelningar = spikEffective.
  expect(x.spikLegs.length + x.ownSpikLegs.length).toBe(x.spikEffective);
  // 7. Allgarderingen aldrig i låst eller inställd avdelning.
  if (x.allgLeg !== null) {
    expect(x.lockedLegs).not.toContain(x.allgLeg);
    expect(x.cancelled).not.toContain(x.allgLeg);
  }
  checkCap(legs, rules, x);
  // 8. Lokalt bäst: en häst mer eller mindre i ett öppet lopp kommer inte
  // närmare budgeten (inom taket).
  if (x.status === "OK") {
    const upper = Math.floor((rules.budget * (1 + BUDGET_OVER_MAX)) / rules.rowPrice + 1e-9);
    const dist = (rows: number) => Math.abs(rows - x.maxRows);
    for (const l of x.legs) {
      if (l.kind !== "OPEN") continue;
      for (const k of [l.selection.length - 1, l.selection.length + 1]) {
        if (k < l.lo || k > l.hi) continue;
        const rows = (x.rows / l.selection.length) * k;
        if (rows <= upper) expect(dist(rows)).toBeGreaterThanOrEqual(dist(x.rows));
      }
    }
  }
}

// E6b (8, egenskaperna a–d och taket).
function checkCap(legs: TippaLeg[], rules: TippaRules, x: TippaResult) {
  const N = rules.maxPerLeg;
  expect(x.maxPerLeg).toBe(N);
  const runnersOf = (leg: number) => legs.find((y) => y.leg === leg)!.starts.filter((s) => !s.scratched).length;
  // fieldMax: högsta antalet löpande utom inställda lopp.
  expect(x.fieldMax).toBe(Math.max(0, ...legs.filter((l) => !l.cancelled).map((l) => runnersOf(l.leg))));
  for (const l of x.legs) {
    const n = runnersOf(l.leg);
    // (a) Med N satt har inget lopp som appen fyller fler än N, och ALLG bara när N ≥ n.
    if (N !== null && (l.kind === "OPEN" || l.kind === "SPIK" || l.kind === "PRIO")) expect(l.selection.length).toBeLessThanOrEqual(N);
    if (N !== null && l.kind === "ALLG") expect(N).toBeGreaterThanOrEqual(n);
    if (l.kind === "ALLG") expect(l.selection.length).toBe(n);
    if (l.kind === "PRIO") expect(l.selection.length).toBeLessThan(n);
  }
  // Egna val över taket listas, och behålls (egenskap 4).
  expect(x.overCapLegs).toEqual(N === null ? [] : x.legs.filter((l) => l.kind === "OWN" && l.selection.length > N).map((l) => l.leg));
  const p = x.legs.filter((l) => l.kind === "PRIO" || l.kind === "ALLG");
  expect(p.length).toBeLessThanOrEqual(1);
  if (x.prioLeg === null) {
    expect(p).toEqual([]);
    expect([x.prioTarget, x.prioCount, x.prioShort]).toEqual([0, 0, 0]);
    return;
  }
  const P = x.legs[x.prioLeg - 1];
  expect(p).toEqual([P]);
  const n = runnersOf(P.leg);
  const target = N === null ? n : Math.min(N, n);
  expect(x.prioTarget).toBe(target);
  expect(x.prioCount).toBe(P.selection.length);
  expect(x.prioShort).toBe(target - x.prioCount);
  expect(x.allgLeg).toBe(P.kind === "ALLG" ? P.leg : null);
  // (b) Med mål < n innehåller P alltid favoriten. (Med mål = n gäller
  // allgarderingens regel före E6b: de lägst rankade tappas, se specen 4.2 steg 3.)
  if (target < n) expect(P.selection).toContain(P.favorite!.number);
  // (c) prioCount i [max(lo, mål − 2), mål] (mål = n: [max(1, n − 2), n] som före E6b).
  const lo = target < n ? Math.max(3, target - PRIO_DROP_MAX) : Math.max(1, n - PRIO_DROP_MAX);
  if (x.status === "OK") {
    expect(x.prioCount).toBeGreaterThanOrEqual(lo);
    expect(x.prioCount).toBeLessThanOrEqual(target);
  }
  expect([P.lo, P.hi]).toEqual([lo, target]);
  // (d) P är aldrig låst, inställd eller spik.
  expect(x.lockedLegs).not.toContain(P.leg);
  expect(x.cancelled).not.toContain(P.leg);
  expect(x.spikLegs).not.toContain(P.leg);
  // capLimited: P under fältet, eller ett öppet lopp kapat av taket.
  if (N !== null && target < n) expect(x.capLimited).toBe(true);
  if (N === null) expect(x.capLimited).toBe(false);
}

describe("egenskaper (1 000 omgångar, fröet 20261028)", () => {
  it("1–8 och 10 gäller för varje omgång", () => {
    const r = mulberry32(20261028);
    const status: Record<string, number> = {};
    let capped = 0;
    let prio = 0;
    for (let i = 0; i < 1000; i++) {
      const g = genRound(r, i);
      const legs = g.legs;
      const rules = { ...g.rules, maxPerLeg: genCap(r) };
      const x = buildRad(legs, rules);
      status[x.status] = (status[x.status] ?? 0) + 1;
      if (rules.maxPerLeg !== null) capped++;
      if (x.legs.some((l) => l.kind === "PRIO")) prio++;
      checkProperties(legs, rules, x);
      // 10. Samma indata ger samma resultat, även i omvänd ordning.
      if (i % 10 === 0) {
        expect(buildRad(legs, rules)).toEqual(x);
        expect(buildRad(reversed(legs), rules)).toEqual(x);
      }
    }
    // Generatorn täcker alla tre lägena.
    expect(status.OK).toBeGreaterThan(100);
    expect(status.RULES_DONT_FIT).toBeGreaterThan(10);
    expect(status.OWN_OVER_BUDGET ?? 0).toBeGreaterThan(0);
    // och både tak och Alla, och prioriterade lopp utan alla hästar.
    expect(capped).toBeGreaterThan(400);
    expect(capped).toBeLessThan(600);
    expect(prio).toBeGreaterThan(100);
  });

  it("9. optimal: inom budgetbandet minst avvikelse och flest hästar, som en uttömmande sökning", () => {
    const r = mulberry32(20261028 + 9);
    let checked = 0;
    for (let i = 0; checked < 300 && i < 20_000; i++) {
      const gameType = i % 2 === 0 ? "V85" : "V75";
      const n = gameType === "V85" ? 8 : 7;
      const legs = Array.from({ length: n }, (_, k) => genLeg(r, k + 1, 4, 8, 0.02));
      const rules: TippaRules = { gameType, budget: int(r, 20, 600), rowPrice: [0.25, 0.5, 1][int(r, 0, 2)], spikCount: spikMaxFor(gameType) - int(r, 0, 3), allgMode: "AUTO", allgLeg: null, maxPerLeg: genCap(r), locked: {} };
      const N = rules.maxPerLeg;
      const x = buildRad(legs, rules);
      const open = x.legs.filter((l) => l.kind === "OPEN");
      const allg = x.legs.find((l) => (l.kind === "ALLG" || l.kind === "PRIO") && l.field.length > 0);
      if (x.status !== "OK" || open.length > 3) continue;
      checked++;
      const upper = Math.floor((rules.budget * (1 + BUDGET_OVER_MAX)) / rules.rowPrice + 1e-9);
      const lower = Math.ceil((rules.budget * (1 - BUDGET_UNDER_MAX)) / rules.rowPrice - 1e-9);
      const fixed = x.legs.filter((l) => l.kind !== "OPEN" && l !== allg).reduce((a, l) => a * Math.max(1, l.selection.length), 1);
      // [min, max, mallens minsta] per lopp; under mallens minsta = 1 avvikelse
      // (prioriterat lopp: per häst under målet). E6b: öppna lopp hi = min(N, …),
      // P [max(lo, mål − 2), mål] (mål = n: [max(1, n − 2), n] som före E6b).
      const ranges = open.map((l) => {
        const f = legFacts(legs[l.leg - 1]);
        const m = minimumPicks(f, l.favBanned);
        const hi = openHiOf(m.lo, m.rest.length, f.runners.length);
        expect(l.hi).toBe(N === null ? hi : Math.max(m.lo, Math.min(N, hi)));
        return { lo: l.lo, hi: l.hi, tmpl: m.lo, allg: false };
      });
      if (allg) {
        const n = allg.field.length;
        const target = N === null ? n : Math.min(N, n);
        const lo = target < n ? Math.max(3, target - PRIO_DROP_MAX) : Math.max(1, n - PRIO_DROP_MAX);
        ranges.push({ lo, hi: target, tmpl: target, allg: true });
      }
      type B = { pen: number; h: number; rows: number };
      const all: B[] = [];
      const walk = (k: number, prod: number, pen: number, h: number) => {
        if (fixed * prod > upper) return;
        if (k === ranges.length) return void all.push({ pen, h, rows: fixed * prod });
        const g = ranges[k];
        for (let v = g.lo; v <= g.hi; v++) walk(k + 1, prod * v, pen + (g.allg ? g.tmpl - v : v < g.tmpl ? 1 : 0), h + v);
      };
      walk(0, 1, 0, 0);
      const inBand = all.filter((b) => b.rows >= lower);
      const got = { pen: x.prioShort + x.relaxedLegs.length, h: open.reduce((a, l) => a + l.selection.length, 0) + (allg?.selection.length ?? 0) };
      if (inBand.length) {
        expect(x.rows).toBeGreaterThanOrEqual(lower);
        const minPen = Math.min(...inBand.map((b) => b.pen));
        const maxH = Math.max(...inBand.filter((b) => b.pen === minPen).map((b) => b.h));
        expect(got).toEqual({ pen: minPen, h: maxH });
      } else {
        expect(x.rows).toBe(Math.max(...all.map((b) => b.rows)));
      }
    }
    expect(checked).toBe(300);
  });
});

// Regression (docs/specs/e6b-max-per-lopp.md, 8): raden med dagens kod
// (före E6b), sparad som snapshot. Samma omgångar med maxPerLeg: null ska ge
// exakt samma { status, rows, selections }. Egen slumpström, så att ändringar i
// egenskapstesten ovan inte flyttar omgångarna.
const selText = (s: Record<number, number[]>) =>
  Object.keys(s)
    .map(Number)
    .sort((a, b) => a - b)
    .map((l) => `${l}:${s[l].join(",")}`)
    .join(" ");

describe("regression mot raden före E6b", () => {
  it("1 000 omgångar (fröet 20261028) ger samma rad", () => {
    const r = mulberry32(20261028);
    const out: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const { legs, rules } = genRound(r, i);
      const x = buildRad(legs, rules);
      out.push(`${i} ${x.status} ${x.rows} | ${selText(x.selections)}`);
    }
    expect(out).toMatchSnapshot();
  });

  it("500 omgångar med små fält (4–8 löpande) ger samma rad", () => {
    const r = mulberry32(20261029);
    const out: string[] = [];
    for (let i = 0; i < 500; i++) {
      const gameType = i % 2 === 0 ? "V85" : "V75";
      const n = gameType === "V85" ? 8 : 7;
      const legs = Array.from({ length: n }, (_, k) => genLeg(r, k + 1, 4, 8, 0.02));
      const rules: TippaRules = { gameType, budget: int(r, 20, 600), rowPrice: [0.25, 0.5, 1][int(r, 0, 2)], spikCount: int(r, 0, spikMaxFor(gameType)), allgMode: r() < 0.8 ? "AUTO" : "CHOSEN", allgLeg: int(r, 1, n), maxPerLeg: null, locked: {} };
      const x = buildRad(legs, rules);
      out.push(`${i} ${x.status} ${x.rows} | ${selText(x.selections)}`);
    }
    expect(out).toMatchSnapshot();
  });
});

describe("prestanda", () => {
  for (const cap of [null, 7]) {
    it(`7 öppna lopp med 16 löpande, budget 100 000 kr, radpris 0,01, tak ${cap ?? "Alla"}: under 1 s`, () => {
      const r = mulberry32(7);
      const legs = Array.from({ length: 8 }, (_, k) => {
        const l = genLeg(r, k + 1, 16, 16, 0);
        return { ...l, starts: l.starts.map((s) => ({ ...s, scratched: false })) };
      });
      const t0 = performance.now();
      const x = buildRad(legs, { gameType: "V85", budget: 100_000, rowPrice: 0.01, spikCount: 0, allgMode: "AUTO", allgLeg: null, maxPerLeg: cap, locked: {} });
      const ms = performance.now() - t0;
      expect(x.legs.filter((l) => l.kind === "OPEN")).toHaveLength(7);
      expect(x.status).toBe("OK");
      // Med tak 7 ryms allt: 7 öppna lopp à 7 och P 7 = 7⁸ ≈ 5,8 miljoner rader < 10 miljoner.
      expect(x.allFit).toBe(cap !== null);
      console.log(`targetRows (tak ${cap ?? "Alla"}): ${x.dpStates} tillstånd, ${ms.toFixed(0)} ms (R = ${x.maxRows})`);
      expect(ms).toBeLessThan(1000);
    });
  }

  it("maximizeHorses vid det hårda taket R = 10 000 000 (7 lopp, 3–16 hästar): under 1 s", () => {
    const legs = Array.from({ length: 7 }, (_, i) => ({ lo: 3, hi: 16, gains: Array.from({ length: 14 }, (_, j) => j * (100 + i)) }));
    const t0 = performance.now();
    const m = maximizeHorses(legs, 10_000_000)!;
    const ms = performance.now() - t0;
    console.log(`maximizeHorses R = 10 000 000: ${m.states} tillstånd, ${ms.toFixed(0)} ms, ${m.horses} hästar`);
    expect(m.product).toBeLessThanOrEqual(10_000_000);
    expect(ms).toBeLessThan(1000);
  });

  for (const cap of [null, 7]) {
    it(`typfallet (Bjerke, tak ${cap ?? "Alla"}): i snitt under 5 ms över 100 körningar`, () => {
      const legs = bjerkeLegs();
      const rules = bjerkeRules({ maxPerLeg: cap });
      buildRad(legs, rules);
      const t0 = performance.now();
      for (let i = 0; i < 100; i++) buildRad(legs, rules);
      const avg = (performance.now() - t0) / 100;
      console.log(`Bjerke (tak ${cap ?? "Alla"}): ${avg.toFixed(2)} ms i snitt, ${buildRad(legs, rules).dpStates} tillstånd`);
      expect(avg).toBeLessThan(5);
    });
  }
});
