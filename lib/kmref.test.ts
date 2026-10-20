import { describe, expect, it } from "vitest";
import { bestAdjusted, kmRef, kmSeconds, timeOutliers } from "@/lib/kmref";

describe("km-tider för signalen tid", () => {
  it("samma km-tid är bättre på längre distans", () => {
    const rec = (d: number) => ({ kmTime: "1.13,4", distance: d, startMethod: "AUTO", galloped: false, disqualified: false });
    expect(bestAdjusted([rec(2140)])!).toBeLessThan(bestAdjusted([rec(1640)])!);
    expect(kmRef("AUTO", 2640)! - kmRef("AUTO", 2140)!).toBeCloseTo(0.995, 3);
    expect(kmSeconds("1.13,4")).toBeCloseTo(73.4, 6);
  });
  it("galopp, diskning och koder räknas inte", () => {
    expect(bestAdjusted([{ kmTime: "1.10,0", distance: 2140, startMethod: "AUTO", galloped: true, disqualified: false }])).toBeNull();
    expect(bestAdjusted([{ kmTime: "u", distance: 2140, startMethod: "AUTO", galloped: false, disqualified: false }])).toBeNull();
  });
  it("bara en häst som sticker ut extremt får ett värde", () => {
    expect(timeOutliers([0, 0.2, -0.1, 0.1, 0.3, -2])).toEqual([0, 0, 0, 0, 0, expect.any(Number)]);
    expect(timeOutliers([0, 0.2, -0.1, 0.1, 0.3, -2])[5]).toBeGreaterThan(0);
    expect(timeOutliers([0, -2, null])).toEqual([0, 0, 0]);
  });
});
