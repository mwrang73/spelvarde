import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  countPct,
  decodeHtml,
  extractTables,
  favoriteWinPct,
  headerMatchesRound,
  interpretPage,
  msRanks,
  parseBana,
  parseDistanceCell,
  parseLeague,
  parseMsTable,
  parsePageHeader,
  parseRank,
  parseSenaste,
  parseStartnr,
  TS_PAGE_KEYS,
  WRONG_ROUND_ERROR,
} from "@/lib/travstatistik";

const raw = (f: string) => readFileSync(path.join(__dirname, "..", "test", "fixtures", "travstatistik", f));
const html = (f: string) => decodeHtml(new Uint8Array(raw(f)));
const gavle = { trackName: "Gävle", date: "2026-10-17" };

describe("avkodning", () => {
  it("läser fixturerna (UTF-8) och riktiga latin-1-sidor likadant", () => {
    const utf8 = html("visaveckansnr.html");
    expect(utf8).toContain("Gävle 17 oktober 2026");
    const latin1 = Buffer.from(utf8, "latin1");
    expect(decodeHtml(new Uint8Array(latin1))).toContain("Gävle 17 oktober 2026");
    expect(decodeHtml(new Uint8Array([0x47, 0xe4, 0x76, 0x6c, 0x65]))).toBe("Gävle");
  });
});

describe("rubrik och rimlighetskontroll", () => {
  it("läser bana och datum från varje sida", () => {
    for (const f of ["visaveckansnr.html", "visaveckansMS.html", "visakuskligan.html", "formtoppen.html", "visasenasteomg.html"]) {
      expect(parsePageHeader(html(f))).toEqual(gavle);
    }
  });
  it("godkänner rätt omgång och avvisar en annan", () => {
    const h = parsePageHeader(html("visaveckansnr.html"));
    expect(headerMatchesRound(h, { trackName: "gävle", date: "2026-10-17" })).toBe(true);
    expect(headerMatchesRound(h, { trackName: "Jägersro", date: "2026-10-24" })).toBe(false);
    expect(headerMatchesRound(null, gavle)).toBe(false);
  });
  it("interpretPage sparar 'Sidan visar en annan omgång' för fel omgång", () => {
    const res = interpretPage("startnr", html("visaveckansnr.html"), { trackName: "Jägersro", date: "2026-10-24" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe(WRONG_ROUND_ERROR);
  });
  it("alla sidnycklar tolkas för rätt omgång", () => {
    const files: Record<string, string> = {
      startnr: "visaveckansnr.html", rank: "visaveckansrankvalny.html", ms: "visaveckansMS.html", bana: "visaveckansbana.html",
      kuskliga: "visakuskligan.html", tranarliga: "visatranarligan.html", form: "formtoppen.html", senaste: "visasenasteomg.html",
    };
    for (const key of TS_PAGE_KEYS) expect(interpretPage(key, html(files[key]), gavle).ok, key).toBe(true);
  });
});

describe("celler", () => {
  it("tolkar antal och procent", () => {
    expect(countPct("37 15.8")).toEqual({ count: 37, pct: 15.8 });
    expect(countPct("25 (50.0 %)")).toEqual({ count: 25, pct: 50 });
    expect(countPct("234")).toEqual({ count: 234, pct: null });
    expect(countPct("")).toBeNull();
  });
  it("tolkar distans, startmetod och intervall", () => {
    expect(parseDistanceCell("2140 a Diam")).toEqual({ distance: 2140, method: "AUTO", extra: "Diam", range: null });
    expect(parseDistanceCell("1640 a (1600 - 1680)")).toEqual({ distance: 1640, method: "AUTO", extra: null, range: [1600, 1680] });
    expect(parseDistanceCell("2140 v Till (2000 - 2200)")).toMatchObject({ method: "VOLTE", extra: "Till" });
  });
  it("tappar inga rader trots trasig HTML (ostängda <font>, <a>)", () => {
    const rows = extractTables(html("visaveckansnr.html"))[0];
    expect(rows.filter((r) => /^Avd \d$/.test(r[0]))).toHaveLength(8);
  });
});

describe("startnr (visaveckansnr.php)", () => {
  const d = parseStartnr(html("visaveckansnr.html"));
  it("ger 8 avdelningar med klass, distans, metod och vinst % per startnummer", () => {
    expect(d.legs).toHaveLength(8);
    expect(d.legs[0]).toMatchObject({ leg: 1, classCode: "S", distance: 1640, method: "AUTO", races: 234 });
    expect(d.legs[0].byNumber[0]).toEqual({ n: 1, count: 37, pct: 15.8 });
    expect(d.legs[0].byNumber).toHaveLength(12);
    expect(d.legs[1]).toMatchObject({ classCode: "Sto", distance: 2140, extra: "Diam", races: 81 });
    expect(d.legs[1].byNumber).toHaveLength(15);
    expect(d.legs[2]).toMatchObject({ classCode: "II", distance: 2640, method: "VOLTE" });
  });
  it("ger 'Alla <distans> <metod>' och 'Alla lopp'", () => {
    expect(d.all.map((g) => `${g.distance}${g.method[0]}`)).toEqual(["1640A", "2140A", "2640A", "1640V", "2140V", "2640V"]);
    expect(d.all[1]).toMatchObject({ races: 3842 });
    expect(d.all[1].byNumber[4]).toEqual({ n: 5, count: 502, pct: 13.1 });
    expect(d.allRaces!.races).toBe(10067);
  });
});

describe("ms (visaveckansMS.php)", () => {
  const d = parseMsTable(html("visaveckansMS.html"));
  it("ger MS 1–8 och summan sedan 2016", () => {
    expect(d.rows.map((r) => r.msRank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(d.rows[0]).toMatchObject({ races: 818 });
    expect(d.rows[0].byWinnerRank[0]).toEqual({ n: 1, count: 446, pct: 54.5 });
    expect(d.total!.races).toBe(5817);
  });
  it("favoritens vinst-% väljs efter loppets MS-rang, annars snittet", () => {
    expect(favoriteWinPct(d, 1)).toBe(54.5);
    expect(favoriteWinPct(d, 7)).toBe(18.9);
    expect(favoriteWinPct(d, null)).toBe(36.7);
  });
  it("MS-rang: loppen sorteras efter favoritens streck", () => {
    expect(msRanks({ 1: 3500, 2: 5200, 3: null, 4: 1800 })).toEqual({ 1: 2, 2: 1, 3: null, 4: 3 });
  });
  it("tolkar också visameststreckadavd (per klass)", () => {
    const k = parseMsTable(html("visameststreckadavd.php_Avd_1.html"));
    expect(k.title).toBe("Avd. 1 klass S");
    expect(k.rows[0]).toMatchObject({ msRank: 1, races: 143 });
    expect(k.rows[0].byWinnerRank[0].pct).toBe(52.4);
  });
});

describe("rank (visaveckansrankvalny.php)", () => {
  it("ger vinnarens rank per avdelning med distansintervall", () => {
    const d = parseRank(html("visaveckansrankvalny.html"));
    expect(d.legs).toHaveLength(8);
    expect(d.legs[0]).toMatchObject({ leg: 1, classCode: "S", distance: 1640, range: [1600, 1680], races: 81 });
    expect(d.legs[0].byRank[0]).toEqual({ n: 1, count: 22, pct: 27.2 });
  });
});

describe("bana (visaveckansbana.php)", () => {
  it("ger tidigare omgångar på banan med rank och från spets", () => {
    const d = parseBana(html("visaveckansbana.html"));
    expect(d.trackName).toBe("Gävle");
    expect(d.rounds.length).toBeGreaterThan(50);
    expect(d.rounds[1]).toMatchObject({ year: 2026, week: 14, rankPoints: 30 });
    expect(d.rounds[1].byRank[0]).toEqual({ n: 1, count: 4, fromLead: 3 });
  });
});

describe("ligor och formtoppen", () => {
  it("kuskligan: bara innevarande års sektion", () => {
    const d = parseLeague(html("visakuskligan.html"));
    expect(d.title).toBe("Kuskligan 2026");
    expect(d.year).toBe(2026);
    expect(d.rows[0]).toEqual({ rank: 1, name: "Kihlström Ö", wins: 36, favorite: 50, favoriteWins: 25, favoriteWinPct: 50, wonRank23: 9, wonRank46: 1, wonRank7: 1 });
    expect(d.rows.find((r) => r.name === "Djuse M E")).toMatchObject({ rank: 3, wins: 31 });
    expect(d.rows.length).toBeGreaterThan(20);
    expect(d.rows.length).toBeLessThan(400);
  });
  it("tränarligan", () => {
    const d = parseLeague(html("visatranarligan.html"));
    expect(d.title).toBe("Tränarligan 2026");
    expect(d.rows[0]).toMatchObject({ rank: 1, name: "Wäjersten D", wins: 35 });
  });
  it("formtoppen: delad placering ärver föregående", () => {
    const d = parseLeague(html("formtoppen.html"));
    expect(d.title).toMatch(/^Formtoppen sedan år 2025/);
    const jepson = d.rows.find((r) => r.name === "Jepson C J")!;
    expect(jepson.rank).toBe(3);
    expect(d.rows[0].name).toBe("Kihlström Ö");
  });
});

describe("senaste (visasenasteomg.php)", () => {
  it("ger de senaste omgångarna (filtrerade på utdelning)", () => {
    const d = parseSenaste(html("visasenasteomg.html"));
    expect(d.rounds[0]).toMatchObject({ year: 2026, week: 38, trackCode: "F", date: "2026-09-19", payout8: 492890 });
    expect(d.rounds.length).toBeGreaterThan(20);
  });
});
