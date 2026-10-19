import { describe, expect, it } from "vitest";
import { digitsToOdds, displayDigits, isValidOdds, keysToDigits, ODDS_RANGE_ERROR, parseOddsText, popDigit, pushDigit, shouldAutoAdvance } from "@/lib/odds-input";

const type = (keys: string[]) => keys.reduce((d, k) => pushDigit(d, k), "");

describe("knappsatsen (S4)", () => {
  it("3-1-0 ger 3,10 och hoppar vidare", () => {
    const d = type(["3", "1", "0"]);
    expect(digitsToOdds(d)).toBe(3.1);
    expect(displayDigits(d)).toBe("3,10");
    expect(shouldAutoAdvance(d)).toBe(true);
  });
  it("1-2-5-0 ger 12,50 och kräver Nästa", () => {
    const d = type(["1", "2", "5", "0"]);
    expect(digitsToOdds(d)).toBe(12.5);
    expect(shouldAutoAdvance(d)).toBe(false);
    expect(shouldAutoAdvance("125")).toBe(true);
  });
  it("2 blir 0,02 tills fler siffror kommer, högst 4 siffror", () => {
    expect(displayDigits(type(["2"]))).toBe("0,02");
    expect(type(["1", "2", "3", "4", "5"])).toBe("1234");
    expect(popDigit("310")).toBe("31");
    expect(displayDigits("")).toBe("");
  });
  it("komma, punkt och inledande nolla ignoreras", () => {
    expect(keysToDigits("3,10")).toBe("310");
    expect(keysToDigits("3.10")).toBe("310");
    expect(type(["0", "3", "1", "0"])).toBe("310");
  });
  it("intervallet 1,01–99,99", () => {
    expect(isValidOdds(1.01)).toBe(true);
    expect(isValidOdds(99.99)).toBe(true);
    expect(isValidOdds(1)).toBe(false);
    expect(isValidOdds(100)).toBe(false);
    expect(isValidOdds(3.105)).toBe(false);
    expect(isValidOdds("3.1")).toBe(false);
    expect(shouldAutoAdvance("100")).toBe(false);
    expect(shouldAutoAdvance("101")).toBe(true);
  });
});

describe("fältet i S6a", () => {
  it("samma tolkning som knappsatsen, och decimaltal med komma", () => {
    expect(parseOddsText("310")).toEqual({ ok: true, value: 3.1 });
    expect(parseOddsText("3,10")).toEqual({ ok: true, value: 3.1 });
    expect(parseOddsText("3,1")).toEqual({ ok: true, value: 3.1 });
    expect(parseOddsText("12.5")).toEqual({ ok: true, value: 12.5 });
    expect(parseOddsText("1250")).toEqual({ ok: true, value: 12.5 });
    expect(parseOddsText("1")).toEqual({ ok: false, error: ODDS_RANGE_ERROR });
    expect(parseOddsText("abc")).toEqual({ ok: false, error: ODDS_RANGE_ERROR });
    expect(parseOddsText("100,00")).toEqual({ ok: false, error: ODDS_RANGE_ERROR });
  });
});
