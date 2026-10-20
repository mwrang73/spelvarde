// Backtest av riktoddsmodellen mot historiska ATG-spel (specen 7.6).
//
//   npm run backtest -- --fran 2025-01-01 --till 2026-10-18 --spelformer V85,V75,V86,GS75
//
// Flaggor (alla valfria):
//   --fran / --till     datumintervall (till: i går)
//   --spelformer        kommaseparerat, standard V85,V75,V86,GS75
//   --beta              extra β-värden att jämföra med v1, standard 1,0.5
//   --vikter            JSON med vikter som ersätter v1:s, t.ex. '{"plats":1.2}'
//   --andel-traning     andel av loppen (äldst) till träning, standard 0.7
//   --ut                katalog för rapporten, standard docs/backtest
//   --namn              namn i filnamnet, standard "backtest" (<datum>-<namn>.md).
//                       En körning skriver aldrig över en tidigare: finns filen
//                       redan får den nya -2, -3 …
//   --statistik         ogonblick (standard) eller poster: källa för hästens år/fjol
//   --bara-underlag     hämta och räkna underlaget, ingen utvärdering
//   --bara-cache        hämta inget: använd bara det som finns i .backtest-cache/;
//                       spel där någon start saknas i cachen hoppas över
//   --utan-spar         pröva inte spåret (annars läses statistikbasen)
//   --spar-db <url>     databasen med statistikbasen, standard DATABASE_URL
//                       (lokalt: npm run db:local och knappen i S10)
//
// Spåret: startnumrets plats % räknas för varje lopp ur statistikbasen
// (HistRace/HistStart), bara lopp före loppdagen (lib/backtest.ts, attachPosts).
// I övrigt ingen databas: allt hämtas från ATG och sparas i .backtest-cache/ (gitignorerad),
// så att en avbruten körning fortsätter där den slutade. Högst 3 anrop samtidigt
// och en kort paus efter varje riktigt anrop. Rapporten skrivs som
// <ut>/<datum>-v1.md och en JSON bredvid. Rena delar i lib/backtest.ts.

import fs from "node:fs";
import path from "node:path";
import { AtgError, atgFetch, atgPaths, mapLimit } from "@/lib/atg";
import {
  positiveSignals,
  SIGNAL_KEYS,
  toFacts,
  type SignalKey,
  applyPlatt,
  EXTRA_KEYS,
  extraFeatures,
  fitPlatt,
  logLoss,
  withExtras,
  type Platt,
  attachPosts,
  betaGrid,
  buildRaces,
  calendarGames,
  calibration,
  fitWeights,
  makePostIndex,
  marketPreds,
  PENGAR,
  withPengar,
  metrics,
  modelPreds,
  naivePreds,
  roiRule,
  searchBeta,
  timeSplit,
  zPreds,
  zRaces,
  type BtRace,
  type Bucket,
  type CalendarEntry,
  type HistRow,
  type Metrics,
  type Pred,
  type StatsSource,
  type RoiRow,
} from "@/lib/backtest";
import { kmRef } from "@/lib/kmref";
import { computeRace, harvilleTop3, INPUT_KEYS, parseWeights, RECOMMENDED_CALIBRATION, RECOMMENDED_WEIGHTS, V1_PARAMS, V1_WEIGHTS, type InputKey, type Weights } from "@/lib/riktodds";
import { addDaysToDateString, stockholmDateString } from "@/lib/stockholm-time";

const ROOT = process.cwd();
const CACHE = path.join(ROOT, ".backtest-cache");
const PAUSE_MS = 250;
const PARALLEL = 3;

// ---- Flaggor ---------------------------------------------------------------------

function args() {
  const a = process.argv.slice(2);
  const get = (name: string) => {
    const i = a.indexOf(`--${name}`);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const today = stockholmDateString(new Date());
  return {
    from: get("fran") ?? "2025-01-01",
    to: get("till") ?? addDaysToDateString(today, -1),
    types: (get("spelformer") ?? "V85,V75,V86,GS75").split(",").map((s) => s.trim()).filter(Boolean),
    betas: (get("beta") ?? "1,0.5").split(",").map(Number).filter((x) => Number.isFinite(x) && x > 0),
    weights: get("vikter") ? parseWeights({ ...V1_WEIGHTS, ...JSON.parse(get("vikter")!) }) : V1_WEIGHTS,
    trainShare: Number(get("andel-traning") ?? 0.7),
    out: get("ut") ?? "docs/backtest",
    name: (get("namn") ?? "backtest").replace(/[^\w.-]+/g, "-"),
    onlyData: a.includes("--bara-underlag"),
    cacheOnly: a.includes("--bara-cache"),
    source: (get("statistik") === "poster" ? "poster" : "ogonblick") as StatsSource,
    withPost: !a.includes("--utan-spar"),
    postDb: get("spar-db") ?? process.env.DATABASE_URL ?? "",
    today,
  };
}

// ---- Hämtning med cache ------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cacheFile = (p: string) => path.join(CACHE, `${p.replace(/[^\w.-]/g, "_")}.json`);
let networkCalls = 0;
let cacheHits = 0;
let cacheOnly = false;
// Markerar ett svar som inte finns i cachen (med --bara-cache).
const MISSING = Symbol("saknas i cachen");

// Svar som inte ändras längre sparas på disk. 404 sparas som null. Andra fel
// försöks igen två gånger och sparas inte, så att nästa körning försöker igen.
async function cached(p: string, keep: (json: unknown) => boolean = () => true): Promise<unknown | null> {
  const file = cacheFile(p);
  if (fs.existsSync(file)) {
    cacheHits++;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  if (cacheOnly) return MISSING;
  for (let attempt = 0; ; attempt++) {
    try {
      networkCalls++;
      const json = await atgFetch(p);
      await sleep(PAUSE_MS);
      if (keep(json)) fs.writeFileSync(file, JSON.stringify(json));
      return json;
    } catch (e) {
      await sleep(PAUSE_MS * 4 * (attempt + 1));
      if (e instanceof AtgError && e.status === 404) {
        fs.writeFileSync(file, "null");
        return null;
      }
      if (attempt >= 2) {
        console.warn(`  kunde inte hämta ${p}: ${e instanceof Error ? e.message : e}`);
        return null;
      }
    }
  }
}

function dates(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysToDateString(d, 1)) out.push(d);
  return out;
}

const progress = (label: string, i: number, n: number) => {
  if (i % 50 === 0 || i === n) process.stdout.write(`\r  ${label} ${i}/${n} (nät ${networkCalls}, cache ${cacheHits})   `);
  if (i === n) process.stdout.write("\n");
};

async function loadRaces(o: ReturnType<typeof args>): Promise<{ races: BtRace[]; games: CalendarEntry[]; skipped: number }> {
  fs.mkdirSync(CACHE, { recursive: true });
  cacheOnly = o.cacheOnly;
  const days = dates(o.from, o.to);
  console.log(`Kalender ${o.from} – ${o.to} (${days.length} dagar), spelformer ${o.types.join(", ")}`);
  let done = 0;
  const perDay = await mapLimit(days, PARALLEL, async (d) => {
    // Dagens och framtida kalendrar sparas inte (de ändras).
    const json = await cached(atgPaths.calendarDay(d), () => d < o.today);
    progress("kalender", ++done, days.length);
    return calendarGames(json, o.types);
  });
  const games = perDay.flat().filter((g) => g.status === "results");
  const missingDays = cacheOnly ? (await Promise.all(days.map((d) => cached(atgPaths.calendarDay(d))))).filter((x) => x === MISSING).length : 0;
  if (missingDays) console.log(`${missingDays} kalenderdagar saknas i cachen och hoppas över`);

  console.log(`${games.length} spel med resultat`);
  done = 0;
  const gameJson = await mapLimit(games, PARALLEL, async (g) => {
    const json = await cached(atgPaths.game(g.id), (j) => (j as { status?: string } | null)?.status === "results");
    progress("spel", ++done, games.length);
    return json;
  });

  // Startdetaljer (tidigare starter) för alla som inte är strukna.
  type Job = { raceId: string; number: number; game: number };
  const jobs: Job[] = [];
  gameJson.forEach((json, gi) => {
    if (json === MISSING) return;
    for (const r of ((json as { races?: unknown[] } | null)?.races ?? []) as { id?: string; status?: string; starts?: { number?: number; scratched?: boolean }[] }[]) {
      if (!r.id || r.status !== "results") continue;
      for (const s of r.starts ?? []) if (typeof s.number === "number" && !s.scratched) jobs.push({ raceId: r.id, number: s.number, game: gi });
    }
  });
  console.log(`${jobs.length} starter att hämta tidigare lopp för`);
  done = 0;
  const detail = new Map<string, unknown>();
  const incomplete = new Set<number>();
  await mapLimit(jobs, PARALLEL, async (j) => {
    const json = await cached(atgPaths.start(j.raceId, j.number));
    if (json === MISSING) incomplete.add(j.game);
    else detail.set(`${j.raceId}/${j.number}`, json);
    progress("starter", ++done, jobs.length);
  });

  const seen = new Set<string>();
  const races: BtRace[] = [];
  const skipped = games.filter((_, i) => gameJson[i] === MISSING || incomplete.has(i)).length;
  if (skipped) console.log(`${skipped} spel hoppas över (saknas helt eller delvis i cachen)`);
  games.forEach((g, i) => {
    if (!gameJson[i] || gameJson[i] === MISSING || incomplete.has(i)) return;
    for (const r of buildRaces(gameJson[i], g.gameType, (raceId, n) => detail.get(`${raceId}/${n}`) ?? null, o.source)) {
      // Samma lopp kan ingå i flera spel: ta det första.
      if (seen.has(r.key)) continue;
      seen.add(r.key);
      races.push(r);
    }
  });
  races.sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date < b.date ? -1 : 1));
  return { races, games: games.filter((_, i) => gameJson[i] !== MISSING && !incomplete.has(i)), skipped };
}

// ---- Rapport -----------------------------------------------------------------------

const f = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d).replace(".", ",") : "–");
const p1 = (x: number) => (Number.isFinite(x) ? `${(100 * x).toFixed(1).replace(".", ",")} %` : "–");
const signedPct = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? "+" : "−"}${Math.abs(100 * x).toFixed(1).replace(".", ",")} %` : "–");
const w2 = (w: Weights) => INPUT_KEYS.map((k) => `${k} ${f(w[k], 2)}`).join(" · ");

type Variant = { name: string; kind: VariantResult["kind"]; test: Pred[]; all: Pred[] | null };

function metricsTable(rows: { name: string; m: Metrics }[]): string {
  const head = "| Variant | Starter | Lopp | Brier | Log loss | Lägst odds topp 3 | Medel P3 | Verklig andel |\n|---|---:|---:|---:|---:|---:|---:|---:|";
  return [head, ...rows.map(({ name, m }) => `| ${name} | ${m.starts} | ${m.races} | ${f(m.brier, 4)} | ${f(m.logLoss, 4)} | ${p1(m.favourite.rate)} (${m.favourite.hits}/${m.favourite.races}) | ${p1(m.meanP)} | ${p1(m.rate)} |`)].join("\n");
}

function calibrationTable(b: Bucket[]): string {
  const head = "| P3-hink | Antal | Förväntad | Verklig |\n|---|---:|---:|---:|";
  return [head, ...b.map((x) => `| ${Math.round(x.lo * 100)}–${Math.round(x.hi * 100)} % | ${x.n} | ${p1(x.expected)} | ${p1(x.actual)} |`)].join("\n");
}

function roiTable(rows: { name: string; r: RoiRow }[]): string {
  const head = "| Variant | Spel | Träff | Insats | Tillbaka | ROI |\n|---|---:|---:|---:|---:|---:|";
  return [head, ...rows.map(({ name, r }) => `| ${name} | ${r.bets} | ${p1(r.hitRate)} | ${r.staked} | ${f(r.returned, 1)} | ${signedPct(r.roi)} |`)].join("\n");
}

function bandsTable(bands: RoiRow[]): string {
  const head = "| Platsodds | Spel | Träff | ROI |\n|---|---:|---:|---:|";
  return [head, ...bands.map((r) => `| ${r.label} | ${r.bets} | ${p1(r.hitRate)} | ${signedPct(r.roi)} |`)].join("\n");
}

// ---- Körning ------------------------------------------------------------------------

async function main() {
  const o = args();
  const { races: loaded, games, skipped } = await loadRaces(o);
  console.log(`Klart: nät ${networkCalls} anrop, cache ${cacheHits}`);
  const post = o.withPost ? await loadPosts(o.postDb, loaded) : null;
  if (post) console.log(`Spår: statistikbasen ${post.from} – ${post.to}, ${post.races} lopp; plats % för ${post.withPost} av ${post.starts} starter`);

  // Underlaget per spelform.
  const byType = o.types.map((t) => {
    const rs = loaded.filter((r) => r.gameType === t);
    const run = rs.flatMap((r) => r.starts.filter((s) => !s.scratched));
    return {
      type: t,
      rounds: new Set(rs.map((r) => r.gameId)).size,
      calendarRounds: games.filter((g) => g.gameType === t).length,
      races: rs.length,
      starts: run.length,
      from: rs[0]?.date ?? null,
      to: rs[rs.length - 1]?.date ?? null,
    };
  });
  const runAll = loaded.flatMap((r) => r.starts.filter((s) => !s.scratched));
  const sources = {
    poster: runAll.filter((s) => s.statsSource === "poster").length,
    ogonblick: runAll.filter((s) => s.statsSource === "ogonblick").length,
    saknas: runAll.filter((s) => s.statsSource === "saknas").length,
    agree: runAll.filter((s) => s.statsAgree === true).length,
    disagree: runAll.filter((s) => s.statsAgree === false).length,
    leakChecked: runAll.filter((s) => s.statsLeak !== null).length,
    leak: runAll.filter((s) => s.statsLeak === true).length,
    noRecords: runAll.filter((s) => s.records.length === 0).length,
    fewRecords: runAll.filter((s) => s.records.length < 5 && (s.lifeStarts ?? 0) >= 5).length,
    driverMissing: runAll.filter((s) => !s.driver).length,
    trainerMissing: runAll.filter((s) => !s.trainer).length,
    noPlaceOdds: runAll.filter((s) => s.placeOdds === null).length,
  };
  console.table(byType);
  console.log(sources);
  if (o.onlyData) return;

  // Samma lopp för alla varianter: alla startande har streck och vinnarodds och
  // loppet har minst 4 startande.
  const races = loaded.filter((r) => {
    const run = r.starts.filter((s) => !s.scratched);
    return run.length >= 4 && run.every((s) => s.streck !== null && s.winOdds !== null);
  });
  const dropped = loaded.length - races.length;
  const { train, test, cut } = timeSplit(races, o.trainShare);
  console.log(`${races.length} lopp i utvärderingen (${dropped} utan streck/odds), träning ${train.length} (t.o.m. ${train[train.length - 1]?.date}), test ${test.length} (från ${cut})`);

  const params = (beta: number) => ({ ...V1_PARAMS, beta });
  const zAll = zRaces(races, V1_PARAMS, o.weights);
  const zTrain = zRaces(train, V1_PARAMS, o.weights);

  // β: sök på träningsdelen (och för information på hela).
  const betaTrain = searchBeta(zTrain, o.weights);
  const betaAll = searchBeta(zAll, o.weights);
  console.log(`Bästa β träning ${betaTrain.beta} (log loss ${f(betaTrain.logLoss, 4)}), hela ${betaAll.beta}`);

  // Vikter: utgå från v1 med bästa β inbakat i vikterna (β = 1), sök på träning.
  // Streck hålls utanför. spar är med när statistikbasen finns.
  const fitKeys: InputKey[] = ["plats", "vinst", "form", ...(post ? (["spar"] as const) : []), "kusk", "tranare", "galopp"];
  const startW = Object.fromEntries(INPUT_KEYS.map((k) => [k, Math.round(o.weights[k] * betaTrain.beta * 1000) / 1000])) as Weights;
  const t0 = Date.now();
  const fit = fitWeights(zTrain, startW, 1, fitKeys);
  console.log(`Anpassade vikter (${fit.evaluations} beräkningar, ${((Date.now() - t0) / 1000).toFixed(1)} s): ${w2(fit.weights)}`);
  // Med streck som extra indata (för information: hur mycket marknaden tillför).
  const zTrainS = zRacesWithStreck(train, o.weights);
  const zTestS = zRacesWithStreck(test, o.weights);
  const fitS = fitWeights(zTrainS, { ...fit.weights, streck: 0.5 }, 1, [...fitKeys, "streck"]);
  // Intjänade pengar (vinstsumma per start i livet) som extra indata, utan och med streck.
  const fitP = fitWeights(withPengar(zTrain), { ...fit.weights, [PENGAR]: 0 }, 1, [...fitKeys, PENGAR]);
  const fitSP = fitWeights(withPengar(zTrainS), { ...fitS.weights, [PENGAR]: 0 }, 1, [...fitKeys, "streck", PENGAR]);
  const zTest = zRaces(test, V1_PARAMS, o.weights);
  console.log(`Pengar: vikt ${f(fitP.weights[PENGAR], 2)} utan streck, ${f(fitSP.weights[PENGAR], 2)} med streck`);

  // Signalerna 1–6: en i taget ovanpå v2 (med streck) och modellen utan streck,
  // bara signalens vikt anpassas på träningsdelen. Sedan alla tillsammans.
  const ref = kmRef;
  const signals: SignalRow[] = [];
  const baseS = logLoss(zPreds(zTestS, V2_WEIGHTS, 1));
  const baseN = logLoss(zPreds(zTest, V2_NO_STRECK, 1));
  for (const k of EXTRA_KEYS) {
    const trS = withExtras(zTrainS, [k], ref);
    const teS = withExtras(zTestS, [k], ref);
    const trN = withExtras(zTrain, [k], ref);
    const teN = withExtras(zTest, [k], ref);
    const fs = fitWeights(trS, { ...V2_WEIGHTS, [k]: 0 } as Weights, 1, [k as InputKey]);
    const fn = fitWeights(trN, { ...V2_NO_STRECK, [k]: 0 } as Weights, 1, [k as InputKey]);
    const raw = test.flatMap((r) => extraFeatures(r, ref)[k]);
    signals.push({
      key: k,
      coverage: raw.filter((v) => v !== null && v !== 0).length,
      starts: raw.length,
      wS: (fs.weights as Record<string, number>)[k],
      dS: logLoss(zPreds(teS, fs.weights, 1)) - baseS,
      wN: (fn.weights as Record<string, number>)[k],
      dN: logLoss(zPreds(teN, fn.weights, 1)) - baseN,
    });
    console.log(`  ${k}: vikt ${f((fs.weights as Record<string, number>)[k], 2)} / ${f((fn.weights as Record<string, number>)[k], 2)}`);
  }
  const allS = fitWeights(withExtras(zTrainS, EXTRA_KEYS, ref), { ...V2_WEIGHTS, ...Object.fromEntries(EXTRA_KEYS.map((k) => [k, 0])) } as Weights, 1, [...(INPUT_KEYS as readonly InputKey[]), ...(EXTRA_KEYS as readonly string[] as InputKey[])]);
  const allN = fitWeights(withExtras(zTrain, EXTRA_KEYS, ref), { ...V2_NO_STRECK, ...Object.fromEntries(EXTRA_KEYS.map((k) => [k, 0])) } as Weights, 1, [...(INPUT_KEYS.filter((k) => k !== "streck") as InputKey[]), ...(EXTRA_KEYS as readonly string[] as InputKey[])]);

  // Kalibrering (Platt) av v2, anpassad på träningsdelen.
  const platt = fitPlatt(zPreds(zTrainS, V2_WEIGHTS, 1));
  const plattAll = fitPlatt(zPreds(withExtras(zTrainS, EXTRA_KEYS, ref), allS.weights, 1));
  console.log(`Platt v2: a ${f(platt.a, 3)} b ${f(platt.b, 3)}`);

  // v3: modellens egna indata (barfota, vila, galopp vid volte och tid finns nu i
  // computeRace). Alla vikter anpassas på träningsdelen, små vikter (< 0,03) sätts
  // till 0 och resten avrundas, sedan kalibreras med Platt och en övre gräns.
  const keysS = [...INPUT_KEYS] as InputKey[];
  const keysN = INPUT_KEYS.filter((k) => k !== "streck") as InputKey[];
  const simplify = (w: Weights) => Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Math.abs(v) < 0.03 ? 0 : Math.round(v * 100) / 100])) as Weights;
  const v3 = simplify(fitWeights(zTrainS, V2_WEIGHTS, 1, keysS).weights);
  const v3n = simplify(fitWeights(zTrain, V2_NO_STRECK, 1, keysN).weights);
  const plattV3 = fitPlatt(zPreds(zTrainS, v3, 1));
  const capV3 = 0.8;
  console.log(`v3: ${JSON.stringify(v3)}`);
  console.log(`v3 utan streck: ${JSON.stringify(v3n)}`);
  console.log(`v3 Platt: a ${plattV3.a.toFixed(3)} b ${plattV3.b.toFixed(3)}`);

  // Antal positiva signaler: topp 3 mot strecket (marknaden) och v3, på hela underlaget.
  const counts = signalCountAnalysis(races, cut);
  const troll = trollAnalysis(races, cut);
  console.log(`Mikaels regel (v3 ≥ 50 %, platsodds ≥ 2,0): ${troll.rules[0].n} spel, träff ${p1(troll.rules[0].hit)}, ROI ${signedPct(troll.rules[0].roi)}`);

  const fixed: { name: string; beta: number }[] = o.betas.map((b) => ({ name: `v1 β = ${String(b).replace(".", ",")}`, beta: b }));
  const variants: Variant[] = [
    ...fixed.map((v) => ({ name: v.name, kind: "modell" as const, test: modelPreds(test, o.weights, params(v.beta)), all: modelPreds(races, o.weights, params(v.beta)) })),
    { name: `v1 bästa β = ${String(betaTrain.beta).replace(".", ",")}`, kind: "modell", test: modelPreds(test, o.weights, params(betaTrain.beta)), all: modelPreds(races, o.weights, params(betaTrain.beta)) },
    { name: "Anpassade vikter (β = 1)", kind: "anpassad", test: modelPreds(test, fit.weights, params(1)), all: null },
    { name: "Anpassade vikter + streck", kind: "anpassad", test: zPreds(zTestS, fitS.weights, 1), all: null },
    { name: "Anpassade vikter + pengar", kind: "anpassad", test: zPreds(withPengar(zTest), fitP.weights, 1), all: null },
    { name: "Anpassade vikter + streck + pengar", kind: "anpassad", test: zPreds(withPengar(zTestS), fitSP.weights, 1), all: null },
    { name: "v2 (streck 0,88 · plats 0,10 · spår 0,03 · tränare 0,03)", kind: "anpassad", test: zPreds(zTestS, V2_WEIGHTS, 1), all: null },
    { name: "v2 kalibrerad", kind: "anpassad", test: applyPlatt(zPreds(zTestS, V2_WEIGHTS, 1), platt), all: null },
    { name: "v2 kalibrerad, Σ P3 = 3", kind: "anpassad", test: applyPlatt(zPreds(zTestS, V2_WEIGHTS, 1), platt, true), all: null },
    { name: "v2 + signaler", kind: "anpassad", test: zPreds(withExtras(zTestS, EXTRA_KEYS, ref), allS.weights, 1), all: null },
    { name: "v2 + signaler, kalibrerad", kind: "anpassad", test: applyPlatt(zPreds(withExtras(zTestS, EXTRA_KEYS, ref), allS.weights, 1), plattAll), all: null },
    { name: "Utan streck (v2)", kind: "anpassad", test: zPreds(zTest, V2_NO_STRECK, 1), all: null },
    { name: "v3 (rekommenderad i appen)", kind: "anpassad", test: applyPlatt(zPreds(zTestS, RECOMMENDED_WEIGHTS, 1), { a: RECOMMENDED_CALIBRATION.plattA, b: RECOMMENDED_CALIBRATION.plattB }, false, RECOMMENDED_CALIBRATION.maxP3), all: null },
    { name: "v3", kind: "anpassad", test: zPreds(zTestS, v3, 1), all: null },
    { name: "v3 kalibrerad", kind: "anpassad", test: applyPlatt(zPreds(zTestS, v3, 1), plattV3), all: null },
    { name: "v3 kalibrerad, högst 80 %", kind: "anpassad", test: applyPlatt(zPreds(zTestS, v3, 1), plattV3, false, capV3), all: null },
    { name: "v3 utan streck", kind: "anpassad", test: zPreds(zTest, v3n, 1), all: null },
    { name: "Utan streck + signaler", kind: "anpassad", test: zPreds(withExtras(zTest, EXTRA_KEYS, ref), allN.weights, 1), all: null },
    { name: "Marknaden (streck)", kind: "referens", test: marketPreds(test, "streck"), all: marketPreds(races, "streck") },
    { name: "Marknaden (vinnarodds)", kind: "referens", test: marketPreds(test, "vinnarodds"), all: marketPreds(races, "vinnarodds") },
    { name: "Naiv (alla lika)", kind: "referens", test: naivePreds(test), all: naivePreds(races) },
  ];

  const result: Result = {
    run: { at: new Date().toISOString(), from: o.from, to: o.to, types: o.types, source: o.source, cacheOnly: o.cacheOnly, skippedGames: skipped, post, firstRace: loaded[0]?.date ?? null, lastRace: loaded[loaded.length - 1]?.date ?? null, weights: o.weights, params: V1_PARAMS, trainShare: o.trainShare },
    data: { byType, sources, persons: personCheck(gameJsonOf(loaded, games)), evaluated: { races: races.length, dropped, train: train.length, test: test.length, testFrom: cut, trainTo: train[train.length - 1]?.date ?? "" } },
    beta: { train: betaTrain, all: betaAll },
    fit: { start: startW, weights: fit.weights, trainLogLoss: fit.logLoss, withStreck: fitS.weights, withPengar: fitP.weights, withStreckPengar: fitSP.weights },
    signals: { rows: signals, baseS, baseN, allS: allS.weights, allN: allN.weights, platt, plattAll, v3, v3n, plattV3, capV3 },
    counts,
    troll,
    variants: variants.map((v) => ({
      name: v.name,
      kind: v.kind,
      test: metrics(v.test),
      all: v.all ? metrics(v.all) : null,
      calibrationTest: calibration(v.test),
      calibrationAll: v.all ? calibration(v.all) : null,
      roiTest: Object.fromEntries(RATIOS.map((r) => [String(r), roiRule(v.test, r)])),
      roiAll: v.all ? Object.fromEntries(RATIOS.map((r) => [String(r), roiRule(v.all!, r)])) : null,
    })),
  };

  const md = report(result);
  fs.mkdirSync(path.resolve(ROOT, o.out), { recursive: true });
  const dir = path.resolve(ROOT, o.out);
  let base = path.join(dir, `${o.today}-${o.name}`);
  for (let i = 2; fs.existsSync(`${base}.md`) || fs.existsSync(`${base}.json`); i++) base = path.join(dir, `${o.today}-${o.name}-${i}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(result, null, 2));
  fs.writeFileSync(`${base}.md`, md);
  console.log(`Skrev ${path.relative(ROOT, base)}.md och .json`);
}

const RATIOS = [1, 1.2, 1.5];

// Modellen som rekommenderades 2026-10-20 (förenklad Anpassad + streck), β = 1.
const V2_WEIGHTS: Weights = { ...V1_WEIGHTS, plats: 0.1, vinst: 0, form: 0, spar: 0.03, kusk: 0, tranare: 0.03, galopp: 0, pengar: 0, streck: 0.88 };
const V2_NO_STRECK: Weights = { ...V1_WEIGHTS, plats: 0.1, vinst: 0.05, form: 0.15, spar: 0.17, kusk: 0.1, tranare: 0.1, galopp: 0.03, pengar: 0.38, streck: 0 };

// En grupp starter: antal, verklig topp 3-andel, strecket (marknaden) och v3:s
// förväntade andel, och avkastningen med 1 kr på plats i ATG:s platspool.
type Group = { label: string; n: number; top3: number; market: number; v3: number; poolN: number; roi: number };

function groupOf(label: string, rows: CountRow[]): Group {
  const n = rows.length;
  const pool = rows.filter((r) => r.hasPool);
  return {
    label,
    n,
    top3: n ? rows.filter((r) => r.y).length / n : NaN,
    market: n ? rows.reduce((a, r) => a + r.pMarket, 0) / n : NaN,
    v3: n ? rows.reduce((a, r) => a + r.pV3, 0) / n : NaN,
    poolN: pool.length,
    roi: pool.length ? pool.reduce((a, r) => a + r.payout, 0) / pool.length - 1 : NaN,
  };
}

type CountRow = { date: string; count: number; flags: Record<SignalKey, boolean>; y: boolean; pMarket: number; pV3: number; streckRank: number; payout: number; hasPool: boolean };

function signalCountAnalysis(races: BtRace[], testFrom: string) {
  const v3Params = { ...V1_PARAMS, beta: 1, ...RECOMMENDED_CALIBRATION };
  const rows: CountRow[] = [];
  for (const race of races) {
    const run = race.starts.filter((s) => !s.scratched);
    const flags = positiveSignals(race);
    const st = run.map((s) => Math.max(s.streck ?? 0, 1e-4));
    const sum = st.reduce((a, b) => a + b, 0);
    const pm = harvilleTop3(st.map((v) => v / sum));
    const v3 = computeRace(toFacts(race, true), RECOMMENDED_WEIGHTS, v3Params).map((r) => r.probTop3);
    const order = [...st.keys()].sort((a, b) => st[b] - st[a]);
    run.forEach((s, i) => {
      rows.push({
        date: race.date,
        count: SIGNAL_KEYS.filter((k) => flags[i][k]).length,
        flags: flags[i],
        y: s.top3,
        pMarket: pm[i],
        pV3: v3[i] ?? NaN,
        streckRank: order.indexOf(i) + 1,
        payout: s.placePayout,
        hasPool: race.placesPaid !== null && s.placeOdds !== null,
      });
    });
  }
  const byCount = [0, 1, 2, 3, 4, 5, 6].map((c) => groupOf(c === 6 ? "6+" : String(c), rows.filter((r) => (c === 6 ? r.count >= 6 : r.count === c))));
  const bySignal = SIGNAL_KEYS.map((k) => groupOf(k, rows.filter((r) => r.flags[k])));
  const low = (min: number, rows2: CountRow[]) => rows2.filter((r) => r.count >= min && r.streckRank >= 4);
  const train = rows.filter((r) => r.date < testFrom);
  const test = rows.filter((r) => r.date >= testFrom);
  const lowStreck = [4, 5, 6].flatMap((m) => [groupOf(`minst ${m}, streck 4:e+ · träning`, low(m, train)), groupOf(`minst ${m}, streck 4:e+ · test`, low(m, test))]);
  return { starts: rows.length, byCount, bySignal, lowStreck, all: groupOf("Alla", rows) };
}

// ---- Mikaels regel och Trollspöt (backtest 2026-10-20) ----------------------------------------
//
// ATG:s platsodds (platspoolens slutodds) får stå i för Unibets fasta odds.
// v3 = den rekommenderade modellen med kalibrering. Marknadens chans ur strecket.

type TrollRow = { gameId: string; date: string; p: number; pm: number; odds: number | null; payout: number; y: boolean; count: number };
type RuleResult = { label: string; n: number; perRound: number; hit: number; meanOdds: number; roi: number; roiTest: number; nTest: number };

function trollAnalysis(races: BtRace[], testFrom: string) {
  const v3Params = { ...V1_PARAMS, beta: 1, ...RECOMMENDED_CALIBRATION };
  const rows: TrollRow[] = [];
  for (const race of races) {
    if (race.placesPaid === null) continue;
    const run = race.starts.filter((s) => !s.scratched);
    const st = run.map((s) => Math.max(s.streck ?? 0, 1e-4));
    const sum = st.reduce((a, b) => a + b, 0);
    const pm = harvilleTop3(st.map((v) => v / sum));
    const p = computeRace(toFacts(race, true), RECOMMENDED_WEIGHTS, v3Params).map((r) => r.probTop3);
    const flags = positiveSignals(race);
    run.forEach((s, i) =>
      rows.push({ gameId: race.gameId, date: race.date, p: p[i] ?? 0, pm: pm[i], odds: s.placeOdds, payout: s.placePayout, y: s.top3, count: SIGNAL_KEYS.filter((k) => flags[i][k]).length }),
    );
  }
  const rounds = new Set(rows.map((r) => r.gameId)).size;
  const roundsTest = new Set(rows.filter((r) => r.date >= testFrom).map((r) => r.gameId)).size;
  const res = (label: string, sel: TrollRow[]): RuleResult => {
    const test = sel.filter((r) => r.date >= testFrom);
    const roi = (xs: TrollRow[]) => (xs.length ? xs.reduce((a, r) => a + r.payout, 0) / xs.length - 1 : NaN);
    return {
      label,
      n: sel.length,
      perRound: sel.length / rounds,
      hit: sel.length ? sel.filter((r) => r.y).length / sel.length : NaN,
      meanOdds: sel.length ? sel.reduce((a, r) => a + (r.odds ?? 0), 0) / sel.length : NaN,
      roi: roi(sel),
      roiTest: roi(test),
      nTest: test.length,
    };
  };
  const withOdds = rows.filter((r) => r.odds !== null);
  const rules = [
    res("Chans ≥ 50 % och odds ≥ 2,0 (Mikaels regel)", withOdds.filter((r) => r.p >= 0.5 && (r.odds as number) >= 2)),
    res("Chans ≥ 45 % och odds ≥ 2,0", withOdds.filter((r) => r.p >= 0.45 && (r.odds as number) >= 2)),
    res("Chans ≥ 40 % och odds ≥ 2,0", withOdds.filter((r) => r.p >= 0.4 && (r.odds as number) >= 2)),
    res("Chans × odds ≥ 1,0 och odds ≥ 2,0", withOdds.filter((r) => r.p * (r.odds as number) >= 1 && (r.odds as number) >= 2)),
    res("Chans × odds ≥ 1,1 och odds ≥ 2,0", withOdds.filter((r) => r.p * (r.odds as number) >= 1.1 && (r.odds as number) >= 2)),
    res("Chans × odds ≥ 1,2 och odds ≥ 2,0", withOdds.filter((r) => r.p * (r.odds as number) >= 1.2 && (r.odds as number) >= 2)),
    res("Alla hästar med odds ≥ 2,0 (referens)", withOdds.filter((r) => (r.odds as number) >= 2)),
  ];

  // Trollspöt före oddsen: uppskattat platsodds ur strecket (k / marknadens chans,
  // k = medianen av platsodds × marknadens chans), hästar med uppskattat odds
  // minst 1,8, rankade på olika sätt, de 10 bästa per omgång.
  const prod = withOdds.map((r) => (r.odds as number) * r.pm).sort((a, b) => a - b);
  const k = prod[Math.floor(prod.length / 2)];
  const est = (r: TrollRow) => k / Math.max(r.pm, 1e-4);
  const byRound = new Map<string, TrollRow[]>();
  for (const r of withOdds) (byRound.get(r.gameId) ?? byRound.set(r.gameId, []).get(r.gameId)!).push(r);
  const top10 = (score: (r: TrollRow) => number, minEst = 1.8) => [...byRound.values()].flatMap((rs) => rs.filter((r) => est(r) >= minEst).sort((a, b) => score(b) - score(a)).slice(0, 10));
  const rankings: { label: string; sel: TrollRow[] }[] = [
    { label: "Chans × uppskattat odds (förväntat värde)", sel: top10((r) => r.p * est(r)) },
    { label: "Modellens fördel mot strecket (chans / marknadens chans)", sel: top10((r) => r.p / r.pm) },
    { label: "Högst chans", sel: top10((r) => r.p) },
    { label: "Flest signaler, sedan chans", sel: top10((r) => r.count + r.p) },
  ];
  const troll = rankings.flatMap(({ label, sel }) => [
    res(`${label} · alla 10`, sel),
    res(`${label} · sedan odds ≥ 2,0 och ≥ riktodds`, sel.filter((r) => (r.odds as number) >= 2 && (r.odds as number) >= 1 / r.p)),
  ]);
  return { rounds, roundsTest, k, rules, troll };
}

type SignalRow = { key: string; coverage: number; starts: number; wS: number; dS: number; wN: number; dN: number };

type PostInfo = { from: string; to: string; races: number; starts: number; withPost: number };

// Statistikbasen ur databasen → plats % per startnummer på varje lopp i underlaget.
async function loadPosts(url: string, races: BtRace[]): Promise<PostInfo | null> {
  if (!url) {
    console.warn("Spår: ingen databas (sätt DATABASE_URL eller --spar-db), spåret prövas inte");
    return null;
  }
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const rows = await db.$queryRawUnsafe<{ raceId: string; date: Date; method: "AUTO" | "VOLTE"; distance: number; number: number; place: number | null; scratched: boolean }[]>(
      `SELECT s."raceId", r."date", r."startMethod"::text AS method, r."distance", s."number", s."place", s."scratched"
       FROM "spelvarde"."HistStart" s JOIN "spelvarde"."HistRace" r ON r."id" = s."raceId"`,
    );
    if (!rows.length) {
      console.warn("Spår: statistikbasen är tom, spåret prövas inte");
      return null;
    }
    const hist: HistRow[] = rows.map((r) => ({ ...r, date: r.date.toISOString().slice(0, 10) }));
    const dates = hist.map((r) => r.date).sort();
    const withPost = attachPosts(races, makePostIndex(hist));
    return { from: dates[0], to: dates[dates.length - 1], races: new Set(hist.map((r) => r.raceId)).size, starts: races.flatMap((r) => r.starts.filter((s) => !s.scratched)).length, withPost };
  } finally {
    await db.$disconnect();
  }
}

type VariantResult = {
  name: string;
  kind: "modell" | "anpassad" | "referens";
  test: Metrics;
  all: Metrics | null;
  calibrationTest: Bucket[];
  calibrationAll: Bucket[] | null;
  roiTest: Record<string, ReturnType<typeof roiRule>>;
  roiAll: Record<string, ReturnType<typeof roiRule>> | null;
};

type Result = {
  run: { at: string; from: string; to: string; types: string[]; source: StatsSource; cacheOnly: boolean; skippedGames: number; post: PostInfo | null; firstRace: string | null; lastRace: string | null; weights: Weights; params: typeof V1_PARAMS; trainShare: number };
  data: {
    byType: { type: string; rounds: number; calendarRounds: number; races: number; starts: number; from: string | null; to: string | null }[];
    sources: Record<string, number>;
    persons: ReturnType<typeof personCheck>;
    evaluated: { races: number; dropped: number; train: number; test: number; testFrom: string; trainTo: string };
  };
  beta: { train: ReturnType<typeof searchBeta>; all: ReturnType<typeof searchBeta> };
  fit: { start: Weights; weights: Weights; trainLogLoss: number; withStreck: Weights; withPengar: Weights; withStreckPengar: Weights };
  signals: { rows: SignalRow[]; baseS: number; baseN: number; allS: Weights; allN: Weights; platt: Platt; plattAll: Platt; v3: Weights; v3n: Weights; plattV3: Platt; capV3: number };
  counts: ReturnType<typeof signalCountAnalysis>;
  troll: ReturnType<typeof trollAnalysis>;
  variants: VariantResult[];
};

function zRacesWithStreck(races: BtRace[], weights: Weights) {
  // computeRace med streck påslaget: z för streck finns då i inputs.z.
  return zRaces(races, V1_PARAMS, weights, true);
}

// Spelens råa JSON för personkontrollen (läses från cachen).
function gameJsonOf(races: BtRace[], games: CalendarEntry[]): unknown[] {
  const ids = new Set(races.map((r) => r.gameId));
  return games.filter((g) => ids.has(g.id)).map((g) => {
    const file = cacheFile(atgPaths.game(g.id));
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  });
}

// Är kuskens och tränarens statistik i games/<id> från loppdagen? Då växer
// årets starter med datumet för samma person. Räknar par av olika dagar samma år.
function personCheck(gameJsons: unknown[]) {
  type Seen = { date: string; starts: number };
  const seen = new Map<string, Seen[]>();
  const add = (key: string, date: string, starts: unknown) => {
    if (typeof starts !== "number") return;
    const list = seen.get(key) ?? [];
    if (!list.some((x) => x.date === date)) list.push({ date, starts });
    seen.set(key, list);
  };
  for (const g of gameJsons) {
    for (const r of ((g as { races?: unknown[] } | null)?.races ?? []) as { date?: string; starts?: { driver?: { id?: number; statistics?: { years?: Record<string, { starts?: number }> } }; horse?: { trainer?: { id?: number; statistics?: { years?: Record<string, { starts?: number }> } } } }[] }[]) {
      const date = r.date;
      if (!date) continue;
      const y = date.slice(0, 4);
      for (const s of r.starts ?? []) {
        if (s.driver?.id) add(`k${s.driver.id}|${y}`, date, s.driver.statistics?.years?.[y]?.starts);
        if (s.horse?.trainer?.id) add(`t${s.horse.trainer.id}|${y}`, date, s.horse.trainer.statistics?.years?.[y]?.starts);
      }
    }
  }
  let up = 0;
  let same = 0;
  let down = 0;
  for (const list of seen.values()) {
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    for (let i = 1; i < list.length; i++) {
      if (list[i].starts > list[i - 1].starts) up++;
      else if (list[i].starts === list[i - 1].starts) same++;
      else down++;
    }
  }
  return { pairs: up + same + down, up, same, down };
}

function report(r: Result): string {
  const d = r.data;
  const s = d.sources;
  const ev = d.evaluated;
  const fixedModels = r.variants.filter((v) => v.kind === "modell");
  const models = r.variants.filter((v) => v.kind !== "referens" && !v.name.includes("streck"));
  const best = models.reduce((a, b) => (b.test.logLoss < a.test.logLoss ? b : a));
  const v1 = r.variants[0];
  const pctOf = (a: number, b: number) => (b ? p1(a / b) : "–");
  const lines: string[] = [];
  const L = (x = "") => lines.push(x);

  L(`# Backtest riktodds v1 – ${r.run.at.slice(0, 10)}`);
  L();
  L(`Skapad av \`npm run backtest\` (scripts/backtest.ts). Spelformer ${r.run.types.join(", ")}, ${r.run.from} – ${r.run.to}. Hästens år/fjol: ${r.run.source === "ogonblick" ? "ögonblicksbilden i games/<id>" : "räknat från posterna"}. Grundvikter: ${w2(r.run.weights)}.`);
  L();
  L("## Underlag");
  L();
  L(`Lopp med i analysen: ${r.run.firstRace ?? "–"} – ${r.run.lastRace ?? "–"}.${r.run.cacheOnly ? ` Körd med --bara-cache: inget hämtades, ${r.run.skippedGames} spel med resultat i intervallet hoppades över eftersom de saknades helt eller delvis i cachen.` : ""}`);
  L();
  L("| Spelform | Omgångar | Lopp | Starter | Från | Till |\n|---|---:|---:|---:|---|---|");
  for (const t of d.byType) L(`| ${t.type} | ${t.rounds} | ${t.races} | ${t.starts} | ${t.from ?? "–"} | ${t.to ?? "–"} |`);
  const tot = d.byType.reduce((a, t) => ({ rounds: a.rounds + t.rounds, races: a.races + t.races, starts: a.starts + t.starts }), { rounds: 0, races: 0, starts: 0 });
  L(`| **Summa** | ${tot.rounds} | ${tot.races} | ${tot.starts} | | |`);
  L();
  L(`Utvärderas: ${ev.races} lopp med minst 4 startande där alla har streck och vinnarodds (${ev.dropped} lopp bort). Tidsmässig delning: träning ${ev.train} lopp t.o.m. ${ev.trainTo}, test ${ev.test} lopp från ${ev.testFrom}.`);
  L();
  L("## Läckage och det som saknas");
  L();
  L(`- Tidigare starter: bara poster med datum före loppdagen (strukna borträknade), högst 5 för form och galopp. ${s.noRecords} starter saknar tidigare poster helt, ${s.fewRecords} har färre än 5 poster trots minst 5 starter i livet.`);
  L(`- Hästens år/fjol: ögonblicksbilden i \`games/<id>\` stämde exakt med posterna före loppet i ${s.agree} av ${s.agree + s.disagree} starter där posterna räcker bakåt (${pctOf(s.agree, s.agree + s.disagree)}); avvikelserna är kvallopp och utländska lopp som posterna och ATG räknar olika. Ögonblicksbilden räknade med senare starter i ${s.leak} av ${s.leakChecked} kontrollerbara fall. Källa: ögonblick ${s.ogonblick}, poster ${s.poster}, saknas ${s.saknas}.`);
  L(`- Kusk och tränare: ögonblicksbilden i \`games/<id>\`. Samma person på två olika dagar samma år: fler starter senare i ${d.persons.up} par, lika i ${d.persons.same}, färre i ${d.persons.down} (av ${d.persons.pairs}). Saknas: kusk ${s.driverMissing}, tränare ${s.trainerMissing} starter (= fältets medel).`);
  if (r.run.post) {
    const pi = r.run.post;
    L(`- Spår: startnumrets plats % (topp 3) på loppets distans och startmetod ur statistikbasen (alla svenska travlopp ${pi.from} – ${pi.to}, ${pi.races} lopp), bara lopp under två år före loppdagen. Exakt distans med minst 150 lopp, annars distansgruppen. ${pi.withPost} av ${pi.starts} starter fick ett värde (${pctOf(pi.withPost, pi.starts)}); övriga har \`spar\` = 0.`);
  } else L("- Spår: inte prövat i den här körningen (--utan-spar): `spar` = 0 för alla.");
  L("- Streck används inte i modellen (vikt 0), bara i referensen Marknaden (streck) och i den extra varianten med streck.");
  L();
  L("## Mått, testdelen");
  L();
  L(metricsTable(r.variants.map((v) => ({ name: v.name, m: v.test }))));
  L();
  L("## Mått, hela underlaget (varianter utan anpassning)");
  L();
  L(metricsTable(r.variants.filter((v) => v.all).map((v) => ({ name: v.name, m: v.all! }))));
  L();
  L("## β");
  L();
  L(`Bästa β på träningsdelen: **${f(r.beta.train.beta, 2)}** (log loss ${f(r.beta.train.logLoss, 4)}). På hela underlaget: ${f(r.beta.all.beta, 2)}.`);
  L();
  L("| β | Log loss (träning) |\n|---:|---:|");
  for (const c of r.beta.train.curve.filter((_, i) => i % 2 === 0)) L(`| ${f(c.beta, 2)} | ${f(c.logLoss, 4)} |`);
  L();
  L("## Anpassade vikter");
  L();
  L(`Koordinatvis sökning på log loss för träningsdelen med β = 1 (β bakas in i vikterna; streck hålls utanför${r.run.post ? ", spår är med" : ", spår och streck hålls utanför"}).`);
  L();
  L("| Indata | v1 | v1 × bästa β | Anpassad | Anpassad + streck | Anpassad + pengar | Anpassad + streck + pengar |\n|---|---:|---:|---:|---:|---:|---:|");
  for (const k of INPUT_KEYS)
    L(`| ${k} | ${f(r.run.weights[k] ?? 0, 2)} | ${f(r.fit.start[k] ?? 0, 2)} | ${f(r.fit.weights[k] ?? 0, 2)} | ${f(r.fit.withStreck[k] ?? 0, 2)} | ${f(r.fit.withPengar[k] ?? 0, 2)} | ${f(r.fit.withStreckPengar[k] ?? 0, 2)} |`);
  L();
  L("pengar = log(1 + hästens vinstsumma per start i livet), z inom loppet. Vinstsumman är ögonblicksbilden i games/<id>, samma som år/fjol.");
  L();
  L(`Bästa modellvariant på testdelen (utan streck): **${best.name}**, log loss ${f(best.test.logLoss, 4)} mot ${f(v1.test.logLoss, 4)} för ${v1.name}.`);
  L();
  const sg = r.signals;
  L("## Signaler (skor, vagn, kuskbyte, klass, vila, galopp vid volte, tid)");
  L();
  L(`En signal i taget: bara dess vikt anpassas på träningsdelen, ovanpå v2 (med streck, log loss ${f(sg.baseS, 4)}) och modellen utan streck (log loss ${f(sg.baseN, 4)}). Δ = ändring i log loss på testdelen (negativt = bättre). Andel = starter i testdelen där signalen inte är 0.`);
  L();
  L("| Signal | Andel | Vikt med streck | Δ med streck | Vikt utan streck | Δ utan streck |\n|---|---:|---:|---:|---:|---:|");
  for (const x of sg.rows) L(`| ${x.key} | ${pctOf(x.coverage, x.starts)} | ${f(x.wS, 2)} | ${f(x.dS, 4)} | ${f(x.wN, 2)} | ${f(x.dN, 4)} |`);
  L();
  const ws = (w: Weights) => Object.entries(w).filter(([, v]) => Math.abs(v) >= 0.005).map(([k, v]) => `${k} ${f(v, 2)}`).join(" · ");
  L(`Alla tillsammans, med streck: ${ws(sg.allS)}.`);
  L();
  L(`Alla tillsammans, utan streck: ${ws(sg.allN)}.`);
  L();
  L(`**v3** (indata i modellen, små vikter satta till 0): med streck ${ws(sg.v3)}; utan streck ${ws(sg.v3n)}; kalibrering a ${f(sg.plattV3.a, 3)}, b ${f(sg.plattV3.b, 3)}, högst ${p1(sg.capV3)}.`);
  L();
  L(`Platt-kalibrering av v2: P3' = sigmoid(${f(sg.platt.a, 3)} + ${f(sg.platt.b, 3)} · logit(P3)). För v2 + signaler: a ${f(sg.plattAll.a, 3)}, b ${f(sg.plattAll.b, 3)}.`);
  L();
  const cal = r.variants.find((v) => v.name === "v2 kalibrerad");
  const v2v = r.variants.find((v) => v.name.startsWith("v2 (streck"));
  if (cal && v2v) {
    L("### Kalibrering, v2 före och efter (testdelen)");
    L();
    L("| P3-hink | Antal före | Verklig före | Antal efter | Verklig efter |\n|---|---:|---:|---:|---:|");
    v2v.calibrationTest.forEach((b, i) => {
      const c = cal.calibrationTest[i];
      L(`| ${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)} % | ${b.n} | ${p1(b.actual)} (förv. ${p1(b.expected)}) | ${c.n} | ${p1(c.actual)} (förv. ${p1(c.expected)}) |`);
    });
    L();
  }
  const ct = r.counts;
  const gTable = (gs: Group[]) => {
    L("| Grupp | Starter | Topp 3 verklig | Strecket säger | v3 säger | Verklig / streck | ROI platspool |\n|---|---:|---:|---:|---:|---:|---:|");
    for (const g of gs) L(`| ${g.label} | ${g.n} | ${p1(g.top3)} | ${p1(g.market)} | ${p1(g.v3)} | ${f(g.top3 / g.market, 2)} | ${signedPct(g.roi)} (${g.poolN}) |`);
    L();
  };
  const tr = r.troll;
  const rTable = (rs: RuleResult[]) => {
    L("| Regel | Spel | Per omgång | Träff | Medelodds | ROI | ROI testdelen (spel) |\n|---|---:|---:|---:|---:|---:|---:|");
    for (const x of rs) L(`| ${x.label} | ${x.n} | ${f(x.perRound, 1)} | ${p1(x.hit)} | ${f(x.meanOdds, 2)} | ${signedPct(x.roi)} | ${signedPct(x.roiTest)} (${x.nTest}) |`);
    L();
  };
  L("## Mikaels regel och Trollspöt");
  L();
  L(`${tr.rounds} omgångar (${tr.roundsTest} i testdelen). ATG:s platsodds står i för Unibets. Chans = v3 med kalibrering. ROI = 1 kr per spel med verklig utdelning. OBS: v3:s vikter är anpassade på träningsdelen, så ROI på hela underlaget är något för optimistisk; testdelen är den ärliga siffran.`);
  L();
  L("### Spelregler när oddsen är kända");
  L();
  rTable(tr.rules);
  L(`### Trollspöt: 10 hästar per omgång innan oddsen är kända`);
  L();
  L(`Uppskattat platsodds = ${f(tr.k, 2)} / marknadens chans ur strecket. Bara hästar med uppskattat odds minst 1,8. Raden "sedan odds ≥ 2,0 och ≥ riktodds" är de av de 10 som hade blivit spel när oddsen kom.`);
  L();
  rTable(tr.troll);
  L("## Antal positiva signaler");
  L();
  L(`Hela underlaget (${ct.starts} starter). Signalerna: spår (plats % minst 15 % över medel), tid (extrem), kusk och tränare (vinst % i fältets topp 3), barfota, plats minst 75 %, vinst minst 50 %, form (minst 2 ettor/tvåor av 5), pengar (per start i fältets topp 3), felfri (ingen galopp i 5). "Strecket säger" = chans till topp 3 ur strecket (Harville). Verklig / streck över 1 betyder att marknaden underskattar gruppen.`);
  L();
  L("### Per antal signaler");
  L();
  gTable(ct.byCount);
  L("### Per signal");
  L();
  gTable(ct.bySignal);
  L("### Många signaler men lågt streck (inte bland loppets 3 mest streckade)");
  L();
  gTable(ct.lowStreck);
  L(`## Kalibrering, ${best.name} (testdelen)`);
  L();
  L(calibrationTable(best.calibrationTest));
  L();
  L(`## Kalibrering, ${v1.name} (hela underlaget)`);
  L();
  L(calibrationTable(v1.calibrationAll ?? v1.calibrationTest));
  L();
  L("## Avkastning: spela plats när marknadens platsodds > riktodds");
  L();
  L("1 kr per spel i ATG:s platspool; marknadens odds är platspoolens slutodds (minOdds efter loppet), utdelningen är den verkliga.");
  L();
  for (const ratio of RATIOS) {
    L(`### Platsodds > ${String(ratio).replace(".", ",")} × riktodds, testdelen`);
    L();
    L(roiTable([...r.variants.map((v) => ({ name: v.name, r: v.roiTest[String(ratio)].total })), { name: "Alla hästar (referens)", r: v1.roiTest[String(ratio)].all }]));
    L();
  }
  L("### Hela underlaget, platsodds > riktodds");
  L();
  L(roiTable([...fixedModels.map((v) => ({ name: v.name, r: v.roiAll!["1"].total })), { name: "Alla hästar (referens)", r: v1.roiAll!["1"].all }]));
  L();
  L(`### Oddsintervall, ${best.name} (testdelen)`);
  L();
  L(bandsTable(best.roiTest["1"].bands));
  L();
  L(`### Oddsintervall, ${v1.name} (hela underlaget)`);
  L();
  L(bandsTable(v1.roiAll!["1"].bands));
  L();
  return lines.join("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
