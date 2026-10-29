import { describe, expect, it } from "vitest";
import {
  barefoot,
  calcLine,
  calibrate,
  clamp,
  computeRace,
  explain,
  harvilleTop3,
  nextModelKey,
  oddsFromP3,
  parseParams,
  parseWeights,
  RECOMMENDED_KEY,
  RECOMMENDED_NO_STRECK,
  RECOMMENDED_WEIGHTS,
  round2,
  sentence,
  softmax,
  V1_PARAMS,
  V1_WEIGHTS,
  V3_WEIGHTS,
  zScores,
  type StartFacts,
  type Weights,
} from "@/lib/riktodds";

const NBSP = "\u00a0";

// Brute force: summera sannolikheten för alla ordningar av ettan, tvåan och trean.
function bruteTop3(pi: number[]): number[] {
  const n = pi.length;
  const out = pi.map(() => 0);
  for (let a = 0; a < n; a++)
    for (let b = 0; b < n; b++)
      for (let c = 0; c < n; c++) {
        if (a === b || a === c || b === c) continue;
        const p = pi[a] * (pi[b] / (1 - pi[a])) * (pi[c] / (1 - pi[a] - pi[b]));
        out[a] += p;
        out[b] += p;
        out[c] += p;
      }
  return out;
}

function start(i: number, o: Partial<StartFacts> = {}): StartFacts {
  return {
    startId: `s${i}`,
    number: i,
    scratched: false,
    horse: { thisYear: { starts: 10, wins: i % 3, placed: 2 + (i % 4) }, lastYear: { starts: 8, wins: 1, placed: 3 }, lifeStarts: 30 },
    records: [
      { place: (i % 5) + 1, galloped: i === 3, disqualified: false },
      { place: 2, galloped: false, disqualified: false },
      { place: null, galloped: false, disqualified: i === 4 },
      { place: 4, galloped: false, disqualified: false },
      { place: 1, galloped: false, disqualified: false },
    ],
    driver: { starts: 200 + i * 10, wins: 20 + i * 3 },
    trainer: { starts: 100, wins: 10 + i },
    post: { pct: 5 + i, mean: 8, distance: 2140, method: "AUTO" },
    streck: 3 + i,
    ...o,
  };
}

const field = (n: number) => Array.from({ length: n }, (_, i) => start(i + 1));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("räknedelar", () => {
  it("z-värden har medel 0 och standardavvikelse 1, och sd = 0 ger 0", () => {
    const z = zScores([1, 2, 3, 4]);
    expect(sum(z)).toBeCloseTo(0, 12);
    expect(Math.sqrt(sum(z.map((x) => x * x)) / z.length)).toBeCloseTo(1, 12);
    expect(zScores([5, 5, 5])).toEqual([0, 0, 0]);
  });
  it("softmax summerar till 1 och tål stora tal", () => {
    const p = softmax([1000, 999, 0], 1);
    expect(sum(p)).toBeCloseTo(1, 12);
    expect(p[0]).toBeGreaterThan(p[1]);
  });
  it("Harville stämmer mot brute force och Σ P3 = 3", () => {
    for (const pi of [softmax([0.3, -1.2, 0.8, 0.1, 2.0, -0.5, 0, 0.4], 1), softmax([0, 0, 0, 0], 1), softmax([3, -3, 1, 0, -1, 2, 0.5, -0.5, 1.5, -2, 0.2, 0.9, -0.1, 0.3, 0.7], 1)]) {
      const h = harvilleTop3(pi);
      const b = bruteTop3(pi);
      h.forEach((x, i) => expect(x).toBeCloseTo(b[i], 10));
      expect(sum(h)).toBeCloseTo(3, 10);
    }
    // Lika chans i fyra hästar: 3/4 var.
    harvilleTop3([0.25, 0.25, 0.25, 0.25]).forEach((x) => expect(x).toBeCloseTo(0.75, 12));
  });
  it("round2 och clamp till 1,01–99,99", () => {
    expect(round2(3.205)).toBe(3.21);
    expect(round2(1.005)).toBe(1.01);
    expect(oddsFromP3(0.3125, 0)).toBe(3.2);
    expect(oddsFromP3(0.999, 0)).toBe(1.01);
    expect(oddsFromP3(0.001, 0)).toBe(99.99);
    expect(oddsFromP3(0, 0)).toBe(99.99);
    expect(oddsFromP3(0.5, 0.1)).toBe(2.2);
    expect(clamp(5, 1, 3)).toBe(3);
  });
});

describe("computeRace", () => {
  it("räknar alla ej strukna, Σ P3 = 3 ± 0,01 och odds = 1/P3", () => {
    for (const n of [4, 7, 12, 15]) {
      const res = computeRace(field(n), V1_WEIGHTS, V1_PARAMS);
      expect(res).toHaveLength(n);
      expect(Math.abs(sum(res.map((r) => r.probTop3)) - 3)).toBeLessThan(0.01);
      for (const r of res) expect(r.odds).toBe(oddsFromP3(r.probTop3, 0));
    }
  });
  it("strukna utelämnas och räknas inte i N", () => {
    const f = field(8);
    f[2].scratched = true;
    const res = computeRace(f, V1_WEIGHTS, V1_PARAMS);
    expect(res.map((r) => r.startId)).not.toContain("s3");
    expect(res).toHaveLength(7);
    expect(res[0].inputs.n).toBe(7);
    expect(sum(res.map((r) => r.probTop3))).toBeCloseTo(3, 6);
  });
  it("lopp med färre än 4 startande får inget", () => {
    expect(computeRace(field(3), V1_WEIGHTS, V1_PARAMS)).toEqual([]);
    const f = field(5);
    f[0].scratched = true;
    f[1].scratched = true;
    expect(computeRace(f, V1_WEIGHTS, V1_PARAMS)).toEqual([]);
  });
  it("osäkert: färre än 5 starter, eller saknar 2 av plats, form och kusk", () => {
    const f = field(6);
    f[0] = start(1, { horse: { thisYear: { starts: 3, wins: 1, placed: 2 }, lastYear: null, lifeStarts: 3 } });
    f[1] = start(2, { horse: { thisYear: null, lastYear: null, lifeStarts: 40 }, driver: null });
    f[2] = start(3, { records: [], driver: null });
    f[3] = start(4, { driver: null });
    const res = computeRace(f, V1_WEIGHTS, V1_PARAMS);
    expect(res[0]).toMatchObject({ uncertain: true });
    expect(res[0].inputs.uncertainReasons).toEqual(["färre än 5 starter"]);
    expect(res[1].uncertain).toBe(true);
    expect(res[1].inputs.uncertainReasons).toEqual(["saknar platsstatistik och kuskstatistik"]);
    expect(res[2].uncertain).toBe(true);
    expect(res[3].uncertain).toBe(false);
    expect(res[4].uncertain).toBe(false);
  });
  it("krympning: utan starter blir plats p0 = 3/N och vinst w0 = 1/N", () => {
    const f = field(6);
    f[0] = start(1, { horse: { thisYear: null, lastYear: null, lifeStarts: 0 } });
    const r = computeRace(f, V1_WEIGHTS, V1_PARAMS)[0];
    expect(r.inputs.values.plats).toEqual({ value: 0.5, missing: true });
    expect(r.inputs.values.vinst.value).toBeCloseTo(1 / 6, 12);
    // (5 placeringar på 18 starter + 6·0,5) / 24
    const r2 = computeRace(field(6), V1_WEIGHTS, V1_PARAMS)[1];
    expect(r2.inputs.values.plats.value).toBeCloseTo((2 + 2 + 3 + 6 * 0.5) / (18 + 6), 12);
  });
  it("bidragen är w·z, strecket har vikt 0 och påverkar inte riktoddset", () => {
    const a = computeRace(field(8), V1_WEIGHTS, V1_PARAMS);
    for (const r of a) {
      expect(r.contributions.plats).toBeCloseTo(V1_WEIGHTS.plats * r.inputs.z.plats, 12);
      expect(r.contributions.streck).toBe(0);
    }
    const f = field(8).map((s, i) => ({ ...s, streck: 50 - i * 6 }));
    expect(computeRace(f, V1_WEIGHTS, V1_PARAMS).map((r) => r.odds)).toEqual(a.map((r) => r.odds));
  });
  it("bättre plats och form ger lägre riktodds", () => {
    const f = field(6).map((s) => ({ ...s, horse: { thisYear: { starts: 10, wins: 1, placed: 3 }, lastYear: null, lifeStarts: 30 }, records: [], driver: null, trainer: null, post: null }));
    f[0].horse = { thisYear: { starts: 10, wins: 5, placed: 9 }, lastYear: null, lifeStarts: 30 };
    const res = computeRace(f, V1_WEIGHTS, V1_PARAMS);
    expect(res[0].odds).toBeLessThan(res[1].odds);
    expect(res[1].odds).toBe(res[2].odds);
  });
});

describe("förklaring (7.4)", () => {
  const res = computeRace(field(10), V1_WEIGHTS, V1_PARAMS);
  it("högst 3 + 3, bara bidrag ≥ 0,15, störst först", () => {
    for (const r of res) {
      const e = explain(r);
      expect(e.pros.length).toBeLessThanOrEqual(3);
      expect(e.cons.length).toBeLessThanOrEqual(3);
      for (const x of [...e.pros, ...e.cons]) expect(Math.abs(x.contribution)).toBeGreaterThanOrEqual(0.15);
      for (const x of e.pros) expect(x.contribution).toBeGreaterThan(0);
      for (const x of e.cons) expect(x.contribution).toBeLessThan(0);
      expect(e.pros.map((x) => x.contribution)).toEqual([...e.pros.map((x) => x.contribution)].sort((a, b) => b - a));
      expect(e.cons.map((x) => x.contribution)).toEqual([...e.cons.map((x) => x.contribution)].sort((a, b) => a - b));
    }
  });
  it("mallmeningar med verkliga värden", () => {
    const f = res[0].inputs.facts;
    expect(sentence("kusk", { ...f, driverWinPct: 21.2 }, true)).toBe(`Kusken vinner 21${NBSP}% i år`);
    expect(sentence("spar", { ...f, number: 10, post: { pct: 3.1, mean: 8, distance: 2640, method: "AUTO" } }, false)).toBe(`Spår 10 på 2640 m auto vinner bara 3,1${NBSP}%`);
    expect(sentence("galopp", { ...f, gallops: 1, gallopsDq: 0, formStarts: 5 }, false)).toBe("Galopp i 1 av 5 senaste");
    expect(sentence("galopp", { ...f, gallops: 1, gallopsDq: 1, formStarts: 5 }, false)).toBe("Galopp i 1 av 5 senaste, med diskning");
    expect(sentence("galopp", { ...f, gallops: 0, gallopsDq: 0, formStarts: 4 }, true)).toBe("Ingen galopp i 4 senaste");
    expect(sentence("plats", { ...f, placePct: 64 }, true)).toBe(`Plats i 64${NBSP}% av starterna i år och i fjol`);
    expect(sentence("form", { ...f, formPlaces: [1, 3, null, 0, 2], formStarts: 5 }, true)).toBe("Form 1-3-d-0-2 i 5 senaste");
  });
  it("beräkningsraden och osäkert-raden", () => {
    expect(calcLine(0.3125, 3.2)).toBe(`Chans till topp 3 ≈ 31${NBSP}% → 1 / 0,31 = 3,20`);
    expect(calcLine(0.5, 2.1, 0.05)).toBe(`Chans till topp 3 ≈ 50${NBSP}% → 1 / 0,50 × 1,05 = 2,10`);
    const r = { ...res[0], uncertain: true, inputs: { ...res[0].inputs, uncertainReasons: ["färre än 5 starter"] } };
    expect(explain(r).uncertainLine).toBe("Osäkert: färre än 5 starter");
    expect(explain(res[0]).uncertainLine).toBeNull();
  });
});

describe("modellversioner", () => {
  it("nästa nyckel", () => {
    expect(nextModelKey(["v1"])).toBe("v1.1");
    expect(nextModelKey(["v1", "v1.1", "v1.9"])).toBe("v1.10");
    expect(nextModelKey([])).toBe("v1.1");
    expect(nextModelKey(["v1", "v2"])).toBe("v2.1");
  });
  it("vikter och parametrar ur JSON faller tillbaka på v1", () => {
    expect(parseWeights({ plats: 2, x: 9 })).toEqual({ ...V1_WEIGHTS, plats: 2 });
    expect(parseWeights(null)).toEqual(V1_WEIGHTS);
    expect(parseParams({ beta: 1.5, kKusk: "x" })).toEqual({ ...V1_PARAMS, beta: 1.5 });
  });
});

describe("pengar och vikterna utan streck", () => {
  const field = (streck: (number | null)[]) =>
    streck.map((st, i) => start(i + 1, { streck: st, earnings: { total: 100_000 * (i + 1), lifeStarts: 20 } }));
  const weights = { ...V1_WEIGHTS, plats: 0, vinst: 0, form: 0, spar: 0, kusk: 0, tranare: 0, galopp: 0, pengar: 0, streck: 1 };
  const noStreck = { ...weights, streck: 0, pengar: 1 };

  it("intjänat per start blir indata med mening", () => {
    const res = computeRace(field([10, 20, 30, 40]), { ...weights, streck: 0, pengar: 1 }, V1_PARAMS);
    // Mest pengar per start ger högst chans.
    expect(res[3].probTop3).toBeGreaterThan(res[0].probTop3);
    expect(res[3].inputs.facts.earningsPerStart).toBe(20_000);
    expect(sentence("pengar", res[3].inputs.facts, true)).toBe(`Tjänar 20${NBSP}000${NBSP}kr per start`);
  });
  it("utan streck i loppet används vikterna utan streck, och det syns i förklaringen", () => {
    const params = { ...V1_PARAMS, noStreck };
    const without = computeRace(field([null, null, null, null]), weights, params);
    expect(without[0].inputs.noStreck).toBe(true);
    expect(without[3].probTop3).toBeGreaterThan(without[0].probTop3);
    expect(explain(without[0]).noteLine).toMatch(/Strecket saknas/);
    // Med streck: de vanliga vikterna.
    const withS = computeRace(field([40, 30, 20, 10]), weights, params);
    expect(withS[0].inputs.noStreck).toBeUndefined();
    expect(withS[0].probTop3).toBeGreaterThan(withS[3].probTop3);
    // Utan vikter utan streck: oförändrat beteende (alla lika).
    const plain = computeRace(field([null, null, null, null]), weights, V1_PARAMS);
    expect(plain[0].probTop3).toBeCloseTo(plain[3].probTop3, 9);
  });
  it("parseParams läser vikterna utan streck, streck alltid 0", () => {
    expect(parseParams({ beta: 1 }).noStreck).toBeNull();
    expect(parseParams({ noStreck: { pengar: 0.4, streck: 2 } }).noStreck).toMatchObject({ pengar: 0.4, streck: 0, plats: 0 });
    // Äldre versioner utan pengar får vikten 0.
    expect(parseWeights({ plats: 1 }).pengar).toBe(0);
  });
});

describe("v3: barfota, vila, galopp vid volte, tid och kalibrering", () => {
  it("barfota ur ATG:s skor", () => {
    expect(barefoot({ front: { hasShoe: false }, back: { hasShoe: false } })).toBe(true);
    expect(barefoot({ front: { hasShoe: true }, back: { hasShoe: false } })).toBe(false);
    expect(barefoot(null)).toBeNull();
  });
  it("kalibreringen: standard ändrar inget, annars krymps och kapas", () => {
    expect(calibrate([0.2, 0.95], { plattA: 0, plattB: 1, maxP3: 1 })).toEqual([0.2, 0.95]);
    const c = calibrate([0.5, 0.95], { plattA: -0.055, plattB: 0.947, maxP3: 0.8 });
    expect(c[0]).toBeLessThan(0.5);
    expect(c[1]).toBe(0.8);
  });
  it("barfota och vila påverkar riktoddset med vikt, och meningarna", () => {
    const w = { ...V1_WEIGHTS, plats: 0, vinst: 0, form: 0, spar: 0, kusk: 0, tranare: 0, galopp: 0, barfota: 1, vila: -1 };
    const field = [true, false, false, false].map((b, i) =>
      start(i + 1, { barefoot: b, raceDate: "2026-10-24", records: [{ place: 3, galloped: false, disqualified: false, date: i === 3 ? "2026-05-01" : "2026-10-10" }] }),
    );
    const res = computeRace(field, w, V1_PARAMS);
    expect(res[0].probTop3).toBeGreaterThan(res[1].probTop3);
    expect(res[3].probTop3).toBeLessThan(res[1].probTop3);
    expect(sentence("barfota", res[0].inputs.facts, true)).toBe("Barfota runt om");
    expect(sentence("vila", res[3].inputs.facts, false)).toBe("176 dagar sedan senaste start");
  });
});

describe("v1.2: strecket utan skalning per lopp (streckLog)", () => {
  const only = (o: Partial<Weights>): Weights => ({ ...V1_WEIGHTS, plats: 0, vinst: 0, form: 0, spar: 0, kusk: 0, tranare: 0, galopp: 0, ...o });
  const field = (streck: (number | null)[]) => streck.map((st, i) => start(i + 1, { streck: st }));

  it("vikten är en exponent på strecket: vinstchansen följer streck^w i alla lopp", () => {
    for (const st of [[10, 20, 30, 40], [70, 10, 10, 5, 5], [25, 25, 20, 15, 10, 5]]) {
      const res = computeRace(field(st), only({ streckLog: 0.56 }), V1_PARAMS);
      const pw = st.map((x) => x ** 0.56);
      const sum = pw.reduce((a, b) => a + b, 0);
      res.forEach((r, i) => expect(r.inputs.winProb).toBeCloseTo(pw[i] / sum, 9));
      // Centrerat men inte skalat: z = log-streck minus loppets medel.
      const m = st.reduce((a, b) => a + Math.log(b), 0) / st.length;
      expect(res[0].inputs.z.streckLog).toBeCloseTo(Math.log(st[0]) - m, 9);
    }
    // Vikt 1 ger exakt strecket som vinstchans.
    const one = computeRace(field([10, 20, 30, 40]), only({ streckLog: 1 }), V1_PARAMS);
    expect(one.map((r) => r.inputs.winProb)).toEqual([0.1, 0.2, 0.3, 0.4].map((x) => expect.closeTo(x, 9)));
  });
  it("skiljer sig från streck (z-värdet), som skalar om varje lopp efter fältets spridning", () => {
    // Samma två översta hästar (40 % och 20 %), olika svans.
    const tight = field([40, 20, 15, 15, 10]);
    const wide = field([40, 20, 20, 10, 5, 2, 1, 1, 1]);
    const ratio = (res: ReturnType<typeof computeRace>) => res[0].inputs.winProb / res[1].inputs.winProb;
    const w = only({ streckLog: 0.56 });
    expect(ratio(computeRace(tight, w, V1_PARAMS))).toBeCloseTo(2 ** 0.56, 9);
    expect(ratio(computeRace(wide, w, V1_PARAMS))).toBeCloseTo(2 ** 0.56, 9);
    // Med z-värdet beror förhållandet på resten av fältet.
    const z = only({ streck: 0.86 });
    expect(Math.abs(ratio(computeRace(tight, z, V1_PARAMS)) - ratio(computeRace(wide, z, V1_PARAMS)))).toBeGreaterThan(0.1);
  });
  it("bakåtkompatibelt: saknad vikt för streckLog = 0, gamla versioner räknar som förut", () => {
    expect(parseWeights({ streck: 0.86 }).streckLog).toBe(0);
    expect(V1_WEIGHTS.streckLog).toBe(0);
    expect(V3_WEIGHTS.streckLog).toBe(0);
    const { streckLog: _, ...old } = V3_WEIGHTS;
    const st = field([40, 25, 15, 10, 6, 4]);
    const a = computeRace(st, old as Weights, V1_PARAMS);
    const b = computeRace(st, V3_WEIGHTS, V1_PARAMS);
    expect(a.map((r) => r.probTop3)).toEqual(b.map((r) => r.probTop3));
    expect(b[0].contributions.streckLog).toBe(0);
  });
  it("utan streck i loppet används vikterna utan streck även när bara streckLog har vikt", () => {
    const params = { ...V1_PARAMS, noStreck: only({ plats: 1 }) };
    const res = computeRace(field([null, null, null, null]), only({ streckLog: 0.56 }), params);
    expect(res[0].inputs.noStreck).toBe(true);
    expect(parseParams({ noStreck: { pengar: 0.4, streckLog: 2 } }).noStreck).toMatchObject({ pengar: 0.4, streck: 0, streckLog: 0 });
  });
  it("meningen är samma som för streck", () => {
    const res = computeRace(field([40, 30, 20, 10]), only({ streckLog: 0.56 }), V1_PARAMS);
    expect(sentence("streckLog", res[0].inputs.facts, true)).toBe(sentence("streck", res[0].inputs.facts, true));
  });
  it("den rekommenderade modellen v1.2 använder streckLog i stället för streck", () => {
    expect(RECOMMENDED_KEY).toBe("v1.2");
    expect(RECOMMENDED_WEIGHTS.streck).toBe(0);
    expect(RECOMMENDED_WEIGHTS.streckLog).toBe(0.56);
    expect(RECOMMENDED_NO_STRECK.streck).toBe(0);
    expect(RECOMMENDED_NO_STRECK.streckLog).toBe(0);
  });
});
