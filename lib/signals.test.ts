import { describe, expect, it } from "vitest";
import { horseSignals, pctSignal, valuePct } from "@/lib/signals";

describe("positiva signaler", () => {
  it("gränserna 75 % plats och 50 % vinst", () => {
    expect(pctSignal("place", 75, 10)).toBe("good");
    expect(pctSignal("place", 74.9, 10)).toBeNull();
    expect(pctSignal("win", 50, 10)).toBe("good");
    expect(pctSignal("win", 49, 10)).toBeNull();
  });
  it("färre än 5 starter blir dämpat, inte grönt", () => {
    expect(pctSignal("place", 100, 4)).toBe("few");
    expect(pctSignal("place", 100, 5)).toBe("good");
    expect(pctSignal("place", null, 10)).toBeNull();
    expect(pctSignal("place", 80, 0)).toBeNull();
  });
  it("signalerna i listan över spelbara", () => {
    const chips = horseSignals({ placePct: 80, winPct: 40, starts: 12, formTones: ["win", "plain", "second", "plain", "gal"], postPlacePct: 41.2, bestPlaceNumber: true });
    expect(chips.map((c) => c.key)).toEqual(["form", "plats", "spar"]);
    expect(chips[0].text).toBe("2 av 5 senaste etta/tvåa");
    expect(horseSignals({ placePct: 90, winPct: 60, starts: 3, formTones: ["win"], postPlacePct: null, bestPlaceNumber: false })).toEqual([]);
  });
  it("värdet mot riktoddset", () => {
    expect(valuePct(2.4, 2)).toBe(20);
    expect(valuePct(1.8, 2)).toBe(-10);
    expect(valuePct(null, 2)).toBeNull();
  });
});
