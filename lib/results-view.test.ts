import { describe, expect, it } from "vitest";
import { nextCard, othersLine, raceResultView } from "@/lib/results-view";
import { mkMark, mkRace, mkStart } from "@/lib/test-round";
import type { StartDto, StartOutcomeDto } from "@/lib/types";

const out = (p: Partial<StartOutcomeDto> = {}): StartOutcomeDto => ({
  interesting: false,
  spelbar: false,
  bet: false,
  xFactor: "NONE",
  hit: null,
  place: null,
  disqualified: false,
  unibetOdds: null,
  trollspotRank: null,
  trollspotMinOdds: null,
  trollspotEstOdds: null,
  ...p,
});
const res = (place: number | null, p: Partial<NonNullable<StartDto["result"]>> = {}) => ({ place, finishOrder: place, disqualified: false, galloped: false, kmTime: null, finalOdds: null, ...p });

// V85-7 i mockupen: 5 Kentucky River vann (Bet), 10 Barack Face 4:a (Bet),
// dött lopp om andraplatsen, en diskad Bet, en struken och övriga.
const starts = [
  mkStart("a", 1, { horse: { id: "h1", name: "Laredo Boko", sex: null, age: null, record: null, earnings: null }, result: res(6) }),
  mkStart("b", 2, { result: res(2), outcome: out({ interesting: true, hit: true, trollspotRank: 4 }) }),
  mkStart("c", 3, { result: res(null, { disqualified: true, galloped: true }), outcome: out({ bet: true, interesting: true, hit: false }) }),
  mkStart("d", 4, { result: res(2) }),
  mkStart("e", 5, { result: res(1), outcome: out({ bet: true, interesting: true, spelbar: true, hit: true }) }),
  mkStart("f", 6, { horse: { id: "h6", name: "Boscha Diablo", sex: null, age: null, record: null, earnings: null }, result: res(0), outcome: out({ interesting: true, hit: false }) }),
  mkStart("g", 7, { scratched: true, outcome: null }),
  mkStart("h", 8, { result: res(7), outcome: out({ bet: true, interesting: true, hit: false }) }),
  mkStart("i", 9, { result: res(null, { disqualified: true }) }),
  mkStart("j", 10, { result: res(4, { galloped: true }), outcome: out({ bet: true, interesting: true, hit: false }) }),
];
const race = mkRace(7, starts, { started: true, resultAt: "2026-10-24T17:19:00.000Z" });

describe("resultatvyn", () => {
  const v = raceResultView(race);
  it("placering 1–4 med dött lopp i startnummerordning, och Bet-utfallet", () => {
    expect(v.placed.map((p) => [p.place, p.start.number, p.bet])).toEqual([
      [1, 5, "hit"],
      [2, 2, null],
      [2, 4, null],
      [4, 10, "miss"],
    ]);
    expect(v.placed[3].galloped).toBe(true);
    expect(v.placed[1].trollspotRank).toBe(4);
  });
  it("5 eller sämre: Bet som missade med 5+ eller d", () => {
    expect(v.betMisses.map((b) => [b.start.number, b.label, b.disqualified, b.galloped])).toEqual([
      [3, "d", true, true],
      [8, "5+", false, false],
    ]);
  });
  it("övriga på en rad med märken och (diskad); strukna syns inte", () => {
    expect(v.others.map((o) => o.number)).toEqual([1, 6, 9]);
    expect(othersLine(v.others)).toBe("1 Laredo Boko · 6 Boscha Diablo I · 9 Häst i (diskad)");
    const all = [...v.placed.map((p) => p.start.number), ...v.betMisses.map((b) => b.start.number), ...v.others.map((o) => o.number)];
    expect(all).not.toContain(7);
    expect(all.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10]);
  });
});

describe("Nästa-kortet", () => {
  const now = Date.parse("2026-10-24T15:25:00.000Z");
  const r = (leg: number, p: Parameters<typeof mkRace>[2] = {}, s: StartDto[] = []) => mkRace(leg, s, { startAt: `2026-10-24T${String(8 + leg).padStart(2, "0")}:00:00.000Z`, ...p });
  it("nästa avdelning har inte startat: dina hästar, annars loppnamnet", () => {
    const mine = [mkStart("x", 3, { horse: { id: "hx", name: "Blixt Lane", sex: null, age: null, record: null, earnings: null }, mark: mkMark("x", { bet: true }) }), mkStart("y", 4, { horse: { id: "hy", name: "Django Silver", sex: null, age: null, record: null, earnings: null }, mark: mkMark("y", { interesting: true }) })];
    const races = [r(7, { started: true }), r(8, {}, mine)];
    expect(nextCard("V85", races[0], races, "R", now, null)).toEqual({ title: "V85-8 startar 18:00", text: "Blixt Lane är Bet. Django Silver är Intressant.", label: "Till V85-8", href: "/omgang/R/avd/8" });
    expect(nextCard("V85", races[0], [races[0], r(8)], "R", now, null).text).toBe("Lopp 8");
  });
  it("nästa avdelning har startat: resultat eller pågår", () => {
    const sum = { bet: { hits: 1, total: 1 }, spelbar: { hits: 0, total: 0 }, interesting: { hits: 1, total: 1 }, trollspot: { hits: 0, total: 0 } };
    const races = [r(6, { started: true }), r(7, { started: true, resultAt: "x", summary: sum })];
    expect(nextCard("V85", races[0], races, "R", now, null)).toMatchObject({ title: "V85-7 · resultat", text: "Träff 1/1." });
    expect(nextCard("V85", races[0], [races[0], r(7, { started: true })], "R", now, null)).toMatchObject({ title: "V85-7 pågår", text: "Väntar på resultat." });
  });
  it("sista loppet: klar med summeringen, eller vilka som väntar", () => {
    const sum = { bet: { hits: 2, total: 4 }, spelbar: { hits: 3, total: 6 }, interesting: { hits: 6, total: 13 }, trollspot: { hits: 0, total: 0 } };
    const done = [r(7, { started: true, resultAt: "x" }), r(8, { started: true, resultAt: "x" })];
    expect(nextCard("V85", done[1], done, "R", now, sum)).toEqual({ title: "Omgången är klar", text: "Bet 2/4 träff · Spelbar 3/6 topp 3 · Intressant 6/13 topp 3.", label: "Till omgången", href: "/omgang/R" });
    const waiting = [r(5, { started: true }), r(6, { started: true }), r(7, { cancelled: true }), r(8, { started: true, resultAt: "x" })];
    expect(nextCard("V85", waiting[3], waiting, "R", now, sum)).toMatchObject({ title: "Väntar på V85-5", text: "V85-5 och V85-6 saknar resultat." });
  });
});
