import { describe, expect, it } from "vitest";
import { applyInteresting, applySpelbar, belowGuideline, forslag, oddsClass, oddsDiff, spelbar, spelbarState } from "@/lib/spelbar";

describe("Spelbar (6.1)", () => {
  it("Kentucky River: Unibet 3,10 mot riktodds 2,40 föreslås", () => {
    const m = { interesting: true, unibetOdds: 3.1, riktodds: 2.4, override: "NONE" as const };
    expect(forslag(m)).toBe(true);
    expect(spelbar(m)).toBe(true);
    expect(spelbarState(m)).toEqual({ forslag: true, spelbar: true, override: "NONE", belowGuideline: false, diff: 0.7, oddsClass: "over" });
  });
  it("Diva Ek: 1,25 mot 1,35 (−0,10) föreslås med toleransen 0,10, är nära och får riktlinjetaggen", () => {
    const m = { interesting: true, unibetOdds: 1.25, riktodds: 1.35, override: "NONE" as const };
    expect(forslag(m)).toBe(true);
    expect(spelbarState(m)).toEqual({ forslag: true, spelbar: true, override: "NONE", belowGuideline: true, diff: -0.1, oddsClass: "near" });
    // Med toleransen 0,00 föreslås den inte.
    expect(spelbarState(m, 2, 0)).toEqual({ forslag: false, spelbar: false, override: "NONE", belowGuideline: true, diff: -0.1, oddsClass: "under" });
  });
  it("1,24 mot 1,35 (−0,11) föreslås inte", () => {
    expect(forslag({ interesting: true, unibetOdds: 1.24, riktodds: 1.35 })).toBe(false);
    expect(oddsClass(1.24, 1.35)).toBe("under");
  });
  it("1,98 mot 2,05 är nära, föreslås och får taggen Under 2,00", () => {
    const s = spelbarState({ interesting: true, unibetOdds: 1.98, riktodds: 2.05, override: "NONE" });
    expect(s).toMatchObject({ forslag: true, oddsClass: "near", belowGuideline: true, diff: -0.07 });
  });
  it("med X-faktor räknas skillnaden mot riktoddset med X (anroparen skickar riktoddsX)", () => {
    // Riktodds 3,00 med Tror på (1,25) = 2,40: Unibet 2,35 är nära, 2,25 är under.
    expect(oddsClass(2.35, 2.4)).toBe("near");
    expect(oddsClass(2.25, 2.4)).toBe("under");
    expect(forslag({ interesting: true, unibetOdds: 2.35, riktodds: 2.4 })).toBe(true);
  });
  it("oddsklassen: över, nära (gränsen ingår), under och null", () => {
    expect(oddsClass(2.11, 2.1)).toBe("over");
    expect(oddsClass(2.1, 2.1)).toBe("near");
    expect(oddsClass(2.0, 2.1)).toBe("near");
    expect(oddsClass(1.99, 2.1)).toBe("under");
    expect(oddsClass(2.0, 2.1, 0.05)).toBe("under");
    expect(oddsClass(2.05, 2.1, 0.05)).toBe("near");
    // Flyttal: 1,15 − 1,25 = −0,10000000000000009 räknas som −0,10.
    expect(oddsClass(1.15, 1.25)).toBe("near");
    expect(oddsClass(null, 2.1)).toBeNull();
    expect(oddsClass(2.1, null)).toBeNull();
    // Klassen gäller även hästar som inte är Intressant; förslaget kräver Intressant.
    expect(forslag({ interesting: false, unibetOdds: 3, riktodds: 2 })).toBe(false);
  });
  it("override styr oberoende av klassen: OFF med över, ON med under", () => {
    const off = spelbarState({ interesting: true, unibetOdds: 3.1, riktodds: 2.4, override: "OFF" });
    expect(off).toMatchObject({ spelbar: false, oddsClass: "over" });
    const on = spelbarState({ interesting: true, unibetOdds: 1.5, riktodds: 2.4, override: "ON" });
    expect(on).toMatchObject({ spelbar: true, oddsClass: "under" });
  });
  it("kräver Intressant, Unibet-odds och riktodds; lika odds räcker, även med toleransen 0,00", () => {
    expect(forslag({ interesting: false, unibetOdds: 3.1, riktodds: 2.4 })).toBe(false);
    expect(forslag({ interesting: true, unibetOdds: null, riktodds: 2.4 })).toBe(false);
    expect(forslag({ interesting: true, unibetOdds: 3.1, riktodds: null })).toBe(false);
    expect(forslag({ interesting: true, unibetOdds: 2.4, riktodds: 2.4 })).toBe(true);
    expect(forslag({ interesting: true, unibetOdds: 2.4, riktodds: 2.4 }, 0)).toBe(true);
    expect(forslag({ interesting: true, unibetOdds: 2.39, riktodds: 2.4 }, 0)).toBe(false);
  });
  it("override styr: ON alltid på, OFF alltid av", () => {
    expect(spelbar({ interesting: true, unibetOdds: 1.2, riktodds: 2.4, override: "ON" })).toBe(true);
    expect(spelbar({ interesting: true, unibetOdds: 3.1, riktodds: 2.4, override: "OFF" })).toBe(false);
  });
  it("tryck: samma som förslaget ger NONE, annat ger ON/OFF", () => {
    const sugg = { interesting: true, unibetOdds: 3.1, riktodds: 2.4 };
    expect(applySpelbar(sugg, "off")).toEqual({ interesting: true, override: "OFF" });
    expect(applySpelbar(sugg, "on")).toEqual({ interesting: true, override: "NONE" });
    const no = { interesting: true, unibetOdds: 1.24, riktodds: 1.35 };
    expect(applySpelbar(no, "on")).toEqual({ interesting: true, override: "ON" });
    // Nära räknas som förslaget: "on" ger NONE, "off" ger OFF.
    const near = { interesting: true, unibetOdds: 1.25, riktodds: 1.35 };
    expect(applySpelbar(near, "on")).toEqual({ interesting: true, override: "NONE" });
    expect(applySpelbar(near, "off")).toEqual({ interesting: true, override: "OFF" });
    expect(applySpelbar(near, "on", 0)).toEqual({ interesting: true, override: "ON" });
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
