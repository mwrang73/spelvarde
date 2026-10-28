// Favoriträttning (backtest 2026-10-28): storfavoriter är överstreckade och v3
// ärver det via streckvikten 0,86. Prövar rättningar på samma underlag och samma
// tränings-/testdelning som scripts/backtest.ts, bara ur .backtest-cache/.
//
//   npx vite-node --config vitest.config.ts scripts/favoritratt.ts -- [--spar-db <url>] [--ut <json>]
//
// Spåret läses ur statistikbasen i den lokala databasen (standard DATABASE_URL).
// Skriptet vägrar köra mot något annat än 127.0.0.1/localhost.

import fs from "node:fs";
import path from "node:path";
import { atgPaths } from "@/lib/atg";
import {
  applyPlatt,
  attachPosts,
  buildRaces,
  calendarGames,
  calibration,
  fitPlatt,
  fitWeights,
  logLoss,
  makePostIndex,
  marketPreds,
  metrics,
  modelPreds,
  timeSplit,
  zPreds,
  zRaces,
  type BtRace,
  type HistRow,
  type Platt,
  type Pred,
  type ZRace,
} from "@/lib/backtest";
import { harvilleTop3, INPUT_KEYS, RECOMMENDED_CALIBRATION, RECOMMENDED_NO_STRECK, RECOMMENDED_WEIGHTS, softmax, V1_PARAMS, V1_WEIGHTS, V3_CALIBRATION, V3_WEIGHTS, type InputKey, type Weights } from "@/lib/riktodds";
import { addDaysToDateString } from "@/lib/stockholm-time";

const ROOT = process.cwd();
const CACHE = path.join(ROOT, ".backtest-cache");
const FROM = "2025-01-01";
const TO = "2026-10-18";
const TYPES = ["V85", "V75", "V86", "GS75"];

const argv = process.argv.slice(2);
const get = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const readCache = (p: string): unknown | undefined => {
  const file = path.join(CACHE, `${p.replace(/[^\w.-]/g, "_")}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : undefined;
};

function loadRaces(): BtRace[] {
  const days: string[] = [];
  for (let d = FROM; d <= TO; d = addDaysToDateString(d, 1)) days.push(d);
  const games = days.flatMap((d) => calendarGames(readCache(atgPaths.calendarDay(d)) ?? null, TYPES)).filter((g) => g.status === "results");
  const seen = new Set<string>();
  const races: BtRace[] = [];
  for (const g of games) {
    const json = readCache(atgPaths.game(g.id));
    if (!json) continue;
    let incomplete = false;
    const detail = new Map<string, unknown>();
    for (const r of ((json as { races?: unknown[] }).races ?? []) as { id?: string; status?: string; starts?: { number?: number; scratched?: boolean }[] }[]) {
      if (!r.id || r.status !== "results") continue;
      for (const s of r.starts ?? []) {
        if (typeof s.number !== "number" || s.scratched) continue;
        const d = readCache(atgPaths.start(r.id, s.number));
        if (d === undefined) incomplete = true;
        else detail.set(`${r.id}/${s.number}`, d);
      }
    }
    if (incomplete) continue;
    for (const r of buildRaces(json, g.gameType, (id, n) => detail.get(`${id}/${n}`) ?? null, "ogonblick")) {
      if (seen.has(r.key)) continue;
      seen.add(r.key);
      races.push(r);
    }
  }
  races.sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date < b.date ? -1 : 1));
  return races;
}

async function loadPosts(url: string, races: BtRace[]) {
  if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error("Bara den lokala databasen (127.0.0.1) får användas");
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const rows = await db.$queryRawUnsafe<{ raceId: string; date: Date; method: "AUTO" | "VOLTE"; distance: number; number: number; place: number | null; scratched: boolean }[]>(
      `SELECT s."raceId", r."date", r."startMethod"::text AS method, r."distance", s."number", s."place", s."scratched"
       FROM "spelvarde"."HistStart" s JOIN "spelvarde"."HistRace" r ON r."id" = s."raceId"`,
    );
    const hist: HistRow[] = rows.map((r) => ({ ...r, date: r.date.toISOString().slice(0, 10) }));
    return attachPosts(races, makePostIndex(hist));
  } finally {
    await db.$disconnect();
  }
}

// ---- Kandidaterna: nya z-värden inom loppet ur strecket --------------------------------------

const zIn = (vals: number[]) => {
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length);
  return vals.map((v) => (sd > 1e-12 ? (v - m) / sd : 0));
};

type Feat = (st: number[]) => number[];
const FEATS: Record<string, Feat> = {
  // log-streck i kvadrat
  logKvadrat: (st) => st.map((s) => Math.log(s) ** 2),
  // strecket som andel (linjärt) bredvid log-strecket
  andel: (st) => st.map((s) => s / 100),
  // loppets mest streckade
  mestStreckad: (st) => {
    const mx = Math.max(...st);
    return st.map((s) => (s === mx ? 1 : 0));
  },
  over30: (st) => st.map((s) => (s >= 30 ? 1 : 0)),
  over40: (st) => st.map((s) => (s >= 40 ? 1 : 0)),
  over50: (st) => st.map((s) => (s >= 50 ? 1 : 0)),
  // överskott av log-streck över 30 %
  overLog30: (st) => st.map((s) => Math.max(0, Math.log(s / 30))),
};
// Utan z-skalning: log-streck centrerat i loppet (samma skala i alla lopp).
const RAW: Record<string, Feat> = {
  logRa: (st) => st.map((s) => Math.log(s / 100)),
};
const FEAT_KEYS = [...Object.keys(FEATS), ...Object.keys(RAW)];

function withFeat(zr: ZRace[], keys: string[]): ZRace[] {
  return zr.map(({ race, z }) => {
    const st = race.starts.filter((s) => !s.scratched).map((s) => Math.max(s.streck ?? 0, 0.01));
    const add = z.map((zi) => ({ ...zi }) as Record<string, number>);
    for (const k of keys) {
      if (RAW[k]) {
        const v = RAW[k](st);
        const m = v.reduce((a, b) => a + b, 0) / v.length;
        v.forEach((x, i) => (add[i][k] = x - m));
      } else zIn(FEATS[k](st)).forEach((v, i) => (add[i][k] = v));
    }
    return { race, z: add as Record<InputKey, number>[] };
  });
}

// Bootstrap över lopp: 95 % intervall för Δ log loss (b − a).
function bootDelta(a: Pred[], b: Pred[], n = 2000): { lo: number; hi: number } {
  const per = new Map<string, { d: number; k: number }>();
  const cl = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));
  const ll = (x: Pred) => -(x.y ? Math.log(cl(x.p)) : Math.log(1 - cl(x.p)));
  a.forEach((x, i) => {
    if (b[i].raceKey !== x.raceKey) throw new Error("olika ordning");
    const e = per.get(x.raceKey) ?? { d: 0, k: 0 };
    e.d += ll(b[i]) - ll(x);
    e.k++;
    per.set(x.raceKey, e);
  });
  const rs = [...per.values()];
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out: number[] = [];
  for (let it = 0; it < n; it++) {
    let d = 0;
    let k = 0;
    for (let j = 0; j < rs.length; j++) {
      const r = rs[Math.floor(rnd() * rs.length)];
      d += r.d;
      k += r.k;
    }
    out.push(d / k);
  }
  out.sort((x, y) => x - y);
  return { lo: out[Math.floor(n * 0.025)], hi: out[Math.floor(n * 0.975)] };
}

const cal = (preds: Pred[], c: Platt, max: number) => applyPlatt(preds, c, false, max);
const f4 = (x: number) => x.toFixed(4);

// Vinstchans (softmax) och P3 för streckfavoriten per lopp.
function favRows(zr: ZRace[], w: Weights, c: Platt, max: number) {
  return zr.map(({ race, z }) => {
    const run = race.starts.filter((s) => !s.scratched);
    const keys = Object.keys(w) as InputKey[];
    const s = z.map((zi) => keys.reduce((a, k) => a + (w[k] ?? 0) * (zi[k] ?? 0), 0));
    const pi = softmax(s, 1);
    const p3 = harvilleTop3(pi).map((p) => Math.min(max, 1 / (1 + Math.exp(-(c.a + c.b * Math.log(Math.min(1 - 1e-6, Math.max(1e-6, p)) / (1 - Math.min(1 - 1e-6, Math.max(1e-6, p)))))))));
    const st = run.map((x) => x.streck ?? 0);
    const sum = st.reduce((a, b) => a + b, 0);
    const fi = st.indexOf(Math.max(...st));
    const fav = run[fi];
    const odds = run.map((x) => (x.winOdds && x.winOdds > 0 ? 1 / x.winOdds : 0));
    const osum = odds.reduce((a, b) => a + b, 0);
    return {
      date: race.date,
      gameId: race.gameId,
      streck: st[fi] / sum,
      win: fav.place === 1 && !fav.disqualified ? 1 : 0,
      top3: fav.top3 ? 1 : 0,
      pi: pi[fi],
      p3: p3[fi],
      pmTop3: harvilleTop3(st.map((v) => Math.max(v, 1e-4) / sum))[fi],
      oddsWin: odds[fi] / osum,
    };
  });
}

async function main() {
  const loaded = loadRaces();
  const url = get("spar-db") ?? process.env.DATABASE_URL ?? "";
  const withPost = await loadPosts(url, loaded);
  const races = loaded.filter((r) => {
    const run = r.starts.filter((s) => !s.scratched);
    return run.length >= 4 && run.every((s) => s.streck !== null && s.winOdds !== null);
  });
  const { train, test, cut } = timeSplit(races, 0.7);
  console.log(`${races.length} lopp, träning ${train.length}, test ${test.length} från ${cut}, spår ${withPost}`);

  const zTr = zRaces(train, V1_PARAMS, V1_WEIGHTS, true);
  const zTe = zRaces(test, V1_PARAMS, V1_WEIGHTS, true);
  const recCal: Platt = { a: V3_CALIBRATION.plattA, b: V3_CALIBRATION.plattB };
  const MAX = V3_CALIBRATION.maxP3;
  const basePreds = cal(zPreds(zTe, V3_WEIGHTS, 1), recCal, MAX);
  const base = logLoss(basePreds);
  console.log(`v3 rekommenderad, test: ${f4(base)}`);

  const out: Record<string, unknown> = { races: races.length, train: train.length, test: test.length, cut, base };
  const rows: { name: string; w: Weights; platt: Platt; max: number; ll: number; delta: number; lo: number; hi: number; trainLl: number }[] = [];
  const evalVariant = (name: string, trZ: ZRace[], teZ: ZRace[], w: Weights, max = MAX, platt?: Platt) => {
    const pl = platt ?? fitPlatt(zPreds(trZ, w, 1));
    const preds = cal(zPreds(teZ, w, 1), pl, max);
    const ll = logLoss(preds);
    const ci = bootDelta(basePreds, preds);
    const trainLl = logLoss(cal(zPreds(trZ, w, 1), pl, max));
    rows.push({ name, w, platt: pl, max, ll, delta: ll - base, lo: ci.lo, hi: ci.hi, trainLl });
    console.log(`${name}: test ${f4(ll)} Δ ${f4(ll - base)} (${f4(ci.lo)} – ${f4(ci.hi)}) · Platt a ${pl.a.toFixed(3)} b ${pl.b.toFixed(3)} · träning ${f4(trainLl)} · ${Object.entries(w).filter(([k, v]) => v && !(INPUT_KEYS as readonly string[]).includes(k)).map(([k, v]) => `${k} ${v}`).join(" ")} streck ${w.streck}`);
    return preds;
  };

  // Referens: v3 med Platt omanpassad på samma träningsdel (ingen ny indata).
  evalVariant("v3, Platt omanpassad", zTr, zTe, V3_WEIGHTS);
  evalVariant("v3, Platt omanpassad, utan tak", zTr, zTe, V3_WEIGHTS, 1);

  // (b) streckvikten ensam (β = 1 och vikterna skalas: samma sak som β-justering).
  const sw = fitWeights(zTr, V3_WEIGHTS, 1, ["streck"]).weights;
  evalVariant("(b) streckvikt omanpassad", zTr, zTe, sw);
  // β som gemensam skala för alla vikter.
  let bestB = { b: 1, ll: Infinity };
  for (let b = 0.8; b <= 1.25; b += 0.01) {
    const ll = logLoss(zPreds(zTr, V3_WEIGHTS, b));
    if (ll < bestB.ll) bestB = { b: Math.round(b * 100) / 100, ll };
  }
  const scaled = Object.fromEntries(Object.entries(V3_WEIGHTS).map(([k, v]) => [k, Math.round(v * bestB.b * 1000) / 1000])) as Weights;
  evalVariant(`(b) β ${bestB.b}`, zTr, zTe, scaled);

  // (c) kalibrering: tak 0,70–0,85.
  for (const m of [0.7, 0.75, 0.85]) evalVariant(`(c) Platt v3, tak ${m}`, zTr, zTe, V3_WEIGHTS, m, recCal);

  // (a) nytt indata: bara dess vikt anpassas, sedan dess vikt + streck, sedan Platt.
  const featPreds: Record<string, Pred[]> = {};
  for (const k of FEAT_KEYS) {
    const tr = withFeat(zTr, [k]);
    const te = withFeat(zTe, [k]);
    const w1 = fitWeights(tr, { ...V3_WEIGHTS, [k]: 0 } as Weights, 1, [k as InputKey]).weights;
    evalVariant(`(a) ${k}`, tr, te, w1);
    const w2 = fitWeights(tr, w1, 1, [k as InputKey, "streck"]).weights;
    featPreds[k] = evalVariant(`(a) ${k} + streck`, tr, te, w2);
  }
  // (b2) log-streck utan z-skalning i stället för streckets z: streck 0, logRa anpassas.
  {
    const tr = withFeat(zTr, ["logRa"]);
    const te = withFeat(zTe, ["logRa"]);
    const w = fitWeights(tr, { ...V3_WEIGHTS, streck: 0, logRa: 0.86 } as Weights, 1, ["logRa" as InputKey]).weights;
    featPreds["logRa i stället för streck"] = evalVariant("(b2) logRa i stället för streck", tr, te, w);
  }
  out.rows = rows;

  // Favoriten: vinstchans och P3, verklig mot modell.
  const groups = (fr: ReturnType<typeof favRows>) => {
    const g = (lbl: string, xs: typeof fr) => ({
      lbl,
      n: xs.length,
      win: xs.reduce((a, x) => a + x.win, 0) / xs.length,
      streck: xs.reduce((a, x) => a + x.streck, 0) / xs.length,
      oddsWin: xs.reduce((a, x) => a + x.oddsWin, 0) / xs.length,
      pi: xs.reduce((a, x) => a + x.pi, 0) / xs.length,
      top3: xs.reduce((a, x) => a + x.top3, 0) / xs.length,
      p3: xs.reduce((a, x) => a + x.p3, 0) / xs.length,
      pmTop3: xs.reduce((a, x) => a + x.pmTop3, 0) / xs.length,
    });
    const strongest = [...new Map(fr.map((x) => [x.gameId, fr.filter((y) => y.gameId === x.gameId).reduce((a, b) => (b.streck > a.streck ? b : a))])).values()];
    return [
      g("Alla streckfavoriter", fr),
      g("Favorit < 30 %", fr.filter((x) => x.streck < 0.3)),
      g("Favorit 30–40 %", fr.filter((x) => x.streck >= 0.3 && x.streck < 0.4)),
      g("Favorit 40–50 %", fr.filter((x) => x.streck >= 0.4 && x.streck < 0.5)),
      g("Favorit 50–60 %", fr.filter((x) => x.streck >= 0.5 && x.streck < 0.6)),
      g("Favorit ≥ 60 %", fr.filter((x) => x.streck >= 0.6)),
      g("Omgångens starkaste favorit", strongest),
    ];
  };
  // Alla vikter om med log-streck utan z-skalning (streck 0), förenklat som v3:
  // vikter under 0,03 blir 0, resten avrundas till två decimaler. Sedan Platt.
  {
    const tr = withFeat(zTr, ["logRa"]);
    const te = withFeat(zTe, ["logRa"]);
    const keys = [...INPUT_KEYS.filter((k) => k !== "streck" && k !== "streckLog"), "logRa"] as InputKey[];
    const b2 = rows.find((x) => x.name.startsWith("(b2)"))!.w;
    const full = fitWeights(tr, b2, 1, keys).weights;
    console.log(`Alla vikter om: ${JSON.stringify(full)}`);
    const simple = Object.fromEntries(Object.entries(full).map(([k, v]) => [k, Math.abs(v) < 0.03 ? 0 : Math.round(v * 100) / 100])) as Weights;
    for (const m of [0.75, 0.8, 0.85, 1]) featPreds[`v1.2 tak ${m}`] = evalVariant(`v1.2 (alla om, förenklad), tak ${m}`, tr, te, simple, m);
    const pl = fitPlatt(zPreds(tr, simple, 1));
    featPreds["v1.2 avrundad Platt"] = evalVariant("v1.2, Platt avrundad", tr, te, simple, 0.8, { a: Math.round(pl.a * 1000) / 1000, b: Math.round(pl.b * 1000) / 1000 });
    featPreds["v1.2 utan Platt"] = evalVariant("v1.2 utan Platt", tr, te, simple, 0.8, { a: 0, b: 1 });
    // Och v3 med alla vikter om (z-streck), för jämförelse.
    const v3full = fitWeights(zTr, V3_WEIGHTS, 1, INPUT_KEYS.filter((k) => k !== "streckLog") as InputKey[]).weights;
    const v3s = Object.fromEntries(Object.entries(v3full).map(([k, v]) => [k, Math.abs(v) < 0.03 ? 0 : Math.round(v * 100) / 100])) as Weights;
    evalVariant("v3 alla vikter om (z-streck), förenklad", zTr, zTe, v3s);
    // Blandning: båda strecken fria, från v1.2.
    const mix = fitWeights(tr, { ...simple, streck: 0 }, 1, ["streck", "logRa"] as InputKey[]).weights;
    evalVariant("v1.2 + z-streck fri (blandning)", tr, te, mix);
    out.v12 = { full, simple, platt: pl };
    // Mått på hela testdelen för v1.2 (lägst odds topp 3 m.m.).
    out.v12Metrics = metrics(cal(zPreds(te, simple, 1), pl, 0.8));
    out.v3Metrics = metrics(basePreds);
    // Träningsdelen: hur stor skillnaden var där (för stabilitet).
    out.v12Fav = { test: groups(favRows(te, simple, pl, 0.8)), all: groups(favRows([...tr, ...te], simple, pl, 0.8)) };
  }
  // Kontroll genom appens egen beräkning (computeRace via modelPreds): v3 och
  // den nya rekommenderade modellen (RECOMMENDED_*), samma testlopp.
  {
    const pr = (w: Weights, c: typeof V3_CALIBRATION, rs: BtRace[]) => modelPreds(rs, w, { ...V1_PARAMS, beta: 1, ...c, noStreck: RECOMMENDED_NO_STRECK });
    const a = pr(V3_WEIGHTS, V3_CALIBRATION, test);
    const b = pr(RECOMMENDED_WEIGHTS, RECOMMENDED_CALIBRATION, test);
    const ci = bootDelta(a, b);
    const ma = metrics(a);
    const mb = metrics(b);
    console.log(`computeRace: v3 ${f4(ma.logLoss)} · rekommenderad ${f4(mb.logLoss)} · Δ ${f4(mb.logLoss - ma.logLoss)} (${f4(ci.lo)} – ${f4(ci.hi)}) · Brier ${f4(ma.brier)} → ${f4(mb.brier)} · lägst odds topp 3 ${ma.favourite.hits} → ${mb.favourite.hits}`);
    const byType = Object.fromEntries(
      TYPES.map((t) => {
        const keys = new Set(test.filter((r) => r.gameType === t).map((r) => r.key));
        const aa = a.filter((x) => keys.has(x.raceKey));
        const bb = b.filter((x) => keys.has(x.raceKey));
        const c2 = bootDelta(aa, bb);
        return [t, { races: keys.size, v3: logLoss(aa), ny: logLoss(bb), lo: c2.lo, hi: c2.hi }];
      }),
    );
    console.log(byType);
    // Träningsdelen (där vikterna anpassades) för jämförelse.
    const at = pr(V3_WEIGHTS, V3_CALIBRATION, train);
    const bt = pr(RECOMMENDED_WEIGHTS, RECOMMENDED_CALIBRATION, train);
    console.log(`computeRace träning: v3 ${f4(logLoss(at))} · rekommenderad ${f4(logLoss(bt))}`);
    // Halvår i testdelen.
    const half = test[Math.floor(test.length / 2)].date;
    const h = (xs: Pred[], first: boolean) => xs.filter((x) => (x.date < half) === first);
    const halves = [true, false].map((first) => ({ first, v3: logLoss(h(a, first)), ny: logLoss(h(b, first)), ...bootDelta(h(a, first), h(b, first)) }));
    console.log({ half, halves });
    // ROI-regeln (platsodds > riktodds) och Mikaels regel (P3 ≥ 50 %, platsodds ≥ 2,0).
    const roi = (xs: Pred[], rule: (x: Pred) => boolean) => {
      const bets = xs.filter((x) => x.hasPlacePool && x.placeOdds !== null && rule(x));
      return { n: bets.length, hit: bets.filter((x) => x.placePayout > 0).length / bets.length, roi: bets.reduce((s2, x) => s2 + x.placePayout, 0) / bets.length - 1 };
    };
    const rules = {
      platsoddsOverRiktodds: { v3: roi(a, (x) => (x.placeOdds as number) > x.odds), ny: roi(b, (x) => (x.placeOdds as number) > x.odds) },
      mikael: { v3: roi(a, (x) => x.p >= 0.5 && (x.placeOdds as number) >= 2), ny: roi(b, (x) => x.p >= 0.5 && (x.placeOdds as number) >= 2) },
    };
    console.log(JSON.stringify(rules));
    out.final = { v3: ma, ny: mb, ci, byType, trainV3: logLoss(at), trainNy: logLoss(bt), half, halves, rules, calV3: calibration(a, 10), calNy: calibration(b, 10) };
  }
  const json = { ...out } as Record<string, unknown>;
  const all = (k: string | null) => [...(k ? withFeat(zTr, [k]) : zTr), ...(k ? withFeat(zTe, [k]) : zTe)];
  json.fav = { v3: { test: groups(favRows(zTe, V3_WEIGHTS, recCal, MAX)), all: groups(favRows(all(null), V3_WEIGHTS, recCal, MAX)) } } as Record<string, unknown>;
  for (const r of rows.filter((r) => r.name.startsWith("(a)") && r.name.endsWith("+ streck"))) {
    const k = r.name.slice(4, -9);
    (json.fav as Record<string, unknown>)[k] = { test: groups(favRows(withFeat(zTe, [k]), r.w, r.platt, r.max)), all: groups(favRows(all(k), r.w, r.platt, r.max)) };
  }
  {
    const r = rows.find((x) => x.name.startsWith("(b2)"))!;
    (json.fav as Record<string, unknown>)["logRa i stället för streck"] = { test: groups(favRows(withFeat(zTe, ["logRa"]), r.w, r.platt, r.max)), all: groups(favRows(all("logRa"), r.w, r.platt, r.max)) };
  }
  // Kalibrering i topp-intervallen (testdelen): v3 och kandidaterna.
  const buckets = (p: Pred[]) => calibration(p, 10).filter((b) => b.lo >= 0.4);
  json.calib = { v3: buckets(basePreds), ...Object.fromEntries(Object.entries(featPreds).map(([k, p]) => [k, buckets(p)])) };
  json.market = { streck: metrics(marketPreds(test, "streck")).logLoss, vinnarodds: metrics(marketPreds(test, "vinnarodds")).logLoss };
  const file = get("ut") ?? "favoritratt.json";
  fs.writeFileSync(file, JSON.stringify(json, null, 2));
  console.log(`Skrev ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
