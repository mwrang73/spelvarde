import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  attachPosts,
  braFeatures,
  braForm,
  withBraForm,
  extraFeatures,
  fitPlatt,
  kmReference,
  kmSeconds,
  brier,
  buildRaces,
  calendarGames,
  calibration,
  countsFromRecords,
  favouriteHitRate,
  fitWeights,
  horseYears,
  logLoss,
  makePostIndex,
  marketPreds,
  modelPreds,
  naivePreds,
  p3FromZ,
  placeWinners,
  recordsBefore,
  roiRule,
  searchBeta,
  timeSplit,
  toFacts,
  zPreds,
  zRaces,
  type BtRace,
  type BtStart,
  type HistRow,
  type Pred,
} from "@/lib/backtest";
import { computeRace, V1_PARAMS, V1_WEIGHTS } from "@/lib/riktodds";
import type { YearStats } from "@/lib/atg";

const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "atg", name), "utf8"));

const rec = (date: string, place: number | null, o: { scratched?: boolean; disqualified?: boolean; galloped?: boolean } = {}) => ({
  date,
  place,
  scratched: o.scratched ?? false,
  disqualified: o.disqualified ?? false,
  galloped: o.galloped ?? false,
});

const ys = (starts: number, wins: number, seconds = 0, thirds = 0): YearStats => ({ starts, wins, seconds, thirds, winPercentage: null, earnings: null });

describe("läckageskydd", () => {
  it("tar bara poster före loppdagen, utan strukna, nyast först", () => {
    const records = [
      rec("2026-03-01", 1),
      rec("2026-04-04", 2), // loppdagen själv
      rec("2026-05-01", 3), // efter loppet
      rec("2026-03-20", null, { scratched: true }),
      rec("2026-03-15", 4),
    ];
    expect(recordsBefore(records, "2026-04-04").map((r) => r.date)).toEqual(["2026-03-15", "2026-03-01"]);
  });

  it("räknar år och fjol ur posterna, diskning är ingen placering", () => {
    const records = [rec("2026-03-01", 1), rec("2026-02-01", 3), rec("2026-01-10", 2, { disqualified: true }), rec("2025-12-01", 1), rec("2026-02-15", null, { scratched: true })];
    expect(countsFromRecords(records, "2026")).toEqual({ starts: 3, wins: 1, placed: 2 });
    expect(countsFromRecords(records, "2025")).toEqual({ starts: 1, wins: 1, placed: 1 });
  });

  it("horseYears: ögonblicksbilden som standard, posterna med source = poster", () => {
    const records = [rec("2026-05-01", 1), rec("2026-03-01", 1), rec("2025-06-01", 2), rec("2024-12-01", 5)];
    const snapshot = { years: { "2026": ys(1, 1), "2025": ys(1, 0, 1) }, life: ys(20, 5) };
    const a = horseYears({ records: records as never }, snapshot, "2026-04-04");
    expect(a.statsSource).toBe("ogonblick");
    expect(a.thisYear).toEqual({ starts: 1, wins: 1, placed: 1 });
    expect(a.lifeStarts).toBe(20);
    // Posterna före loppet ger samma tal, och bilden räknar inte loppet 2026-05-01.
    expect(a.statsAgree).toBe(true);
    expect(a.statsLeak).toBe(false);

    const b = horseYears({ records: records as never }, snapshot, "2026-04-04", "poster");
    expect(b.statsSource).toBe("poster");
    expect(b.thisYear).toEqual({ starts: 1, wins: 1, placed: 1 });
    expect(b.lastYear).toEqual({ starts: 1, wins: 0, placed: 1 });
  });

  it("horseYears: flaggar en ögonblicksbild som räknar med senare starter", () => {
    const records = [rec("2026-05-01", 1), rec("2026-03-01", 1), rec("2024-12-01", 5)];
    const leaky = { years: { "2026": ys(2, 2) }, life: ys(20, 5) };
    expect(horseYears({ records: records as never }, leaky, "2026-04-04").statsLeak).toBe(true);
  });

  it("horseYears: posterna används inte om de inte räcker bakåt till fjolårets början", () => {
    const records = [rec("2026-03-01", 1), rec("2025-06-01", 2)];
    const r = horseYears({ records: records as never }, null, "2026-04-04", "poster");
    expect(r.statsSource).toBe("saknas");
    expect(r.thisYear).toBeNull();
  });
});

describe("ATG-data", () => {
  const game = fixture("game-V85_2026-10-17_16_5-results.json");

  it("kalendern ger spelen för de valda spelformerna", () => {
    const cal = fixture("calendar-2026-10-24.json");
    const games = calendarGames(cal, ["V85", "XX"]);
    expect(games.length).toBeGreaterThan(0);
    expect(games.every((g) => g.gameType === "V85" && g.id.startsWith("V85_"))).toBe(true);
  });

  it("platspoolens utdelning per startnummer", () => {
    const w = placeWinners(game.races[0].pools);
    expect(w?.places).toBe(3);
    expect([...w!.paid.entries()]).toEqual([
      [6, 2.28],
      [2, 1.52],
      [4, 2.86],
    ]);
    expect(placeWinners({})).toBeNull();
  });

  it("bygger lopp med utfall, streck, platsodds och utdelning", () => {
    const races = buildRaces(game, "V85", () => null);
    expect(races).toHaveLength(8);
    const r = races[0];
    expect(r.date).toBe("2026-10-17");
    expect(r.placesPaid).toBe(3);
    const by = (n: number) => r.starts.find((s) => s.number === n)!;
    expect(by(6)).toMatchObject({ top3: true, place: 1, placePayout: 2.28, streck: 11.68, placeOdds: 2.28, winOdds: 8.54 });
    expect(by(1)).toMatchObject({ top3: false, place: 6, placePayout: 0, streck: 3.55, placeOdds: 2.94 });
    // Diskad: inte topp 3.
    expect(by(3)).toMatchObject({ top3: false, disqualified: true, placePayout: 0 });
    expect(r.starts.filter((s) => s.top3)).toHaveLength(3);
    // Inga startdetaljer: ögonblicksbilden används, inga poster.
    expect(by(1).statsSource).toBe("ogonblick");
    expect(by(1).records).toEqual([]);
    // Indata: inget spår, inget streck.
    expect(toFacts(r).every((f) => f.post === null && f.streck === null)).toBe(true);
    expect(toFacts(r, true).find((f) => f.number === 6)?.streck).toBe(11.68);
  });

  it("startdetaljernas poster filtreras på loppdatumet", () => {
    const detail = {
      horse: {
        id: 1,
        results: {
          records: [
            { date: "2026-10-25", place: "1", track: { name: "Solvalla" } },
            { date: "2026-10-17", place: "2", track: { name: "Gävle" } },
            { date: "2026-10-01", place: "3", track: { name: "Gävle" } },
          ],
        },
      },
    };
    const r = buildRaces(game, "V85", (_id, n) => (n === 1 ? detail : null))[0];
    expect(r.starts.find((s) => s.number === 1)!.records).toMatchObject([{ date: "2026-10-01", place: 3, galloped: false, disqualified: false }]);
  });
});

describe("mått", () => {
  const P = (raceKey: string, p: number, y: 0 | 1, o: Partial<Pred> = {}): Pred => ({
    raceKey,
    date: "2026-01-01",
    p,
    y,
    odds: 1 / p,
    placeOdds: null,
    placePayout: 0,
    hasPlacePool: true,
    ...o,
  });

  it("Brier och log loss", () => {
    const xs = [P("a", 0.8, 1), P("a", 0.2, 0), P("a", 0.5, 1)];
    expect(brier(xs)).toBeCloseTo((0.04 + 0.04 + 0.25) / 3, 12);
    expect(logLoss(xs)).toBeCloseTo(-(Math.log(0.8) + Math.log(0.8) + Math.log(0.5)) / 3, 12);
    // p = 0 eller 1 klipps, så att log loss blir ändlig.
    expect(Number.isFinite(logLoss([P("a", 0, 1), P("a", 1, 0)]))).toBe(true);
    expect(brier([])).toBeNaN();
  });

  it("kalibreringshinkar: 10 lika breda, 1,0 i sista, tomma ger NaN", () => {
    const b = calibration([P("a", 0.05, 0), P("a", 0.15, 1), P("a", 0.19, 0), P("a", 1, 1), P("a", 0.95, 0)]);
    expect(b).toHaveLength(10);
    expect(b[0]).toMatchObject({ n: 1, actual: 0 });
    expect(b[0].expected).toBeCloseTo(0.05);
    expect(b[1]).toMatchObject({ n: 2, actual: 0.5 });
    expect(b[1].expected).toBeCloseTo(0.17);
    expect(b[9]).toMatchObject({ n: 2, actual: 0.5 });
    expect(b[5].n).toBe(0);
    expect(b[5].expected).toBeNaN();
  });

  it("lägst odds i loppet kommer topp 3", () => {
    const xs = [P("a", 0.7, 1), P("a", 0.3, 0), P("b", 0.6, 0), P("b", 0.5, 1)];
    expect(favouriteHitRate(xs)).toEqual({ races: 2, hits: 1, rate: 0.5 });
  });

  it("ROI-regeln: spela när platsodds > riktodds × kvot", () => {
    const xs = [
      P("a", 0.5, 1, { odds: 2, placeOdds: 2.5, placePayout: 2.4 }), // spel, träff
      P("a", 0.5, 0, { odds: 2, placeOdds: 1.8 }), // inget spel
      P("b", 0.25, 0, { odds: 4, placeOdds: 6 }), // spel, miss
      P("b", 0.25, 1, { odds: 4, placeOdds: 12, placePayout: 11 }), // spel, träff
      P("c", 0.25, 1, { odds: 4, placeOdds: null }), // inget platsodds
      P("d", 0.25, 1, { odds: 4, placeOdds: 9, hasPlacePool: false }), // ingen platspool
    ];
    const r = roiRule(xs);
    expect(r.total).toMatchObject({ bets: 3, hits: 2, staked: 3 });
    expect(r.total.returned).toBeCloseTo(13.4);
    expect(r.total.roi).toBeCloseTo(13.4 / 3 - 1);
    expect(r.all.bets).toBe(4);
    const band = (label: string) => r.bands.find((b) => b.label === label)!;
    expect(band("2–3").bets).toBe(1);
    expect(band("5–10").bets).toBe(1);
    expect(band("10+")).toMatchObject({ bets: 1, hits: 1 });
    expect(band("1–1,5").roi).toBeNaN();
    // Med kvot 1,3 faller spelet på 2,5 mot 2 bort.
    expect(roiRule(xs, 1.3).total.bets).toBe(2);
  });
});

describe("modellen i backtestet", () => {
  // Påhittade lopp där plats-statistiken avgör: hästen med flest placeringar kommer topp 3.
  const start = (n: number, placed: number, top3: boolean): BtStart => ({
    number: n,
    scratched: false,
    top3,
    place: top3 ? 1 : 5,
    disqualified: false,
    thisYear: { starts: 10, wins: Math.floor(placed / 2), placed },
    lastYear: null,
    lifeStarts: 20,
    statsSource: "ogonblick",
    statsAgree: null,
    statsLeak: null,
    records: [{ date: "2025-12-01", place: placed > 5 ? 1 : 6, galloped: n === 2, disqualified: false }],
    driver: { starts: 100, wins: 10 + n },
    trainer: null,
    streck: 5 + placed,
    winOdds: 20 / (1 + placed),
    placeOdds: 3,
    placePayout: top3 ? 2 : 0,
  });
  const race = (key: string, date: string): BtRace => ({
    key,
    date,
    gameType: "V85",
    gameId: "g",
    leg: 1,
    distance: 2140,
    startMethod: "AUTO",
    placesPaid: 3,
    starts: Array.from({ length: 8 }, (_, i) => start(i + 1, 8 - i, i < 3)),
  });
  const races = [race("r1", "2026-01-01"), race("r2", "2026-01-01"), race("r3", "2026-02-01"), race("r4", "2026-03-01")];

  it("p3FromZ ger samma P3 som computeRace", () => {
    const facts = toFacts(races[0]);
    const params = { ...V1_PARAMS, beta: 0.7 };
    const direct = computeRace(facts, V1_WEIGHTS, params).map((r) => r.probTop3);
    const z = zRaces([races[0]], params, V1_WEIGHTS)[0].z;
    p3FromZ(z, V1_WEIGHTS, 0.7).forEach((p, i) => expect(p).toBeCloseTo(direct[i], 12));
    expect(modelPreds([races[0]], V1_WEIGHTS, params).map((x) => x.p)).toEqual(direct);
  });

  it("naiv modell ger 3 / N och marknaden summerar till 3", () => {
    expect(naivePreds([races[0]]).every((x) => Math.abs(x.p - 3 / 8) < 1e-12)).toBe(true);
    const m = marketPreds([races[0]], "streck");
    expect(m.reduce((a, x) => a + x.p, 0)).toBeCloseTo(3, 9);
    expect(marketPreds([races[0]], "vinnarodds")).toHaveLength(8);
  });

  it("β-sökningen och viktsökningen förbättrar log loss när data är tydlig", () => {
    const zr = zRaces(races, V1_PARAMS, V1_WEIGHTS);
    const b = searchBeta(zr, V1_WEIGHTS);
    // Datan är helt förutsägbar, så det största β i rutnätet vinner.
    expect(b.beta).toBe(1.5);
    const before = logLoss(zPreds(zr, V1_WEIGHTS, 1));
    const fit = fitWeights(zr, V1_WEIGHTS, 1, ["plats", "vinst"], [0.4], 3);
    expect(fit.logLoss).toBeLessThan(before);
    expect(fit.weights.plats).toBeGreaterThan(V1_WEIGHTS.plats);
  });

  it("tidsmässig delning håller ihop dagar och lägger äldst i träning", () => {
    const s = timeSplit(races, 0.25);
    // 25 % av 4 = 1 lopp, men dagen 2026-01-01 har två lopp.
    expect(s.train.map((r) => r.key)).toEqual(["r1", "r2"]);
    expect(s.test.map((r) => r.key)).toEqual(["r3", "r4"]);
    expect(s.cut).toBe("2026-02-01");
  });
});

describe("spår ur statistikbasen i backtestet", () => {
  // 160 lopp 2140 m auto, ett om dagen från 2025-01-01: nr 1 vinner alltid, nr 2 tvåa, nr 3 trea.
  const day = (i: number) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
  const rows: HistRow[] = [];
  for (let i = 0; i < 160; i++)
    for (let n = 1; n <= 8; n++) rows.push({ raceId: `r${i}`, date: day(i), method: "AUTO", distance: 2140, number: n, place: n <= 3 ? n : 0, scratched: false });
  const index = makePostIndex(rows);

  it("räknar bara lopp före loppdagen", () => {
    expect(index(day(160), "AUTO", 2140)?.get(1)).toBe(100);
    expect(index(day(160), "AUTO", 2140)?.get(4)).toBe(0);
    // Dag 150: bara 150 lopp före, precis gränsen.
    expect(index(day(150), "AUTO", 2140)).not.toBeNull();
    expect(index(day(149), "AUTO", 2140)).toBeNull();
  });
  it("faller tillbaka på distansgruppen och saknas för annan startmetod", () => {
    expect(index(day(160), "AUTO", 2100)?.get(2)).toBe(100);
    expect(index(day(160), "VOLTE", 2140)).toBeNull();
  });
  it("sätter post med medel som i drift", () => {
    const r = { key: "x", date: day(160), gameType: "V85", gameId: "g", leg: 1, distance: 2140, startMethod: "AUTO" as const, placesPaid: 3, starts: [1, 4].map((n) => ({ number: n, scratched: false, records: [] }) as unknown as BtStart) };
    expect(attachPosts([r], index)).toBe(2);
    expect(r.starts[0].post).toMatchObject({ pct: 100, mean: 37.5, kind: "plats" });
    expect(toFacts(r)[1].post).toMatchObject({ pct: 0 });
  });
});

describe("signalerna och kalibreringen", () => {
  it("km-tid och referens: samma km-tid är bättre på längre distans", () => {
    expect(kmSeconds("1.13,4")).toBeCloseTo(73.4, 6);
    expect(kmSeconds("u")).toBeNull();
    const rec = (d: number, t: string) => ({ date: "2026-01-01", place: 5, galloped: false, disqualified: false, kmTime: t, distance: d, startMethod: "AUTO" as const, driverName: null });
    const mk = (n: number, d: number, t: string) => ({ number: n, scratched: false, records: Array.from({ length: 60 }, () => rec(d, t)) }) as unknown as BtStart;
    const race = { key: "r", date: "2026-02-01", gameType: "V85", gameId: "g", leg: 1, distance: 2140, startMethod: "AUTO" as const, placesPaid: 3, starts: [mk(1, 1640, "1.12,0"), mk(2, 2140, "1.13,0")] };
    const ref = kmReference([race]);
    // 1.13,4 är 0,4 s långsammare än referensen på 2140 men 1,4 s långsammare på 1640.
    expect(73.4 - ref("AUTO", 2140)!).toBeCloseTo(0.4, 6);
    expect(73.4 - ref("AUTO", 1640)!).toBeCloseTo(1.4, 6);
  });
  it("tid blir bara skild från 0 för en häst som sticker ut extremt", () => {
    const rec = (t: string) => ({ date: "2026-01-01", place: 5, galloped: false, disqualified: false, kmTime: t, distance: 2140, startMethod: "AUTO" as const, driverName: null });
    const times = ["1.13,0", "1.13,2", "1.12,9", "1.13,1", "1.13,3", "1.11,0"];
    const starts = times.map((t, i) => ({ number: i + 1, scratched: false, records: [rec(t)], driver: null }) as unknown as BtStart);
    const race = { key: "r", date: "2026-02-01", gameType: "V85", gameId: "g", leg: 1, distance: 2140, startMethod: "AUTO" as const, placesPaid: 3, starts };
    const tid = extraFeatures(race, () => 73).tid;
    expect(tid.slice(0, 5).every((x) => x === 0)).toBe(true);
    expect(tid[5]).toBeGreaterThan(0);
  });
  it("Platt: redan kalibrerat ger ungefär a = 0, b = 1, och överkonfident krymps", () => {
    const preds = Array.from({ length: 2000 }, (_, i) => ({ p: 0.1 + 0.8 * (i / 2000), y: (i * 7919) % 2000 < 0.1 * 2000 + 0.8 * i ? 1 : 0 }) as { p: number; y: 0 | 1 });
    const c = fitPlatt(preds);
    expect(Math.abs(c.a)).toBeLessThan(0.2);
    expect(Math.abs(c.b - 1)).toBeLessThan(0.2);
  });
});

describe("Bra form (backtest 2026-10-27)", () => {
  const r = (date: string, place: number | null, disqualified = false) => ({ date, place, disqualified });
  it("topp 3 i båda de två senaste och senaste start högst 28 dagar före loppdagen", () => {
    expect(braForm([r("2026-10-01", 3), r("2026-09-10", 1)], "2026-10-29")).toBe(true);
    expect(braForm([r("2026-10-01", 3), r("2026-09-10", 1)], "2026-10-30")).toBe(false);
    expect(braForm([r("2026-10-01", 3), r("2026-09-10", 1)], "2026-10-30", 42)).toBe(true);
    expect(braForm([r("2025-01-01", 2), r("2024-12-01", 2)], "2026-10-30", Infinity)).toBe(true);
  });
  it("diskning, fyra eller sämre och färre än två starter ger inte Bra form", () => {
    expect(braForm([r("2026-10-20", 1, true), r("2026-10-01", 1)], "2026-10-27")).toBe(false);
    expect(braForm([r("2026-10-20", 1), r("2026-10-01", 4)], "2026-10-27")).toBe(false);
    expect(braForm([r("2026-10-20", 1), r("2026-10-01", null)], "2026-10-27")).toBe(false);
    expect(braForm([r("2026-10-20", 1)], "2026-10-27")).toBe(false);
    expect(braForm([], "2026-10-27")).toBe(false);
  });
  it("braFeatures och withBraForm: 0/1 per startande, z inom loppet, strukna hoppas över", () => {
    const st = (n: number, records: ReturnType<typeof r>[], scratched = false) => ({ number: n, scratched, records }) as unknown as BtStart;
    const race = { key: "r", date: "2026-10-27", gameType: "V85", gameId: "g", leg: 1, distance: 2140, startMethod: "AUTO" as const, placesPaid: 3, starts: [st(1, [r("2026-10-20", 1), r("2026-10-01", 2)]), st(2, [], true), st(3, [r("2026-09-01", 1), r("2026-08-01", 2)]), st(4, [])] };
    expect(braFeatures(race)).toEqual({ braForm: [1, 0, 0], braForm6v: [1, 0, 0], plats2: [1, 1, 0] });
    const z = withBraForm([{ race, z: [{}, {}, {}] as never }], ["braForm"])[0].z as unknown as Record<string, number>[];
    expect(z[0].braForm).toBeGreaterThan(0);
    expect(z[1].braForm).toBeCloseTo(z[2].braForm, 9);
    expect(z.reduce((a, x) => a + x.braForm, 0)).toBeCloseTo(0, 9);
  });
});
