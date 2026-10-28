import { describe, expect, it } from "vitest";
import { couponCost, couponDateLabel, couponText, favoriteStreck, parseCouponBody, rowCount, suggestCoupon, suggestionOrder, type CouponLeg, type CouponStart } from "@/lib/coupon";

const s = (number: number, o: Partial<CouponStart> = {}): CouponStart => ({ number, scratched: false, spelbar: false, interesting: false, riktodds: null, streck: null, ...o });

describe("rader och kostnad", () => {
  it("rader = produkten av antal valda, kostnad = rader × radpris", () => {
    const sel = { 1: [3, 10], 2: [5], 3: [1, 2, 3], 4: [4], 5: [6, 7], 6: [8], 7: [1, 2, 3, 4], 8: [2, 9, 11] };
    expect(rowCount(sel)).toBe(2 * 3 * 2 * 4 * 3);
    expect(couponCost(288, 0.5)).toBe(144);
    expect(couponCost(3, 0.33)).toBe(0.99);
    expect(rowCount({ 1: [3] })).toBe(0);
  });
});

describe("ordningen för förslag (6.5)", () => {
  it("Spelbar (lägst riktodds), övriga Intressant (lägst riktodds), resten efter streck; strukna inte med", () => {
    const starts = [
      s(1, { streck: 30 }),
      s(2, { interesting: true, riktodds: 3.0, streck: 5 }),
      s(3, { spelbar: true, interesting: true, riktodds: 4.0 }),
      s(4, { spelbar: true, interesting: true, riktodds: 2.5 }),
      s(5, { streck: 40 }),
      s(6, { interesting: true, riktodds: 1.8 }),
      s(7, { streck: 50, scratched: true }),
      s(8, { interesting: true, riktodds: null, streck: 20 }),
      s(9, { streck: null }),
    ];
    expect(suggestionOrder(starts)).toEqual([4, 3, 6, 2, 8, 5, 1, 9]);
  });
  it("saknas riktodds sorteras på streck", () => {
    expect(suggestionOrder([s(1, { interesting: true, streck: 5 }), s(2, { interesting: true, streck: 15 })])).toEqual([2, 1]);
  });
});

describe("Föreslå inom budget", () => {
  // Avd 1–8 med 6 hästar var, favoritens streck 60, 50, … 25 (avd 8 mest öppen).
  const legs: CouponLeg[] = [1, 2, 3, 4, 5, 6, 7, 8].map((leg) => ({
    leg,
    starts: [1, 2, 3, 4, 5, 6].map((n) => s(n, { streck: n === 1 ? 60 - (leg - 1) * 5 : 10 - n })),
  }));

  it("1 häst per avdelning, sedan varv i ordningen mest öppna lopp först, inom budget", () => {
    const sel = suggestCoupon(legs, { budget: 20, rowPrice: 0.5, locked: [], current: {} });
    // 40 rader ryms (20 kr). Varv 1: avd 8, 7, 6, 5, 4 … så länge det ryms.
    const rows = rowCount(sel);
    expect(couponCost(rows, 0.5)).toBeLessThanOrEqual(20);
    expect(sel[8].length).toBeGreaterThanOrEqual(sel[1].length);
    expect(sel[1]).toEqual([1]);
    // Ingen enskild avdelning kan få en häst till utan att budgeten spricker.
    for (const leg of [1, 2, 3, 4, 5, 6, 7, 8]) {
      if (sel[leg].length < 6) expect(couponCost((rows / sel[leg].length) * (sel[leg].length + 1), 0.5)).toBeGreaterThan(20);
    }
    expect(sel).toEqual({ 1: [1], 2: [1], 3: [1], 4: [1, 2], 5: [1, 2], 6: [1, 2], 7: [1, 2], 8: [1, 2] });
  });

  it("låsta avdelningar behåller sitt val och räknas in i kostnaden", () => {
    const sel = suggestCoupon(legs, { budget: 20, rowPrice: 0.5, locked: [8], current: { 8: [2, 4, 5, 6] } });
    expect(sel[8]).toEqual([2, 4, 5, 6]);
    expect(couponCost(rowCount(sel), 0.5)).toBeLessThanOrEqual(20);
    expect(rowCount(sel)).toBe(4 * 2 * 2 * 2);
  });

  it("startade avdelningar räknas som låsta, och för liten budget ger bara spikar", () => {
    const started = legs.map((l) => (l.leg === 1 ? { ...l, started: true } : l));
    const sel = suggestCoupon(started, { budget: 0, rowPrice: 0.5, locked: [], current: { 1: [3, 4] } });
    expect(sel[1]).toEqual([3, 4]);
    for (const leg of [2, 3, 4, 5, 6, 7, 8]) expect(sel[leg]).toHaveLength(1);
  });

  it("Spelbar först i avdelningen", () => {
    const l: CouponLeg[] = [{ leg: 1, starts: [s(1, { streck: 50 }), s(2, { spelbar: true, interesting: true, riktodds: 3 })] }];
    expect(suggestCoupon(l, { budget: 0, rowPrice: 0.5, locked: [], current: {} })[1]).toEqual([2]);
    expect(favoriteStreck(l[0].starts)).toBe(50);
  });
});

describe("Kopiera rad", () => {
  it("textformatet i 6.5", () => {
    const sel = { 1: [10, 3], 2: [5], 3: [1, 2], 4: [4, 6], 5: [7, 8], 6: [1, 2, 3], 7: [1, 2, 3], 8: [1, 2] };
    expect(couponDateLabel("2026-10-24")).toBe("lör 24 okt 2026");
    expect(couponText({ trackName: "Jägersro", date: "2026-10-24", gameType: "V85" }, sel, 0.5)).toBe(
      ["V85 Jägersro lör 24 okt 2026", "Avd 1: 3, 10", "Avd 2: 5", "Avd 3: 1, 2", "Avd 4: 4, 6", "Avd 5: 7, 8", "Avd 6: 1, 2, 3", "Avd 7: 1, 2, 3", "Avd 8: 1, 2", "288 rader · 144,00 kr"].join("\n"),
    );
    expect(couponText({ trackName: "Jägersro", date: "2026-10-24", gameType: "V85" }, { 1: [3] }, 0.5).split("\n").at(-1)).toBe("0 rader · 0,00 kr");
  });
});

describe("Kopiera rad för V75", () => {
  it("sju avdelningar och V75 i rubriken", () => {
    const sel = { 1: [1], 2: [2], 3: [3], 4: [4], 5: [5], 6: [6], 7: [7, 8] };
    const text = couponText({ trackName: "Solvalla", date: "2026-11-28", gameType: "V75" }, sel, 0.5).split("\n");
    expect(text[0]).toBe("V75 Solvalla lör 28 nov 2026");
    expect(text).toHaveLength(9);
    expect(text.at(-1)).toBe("2 rader · 1,00 kr");
    expect(rowCount(sel, 7)).toBe(2);
    expect(rowCount(sel, 8)).toBe(0);
  });
});

describe("kroppen till PUT /api/rounds/[id]/coupon", () => {
  it("godkänner en hel kupong och sorterar valen", () => {
    expect(parseCouponBody({ budget: 150, selections: { "1": [10, 3, 3], "2": [5] }, lockedLegs: [2] })).toEqual({
      ok: true,
      value: { budget: 150, rowPrice: null, selections: { 1: [3, 10], 2: [5] }, lockedLegs: [2] },
    });
  });
  it("avvisar fel", () => {
    expect(parseCouponBody({ budget: -1, selections: {} }).ok).toBe(false);
    expect(parseCouponBody({ budget: 10.5, selections: {} }).ok).toBe(false);
    expect(parseCouponBody({ budget: 10, selections: { "9": [1] } }).ok).toBe(false);
    expect(parseCouponBody({ budget: 10, selections: { "1": [0] } }).ok).toBe(false);
    expect(parseCouponBody({ budget: 10, selections: [] }).ok).toBe(false);
    expect(parseCouponBody({ budget: 10, selections: {}, lockedLegs: [9] }).ok).toBe(false);
    expect(parseCouponBody({ budget: 10, selections: {}, userId: "x" }).ok).toBe(false);
  });
});

// ---- E6 (docs/specs/e6-v85-rad.md 6.5.13 och 12) ------------------------------------------------

import { asLegRoles } from "@/lib/coupon";
import { buildRad } from "@/lib/tippa";
import { BJERKE_ROUND, bjerkeLegs, bjerkeRules } from "@/lib/tippa.fixture";

describe("E6: Kopiera-texten med allgardering", () => {
  const legs = bjerkeLegs();
  const r = buildRad(legs, bjerkeRules());
  const numbersByLeg = (scr: Record<number, number[]> = {}) => Object.fromEntries(legs.map((l) => [l.leg, { all: l.starts.map((s) => s.number), scratched: scr[l.leg] ?? [] }]));

  it("mockupens hela text för Bjerke", () => {
    expect(couponText(BJERKE_ROUND, r.selections, 0.5, { allgLeg: 5, numbersByLeg: numbersByLeg() })).toBe(
      ["V85 Bjerke lör 31 okt 2026", "Avd 1: 7, 10, 12", "Avd 2: 2", "Avd 3: 1, 5, 9, 13", "Avd 4: 1", "Avd 5: alla (1–12)", "Avd 6: 3", "Avd 7: 3, 4, 11, 14", "Avd 8: 4", "576 rader · 288,00 kr"].join("\n"),
    );
  });
  it("med strukna i allgarderingen", () => {
    expect(couponText(BJERKE_ROUND, r.selections, 0.5, { allgLeg: 5, numbersByLeg: numbersByLeg({ 5: [7] }) }).split("\n")[5]).toBe("Avd 5: alla (1–12, utom 7)");
    expect(couponText(BJERKE_ROUND, r.selections, 0.5, { allgLeg: 5, numbersByLeg: numbersByLeg({ 5: [7, 3] }) }).split("\n")[5]).toBe("Avd 5: alla (1–12, utom 3 och 7)");
  });
  it("utan opts som före E6", () => {
    expect(couponText(BJERKE_ROUND, r.selections, 0.5).split("\n")[5]).toBe("Avd 5: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12");
  });
});

describe("E6: parseCouponBody", () => {
  const body = { budget: 300, selections: { "4": [1] }, lockedLegs: [4] };
  const roles = { v: 1, prelim: false, favLimit: 4, legs: { "1": { k: "OPEN", h: { "7": ["T3", "SIG4"] }, favOut: 3 }, "5": { k: "ALLG", fav: 6 } } };

  it("godtar de nya fälten", () => {
    const p = parseCouponBody({ ...body, spikCount: 4, allgMode: "CHOSEN", allgLeg: 5, legRoles: roles, copiedAt: "2026-10-31T13:05:00.000Z", copiedSelections: { "4": [1] } });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.value).toMatchObject({ spikCount: 4, allgMode: "CHOSEN", allgLeg: 5, legRoles: roles, copiedSelections: { 4: [1] } });
    expect(p.value.copiedAt?.toISOString()).toBe("2026-10-31T13:05:00.000Z");
  });
  it("lämnar saknade fält som undefined och tar null", () => {
    const p = parseCouponBody(body);
    expect(p.ok && [p.value.spikCount, p.value.allgMode, p.value.allgLeg, p.value.legRoles, p.value.copiedAt, p.value.copiedSelections]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    const n = parseCouponBody({ ...body, spikCount: null, allgMode: null, allgLeg: null, legRoles: null, copiedAt: null, copiedSelections: null });
    expect(n.ok && n.value).toMatchObject({ spikCount: null, allgMode: null, allgLeg: null, legRoles: null, copiedAt: null, copiedSelections: null });
  });
  it("avvisar okänd allgMode, spikCount 9, legRoles med okänd kod och fel kopieringstid", () => {
    expect(parseCouponBody({ ...body, allgMode: "NONE" })).toEqual({ ok: false, error: "Allgarderingen ska vara Auto eller en vald avdelning." });
    expect(parseCouponBody({ ...body, spikCount: 9 }).ok).toBe(false);
    expect(parseCouponBody({ ...body, spikCount: 2.5 }).ok).toBe(false);
    expect(parseCouponBody({ ...body, allgLeg: 9 })).toEqual({ ok: false, error: "Avd 9 finns inte i omgången." });
    expect(parseCouponBody({ ...body, legRoles: { ...roles, legs: { "1": { k: "OPEN", h: { "7": ["XYZ"] } } } } })).toEqual({ ok: false, error: "Ogiltiga skäl i raden." });
    expect(parseCouponBody({ ...body, legRoles: { ...roles, v: 2 } }).ok).toBe(false);
    expect(parseCouponBody({ ...body, legRoles: { ...roles, legs: { "9": { k: "OPEN" } } } }).ok).toBe(false);
    expect(parseCouponBody({ ...body, legRoles: { ...roles, legs: { "1": { k: "OPEN", note: "x".repeat(7000) } } } })).toEqual({ ok: false, error: "Ogiltiga skäl i raden." });
    expect(parseCouponBody({ ...body, copiedAt: "i går", copiedSelections: {} })).toEqual({ ok: false, error: "Ogiltig kopieringstid." });
    expect(parseCouponBody({ ...body, copiedAt: "2026-10-31T13:05:00Z" }).ok).toBe(false);
    expect(parseCouponBody({ ...body, okänt: 1 })).toEqual({ ok: false, error: "Okänt fält i kupongen." });
  });
  it("asLegRoles ger null vid fel form", () => {
    expect(asLegRoles(roles)).toEqual(roles);
    expect(asLegRoles(null)).toBeNull();
    expect(asLegRoles({ ...roles, legs: { "1": { k: "NOPE" } } })).toBeNull();
    expect(asLegRoles(buildRad(bjerkeLegs(), bjerkeRules()).legRoles)).not.toBeNull();
  });
});
