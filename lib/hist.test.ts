import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseHistRace, swedishTrotRaceIds } from "@/lib/atg";
import { bestNumbers, datesBetween, distanceGroup, histRange, MIN_STARTS_PCT, toRows, type PostTable } from "@/lib/hist";

const race = JSON.parse(readFileSync(path.join(__dirname, "..", "test", "fixtures", "atg", "race-2026-10-10_5_1.json"), "utf8"));

describe("ATG-lopp till statistikbasen", () => {
  it("tolkar ett avgjort lopp (Solvalla 2026-10-10 lopp 1)", () => {
    const r = parseHistRace(race)!;
    expect(r).toMatchObject({ id: "2026-10-10_5_1", date: "2026-10-10", trackId: 5, trackName: "Solvalla", raceNumber: 1, distance: 2140, startMethod: "AUTO" });
    expect(r.starts).toHaveLength(12);
    expect(r.starts.find((s) => s.number === 11)).toMatchObject({ place: 1, disqualified: false, finalOdds: 22.2 });
    expect(r.starts.find((s) => s.number === 12)).toMatchObject({ place: 2 });
    // Diskad: ingen placering.
    expect(r.starts.find((s) => s.number === 6)).toMatchObject({ place: null, disqualified: true, galloped: true });
  });
  it("struken häst får ingen placering och inga odds", () => {
    const copy = structuredClone(race);
    copy.starts[0].scratched = true;
    expect(parseHistRace(copy)!.starts[0]).toMatchObject({ scratched: true, place: null, finalOdds: null, galloped: false });
  });
  it("hoppar över lopp utan resultat, utländska och galopp", () => {
    expect(parseHistRace({ ...race, status: "upcoming" })).toBeNull();
    expect(parseHistRace({ ...race, track: { ...race.track, countryCode: "NO" } })).toBeNull();
    expect(parseHistRace({ ...race, sport: "gallop" })).toBeNull();
    expect(parseHistRace({ ...race, starts: race.starts.map((s: { result: object }) => ({ ...s, result: {} })) })).toBeNull();
    expect(parseHistRace(null)).toBeNull();
  });
  it("kalenderns svenska travlopp med resultat", () => {
    const cal = {
      tracks: [
        { id: 5, countryCode: "SE", sport: "trot", races: [{ id: "a", status: "results" }, { id: "b", status: "upcoming" }] },
        { id: 7, countryCode: "SE", sport: "gallop", races: [{ id: "c", status: "results" }] },
        { id: 9, countryCode: "FR", sport: "trot", races: [{ id: "d", status: "results" }] },
        { id: 11, countryCode: "SE", sport: "trot" },
      ],
    };
    expect(swedishTrotRaceIds(cal)).toEqual(["a"]);
    expect(swedishTrotRaceIds({})).toEqual([]);
  });
});

describe("statistikbasens räkning", () => {
  it("intervallet är två år bakåt till i går", () => {
    expect(histRange(new Date("2026-10-19T10:00:00Z"))).toEqual({ from: "2024-10-19", to: "2026-10-18" });
    expect(histRange(new Date("2028-02-29T10:00:00Z")).from).toBe("2026-02-28");
    expect(datesBetween("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
  });
  it("distansgrupperna", () => {
    expect(distanceGroup(1640).label).toMatch(/^kort/);
    expect(distanceGroup(2140).label).toMatch(/^medel/);
    expect(distanceGroup(2640).label).toMatch(/^lång/);
  });
  it("procent bara med tillräckligt många starter", () => {
    const rows = toRows([
      { n: 1, starts: 200, wins: 30, top3: 81, },
      { n: 2, starts: MIN_STARTS_PCT - 1, wins: 5, top3: 8 },
    ]);
    expect(rows[0]).toMatchObject({ winPct: 15, placePct: 40.5 });
    expect(rows[1]).toMatchObject({ winPct: null, placePct: null });
  });
  it("bästa startnummer för vinst och plats bland loppets", () => {
    const t: PostTable = {
      scope: "all",
      method: "AUTO",
      distanceLabel: "2140 m",
      exact: true,
      races: 300,
      from: "2024-10-19",
      to: "2026-10-19",
      byNumber: toRows([
        { n: 1, starts: 300, wins: 45, top3: 120 },
        { n: 2, starts: 300, wins: 40, top3: 130 },
        { n: 3, starts: 300, wins: 50, top3: 100 },
      ]),
    };
    const b = bestNumbers(t, [1, 2]);
    expect(b.win?.n).toBe(1);
    expect(b.place?.n).toBe(2);
    expect(bestNumbers(null, [1])).toEqual({ win: null, place: null });
  });
});
