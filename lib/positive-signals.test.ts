import { describe, expect, it } from "vitest";
import { positiveSignals, type SignalInput } from "@/lib/positive-signals";
import { signalLines, signalTags } from "@/lib/signals";

const rec = (place: number, o: Partial<SignalInput["records"][number]> = {}) => ({ place, galloped: false, disqualified: false, kmTime: "1.16,0", distance: 2140, startMethod: "AUTO", ...o });

function horse(i: number, o: Partial<SignalInput> = {}): SignalInput {
  return {
    scratched: false,
    thisYear: { starts: 6, wins: 1, placed: 2 },
    lastYear: { starts: 4, wins: 0, placed: 1 },
    records: [rec(5), rec(6), rec(4)],
    driver: { starts: 100, wins: 10 + i },
    trainer: { starts: 50, wins: 5 + i },
    earnings: { total: 100_000 * (i + 1), lifeStarts: 20 },
    barefoot: false,
    post: { pct: 30, mean: 30 },
    streck: 10 + i,
    ...o,
  };
}

describe("positiva signaler", () => {
  it("en häst med allt uppfyllt får alla tio, strukna får null", () => {
    const times = ["1.14,0", "1.14,2", "1.13,9", "1.14,1", "1.14,3"];
    const field = [0, 1, 2, 3, 4].map((i) => horse(i, { records: [rec(5, { kmTime: times[i] }), rec(6), rec(4)] }));
    field[5] = horse(9, {
      thisYear: { starts: 8, wins: 5, placed: 7 },
      lastYear: null,
      records: [rec(1, { kmTime: "1.10,0" }), rec(2), rec(1)],
      barefoot: true,
      post: { pct: 40, mean: 30 },
    });
    field.push(horse(1, { scratched: true }));
    const res = positiveSignals(field);
    expect(res[6]).toBeNull();
    expect(res[5]!.count).toBe(10);
    expect(res[5]!.values.tidBetter).toBeCloseTo(4.05, 6);
    expect(res[0]!.flags.barfota).toBe(false);
  });
  it("okänt underlag blir null och räknas inte", () => {
    const res = positiveSignals([horse(0, { barefoot: null, post: null, records: [], thisYear: null, lastYear: null }), horse(1), horse(2), horse(3)]);
    expect(res[0]!.flags).toMatchObject({ barfota: null, spar: null, form: null, felfri: null, plats75: null, tid: null });
    expect(signalLines(res[0]!).find((l) => l.key === "barfota")).toMatchObject({ state: "unknown", text: "Okänt" });
  });
  it("Lågt streck: minst 4 signaler och inte bland de 3 mest streckade, null utan streck", () => {
    const field = [0, 1, 2, 3, 4, 5].map((i) => horse(i, { streck: 30 - i }));
    field[5] = horse(9, { streck: 2, barefoot: true, post: { pct: 40, mean: 30 }, records: [rec(1), rec(2), rec(3)] });
    const res = positiveSignals(field);
    expect(res[5]!.count).toBeGreaterThanOrEqual(4);
    expect(res[5]!.lowStreck).toBe(true);
    const noStreck = positiveSignals(field.map((h) => ({ ...h, streck: null })));
    expect(noStreck[5]!.lowStreck).toBeNull();
  });
  it("korta taggar för de uppfyllda", () => {
    const res = positiveSignals([horse(0), horse(1), horse(2, { barefoot: true, records: [rec(1), rec(2), rec(5), rec(4)] }), horse(3)]);
    expect(signalTags(res[2]!).map((t) => t.text)).toEqual(expect.arrayContaining(["Barfota", "Form 2/4", "Felfri"]));
  });
});
