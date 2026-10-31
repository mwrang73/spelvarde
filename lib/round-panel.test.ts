import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLegValues } from "@/lib/atg";
import { roundPanel } from "@/lib/round-panel";
import { mkRace, mkStart } from "@/lib/test-round";
import type { RaceDto, StartResultDto } from "@/lib/types";

const NOW = Date.parse("2026-10-31T16:00:00Z");
const res = (place: number): StartResultDto => ({ place, finishOrder: null, disqualified: false, galloped: false, kmTime: null, finalOdds: null });

// Lopp 1–6 har resultat med nummer `winner` som etta, övriga har inte startat.
function race(leg: number, winner: number | number[] | null, p: Partial<RaceDto> = {}): RaceDto {
  const winners = winner === null ? [] : [winner].flat();
  const starts = [1, 2, 3, 4].map((n) => mkStart(`s${leg}-${n}`, n, { result: winner === null ? null : res(winners.includes(n) ? 1 : 5), horse: { name: `Häst ${leg}${n}` } as never }));
  return mkRace(leg, starts, { startAt: new Date(NOW - (10 - leg) * 600_000).toISOString(), resultAt: winner === null ? null : "2026-10-31T15:00:00Z", cancelled: false, ...p });
}
const input = (over: Partial<Parameters<typeof roundPanel>[0]> = {}) => ({ gameType: "V85", races: [race(1, 1), race(2, 2), race(3, 3)], row: null, shownLegs: [1, 2, 3], values: [], selectedLeg: 3, runningLeg: null, now: NOW, ...over });
const VALUES = [
  { leg: 1, value: 37, systems: 386931 },
  { leg: 2, value: 99, systems: 145479 },
  { leg: 3, value: 347, systems: 41763 },
];

describe("roundPanel", () => {
  it("visar vinnaren och rätt eller fel mot raden", () => {
    const p = roundPanel(input({ row: { selections: { 1: [1], 2: [1, 3], 3: [3] } } }));
    expect(p.rows.map((r) => r.cell)).toMatchObject([
      { kind: "win", number: 1, name: "Häst 11", hit: true },
      { kind: "win", number: 2, hit: false },
      { kind: "win", number: 3, hit: true },
    ]);
    expect(p.score).toEqual({ text: "2 av 3 rätt", verdict: { tone: "down", text: "✗ Spräckt i V85-2" } });
  });
  it("utan rad: vinnarna utan rätt eller fel, och ingen summa", () => {
    const p = roundPanel(input());
    expect(p.rows[0].cell).toMatchObject({ kind: "win", hit: null });
    expect(p.score).toBeNull();
  });
  it("dolt lopp avslöjar varken vinnare, rätt eller värde", () => {
    const p = roundPanel(input({ shownLegs: [1], values: VALUES, row: { selections: { 1: [1], 2: [2] } } }));
    expect(p.rows[1].cell).toMatchObject({ kind: "text", text: "Resultat dolt" });
    expect(JSON.stringify(p.rows[1])).not.toContain("Häst 22");
    expect(p.value).toMatchObject({ value: 37, after: "efter V85-1" });
    expect(p.score).toEqual({ text: "1 av 1 rätt", verdict: { tone: "plain", text: "Alla rätt hittills" } });
  });
  it("överhoppat lopp: värdet efter det högsta visade loppet", () => {
    const p = roundPanel(input({ shownLegs: [1, 3], values: VALUES }));
    expect(p.value).toMatchObject({ value: 347, systems: 41763, after: "efter V85-3" });
    expect(p.lastShownLeg).toBe(3);
  });
  it("saknas värdet för högsta loppet visas närmast lägre med rätt etikett", () => {
    const p = roundPanel(input({ values: VALUES.slice(0, 2) }));
    expect(p.value).toMatchObject({ value: 99, after: "efter V85-2" });
    expect(p.lastShownLeg).toBe(3);
  });
  it("inget visat ger inget värde", () => {
    expect(roundPanel(input({ shownLegs: [], values: VALUES })).value).toBeNull();
  });
  it("alla lopp visade: Utdelning och Alla rätt. Annars Värde", () => {
    const row = { selections: { 1: [1], 2: [2], 3: [3] } };
    const all = roundPanel(input({ row, values: VALUES }));
    expect(all.value?.label).toBe("Utdelning 8 rätt");
    expect(all.score?.verdict).toEqual({ tone: "up", text: "✓ Alla rätt" });
    expect(roundPanel(input({ row, values: VALUES, shownLegs: [1, 2] })).value?.label).toBe("Värde 8 rätt");
    expect(roundPanel(input({ row, values: VALUES.slice(0, 2) })).value?.label).toBe("Värde 8 rätt");
  });
  it("spelformen styr namnen", () => {
    const p = roundPanel(input({ gameType: "V75", values: VALUES }));
    expect(p.rows[0].name).toBe("V75-1");
    expect(p.value?.label).toBe("Utdelning 7 rätt");
  });
  it("dött lopp: första på brickan, alla räknas som rätt", () => {
    const p = roundPanel(input({ races: [race(1, [1, 3])], shownLegs: [1], row: { selections: { 1: [3] } } }));
    expect(p.rows[0].cell).toMatchObject({ kind: "win", number: 1, name: "Häst 11 · 3 Häst 13", hit: true });
  });
  it("kommande, pågående, väntande och inställt lopp", () => {
    const future = race(4, null, { startAt: new Date(NOW + 600_000).toISOString() });
    const running = race(5, null, { startAt: new Date(NOW - 60_000).toISOString() });
    const waiting = race(6, null, { startAt: new Date(NOW - 120_000).toISOString() });
    const cancelled = race(7, null, { cancelled: true });
    const p = roundPanel(input({ races: [future, running, waiting, cancelled], shownLegs: [], runningLeg: 5 }));
    expect(p.rows[0].cell).toMatchObject({ kind: "text", text: expect.stringMatching(/^Start \d\d:\d\d$/) });
    expect(p.rows[1].cell).toMatchObject({ text: "Pågår", running: true });
    expect(p.rows[2].cell).toMatchObject({ text: "Väntar på resultat", running: false });
    expect(p.rows[3].cell).toMatchObject({ text: "Inställt", struck: true });
  });
  it("etiketten säger vilket lopp som visas", () => {
    const p = roundPanel(input({ row: { selections: { 3: [3] } } }));
    expect(p.rows[2].label).toBe("V85-3, vinnare 3 Häst 33, rätt. Visas nu");
    expect(p.rows[2].current).toBe(true);
    expect(p.rows[0].current).toBe(false);
  });
});

describe("parseLegValues", () => {
  const game = (races: unknown[]) => ({ races });
  const pool = (amount: unknown, systems: unknown) => ({ pools: { V85: { result: { value: { amount }, systems } } } });
  it("öre blir kronor, systems är en sträng hos ATG", () => {
    expect(parseLegValues(game([pool(3700, "386931"), pool(146600, "9898")]), "V85")).toEqual([
      { leg: 1, value: 37, systems: 386931 },
      { leg: 2, value: 1466, systems: 9898 },
    ]);
  });
  it("riktigt ATG-svar: värdet efter sista loppet är utdelningen, systems med decimalkomma", () => {
    const json = JSON.parse(readFileSync("test/fixtures/atg/game-V85_2026-10-17_16_5-results.json", "utf8"));
    const values = parseLegValues(json, "V85");
    expect(values).toHaveLength(8);
    expect(values[0]).toEqual({ leg: 1, value: 68, systems: 206652 });
    expect(values[7]).toEqual({ leg: 8, value: Math.round(json.pools.V85.result.payouts["8"].payout / 100), systems: 2 });
  });
  it("lopp utan resultat hoppas över, loppnumret behålls", () => {
    expect(parseLegValues(game([{ pools: {} }, pool(9900, 145479), {}]), "V85")).toEqual([{ leg: 2, value: 99, systems: 145479 }]);
  });
  it("annan spelforms pool räknas inte, trasig data ger inget", () => {
    expect(parseLegValues(game([pool(3700, "1")]), "V75")).toEqual([]);
    expect(parseLegValues(game([pool("x", "1"), pool(100, null)]), "V85")).toEqual([]);
    expect(parseLegValues(null, "V85")).toEqual([]);
  });
});
