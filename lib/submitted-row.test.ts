import { describe, expect, it } from "vitest";
import * as mod from "@/lib/submitted-row";
import { isLateMark, parseSubmittedRowBody, rowDiff, rowsOfSelections, sameRow, SUBMITTED_ROW_MAX_ROWS, winnersInRow, type RowRace } from "@/lib/submitted-row";

const NOW = new Date("2026-10-24T12:00:00Z");
const sel8 = { "1": [5, 2, 5], "2": [1], "3": [1, 2, 3], "4": [1, 2, 3], "5": [1, 2, 3, 4], "6": [1], "7": [1, 2, 3], "8": [1, 2, 3] };
const body = (over: Record<string, unknown> = {}) => ({ selections: sel8, rowPrice: 0.5, markedAt: "2026-10-24T11:59:00.000Z", ...over });
const parse = (over: Record<string, unknown> = {}, gameType = "V85") => parseSubmittedRowBody(body(over), gameType, NOW);
const errorOf = (r: { ok: boolean; error?: string }) => (r.ok ? null : r.error);

// Ett lopp: vinnaren är `winner`, diskade och strukna enligt parametrarna.
const race = (leg: number, winner: number | number[], over: Partial<RowRace> = {}): RowRace => ({
  leg,
  cancelled: false,
  resultAt: "2026-10-24T16:00:00Z",
  starts: [1, 2, 3, 4].map((number) => ({ number, scratched: false, result: { place: ([] as number[]).concat(winner).includes(number) ? 1 : 2, disqualified: false } })),
  ...over,
});

describe("parseSubmittedRowBody (9.3)", () => {
  it("giltig kropp, 8 lopp: sorterad och utan dubbletter", () => {
    const r = parse();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.selections[1]).toEqual([2, 5]);
      expect(r.value.rowPrice).toBe(0.5);
      expect(r.value.markedAt.toISOString()).toBe("2026-10-24T11:59:00.000Z");
    }
  });
  it("okänt fält", () => {
    expect(errorOf(parse({ userId: "annan" }))).toBe("Okänt fält i raden.");
    expect(errorOf(parse({ markedLate: false }))).toBe("Okänt fält i raden.");
  });
  it("lopp 9, selections som array, nummer 31", () => {
    expect(errorOf(parse({ selections: { ...sel8, "9": [1] } }))).toBe("V85-9 finns inte i omgången.");
    expect(errorOf(parse({ selections: [[1]] }))).toBe("Ogiltig begäran.");
    expect(errorOf(parse({ selections: null }))).toBe("Ogiltig begäran.");
    expect(errorOf(parse({ selections: { ...sel8, "3": [31] } }))).toBeTruthy();
    expect(errorOf(parse({ selections: { ...sel8, abc: [1] } }))).toBeTruthy();
    expect(errorOf(parse({ selections: { ...sel8, "3": ["1"] } }))).toBeTruthy();
  });
  it("radpris 0, 101, text och saknat", () => {
    const text = "Radpriset ska ligga mellan 0,01 och 100 kr.";
    for (const rowPrice of [0, 101, "0,5", null, Number.NaN, 0.009]) expect(errorOf(parse({ rowPrice }))).toBe(text);
    const { rowPrice: _drop, ...noPrice } = body();
    expect(errorOf(parseSubmittedRowBody(noPrice, "V85", NOW))).toBe(text);
  });
  it("radpriset avrundas till hundradelar", () => {
    const r = parse({ rowPrice: 0.555 });
    expect(r.ok && r.value.rowPrice).toBe(0.56);
  });
  it("markedAt utan tidszon, ogiltig, för långt fram och saknad", () => {
    const text = "Ogiltig tid för markeringen.";
    for (const markedAt of ["2026-10-24T11:59:00", "i dag", "2026-02-31T10:00:00Z", "2026-13-01T10:00:00Z", 1730000000, null, "0001-01-01T00:00:00Z"]) {
      expect(errorOf(parse({ markedAt }))).toBe(text);
    }
    expect(errorOf(parse({ markedAt: "2026-10-24T12:05:01Z" }))).toBe(text);
    expect(parse({ markedAt: "2026-10-24T12:05:00Z" }).ok).toBe(true);
    expect(parse({ markedAt: "2026-10-24T13:59:00+02:00" }).ok).toBe(true);
  });
  it("V75 med 7 lopp, lopp 8", () => {
    expect(errorOf(parse({}, "V75"))).toBe("V75-8 finns inte i omgången.");
  });
});

describe("rowsOfSelections", () => {
  const eight = { 1: [1, 2], 2: [1], 3: [1, 2, 3], 4: [1, 2, 3], 5: [1, 2, 3, 4], 6: [1], 7: [1, 2, 3], 8: [1, 2, 3] };
  it("2×1×3×3×4×1×3×3 = 648 rader, 324,00 kr vid 0,50", () => {
    expect(rowsOfSelections(eight, 0.5, "V85")).toEqual({ ok: true, value: { rows: 648, cost: 324 } });
  });
  it("tomt och saknat lopp", () => {
    expect(rowsOfSelections({ ...eight, 3: [] }, 0.5, "V85")).toEqual({ ok: false, error: "V85-3 har inga hästar i raden." });
    const { 3: _drop, ...without } = eight;
    expect(rowsOfSelections(without, 0.5, "V85")).toEqual({ ok: false, error: "V85-3 har inga hästar i raden." });
  });
  it("V75: sju lopp räcker, lopp 8 finns inte", () => {
    const { 8: _drop, ...seven } = eight;
    expect(rowsOfSelections(seven, 1, "V75")).toEqual({ ok: true, value: { rows: 216, cost: 216 } });
    expect(rowsOfSelections(eight, 1, "V75")).toEqual({ ok: false, error: "V75-8 finns inte i omgången." });
  });
  it("mer än gränsen, exakt gränsen går", () => {
    const wide = Array.from({ length: 30 }, (_, i) => i + 1);
    const all = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((l) => [l, wide]));
    expect(rowsOfSelections(all, 0.5, "V85")).toEqual({ ok: false, error: "Raden har för många rader." });
    // 2 000 000 000 = 2^10 · 5^9: 8 · 8 · 16 · 25 · 25 · 25 · 25 · 5 hästar.
    const counts = [8, 8, 16, 25, 25, 25, 25, 5];
    expect(counts.reduce((a, b) => a * b, 1)).toBe(SUBMITTED_ROW_MAX_ROWS);
    const exact = Object.fromEntries(counts.map((n, i) => [i + 1, wide.slice(0, n)]));
    const ok = rowsOfSelections(exact, 100, "V85");
    expect(ok).toEqual({ ok: true, value: { rows: SUBMITTED_ROW_MAX_ROWS, cost: 200_000_000_000 } });
  });
});

describe("regler (10)", () => {
  const races = [{ startAt: new Date("2026-10-24T15:00:00Z") }, { startAt: "2026-10-24T14:00:00Z" }];
  it("isLateMark före, exakt vid och efter första start", () => {
    expect(isLateMark("2026-10-24T13:59:59.999Z", races)).toBe(false);
    expect(isLateMark("2026-10-24T14:00:00.000Z", races)).toBe(true);
    expect(isLateMark(new Date("2026-10-24T14:00:00.001Z"), races)).toBe(true);
    expect(isLateMark("2026-10-24T14:00:00.000Z", [])).toBe(false);
  });
  it("sameRow: olika ordning är samma rad", () => {
    expect(sameRow({ 1: [2, 5], 2: [1] }, { 2: [1], 1: [5, 2] })).toBe(true);
    expect(sameRow({ 1: [2, 5] }, { 1: [2] })).toBe(false);
    expect(sameRow({ 1: [2] }, { 1: [2], 2: [1] })).toBe(false);
  });
  it("rowDiff med äkta minustecken", () => {
    const text = rowDiff({ 3: [1], 4: [10, 2], 5: [4, 6] }, { 3: [7, 1], 4: [12, 2], 5: [6] }, "V85");
    expect(text).toBe("V85-3 +7. V85-4 +12 −10. V85-5 −4.");
    expect(text).toContain("−");
    expect(text).not.toContain("-10");
  });
  it("rowDiff lika ger tomt", () => {
    expect(rowDiff({ 1: [2, 5] }, { 1: [5, 2] }, "V85")).toBe("");
  });
  it("rowDiff följer spelformen", () => {
    expect(rowDiff({ 1: [1] }, { 1: [1, 2] }, "V75")).toBe("V75-1 +2.");
  });
});

describe("winnersInRow (7.4, 10)", () => {
  const legs = [1, 2, 3, 4, 5, 6, 7, 8];
  const row = { selections: Object.fromEntries(legs.map((l) => [l, [1]])) as Record<number, number[]> };
  it("4 visade, 3 rätt", () => {
    const races = legs.map((l) => race(l, l === 4 ? 2 : 1));
    const s = winnersInRow(row, races, [1, 2, 3, 4]);
    expect(s.text).toBe("3 av 4 rätt");
    expect(s).toMatchObject({ hits: 3, shown: 4, total: 8, allShown: false });
  });
  it("alla visade", () => {
    const races = legs.map((l) => race(l, l <= 2 ? 2 : 1));
    expect(winnersInRow(row, races, legs).text).toBe("6 av 8 rätt");
  });
  it("dolt lopp som vanns räknas inte", () => {
    const races = legs.map((l) => race(l, 1));
    expect(winnersInRow(row, races, [1]).text).toBe("1 av 1 rätt");
  });
  it("visat lopp utan resultat räknas inte", () => {
    const races = [race(1, 1), race(2, 1, { resultAt: null })];
    expect(winnersInRow(row, races, [1, 2]).text).toBe("1 av 1 rätt");
  });
  it("inställt lopp finns inte i nämnaren", () => {
    const races = [race(1, 1), race(2, 1, { cancelled: true })];
    const s = winnersInRow(row, races, [1, 2]);
    expect(s.text).toBe("1 av 1 rätt");
    expect(s.allShown).toBe(true);
  });
  it("dött lopp: en vinnare i raden är rätt", () => {
    expect(winnersInRow(row, [race(1, [1, 2])], [1]).hits).toBe(1);
    expect(winnersInRow({ selections: { 1: [2] } }, [race(1, [1, 2])], [1]).hits).toBe(1);
  });
  it("diskad med place 1 är inte rätt", () => {
    const r = race(1, 1);
    r.starts[0].result = { place: 1, disqualified: true };
    expect(winnersInRow(row, [r], [1]).hits).toBe(0);
  });
  it("struken i raden är inte rätt, raden är oförändrad", () => {
    const r = race(1, 2);
    r.starts[0] = { number: 1, scratched: true, result: { place: 1, disqualified: false } };
    const selections = { 1: [1] };
    expect(winnersInRow({ selections }, [r], [1]).hits).toBe(0);
    expect(selections).toEqual({ 1: [1] });
  });
  it("ingen inlämnad rad", () => {
    expect(winnersInRow(null, [race(1, 1)], [1]).text).toBe("Ingen inlämnad rad");
  });
});

describe("texterna", () => {
  const texts = Object.entries(mod).flatMap(([name, v]) => {
    if (!name.startsWith("SUBMITTED_ROW_")) return [];
    if (typeof v === "string") return [v];
    if (typeof v === "function") return [String((v as (...a: unknown[]) => string)("V85", 3, "x", 1))];
    return [];
  });
  it("finns och innehåller aldrig Avd", () => {
    expect(texts.length).toBeGreaterThan(20);
    for (const t of texts) expect(t).not.toMatch(/\bAvd|avdelning/);
  });
  it("Ersätt raden, inte rad 1", () => {
    expect(mod.SUBMITTED_ROW_REPLACE).toBe("Ersätt raden");
    for (const t of texts) expect(t).not.toMatch(/rad 1/i);
  });
});
