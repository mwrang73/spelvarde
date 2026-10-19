// Riktoddsmodell v1 (specen 7). Ren modul utan databas: indata per start in,
// P3 (chans till topp 3), riktodds, osäkert-flagga och bidrag ut. Förklaringen
// ("Talar för"/"Talar emot" och beräkningsraden) byggs från det som sparas i
// Riktodds.inputs och Riktodds.contributions, så att den kan visas utan att
// modellen räknas om. Testas i lib/riktodds.test.ts.
//
// Modellen är märkt v1, okalibrerad. Den gäller bara plats (topp 3).

import { pct } from "@/lib/format";

export const INPUT_KEYS = ["plats", "vinst", "form", "spar", "kusk", "tranare", "galopp", "streck"] as const;
export type InputKey = (typeof INPUT_KEYS)[number];
export type Weights = Record<InputKey, number>;

// beta och marginal (7.2), k-värden för krympningen (7.1).
export type ModelParams = { beta: number; marginal: number; kPlats: number; kVinst: number; kKusk: number; kTranare: number };

// Standardvikter och parametrar v1 (7.3). Samma värden som scripts/seed.mjs.
export const V1_WEIGHTS: Weights = { plats: 1.0, vinst: 0.5, form: 0.6, spar: 0.4, kusk: 0.3, tranare: 0.2, galopp: -0.4, streck: 0 };
export const V1_PARAMS: ModelParams = { beta: 1.0, marginal: 0, kPlats: 6, kVinst: 6, kKusk: 20, kTranare: 20 };

export const MIN_STARTERS = 4;
export const ODDS_MIN = 1.01;
export const ODDS_MAX = 99.99;
// Bidrag under gränsen visas inte i förklaringen (7.4).
export const EXPLAIN_MIN = 0.15;
export const EXPLAIN_MAX = 3;
// Hästen räknas som osäker med färre starter än så (7.2 punkt 6).
export const FEW_STARTS = 5;
const FORM_POINTS = [0, 1.0, 0.8, 0.6, 0.4, 0.2];

// ---- Indata ------------------------------------------------------------------------

export type Counts = { starts: number; wins: number; placed: number };

export type StartFacts = {
  startId: string;
  number: number;
  scratched: boolean;
  horse: {
    // Starter, segrar och placeringar (1–3) i år och i fjol (ATG horse.statistics).
    thisYear: Counts | null;
    lastYear: Counts | null;
    // Starter totalt (livet). null = okänt, då räknas de tidigare starterna.
    lifeStarts: number | null;
  };
  // De 5 senaste riktiga starterna före loppet, nyast först (HorseRecord).
  records: { place: number | null; galloped: boolean; disqualified: boolean }[];
  // Vinster och starter i år (ATG driver/trainer.statistics). null = saknas.
  driver: { starts: number; wins: number } | null;
  trainer: { starts: number; wins: number } | null;
  // Startnumrets procent på distansen och startmetoden och medel för alla
  // startnummer. kind "plats" = topp 3 ur statistikbasen (lib/hist.ts),
  // saknas/"vinst" = vinst % från travstatistik.se. null = saknas.
  post: { pct: number; mean: number; distance: number; method: "AUTO" | "VOLTE"; kind?: "vinst" | "plats" } | null;
  // Streck i procent (12.3 = 12,3 %). null = saknas.
  streck: number | null;
};

// Det som sparas per start i Riktodds.inputs: värdet som gick in i
// z-standardiseringen, om det saknades och fakta för meningarna.
export type InputValue = { value: number; missing: boolean };
export type StoredInputs = {
  version: 1;
  n: number;
  values: Record<InputKey, InputValue>;
  z: Record<InputKey, number>;
  strength: number;
  winProb: number;
  facts: {
    number: number;
    placePct: number | null;
    winPct: number | null;
    yearsStarts: number;
    formPlaces: (number | null)[];
    formStarts: number;
    gallops: number;
    gallopsDq: number;
    driverWinPct: number | null;
    trainerWinPct: number | null;
    post: StartFacts["post"];
    streck: number | null;
    lifeStarts: number;
  };
  uncertainReasons: string[];
};

export type StartRiktodds = {
  startId: string;
  probTop3: number;
  odds: number;
  uncertain: boolean;
  inputs: StoredInputs;
  contributions: Record<InputKey, number>;
};

// ---- Små räknefunktioner --------------------------------------------------------------

export const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// z-värden inom loppet (populationens standardavvikelse). sd = 0 ger 0.
export function zScores(xs: number[]): number[] {
  const m = mean(xs);
  const sd = Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
  if (!(sd > 1e-12)) return xs.map(() => 0);
  return xs.map((x) => (x - m) / sd);
}

export function softmax(strengths: number[], beta: number): number[] {
  const scaled = strengths.map((s) => beta * s);
  const max = Math.max(...scaled);
  const e = scaled.map((s) => Math.exp(s - max));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / sum);
}

// Harvilles formel, exakt summa över alla ordningar av ettan, tvåan och trean (7.2 punkt 4).
export function harvilleTop3(pi: number[]): number[] {
  const n = pi.length;
  return pi.map((pi_i, i) => {
    let p = pi_i;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const rj = 1 - pi[j];
      if (rj <= 0) continue;
      p += (pi[j] * pi_i) / rj;
      for (let k = 0; k < n; k++) {
        if (k === i || k === j) continue;
        const rjk = 1 - pi[j] - pi[k];
        if (rjk <= 0) continue;
        p += ((pi[j] * pi[k]) / rj) * (pi_i / rjk);
      }
    }
    return Math.min(1, p);
  });
}

export function oddsFromP3(p3: number, marginal: number): number {
  if (!(p3 > 0)) return ODDS_MAX;
  return clamp(round2((1 / p3) * (1 + marginal)), ODDS_MIN, ODDS_MAX);
}

// Krympning mot fältets medel: (x + k·x0) / (n + k).
export const shrink = (x: number, n: number, k: number, x0: number) => (x + k * x0) / (n + k);

const formPoints = (place: number | null, disqualified: boolean) => (disqualified || place === null ? 0 : FORM_POINTS[place] ?? 0);

// ---- Modellen -------------------------------------------------------------------------

// Räknar ett lopp. Strukna starter utelämnas. Lopp med färre än 4 startande
// ger en tom lista.
export function computeRace(all: StartFacts[], weights: Weights, params: ModelParams): StartRiktodds[] {
  const starts = all.filter((s) => !s.scratched);
  const N = starts.length;
  if (N < MIN_STARTERS) return [];

  const p0 = 3 / N;
  const w0 = 1 / N;
  const years = (s: StartFacts) => {
    const a = s.horse.thisYear;
    const b = s.horse.lastYear;
    return { starts: (a?.starts ?? 0) + (b?.starts ?? 0), wins: (a?.wins ?? 0) + (b?.wins ?? 0), placed: (a?.placed ?? 0) + (b?.placed ?? 0) };
  };
  const rate = (p: { starts: number; wins: number } | null) => (p && p.starts > 0 ? p.wins / p.starts : null);

  const formRaw = starts.map((s) => (s.records.length ? mean(s.records.slice(0, 5).map((r) => formPoints(r.place, r.disqualified))) : null));
  const formMean = mean(formRaw.filter((x): x is number => x !== null));
  const driverRates = starts.map((s) => rate(s.driver));
  const trainerRates = starts.map((s) => rate(s.trainer));
  const driverMean = mean(driverRates.filter((x): x is number => x !== null));
  const trainerMean = mean(trainerRates.filter((x): x is number => x !== null));

  const values: Record<InputKey, InputValue>[] = starts.map((s, i) => {
    const y = years(s);
    const last5 = s.records.slice(0, 5);
    return {
      plats: { value: shrink(y.placed, y.starts, params.kPlats, p0), missing: y.starts === 0 },
      vinst: { value: shrink(y.wins, y.starts, params.kVinst, w0), missing: y.starts === 0 },
      form: { value: formRaw[i] ?? formMean, missing: formRaw[i] === null },
      spar: s.post && s.post.mean > 0 ? { value: Math.log(Math.max(s.post.pct, 0.1) / s.post.mean), missing: false } : { value: 0, missing: true },
      kusk: driverRates[i] === null ? { value: driverMean, missing: true } : { value: shrink(s.driver!.wins, s.driver!.starts, params.kKusk, driverMean), missing: false },
      tranare: trainerRates[i] === null ? { value: trainerMean, missing: true } : { value: shrink(s.trainer!.wins, s.trainer!.starts, params.kTranare, trainerMean), missing: false },
      galopp: { value: last5.reduce((a, r) => a + (r.galloped ? (r.disqualified ? 1.5 : 1) : 0), 0), missing: last5.length === 0 },
      streck: s.streck !== null && s.streck > 0 ? { value: Math.log(s.streck), missing: false } : { value: 0, missing: true },
    };
  });

  const z = {} as Record<InputKey, number[]>;
  for (const key of INPUT_KEYS) z[key] = zScores(values.map((v) => v[key].value));

  const contributions = starts.map((_, i) => {
    const c = {} as Record<InputKey, number>;
    for (const key of INPUT_KEYS) c[key] = (weights[key] ?? 0) * z[key][i] || 0;
    return c;
  });
  const strengths = contributions.map((c) => INPUT_KEYS.reduce((a, k) => a + c[k], 0));
  const pi = softmax(strengths, params.beta);
  const p3 = harvilleTop3(pi);

  return starts.map((s, i) => {
    const y = years(s);
    const last5 = s.records.slice(0, 5);
    const lifeStarts = s.horse.lifeStarts ?? s.records.length;
    const reasons: string[] = [];
    if (lifeStarts < FEW_STARTS) reasons.push("färre än 5 starter");
    const missingCore = (["plats", "form", "kusk"] as const).filter((k) => values[i][k].missing);
    if (missingCore.length >= 2) reasons.push(`saknar ${joinSv(missingCore.map((k) => MISSING_LABEL[k]))}`);
    const zi = {} as Record<InputKey, number>;
    for (const key of INPUT_KEYS) zi[key] = z[key][i];
    return {
      startId: s.startId,
      probTop3: p3[i],
      odds: oddsFromP3(p3[i], params.marginal),
      uncertain: reasons.length > 0,
      contributions: contributions[i],
      inputs: {
        version: 1,
        n: N,
        values: values[i],
        z: zi,
        strength: strengths[i],
        winProb: pi[i],
        facts: {
          number: s.number,
          placePct: y.starts ? (100 * y.placed) / y.starts : null,
          winPct: y.starts ? (100 * y.wins) / y.starts : null,
          yearsStarts: y.starts,
          formPlaces: last5.map((r) => (r.disqualified ? null : r.place)),
          formStarts: last5.length,
          gallops: last5.filter((r) => r.galloped).length,
          gallopsDq: last5.filter((r) => r.galloped && r.disqualified).length,
          driverWinPct: driverRates[i] === null ? null : 100 * driverRates[i]!,
          trainerWinPct: trainerRates[i] === null ? null : 100 * trainerRates[i]!,
          post: s.post,
          streck: s.streck,
          lifeStarts,
        },
        uncertainReasons: reasons,
      },
    };
  });
}

const MISSING_LABEL: Record<"plats" | "form" | "kusk", string> = { plats: "platsstatistik", form: "tidigare starter", kusk: "kuskstatistik" };

function joinSv(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} och ${xs[xs.length - 1]}`;
}

// ---- Förklaring (7.4) -----------------------------------------------------------------

export type WhyRow = { key: InputKey; contribution: number; text: string };
export type Explanation = {
  pros: WhyRow[];
  cons: WhyRow[];
  // "Chans till topp 3 ≈ 31 % → 1 / 0,31 = 3,20"
  calcLine: string;
  // "Osäkert: färre än 5 starter" eller null.
  uncertainLine: string | null;
};

const dec2 = (x: number) => x.toFixed(2).replace(".", ",");
const pct0 = (x: number) => pct(x, 0);
const pct1 = (x: number) => pct(x, 1);
const methodSv = (m: "AUTO" | "VOLTE") => (m === "AUTO" ? "auto" : "volte");

// En mening per indata med det verkliga värdet. positive = bidraget talar för hästen.
export function sentence(key: InputKey, f: StoredInputs["facts"], positive: boolean): string {
  switch (key) {
    case "plats":
      return f.placePct === null ? "Inga starter i år eller i fjol" : `Plats i ${pct0(f.placePct)} av starterna i år och i fjol`;
    case "vinst":
      return f.winPct === null ? "Inga starter i år eller i fjol" : `Vinner ${pct0(f.winPct)} av starterna i år och i fjol`;
    case "form": {
      if (!f.formStarts) return "Inga tidigare starter";
      const chars = f.formPlaces.map((p) => (p === null ? "d" : p >= 1 && p <= 9 ? String(p) : "0")).join("-");
      return `Form ${chars} i ${f.formStarts} senaste`;
    }
    case "spar":
      if (!f.post) return "Spårstatistik saknas";
      return `Spår ${f.number} på ${f.post.distance} m ${methodSv(f.post.method)} ${f.post.kind === "plats" ? "tar plats" : "vinner"} ${positive ? "" : "bara "}${pct1(f.post.pct)}`;
    case "kusk":
      return f.driverWinPct === null ? "Kuskens statistik saknas" : `Kusken vinner ${pct0(f.driverWinPct)} i år`;
    case "tranare":
      return f.trainerWinPct === null ? "Tränarens statistik saknas" : `Tränaren vinner ${pct0(f.trainerWinPct)} i år`;
    case "galopp":
      if (!f.formStarts) return "Inga tidigare starter";
      if (!f.gallops) return `Ingen galopp i ${f.formStarts} senaste`;
      if (!f.gallopsDq) return `Galopp i ${f.gallops} av ${f.formStarts} senaste`;
      return `Galopp i ${f.gallops} av ${f.formStarts} senaste, ${f.gallops === 1 ? "med" : `varav ${f.gallopsDq} med`} diskning`;
    case "streck":
      return f.streck === null ? "Streck saknas" : `Streckad ${pct1(f.streck)}`;
  }
}

export function calcLine(probTop3: number, odds: number, marginal = 0): string {
  const p = round2(probTop3);
  const m = marginal ? ` × ${dec2(1 + marginal)}` : "";
  return `Chans till topp 3 ≈ ${pct0(probTop3 * 100)} → 1 / ${dec2(p)}${m} = ${dec2(odds)}`;
}

export function explain(r: { probTop3: number; odds: number; uncertain: boolean; inputs: StoredInputs; contributions: Partial<Record<InputKey, number>> }, marginal = 0): Explanation {
  const rows = INPUT_KEYS.map((key) => ({ key, contribution: r.contributions[key] ?? 0 })).filter((x) => Math.abs(x.contribution) >= EXPLAIN_MIN);
  const pros = rows
    .filter((x) => x.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, EXPLAIN_MAX)
    .map((x) => ({ ...x, text: sentence(x.key, r.inputs.facts, true) }));
  const cons = rows
    .filter((x) => x.contribution < 0)
    .sort((a, b) => a.contribution - b.contribution)
    .slice(0, EXPLAIN_MAX)
    .map((x) => ({ ...x, text: sentence(x.key, r.inputs.facts, false) }));
  return {
    pros,
    cons,
    calcLine: calcLine(r.probTop3, r.odds, marginal),
    uncertainLine: r.uncertain ? `Osäkert: ${r.inputs.uncertainReasons.join(", ") || "för lite underlag"}` : null,
  };
}

// ---- Vikter och parametrar från ModelVersion (JSON) --------------------------------------

export function parseWeights(x: unknown): Weights {
  const o = x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
  const w = {} as Weights;
  for (const k of INPUT_KEYS) w[k] = typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : V1_WEIGHTS[k];
  return w;
}

export function parseParams(x: unknown): ModelParams {
  const o = x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
  const num = (k: keyof ModelParams) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : V1_PARAMS[k]);
  return { beta: num("beta"), marginal: num("marginal"), kPlats: num("kPlats"), kVinst: num("kVinst"), kKusk: num("kKusk"), kTranare: num("kTranare") };
}

// Nästa versionsnyckel: v1 → v1.1, v1.1 → v1.2, v1.9 → v1.10.
export function nextModelKey(keys: string[]): string {
  let maxMinor = 0;
  let major = 1;
  for (const k of keys) {
    const m = /^v(\d+)(?:\.(\d+))?$/.exec(k);
    if (!m) continue;
    const ma = Number(m[1]);
    const mi = m[2] ? Number(m[2]) : 0;
    if (ma > major) {
      major = ma;
      maxMinor = mi;
    } else if (ma === major) maxMinor = Math.max(maxMinor, mi);
  }
  return `v${major}.${maxMinor + 1}`;
}
