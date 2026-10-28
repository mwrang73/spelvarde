// Egenskaper för buildRad (docs/specs/e6-v85-rad.md, 14 "Egenskaper") med en
// egen frögenerator (mulberry32, fröet 20261028), och prestandatestet.
import { describe, expect, it } from "vitest";
import { spikMaxFor } from "@/lib/game-type";
import { buildRad, legFacts, maximizeHorses, minimumPicks, type TippaLeg, type TippaResult, type TippaRules, type TippaStart, openHiOf } from "@/lib/tippa";
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
    locked,
  };
  return { legs, rules };
}

const reversed = (legs: TippaLeg[]) => [...legs].reverse().map((l) => ({ ...l, starts: [...l.starts].reverse() }));

function checkProperties(legs: TippaLeg[], rules: TippaRules, x: TippaResult) {
  // 1. OK ryms i budgeten.
  if (x.status === "OK") expect(x.cost).toBeLessThanOrEqual(rules.budget + 1e-9);
  for (const l of x.legs) {
    const raw = legs.find((y) => y.leg === l.leg)!;
    const scratched = new Set(raw.starts.filter((s) => s.scratched).map((s) => s.number));
    const runners = raw.starts.filter((s) => !s.scratched).map((s) => s.number);
    // 2. Grupperna i öppna avdelningar med minst 4 löpande.
    if (l.kind === "OPEN" && runners.length >= 4) {
      const codes = l.horses.flatMap((h) => h.reasons);
      expect(codes.includes("T3")).toBe(true);
      expect(codes.includes("MEL") || codes.includes("NOMEL")).toBe(true);
      expect(codes.includes("SKR") || codes.includes("LOW")).toBe(true);
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
  // 8. Lokalt maximal: ingen öppen avdelning kan få en häst till.
  if (x.status === "OK") {
    for (const l of x.legs) {
      if (l.kind !== "OPEN" || l.selection.length >= l.hi) continue;
      const next = (x.rows / l.selection.length) * (l.selection.length + 1);
      expect(next).toBeGreaterThan(x.maxRows);
    }
  }
}

describe("egenskaper (1 000 omgångar, fröet 20261028)", () => {
  it("1–8 och 10 gäller för varje omgång", () => {
    const r = mulberry32(20261028);
    const status: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) {
      const { legs, rules } = genRound(r, i);
      const x = buildRad(legs, rules);
      status[x.status] = (status[x.status] ?? 0) + 1;
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
  });

  it("9. optimal: samma antal hästar och poäng som en uttömmande sökning", () => {
    const r = mulberry32(20261028 + 9);
    let checked = 0;
    for (let i = 0; checked < 300 && i < 20_000; i++) {
      const gameType = i % 2 === 0 ? "V85" : "V75";
      const n = gameType === "V85" ? 8 : 7;
      const legs = Array.from({ length: n }, (_, k) => genLeg(r, k + 1, 4, 8, 0.02));
      const rules: TippaRules = { gameType, budget: int(r, 20, 600), rowPrice: [0.25, 0.5, 1][int(r, 0, 2)], spikCount: spikMaxFor(gameType) - int(r, 0, 3), allgMode: "AUTO", allgLeg: null, locked: {} };
      const x = buildRad(legs, rules);
      const open = x.legs.filter((l) => l.kind === "OPEN");
      if (x.status !== "OK" || open.length > 3 || open.some((l) => l.field.length > 8)) continue;
      checked++;
      const fast = x.legs.filter((l) => l.kind !== "OPEN").reduce((a, l) => a * Math.max(1, l.selection.length), 1);
      const parts = open.map((l) => {
        const m = minimumPicks(legFacts(legs[l.leg - 1]), l.favBanned);
        const gains = [0];
        for (const h of m.rest) gains.push(gains[gains.length - 1] + h.score);
        return { lo: m.lo, hi: openHiOf(m.lo, m.rest.length, l.field.length), gains };
      });
      let bestH = -1;
      let bestS = -1;
      const walk = (i: number, prod: number, h: number, s: number) => {
        if (fast * prod > x.maxRows) return;
        if (i === parts.length) {
          if (h > bestH || (h === bestH && s > bestS)) {
            bestH = h;
            bestS = s;
          }
          return;
        }
        for (let k = parts[i].lo; k <= parts[i].hi; k++) walk(i + 1, prod * k, h + k, s + parts[i].gains[k - parts[i].lo]);
      };
      walk(0, 1, 0, 0);
      const gotH = open.reduce((a, l) => a + l.selection.length, 0);
      const gotS = open.reduce((a, l, j) => a + parts[j].gains[l.selection.length - parts[j].lo], 0);
      expect(gotH).toBe(bestH);
      expect(gotS).toBe(bestS);
    }
    expect(checked).toBe(300);
  });
});

describe("prestanda", () => {
  it("7 öppna lopp med 16 löpande, budget 100 000 kr, radpris 0,01: under 1 s", () => {
    const r = mulberry32(7);
    const legs = Array.from({ length: 8 }, (_, k) => {
      const l = genLeg(r, k + 1, 16, 16, 0);
      return { ...l, starts: l.starts.map((s) => ({ ...s, scratched: false })) };
    });
    const t0 = performance.now();
    const x = buildRad(legs, { gameType: "V85", budget: 100_000, rowPrice: 0.01, spikCount: 0, allgMode: "AUTO", allgLeg: null, locked: {} });
    const ms = performance.now() - t0;
    expect(x.legs.filter((l) => l.kind === "OPEN")).toHaveLength(7);
    expect(x.status).toBe("OK");
    expect(x.allFit).toBe(false);
    console.log(`maximizeHorses: ${x.dpStates} tillstånd, ${ms.toFixed(0)} ms (R = ${Math.floor(x.maxRows / 16)})`);
    expect(ms).toBeLessThan(1000);
  });

  it("maximizeHorses vid det hårda taket R = 10 000 000 (7 lopp, 3–16 hästar): under 1 s", () => {
    const legs = Array.from({ length: 7 }, (_, i) => ({ lo: 3, hi: 16, gains: Array.from({ length: 14 }, (_, j) => j * (100 + i)) }));
    const t0 = performance.now();
    const m = maximizeHorses(legs, 10_000_000)!;
    const ms = performance.now() - t0;
    console.log(`maximizeHorses R = 10 000 000: ${m.states} tillstånd, ${ms.toFixed(0)} ms, ${m.horses} hästar`);
    expect(m.product).toBeLessThanOrEqual(10_000_000);
    expect(ms).toBeLessThan(1000);
  });

  it("typfallet (Bjerke): i snitt under 5 ms över 100 körningar", () => {
    const legs = bjerkeLegs();
    const rules = bjerkeRules();
    buildRad(legs, rules);
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) buildRad(legs, rules);
    const avg = (performance.now() - t0) / 100;
    console.log(`Bjerke: ${avg.toFixed(2)} ms i snitt, ${buildRad(legs, rules).dpStates} tillstånd`);
    expect(avg).toBeLessThan(5);
  });
});
