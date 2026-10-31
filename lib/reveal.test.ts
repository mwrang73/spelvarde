import { describe, expect, it } from "vitest";
import { hideLeg, hidesCommentResult, isShown, parseReveal, REVEAL_MAX_ROUNDS, shownLegsOf, showLeg } from "@/lib/reveal";

describe("resultatskyddets val (E8 17.3)", () => {
  it("tom och skadad lagring ger tomt", () => {
    expect(parseReveal(null)).toEqual({});
    expect(parseReveal("")).toEqual({});
    expect(parseReveal("{inte json")).toEqual({});
    expect(parseReveal("[1,2]")).toEqual({});
    expect(parseReveal('{"r1":"x","r2":[1,"a",1,99.5]}')).toEqual({ r2: [1] });
  });

  it("Visa lägger till ett lopp, Dölj tar bort det, andra lopp och omgångar rörs inte", () => {
    let s = showLeg({}, "r1", 4);
    s = showLeg(s, "r1", 2);
    s = showLeg(s, "r2", 4);
    expect(s).toEqual({ r1: [2, 4], r2: [4] });
    s = hideLeg(s, "r1", 4);
    expect(s).toEqual({ r1: [2], r2: [4] });
    expect(shownLegsOf(s, "r3")).toEqual([]);
    expect(hideLeg(hideLeg(s, "r1", 2), "r2", 4)).toEqual({});
  });

  it("över 40 omgångar tar bort den äldsta", () => {
    let s = {};
    for (let i = 0; i <= REVEAL_MAX_ROUNDS; i++) s = showLeg(s, `omg-${i}`, 1);
    expect(Object.keys(s)).toHaveLength(REVEAL_MAX_ROUNDS);
    expect(shownLegsOf(s, "omg-0")).toEqual([]);
    expect(shownLegsOf(s, `omg-${REVEAL_MAX_ROUNDS}`)).toEqual([1]);
  });

  it("isShown: inget resultat ger false, inställt ger false, satt och resultat ger true", () => {
    expect(isShown({ leg: 1, resultAt: null, cancelled: false }, [1])).toBe(false);
    expect(isShown({ leg: 1, resultAt: "2026-10-31T16:00:00Z", cancelled: true }, [1])).toBe(false);
    expect(isShown({ leg: 1, resultAt: "2026-10-31T16:00:00Z", cancelled: false }, [])).toBe(false);
    expect(isShown({ leg: 1, resultAt: "2026-10-31T16:00:00Z", cancelled: false }, [1])).toBe(true);
  });

  it("hästkortet: placeringen utelämnas bara för dolt lopp i samma omgång", () => {
    const c = { round: { id: "r1" }, leg: 4 };
    expect(hidesCommentResult(c, "r1", [])).toBe(true);
    expect(hidesCommentResult(c, "r1", [4])).toBe(false);
    expect(hidesCommentResult(c, "r2", [])).toBe(false);
  });
});
