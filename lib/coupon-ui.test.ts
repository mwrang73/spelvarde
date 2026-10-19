import { describe, expect, it } from "vitest";
import type { CouponLeg } from "@/lib/coupon";
import { couponBody, couponSummary, parseBudget, parseGuideline, parseRowPrice, stepLeg, toggleNumber } from "@/lib/coupon-ui";

const leg: CouponLeg = {
  leg: 7,
  starts: [
    { number: 1, scratched: false, spelbar: false, interesting: false, riktodds: 5, streck: 30 },
    { number: 3, scratched: false, spelbar: false, interesting: true, riktodds: 2.9, streck: 10 },
    { number: 5, scratched: false, spelbar: true, interesting: true, riktodds: 2.4, streck: 12 },
    { number: 8, scratched: true, spelbar: false, interesting: false, riktodds: null, streck: 40 },
    { number: 10, scratched: false, spelbar: true, interesting: true, riktodds: 3.2, streck: 8 },
  ],
};

describe("V85-raden i S6b", () => {
  it("+ följer förslagets ordning: Spelbar, Intressant, sedan streck; strukna aldrig", () => {
    let sel: number[] = [];
    const seen: number[][] = [];
    for (let i = 0; i < 5; i++) seen.push((sel = stepLeg(leg, sel, 1)));
    expect(seen).toEqual([[5], [5, 10], [3, 5, 10], [1, 3, 5, 10], [1, 3, 5, 10]]);
  });
  it("− tar bort den som kommer sist i ordningen men aldrig den sista hästen", () => {
    expect(stepLeg(leg, [1, 5, 10], -1)).toEqual([5, 10]);
    expect(stepLeg(leg, [10], -1)).toEqual([10]);
    // Eget val utanför ordningen (strukna) tas bort först.
    expect(stepLeg(leg, [5, 8], -1)).toEqual([5]);
  });
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
