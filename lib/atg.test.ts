import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatKmTime,
  formatRecord,
  mapLimit,
  parseCalendarDay,
  parseFirstPrize,
  parseGame,
  parseRecord,
  parseStartDetail,
  pickNextV85,
} from "@/lib/atg";

const fx = (f: string) => JSON.parse(readFileSync(path.join(__dirname, "..", "test", "fixtures", "atg", f), "utf8"));
const upcoming = fx("game-V85_2026-10-24_7_5.json");
const bettable = fx("game-V85_2026-10-24_7_5-bettable.json");
const results = fx("game-V85_2026-10-17_16_5-results.json");
const startDetail = fx("start-2026-10-24_7_11-1.json");
const calendar = fx("calendar-2026-10-24.json");

describe("parseGame – kommande omgång (game.json, Jägersro 2026-10-24)", () => {
  const warnings: string[] = [];
  const g = parseGame(upcoming, (m) => warnings.push(m))!;

  it("ger omgång, bana och 8 avdelningar i V85-ordning", () => {
    expect(g.atgGameId).toBe("V85_2026-10-24_7_5");
    expect(g.date).toBe("2026-10-24");
    expect(g.trackId).toBe(7);
    expect(g.trackName).toBe("Jägersro");
    expect(g.races).toHaveLength(8);
    expect(g.races.map((r) => r.leg)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(g.races.map((r) => r.raceNumber)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("tolkar tider utan tidszon som svensk tid (sommartid i oktober före omställningen)", () => {
    expect(g.firstStartAt.toISOString()).toBe("2026-10-24T13:00:00.000Z");
    expect(g.races[6].startAt.toISOString()).toBe("2026-10-24T15:13:00.000Z");
  });

  it("mappar lopp: distans, startmetod, förstapris och villkor", () => {
    const avd7 = g.races[6];
    expect(avd7.atgRaceId).toBe("2026-10-24_7_11");
    expect(avd7.distance).toBe(2640);
    expect(avd7.startMethod).toBe("AUTO");
    expect(g.races[3].startMethod).toBe("VOLTE");
    expect(avd7.starts).toHaveLength(12);
    expect(g.races[0].prize).toBe(150000);
    expect(g.races[0].terms.length).toBeGreaterThan(0);
    expect(avd7.hasResult).toBe(false);
  });

  it("mappar start, häst, kusk och tränare med statistik", () => {
    const s = g.races[0].starts[0];
    expect(s.number).toBe(1);
    expect(s.postPosition).toBe(1);
    expect(s.distance).toBe(2140);
    expect(s.scratched).toBe(false);
    expect(s.horse).toMatchObject({ atgHorseId: 787259, name: "Panthere d'Inverne", age: 5, sex: "mare", birthYear: 2021 });
    expect(s.record).toBe("1.11,8aM");
    expect(s.earnings).toBe(2496172);
    expect(s.driver).toMatchObject({ atgPersonId: 149226, firstName: "André", lastName: "Eklundh", shortName: "Ekl An" });
    expect(s.driver!.stats!["2026"]).toEqual({ starts: 422, wins: 49, seconds: 68, thirds: 57, winPercentage: 11.61, earnings: 7499591 });
    expect(s.trainer!.stats!["2026"].winPercentage).toBe(17.34);
    expect(s.horseStats!.years["2026"]).toMatchObject({ starts: 7, wins: 2, seconds: 1, thirds: 0 });
    expect(s.horseStats!.life).toMatchObject({ starts: 33, wins: 10 });
  });

  it("saknar streck innan V85 har öppnat (inga pools i svaret)", () => {
    expect(g.hasStreck).toBe(false);
    expect(g.races.flatMap((r) => r.starts).every((s) => s.streck === null)).toBe(true);
  });

  it("har 102 starter och inga varningar", () => {
    expect(g.races.reduce((n, r) => n + r.starts.length, 0)).toBe(102);
    expect(warnings).toEqual([]);
  });
});

describe("parseGame – öppet spel (bettable)", () => {
  const g = parseGame(bettable)!;
  it("har streck i hundradelar av procent som summerar till 100 % per avdelning", () => {
    expect(g.hasStreck).toBe(true);
    for (const r of g.races) {
      expect(r.starts.reduce((n, s) => n + (s.streck ?? 0), 0)).toBeGreaterThanOrEqual(9990);
      expect(r.starts.reduce((n, s) => n + (s.streck ?? 0), 0)).toBeLessThanOrEqual(10010);
    }
    expect(g.races[0].starts[0].streck).toBe(1924);
    expect(g.races[0].starts[0].winOdds).toBe(1.7);
  });

  it("anger kuskbyte med originalDriver (avd 8 nr 11: Uhrberg → Östre)", () => {
    const s = g.races[7].starts.find((x) => x.number === 11)!;
    expect(s.driver!.lastName).toBe("Östre");
    expect(s.originalDriver!.lastName).toBe("Uhrberg");
  });
});

describe("parseGame – spelad omgång med resultat (Gävle 2026-10-17)", () => {
  const g = parseGame(results)!;
  const all = g.races.flatMap((r) => r.starts.map((s) => ({ leg: r.leg, ...s })));

  it("har resultat på alla lopp och faktisk starttid med sekunder", () => {
    expect(g.status).toBe("results");
    expect(g.races.every((r) => r.hasResult)).toBe(true);
    expect(g.races[0].startAt.toISOString()).toBe("2026-10-17T13:00:43.000Z");
    expect(g.races[0].scheduledStartAt!.toISOString()).toBe("2026-10-17T13:00:00.000Z");
  });

  it("strykning: scratched = true och inget resultat", () => {
    const scratched = all.filter((s) => s.scratched);
    expect(scratched.map((s) => `${s.leg}:${s.number}`)).toEqual(["4:3", "6:1", "6:2", "7:12", "8:6", "8:8"]);
    expect(scratched.every((s) => s.result === null)).toBe(true);
  });

  it("diskning: disqualified = true utan placering, oftast med galopp", () => {
    const dq = all.filter((s) => s.result?.disqualified);
    expect(dq.length).toBeGreaterThan(0);
    expect(dq.every((s) => s.result!.place === null)).toBe(true);
    expect(dq.some((s) => s.result!.galloped)).toBe(true);
  });

  it("placering, kmtid som text, finalOdds som decimaltal och platsodds", () => {
    const s = g.races[0].starts[0];
    expect(s.result).toEqual({ place: 6, finishOrder: 6, disqualified: false, galloped: false, kmTime: "1.11,1", finalOdds: 19.6, placeOddsMin: 2.94, placeOddsMax: 2.94 });
    const winner = g.races[0].starts.find((x) => x.result?.place === 1)!;
    expect(winner.number).toBe(6);
    const unplacedGallop = all.find((x) => x.result?.place === 0 && x.result.galloped)!;
    expect(unplacedGallop).toBeTruthy();
    expect(all.some((x) => x.result?.kmTime === "u")).toBe(true);
  });
});

describe("parseStartDetail – races/<id>/start/<nr>", () => {
  const d = parseStartDetail(startDetail)!;
  it("ger häst, kusk och tidigare lopp", () => {
    expect(d.raceId).toBe("2026-10-24_7_11");
    expect(d.startNumber).toBe(1);
    expect(d.driver!.lastName).toBe("Jepson");
    expect(d.records.length).toBeGreaterThan(80);
    expect(d.records.length).toBeLessThanOrEqual(95);
  });
  it("tolkar ett record: place som sträng, odds i hundradelar, distans och spår i record.start", () => {
    expect(d.records[0]).toEqual({
      date: "2026-10-06",
      trackName: "Halmstad",
      trackId: 18,
      atgRaceRef: "2026-10-06_18_9",
      raceNumber: 9,
      distance: 2140,
      startMethod: "AUTO",
      postPosition: 7,
      place: 7,
      galloped: false,
      disqualified: false,
      scratched: false,
      kmTime: "1.12,9",
      odds: 6.33,
      driverName: "Robert Bergh",
      firstPrize: 125000,
    });
  });
  it("galopp med diskning, och strukna lopp markeras", () => {
    const gd = d.records.find((r) => r.date === "2025-10-15")!;
    // Sifferkoden { code: "4" } är ingen km-tid och visas inte.
    expect(gd).toMatchObject({ galloped: true, disqualified: true, place: null, kmTime: null });
    expect(d.records.some((r) => r.scratched)).toBe(true);
  });
  it("utländskt lopp utan kusk-id och spår går att läsa", () => {
    const fr = d.records.find((r) => r.date === "2023-12-31")!;
    expect(fr).toMatchObject({ trackName: "Vincennes", postPosition: null, driverName: "M Abrivard", startMethod: "VOLTE", disqualified: true });
  });
  it("ger inga dubbletter av (datum, bana)", () => {
    const keys = d.records.map((r) => `${r.date}|${r.trackName}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("kalendern", () => {
  it("hittar V85 med bannamn", () => {
    const games = parseCalendarDay(calendar);
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ id: "V85_2026-10-24_7_5", status: "bettable", trackIds: [7], trackName: "Jägersro" });
    expect(games[0].startTime.toISOString()).toBe("2026-10-24T13:00:00.000Z");
  });
  it("väljer första V85 vars start är senare än nu − 12 h", () => {
    const games = parseCalendarDay(calendar);
    expect(pickNextV85(games, new Date("2026-10-19T19:00:00Z"))?.id).toBe("V85_2026-10-24_7_5");
    // Lördag kväll: dagens omgång gäller fortfarande.
    expect(pickNextV85(games, new Date("2026-10-24T20:00:00Z"))?.id).toBe("V85_2026-10-24_7_5");
    // Söndag kväll: den är för gammal.
    expect(pickNextV85(games, new Date("2026-10-25T19:00:00Z"))).toBeNull();
  });
});

describe("typvakter och hjälpare", () => {
  it("kraschar aldrig på skräp", () => {
    const warns: string[] = [];
    expect(parseGame(null, (m) => warns.push(m))).toBeNull();
    expect(parseGame({ id: "V85_x", races: "nej" }, (m) => warns.push(m))).toBeNull();
    expect(parseGame({ id: "V85_2026-10-24_7_5", races: [{ id: 1 }] }, (m) => warns.push(m))).toBeNull();
    expect(parseStartDetail(42)).toBeNull();
    expect(parseCalendarDay({})).toEqual([]);
    expect(parseRecord({ date: "igår" })).toBeNull();
    expect(warns.length).toBeGreaterThan(0);
  });
  it("hoppar över en trasig start men behåller resten", () => {
    const copy = structuredClone(upcoming);
    copy.races[0].starts[0].horse = null;
    const warns: string[] = [];
    const g = parseGame(copy, (m) => warns.push(m))!;
    expect(g.races[0].starts).toHaveLength(11);
    expect(warns.some((w) => w.includes("avd 1"))).toBe(true);
  });
  it("formaterar km-tid, rekord och förstapris", () => {
    expect(formatKmTime({ minutes: 1, seconds: 9, tenths: 5 })).toBe("1.09,5");
    expect(formatKmTime({ code: "u" })).toBe("u");
    expect(formatKmTime("1.12,0")).toBeNull();
    expect(formatRecord({ code: "aK", time: { minutes: 1, seconds: 13, tenths: 2 } })).toBe("1.13,2aK");
    expect(parseFirstPrize("Pris: 400.000-200.000 kr")).toBe(400000);
    expect(parseFirstPrize("Inget pris")).toBeNull();
  });
  it("mapLimit kör högst n samtidigt och behåller ordningen", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  });
});
