import { describe, expect, it } from "vitest";
import { trollspot } from "@/lib/trollspot";
import type { RaceDto, StartDto } from "@/lib/types";

const start = (n: number, streck: number | null, p: number | null, o: Partial<StartDto> = {}) =>
  ({ id: `s${n}`, number: n, scratched: false, streck, probTop3: p, riktodds: p ? Math.round(100 / p) / 100 : null, mark: null, signals: null, horse: { name: `H${n}` }, ...o }) as unknown as StartDto;
const race = (leg: number, starts: StartDto[], startAt = "2026-10-24T15:00:00Z") => ({ id: `r${leg}`, leg, startAt, cancelled: false, starts }) as unknown as RaceDto;
const NOW = Date.parse("2026-10-22T18:00:00Z");

describe("Trollspöt", () => {
  // Fält med en storfavorit (uppskattat odds under 1,8) och nio jämnare.
  const field = (leg: number) =>
    race(leg, [start(1, 40, 0.8), start(2, 9, 0.5), start(3, 8, 0.45), start(4, 7, 0.3), start(5, 7, 0.25), start(6, 6, 0.2), start(7, 6, 0.2), start(8, 6, 0.15), start(9, 6, 0.15), start(10, 5, 0.1)]);

  it("tar bort hästar som troligen får under 1,80 och sorterar på chans", () => {
    const res = trollspot([field(1)], NOW);
    expect(res.hasStreck).toBe(true);
    expect(res.items.map((i) => i.start.number)).not.toContain(1);
    expect(res.items[0].start.number).toBe(2);
    expect(res.items.every((i) => i.estOdds >= 1.8)).toBe(true);
  });
  it("minst X är det högsta av 2,00, riktoddset och marknadens odds", () => {
    const it2 = trollspot([field(1)], NOW).items[0];
    expect(it2.minOdds).toBe(Math.max(2, it2.start.riktodds!, it2.estOdds));
    expect(it2.minOdds).toBeGreaterThanOrEqual(2);
  });
  it("högst 10, strukna och startade lopp bort, Unibet över eller under gränsen", () => {
    const races = [1, 2, 3].map(field);
    races[2] = race(3, races[2].starts, "2026-10-22T17:00:00Z");
    races[0].starts[1] = { ...races[0].starts[1], scratched: true };
    races[1].starts[1] = { ...races[1].starts[1], mark: { unibetOdds: 9.99 } } as StartDto;
    const res = trollspot(races, NOW);
    expect(res.items.length).toBeLessThanOrEqual(10);
    expect(res.items.some((i) => i.race.leg === 3)).toBe(false);
    expect(res.items.some((i) => i.start.id === "s2" && i.race.leg === 1)).toBe(false);
    expect(res.items.find((i) => i.race.leg === 2 && i.start.number === 2)!.over).toBe(true);
  });
  it("utan streck: tom lista och hasStreck false", () => {
    const res = trollspot([race(1, [1, 2, 3, 4].map((n) => start(n, null, 0.4)))], NOW);
    expect(res).toMatchObject({ hasStreck: false, items: [] });
  });
});
