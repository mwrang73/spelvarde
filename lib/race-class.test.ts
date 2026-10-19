import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { raceClass } from "@/lib/race-class";

const fx = (f: string) => JSON.parse(readFileSync(path.join(__dirname, "..", "test", "fixtures", "atg", f), "utf8"));

describe("race-class", () => {
  it("klassar loppen i fixturerna", () => {
    const labels = (f: string) => fx(f).races.map((r: { name: string; terms: string[] }) => raceClass(r.name, r.terms).label);
    expect(labels("game-V85_2026-10-24_7_5.json")).toEqual([
      "Diamantstoet", "Stodivisionen", "Klass II", "Övrigt", "Klass III", "Klass I", "Gr. II Int. Gulddivisionen", "Brons mot Silver",
    ]);
    expect(labels("game-V85_2026-10-17_16_5-results.json")).toEqual([
      "Silverdivisionen", "Diamantstoet", "Klass II", "Gulddivisionen", "Kallblodsdivisionen", "Klass III", "Bronsdivisionen", "Klass I",
    ]);
  });
  it("grupplopp som prefix, villkor som reserv", () => {
    expect(raceClass("Elitloppet (Gr. I Int.)")).toEqual({ base: "Övrigt", group: "Gr. I Int.", label: "Gr. I Int." });
    expect(raceClass("Svenskt Travderby (Gr. I)")).toMatchObject({ group: "Gr. I", label: "Gr. I" });
    expect(raceClass("Lopp 3", ["Lärlingslopp. 3-åriga och äldre"]).label).toBe("Lärlingslopp");
    expect(raceClass("STL Klass III").label).toBe("Klass III");
  });
});
