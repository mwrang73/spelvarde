import { describe, expect, it } from "vitest";
import {
  calcLineWithX,
  checkFactors,
  factorFor,
  factorText,
  isXFactor,
  nextXFactor,
  parseFactor,
  parseSourceSupport,
  riktoddsX,
  SOURCE_SUPPORT_ERROR,
  sourceSupportText,
  stepSourceSupport,
  X_FACTOR_ORDER_ERROR,
  X_FACTOR_RANGE_ERROR,
} from "@/lib/xfactor";

const S = { xFactorTror: 1.25, xFactorStark: 1.5 };

describe("X-faktor (6.8)", () => {
  it("formeln med standardfaktorerna: 3,00 → 2,40 / 2,00, 3,20 → 2,56 / 2,13, 1,20 Stark → 1,01", () => {
    expect(riktoddsX(3, "TROR", S)).toBe(2.4);
    expect(riktoddsX(3, "STARK", S)).toBe(2);
    expect(riktoddsX(3.2, "TROR", S)).toBe(2.56);
    expect(riktoddsX(3.2, "STARK", S)).toBe(2.13);
    expect(riktoddsX(1.2, "STARK", S)).toBe(1.01);
    // Utan läge: oförändrat. Utan riktodds: null.
    expect(riktoddsX(3.2, "NONE", S)).toBe(3.2);
    expect(riktoddsX(null, "STARK", S)).toBeNull();
    expect(riktoddsX(null, "NONE", S)).toBeNull();
  });
  it("användarens egna faktorer och standard när inget anges", () => {
    expect(riktoddsX(3, "TROR", { xFactorTror: 1.5, xFactorStark: 2 })).toBe(2);
    expect(riktoddsX(3, "STARK", { xFactorTror: 1.5, xFactorStark: 2 })).toBe(1.5);
    expect(riktoddsX(3, "TROR")).toBe(2.4);
    expect([factorFor("NONE", S), factorFor("TROR", S), factorFor("STARK", S)]).toEqual([1, 1.25, 1.5]);
    expect(factorText("TROR", S)).toBe("÷1,25");
  });
  it("nästa läge vid X och Shift + X", () => {
    expect([nextXFactor("NONE"), nextXFactor("TROR"), nextXFactor("STARK")]).toEqual(["TROR", "STARK", "NONE"]);
    expect([nextXFactor("NONE", true), nextXFactor("STARK", true), nextXFactor("TROR", true)]).toEqual(["STARK", "TROR", "NONE"]);
  });
  it("X-steget i beräkningsraden", () => {
    const base = "Chans till topp 3 ≈ 31 % → 1 / 0,31 = 3,20";
    expect(calcLineWithX(base, 3.2, "TROR", S)).toBe(`${base} → ÷ 1,25 (Tror på) = 2,56`);
    expect(calcLineWithX(base, 3.2, "NONE", S)).toBe(base);
    expect(calcLineWithX(base, null, "STARK", S)).toBe(base);
  });
  it("lägen och källstöd valideras", () => {
    expect(["NONE", "TROR", "STARK"].every(isXFactor)).toBe(true);
    expect([null, "tror", "X", 1].some(isXFactor)).toBe(false);
    expect(parseSourceSupport(null)).toEqual({ ok: true, value: null });
    expect(parseSourceSupport(0)).toEqual({ ok: true, value: 0 });
    expect(parseSourceSupport(20)).toEqual({ ok: true, value: 20 });
    for (const bad of [-1, 21, 2.5, "3", undefined]) expect(parseSourceSupport(bad)).toEqual({ ok: false, error: SOURCE_SUPPORT_ERROR });
  });
  it("faktorerna: 1,05–3,00 i hundradelar och Stark > Tror", () => {
    expect(parseFactor(1.05)).toEqual({ ok: true, value: 1.05 });
    expect(parseFactor(3)).toEqual({ ok: true, value: 3 });
    for (const bad of [1.04, 3.01, 1.255, "1,25", NaN]) expect(parseFactor(bad)).toEqual({ ok: false, error: X_FACTOR_RANGE_ERROR });
    expect(checkFactors({ xFactorTror: 1.25, xFactorStark: 1.5 }).ok).toBe(true);
    expect(checkFactors({ xFactorTror: 1.5, xFactorStark: 1.5 })).toEqual({ ok: false, error: X_FACTOR_ORDER_ERROR });
    expect(checkFactors({ xFactorTror: 1.6, xFactorStark: 1.5 })).toEqual({ ok: false, error: X_FACTOR_ORDER_ERROR });
  });
  it("källstödets text och stegare", () => {
    expect(sourceSupportText(2, 4)).toBe("2 av 4 källor pekar ut hästen");
    expect(sourceSupportText(null, 4)).toBe("Inte ifyllt · 4 påslagna källor");
    expect(stepSourceSupport(null, 4, 1)).toBe(1);
    expect(stepSourceSupport(null, 4, -1)).toBe(0);
    expect(stepSourceSupport(4, 4, 1)).toBe(4);
    expect(stepSourceSupport(0, 4, -1)).toBe(0);
    // Sparat värde över m (en källa stängdes av): − fungerar, + gör ingenting.
    expect(stepSourceSupport(5, 3, -1)).toBe(4);
    expect(stepSourceSupport(5, 3, 1)).toBe(5);
  });
});
