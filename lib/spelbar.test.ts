import { describe, expect, it } from "vitest";
import { applyInteresting, applySpelbar, belowGuideline, forslag, oddsDiff, spelbar, spelbarState } from "@/lib/spelbar";

describe("Spelbar (6.1)", () => {
  it("Kentucky River: Unibet 3,10 mot riktodds 2,40 föreslås", () => {
    const m = { interesting: true, unibetOdds: 3.1, riktodds: 2.4, override: "NONE" as const };
    expect(forslag(m)).toBe(true);
    expect(spelbar(m)).toBe(true);
    expect(spelbarState(m)).toEqual({ forslag: true, spelbar: true, override: "NONE", belowGuideline: false, diff: 0.7 });
  });
  it("Diva Ek: 1,25 mot 1,35 föreslås inte, och får riktlinjetaggen", () => {
    const m = { interesting: true, unibetOdds: 1.25, riktodds: 1.35, override: "NONE" as const };
    expect(forslag(m)).toBe(false);
    expect(spelbarState(m)).toEqual({ forslag: false, spelbar: false, override: "NONE", belowGuideline: true, diff: -0.1 });
  });
  it("kräver Intressant, Unibet-odds och riktodds, och lika odds räcker inte", () => {
    expect(forslag({ interesting: false, unibetOdds: 3.1, riktodds: 2.4 })).toBe(false);
    expect(forslag({ interesting: true, unibetOdds: null, riktodds: 2.4 })).toBe(false);
    expect(forslag({ interesting: true, unibetOdds: 3.1, riktodds: null })).toBe(false);
    expect(forslag({ interesting: true, unibetOdds: 2.4, riktodds: 2.4 })).toBe(false);
  });
  it("override styr: ON alltid på, OFF alltid av", () => {
    expect(spelbar({ interesting: true, unibetOdds: 1.2, riktodds: 2.4, override: "ON" })).toBe(true);
    expect(spelbar({ interesting: true, unibetOdds: 3.1, riktodds: 2.4, override: "OFF" })).toBe(false);
  });
  it("tryck: samma som förslaget ger NONE, annat ger ON/OFF", () => {
    const sugg = { interesting: true, unibetOdds: 3.1, riktodds: 2.4 };
    expect(applySpelbar(sugg, "off")).toEqual({ interesting: true, override: "OFF" });
    expect(applySpelbar(sugg, "on")).toEqual({ interesting: true, override: "NONE" });
    const no = { interesting: true, unibetOdds: 1.25, riktodds: 1.35 };
    expect(applySpelbar(no, "on")).toEqual({ interesting: true, override: "ON" });
    expect(applySpelbar(no, "off")).toEqual({ interesting: true, override: "NONE" });
    expect(applySpelbar(no, "auto")).toEqual({ interesting: true, override: "NONE" });
  });
  it("Spelbar för hand sätter Intressant, och borttagen Intressant nollställer override", () => {
    expect(applySpelbar({ interesting: false, unibetOdds: null, riktodds: 2.4 }, "on")).toEqual({ interesting: true, override: "ON" });
    // Förslaget blir sant när hästen blir Intressant: då räcker NONE.
    expect(applySpelbar({ interesting: false, unibetOdds: 3.1, riktodds: 2.4 }, "on")).toEqual({ interesting: true, override: "NONE" });
    expect(applyInteresting("ON", false)).toBe("NONE");
    expect(applyInteresting("OFF", true)).toBe("OFF");
  });
  it("manuella val står kvar när oddset ändras", () => {
    const on = { interesting: true, riktodds: 2.4, override: "ON" as const };
    expect(spelbar({ ...on, unibetOdds: 1.5 })).toBe(true);
    expect(spelbar({ ...on, unibetOdds: 5 })).toBe(true);
    const off = { interesting: true, riktodds: 2.4, override: "OFF" as const };
    expect(spelbar({ ...off, unibetOdds: 5 })).toBe(false);
  });
  it("riktlinjen påverkar inte förslaget", () => {
    expect(belowGuideline(1.99)).toBe(true);
    expect(belowGuideline(2)).toBe(false);
    expect(belowGuideline(2.4, 2.5)).toBe(true);
    expect(belowGuideline(null)).toBe(false);
    expect(forslag({ interesting: true, unibetOdds: 1.6, riktodds: 1.5 })).toBe(true);
    expect(oddsDiff(null, 2)).toBeNull();
  });
});
