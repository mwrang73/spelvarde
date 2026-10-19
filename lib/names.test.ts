import { describe, expect, it } from "vitest";
import { matchPerson, normalizeName, parseShortName } from "@/lib/names";

const people = [
  { id: "p1", firstName: "Örjan", lastName: "Kihlström" },
  { id: "p2", firstName: "Mats E", lastName: "Djuse" },
  { id: "p3", firstName: "Magnus A", lastName: "Djuse" },
  { id: "p4", firstName: "Carl Johan", lastName: "Jepson" },
  { id: "p5", firstName: "Daniel", lastName: "Wäjersten" },
  { id: "p6", firstName: "Anna", lastName: "Svensson" },
  { id: "p7", firstName: "Andreas", lastName: "Svensson" },
  { id: "p8", firstName: "Per-Erik", lastName: "Lind-Berg" },
];

describe("names", () => {
  it("normaliserar: små bokstäver, trimmat, bindestreck som mellanslag, åäö kvar", () => {
    expect(normalizeName("  Kihlström-Öberg  Ö ")).toBe("kihlström öberg ö");
  });
  it("tolkar efternamn och initialer", () => {
    expect(parseShortName("Kihlström Ö")).toEqual({ lastName: "kihlström", initials: ["ö"] });
    expect(parseShortName("Djuse M E")).toEqual({ lastName: "djuse", initials: ["m", "e"] });
    expect(parseShortName("Jepson CJ")).toEqual({ lastName: "jepson", initials: ["c", "j"] });
    expect(parseShortName("Kihlström")).toBeNull();
  });
  it("exakt en träff kopplar", () => {
    expect(matchPerson("Kihlström Ö", people).personId).toBe("p1");
    expect(matchPerson("Djuse M E", people).personId).toBe("p2");
    expect(matchPerson("Djuse M A", people).personId).toBe("p3");
    expect(matchPerson("Jepson C J", people).personId).toBe("p4");
    expect(matchPerson("Wäjersten D", people).personId).toBe("p5");
    expect(matchPerson("Lind Berg P E", people).personId).toBe("p8");
  });
  it("flera eller inga träffar kopplar inte", () => {
    expect(matchPerson("Svensson A", people)).toEqual({ rawName: "Svensson A", personId: null, candidates: 2 });
    expect(matchPerson("Djuse M", people).personId).toBeNull();
    expect(matchPerson("Goop B", people)).toMatchObject({ personId: null, candidates: 0 });
  });
});
