import { describe, expect, it } from "vitest";
import { couponBody, couponSummary, parseBudget, parseGuideline, parseRowPrice, toggleNumber } from "@/lib/coupon-ui";
import type { MarkDto, RoundResponse } from "@/lib/types";

describe("V85-raden i S6b", () => {
  it("arket växlar en häst", () => {
    expect(toggleNumber([3, 10], 5)).toEqual([3, 5, 10]);
    expect(toggleNumber([3, 5, 10], 5)).toEqual([3, 10]);
  });
  it("rader, kostnad, kvar och över budget med radpris 0,50", () => {
    const sel = { 1: [3, 10], 2: [5], 3: [1, 2], 4: [1, 2, 3], 5: [1, 2], 6: [1, 2], 7: [1, 2, 3], 8: [1, 2] };
    expect(couponSummary(sel, 200, 0.5)).toEqual({ rows: 288, cost: 144, left: 56, over: false });
    expect(couponSummary(sel, 112, 0.5)).toEqual({ rows: 288, cost: 144, left: -32, over: true });
    expect(couponSummary({ 1: [3] }, 100, 0.5).rows).toBe(0);
  });
  it("kroppen till PUT: tomma avdelningar skickas inte, låsta sorteras", () => {
    expect(couponBody(200, null, { 1: [10, 3], 2: [] }, [7, 2, 7])).toEqual({ budget: 200, rowPrice: null, selections: { "1": [3, 10] }, lockedLegs: [2, 7] });
  });
  it("fälten för budget, radpris och riktlinje", () => {
    expect(parseBudget("1 000 kr")).toBe(1000);
    expect(parseBudget("12,5")).toBeNull();
    expect(parseBudget("200000")).toBeNull();
    expect(parseRowPrice("0,50")).toBe(0.5);
    expect(parseRowPrice("1")).toBe(1);
    expect(parseRowPrice("0")).toBeNull();
    expect(parseGuideline("2,00")).toBe(2);
    expect(parseGuideline("1")).toBeNull();
  });
});

// ---- E6: tippaLegs och couponBody -----------------------------------------------------------------

import { tippaLegs } from "@/lib/coupon-ui";

describe("E6: tippaLegs och couponBody", () => {
  const mark = (o: Partial<MarkDto>): MarkDto => ({ interesting: false, spelbar: false, bet: false, betOdds: null, xFactor: "NONE", riktoddsX: null, ...o }) as MarkDto;
  const start = (number: number, o: Record<string, unknown> = {}) => ({ number, scratched: false, streck: 10, riktodds: 3, horse: { name: `H${number}` }, signals: null, mark: null, ...o });
  const data = {
    round: { gameType: "V75" },
    races: [
      {
        leg: 1,
        startAt: "2026-11-28T15:20:00.000Z",
        cancelled: false,
        starts: [
          start(2, { mark: mark({ interesting: true, xFactor: "TROR", riktoddsX: 2.4 }), signals: { count: 5 } }),
          start(1, { mark: mark({ interesting: true, spelbar: true, bet: true, betOdds: 2.15 }) }),
          start(3, { scratched: true }),
        ],
      },
    ],
  } as unknown as RoundResponse;

  it("ger riktX med X-faktor, signalerna och Bet, sorterat på nummer och 1..legsFor", () => {
    const legs = tippaLegs(data);
    expect(legs).toHaveLength(7);
    expect(legs[0].starts.map((s) => s.number)).toEqual([1, 2, 3]);
    expect(legs[0].starts[1]).toMatchObject({ name: "H2", riktX: 2.4, signals: 5, xFactor: "TROR", interesting: true });
    expect(legs[0].starts[0]).toMatchObject({ riktX: 3, bet: true, betOdds: 2.15, spelbar: true });
    expect(legs[0].starts[2]).toMatchObject({ scratched: true, riktX: null });
    expect(tippaLegs(data, { xFactorTror: 1.5, xFactorStark: 2 })[0].starts[1].riktX).toBe(2);
    expect(legs[3]).toEqual({ leg: 4, startAt: "", cancelled: false, starts: [] });
  });

  it("couponBody tar med de nya fälten", () => {
    const b = couponBody(300, 0.5, { 4: [1], 1: [10, 7] }, [4], {
      spikCount: 4,
      allgMode: "AUTO",
      allgLeg: 5,
      legRoles: null,
      copiedAt: "2026-10-31T13:05:00.000Z",
      copiedSelections: { 4: [1] },
    });
    expect(b).toEqual({ budget: 300, rowPrice: 0.5, selections: { "1": [7, 10], "4": [1] }, lockedLegs: [4], spikCount: 4, allgMode: "AUTO", allgLeg: 5, legRoles: null, copiedAt: "2026-10-31T13:05:00.000Z", copiedSelections: { "4": [1] } });
    expect(Object.keys(couponBody(300, 0.5, {}, []))).toEqual(["budget", "rowPrice", "selections", "lockedLegs"]);
  });

  it("E6b: couponBody tar med maxPerLeg (tal eller null), och utelämnar det när det saknas", () => {
    const e6 = { spikCount: 4, allgMode: "AUTO" as const, allgLeg: 5, legRoles: null, copiedAt: null, copiedSelections: null };
    expect(couponBody(300, 0.5, {}, [], { ...e6, maxPerLeg: 7 }).maxPerLeg).toBe(7);
    const n = couponBody(300, 0.5, {}, [], { ...e6, maxPerLeg: null });
    expect("maxPerLeg" in n && n.maxPerLeg).toBeNull();
    expect("maxPerLeg" in couponBody(300, 0.5, {}, [], e6)).toBe(false);
  });
});
