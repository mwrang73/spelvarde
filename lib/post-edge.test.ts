import { describe, expect, it } from "vitest";
import { legName, legNames } from "@/lib/game-type";
import { postEdge, postEdgeText } from "@/lib/post-edge";

describe("spårfördelen", () => {
  const line = { bestNumber: { number: 3, pct: 14.6 }, bestPlace: { number: 4, pct: 39.8 } };

  it("bästa vinstspår, platsspår eller inget", () => {
    expect(postEdge(line, 3)).toBe("v");
    expect(postEdge(line, 4)).toBe("p");
    expect(postEdge(line, 5)).toBeNull();
  });

  it("samma spår bäst på båda ger ett märke", () => {
    expect(postEdge({ bestNumber: { number: 1, pct: 15.8 }, bestPlace: { number: 1, pct: 42.3 } }, 1)).toBe("vp");
  });

  it("travstatistik.se har bara vinst, och utan statistik blir det inget märke", () => {
    expect(postEdge({ bestNumber: { number: 3, pct: 14.6 }, bestPlace: null }, 3)).toBe("v");
    expect(postEdge({ bestNumber: null, bestPlace: null }, 3)).toBeNull();
  });

  it("texten för skärmläsare", () => {
    expect(postEdgeText("vp")).toBe("bästa spår för vinst och plats");
    expect(postEdgeText(null)).toBe("");
  });
});

describe("benämningen på loppen", () => {
  it("följer spelformen", () => {
    expect(legName("V85", 1)).toBe("V85-1");
    expect(legName("V75", 7)).toBe("V75-7");
  });

  it("listor", () => {
    expect(legNames("V85", [2])).toBe("V85-2");
    expect(legNames("V85", [2, 6])).toBe("V85-2 och V85-6");
    expect(legNames("V85", [1, 2, 6])).toBe("V85-1, V85-2 och V85-6");
  });
});
