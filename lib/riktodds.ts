// Riktoddsmodell v1 (specen 7). Ren modul utan databas: indata per start in,
// P3 (chans till topp 3), riktodds, osäkert-flagga och bidrag ut. Förklaringen
// ("Talar för"/"Talar emot" och beräkningsraden) byggs från det som sparas i
// Riktodds.inputs och Riktodds.contributions, så att den kan visas utan att
// modellen räknas om. Testas i lib/riktodds.test.ts.
//
// Modellen är märkt v1, okalibrerad. Den gäller bara plats (topp 3).

import { money, pct } from "@/lib/format";
import { bestAdjusted, timeOutliers } from "@/lib/kmref";

export const INPUT_KEYS = ["plats", "vinst", "form", "spar", "kusk", "tranare", "galopp", "galoppVolt", "pengar", "barfota", "vila", "tid", "streck"] as const;
export type InputKey = (typeof INPUT_KEYS)[number];
export type Weights = Record<InputKey, number>;

// beta och marginal (7.2), k-värden för krympningen (7.1). plattA, plattB och
// maxP3 kalibrerar P3 efter Harville: P3' = min(maxP3, sigmoid(a + b·logit P3)),
// standard a = 0, b = 1, maxP3 = 1 (ingen ändring). noStreck = vikterna
// som används i ett lopp där ingen häst har streck än (V-spelet har inte
// öppnat), när modellens vikt för streck inte är 0. null = samma vikter.
export type ModelParams = { beta: number; marginal: number; kPlats: number; kVinst: number; kKusk: number; kTranare: number; plattA: number; plattB: number; maxP3: number; noStreck: Weights | null };
export type NumParamKey = Exclude<keyof ModelParams, "noStreck">;

// Standardvikter och parametrar v1 (7.3). Samma värden som scripts/seed.mjs.
export const V1_WEIGHTS: Weights = { plats: 1.0, vinst: 0.5, form: 0.6, spar: 0.4, kusk: 0.3, tranare: 0.2, galopp: -0.4, galoppVolt: 0, pengar: 0, barfota: 0, vila: 0, tid: 0, streck: 0 };
export const V1_PARAMS: ModelParams = { beta: 1.0, marginal: 0, kPlats: 6, kVinst: 6, kKusk: 20, kTranare: 20, plattA: 0, plattB: 1, maxP3: 1, noStreck: null };

// Rekommenderad modell v3 ur backtestet 2026-10-20 (docs/backtest), β = 1.
// Testdelen (654 lopp): med streck och kalibrering log loss 0,4893 (v2 0,4949,
// vinnarodds 0,5010); utan streck (noStreck) 0,5218.
export const RECOMMENDED_WEIGHTS: Weights = { plats: 0.08, vinst: 0, form: -0.05, spar: 0.03, kusk: 0, tranare: 0.03, galopp: -0.05, galoppVolt: 0, pengar: 0.05, barfota: 0.08, vila: -0.07, tid: 0, streck: 0.86 };
export const RECOMMENDED_NO_STRECK: Weights = { plats: 0.1, vinst: 0.08, form: 0.15, spar: 0.17, kusk: 0.1, tranare: 0.1, galopp: 0.03, galoppVolt: 0, pengar: 0.38, barfota: 0.13, vila: -0.1, tid: 0.08, streck: 0 };
// Kalibreringen som hör till v3 (anpassad på modellen med streck).
export const RECOMMENDED_CALIBRATION: Pick<ModelParams, "plattA" | "plattB" | "maxP3"> = { plattA: -0.055, plattB: 0.947, maxP3: 0.8 };

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
  // date, kmTime, distance och startMethod används av vila och tid (v3).
  records: { place: number | null; galloped: boolean; disqualified: boolean; date?: string; kmTime?: string | null; distance?: number | null; startMethod?: string | null }[];
  // Loppets datum ("2026-10-24") och startmetod, för vila och galopp vid volte.
  raceDate?: string;
  volte?: boolean;
  // Barfota runt om (horse.shoes). null/saknas = okänt.
  barefoot?: boolean | null;
  // Vinster och starter i år (ATG driver/trainer.statistics). null = saknas.
  driver: { starts: number; wins: number } | null;
  trainer: { starts: number; wins: number } | null;
  // Startnumrets procent på distansen och startmetoden och medel för alla
  // startnummer. kind "plats" = topp 3 ur statistikbasen (lib/hist.ts),
  // saknas/"vinst" = vinst % från travstatistik.se. null = saknas.
  post: { pct: number; mean: number; distance: number; method: "AUTO" | "VOLTE"; kind?: "vinst" | "plats" } | null;
  // Streck i procent (12.3 = 12,3 %). null = saknas.
  streck: number | null;
  // Hästens totala vinstsumma (kr) och starter i livet. null/saknas = okänt.
  earnings?: { total: number; lifeStarts: number } | null;
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
    // Intjänat per start i livet (kr). Saknas i rader räknade före pengar fanns.
    earningsPerStart?: number | null;
    // v3: barfota runt om, dagar sedan senaste start, voltstart och tidens extremvärde.
    barefoot?: boolean | null;
    daysSinceLast?: number | null;
    volte?: boolean;
    tidOutlier?: number;
  };
  uncertainReasons: string[];
  // Loppet saknade streck och räknades med modellens vikter utan streck.
  noStreck?: boolean;
};

export type StartRiktodds = {
  startId: string;
  probTop3: number;
  odds: number;
  uncertain: boolean;
  inputs: StoredInputs;
  contributions: Record<InputKey, number>;
};

// Barfota runt om ur ATG:s horse.shoes ({ front: { hasShoe }, back: { hasShoe } }). null = okänt.
export function barefoot(shoes: unknown): boolean | null {
  const o = shoes && typeof shoes === "object" ? (shoes as { front?: { hasShoe?: unknown }; back?: { hasShoe?: unknown } }) : null;
  const f = o?.front?.hasShoe;
  const b = o?.back?.hasShoe;
  if (typeof f !== "boolean" || typeof b !== "boolean") return null;
  return !f && !b;
}

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

const gallopScore = (last5: StartFacts["records"]) => last5.reduce((a, r) => a + (r.galloped ? (r.disqualified ? 1.5 : 1) : 0), 0);

// Kalibreringen efter Harville (v3): sigmoid(a + b·logit P3), högst maxP3.
// Standardvärdena (a 0, b 1, max 1) ändrar ingenting.
export function calibrate(p3: number[], params: Pick<ModelParams, "plattA" | "plattB" | "maxP3">): number[] {
  const { plattA: a, plattB: b, maxP3 } = params;
  if (a === 0 && b === 1 && maxP3 >= 1) return p3;
  return p3.map((p) => {
    const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
    return Math.min(maxP3, 1 / (1 + Math.exp(-(a + b * Math.log(q / (1 - q))))));
  });
}

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
  const perStart = starts.map((s) => (s.earnings && s.earnings.lifeStarts > 0 ? s.earnings.total / s.earnings.lifeStarts : null));
  const moneyRaw = perStart.map((x) => (x === null ? null : Math.log1p(Math.max(0, x))));
  const moneyMean = mean(moneyRaw.filter((x): x is number => x !== null));
  const days = starts.map((s) => (s.raceDate && s.records[0]?.date ? Math.max(0, Math.round((Date.parse(`${s.raceDate}T00:00:00Z`) - Date.parse(`${s.records[0].date}T00:00:00Z`)) / 86_400_000)) : null));
  const vilaRaw = days.map((d) => (d === null ? null : Math.log1p(d)));
  const vilaMean = mean(vilaRaw.filter((x): x is number => x !== null));
  const footRaw: (number | null)[] = starts.map((s) => (s.barefoot === undefined || s.barefoot === null ? null : s.barefoot ? 1 : 0));
  const footMean = mean(footRaw.filter((x): x is number => x !== null));
  const tid = timeOutliers(starts.map((s) => bestAdjusted(s.records)));
  // Inget streck i loppet: vikterna utan streck, om modellen har sådana.
  const noStreck = !!params.noStreck && (weights.streck ?? 0) !== 0 && starts.every((s) => s.streck === null || !(s.streck > 0));
  const w = noStreck ? params.noStreck! : weights;

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
      galopp: { value: gallopScore(last5), missing: last5.length === 0 },
      galoppVolt: { value: s.volte ? gallopScore(last5) : 0, missing: last5.length === 0 },
      barfota: footRaw[i] === null ? { value: footMean, missing: true } : { value: footRaw[i]!, missing: false },
      vila: vilaRaw[i] === null ? { value: vilaMean, missing: true } : { value: vilaRaw[i]!, missing: false },
      tid: { value: tid[i], missing: false },
      pengar: moneyRaw[i] === null ? { value: moneyMean, missing: true } : { value: moneyRaw[i]!, missing: false },
      streck: s.streck !== null && s.streck > 0 ? { value: Math.log(s.streck), missing: false } : { value: 0, missing: true },
    };
  });

  const z = {} as Record<InputKey, number[]>;
  for (const key of INPUT_KEYS) z[key] = zScores(values.map((v) => v[key].value));

  const contributions = starts.map((_, i) => {
    const c = {} as Record<InputKey, number>;
    for (const key of INPUT_KEYS) c[key] = (w[key] ?? 0) * z[key][i] || 0;
    return c;
  });
  const strengths = contributions.map((c) => INPUT_KEYS.reduce((a, k) => a + c[k], 0));
  const pi = softmax(strengths, params.beta);
  const p3 = calibrate(harvilleTop3(pi), params);

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
          earningsPerStart: perStart[i],
          barefoot: footRaw[i] === null ? null : footRaw[i] === 1,
          daysSinceLast: days[i],
          volte: !!s.volte,
          tidOutlier: tid[i],
        },
        uncertainReasons: reasons,
        ...(noStreck ? { noStreck: true } : {}),
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
  // Loppet saknar streck och räknades med vikterna utan streck, annars null.
  noteLine: string | null;
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
    case "galoppVolt":
      return `Galopp i ${f.gallops} av ${f.formStarts} senaste, och det är voltstart`;
    case "barfota":
      return f.barefoot == null ? "Skor okänt" : f.barefoot ? "Barfota runt om" : "Går med skor";
    case "vila":
      return f.daysSinceLast == null ? "Ingen tidigare start" : `${f.daysSinceLast} dagar sedan senaste start`;
    case "tid":
      return positive ? "Sticker ut på tid: klart snabbast i fältet (justerat för distans)" : "En annan häst sticker ut klart på tid";
    case "pengar":
      return f.earningsPerStart == null ? "Vinstsumma saknas" : `Tjänar ${positive ? "" : "bara "}${money(f.earningsPerStart)} per start`;
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
    noteLine: r.inputs.noStreck ? "Strecket saknas än, så modellens vikter utan streck används." : null,
  };
}

// ---- Vikter och parametrar från ModelVersion (JSON) --------------------------------------

// Saknade nycklar får v1:s värde (pengar, som kom senare, får 0).
export function parseWeights(x: unknown, fallback: Weights = V1_WEIGHTS): Weights {
  const o = x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
  const w = {} as Weights;
  for (const k of INPUT_KEYS) w[k] = typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : fallback[k];
  return w;
}

const ZERO_WEIGHTS = Object.fromEntries(INPUT_KEYS.map((k) => [k, 0])) as Weights;

export function parseParams(x: unknown): ModelParams {
  const o = x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
  const num = (k: NumParamKey) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : V1_PARAMS[k]);
  const cal = { plattA: num("plattA"), plattB: num("plattB"), maxP3: num("maxP3") };
  const ns = o.noStreck && typeof o.noStreck === "object" && !Array.isArray(o.noStreck) ? { ...parseWeights(o.noStreck, ZERO_WEIGHTS), streck: 0 } : null;
  return { beta: num("beta"), marginal: num("marginal"), kPlats: num("kPlats"), kVinst: num("kVinst"), kKusk: num("kKusk"), kTranare: num("kTranare"), ...cal, noStreck: ns };
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
