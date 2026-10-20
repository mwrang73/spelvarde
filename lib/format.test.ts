import { describe, expect, it } from "vitest";
import { ageSex, changesSummary, dayDate, distShort, kr, odds, ordinal, pct, placeChar, placeLabel, relTime, shortRaceName, money } from "@/lib/format";

const NBSP = " ";

describe("tal", () => {
  it("procent med decimalkomma och hårt mellanslag", () => {
    expect(pct(12.2)).toBe(`12,2${NBSP}%`);
    expect(pct(54.5)).toBe(`54,5${NBSP}%`);
    expect(pct(null)).toBe("–");
  });
  it("odds med två decimaler", () => {
    expect(odds(3.1)).toBe("3,10");
    expect(odds(null)).toBe("–");
  });
  it("kronor med tusentalsavgränsare", () => {
    expect(kr(2787330)).toBe(`2${NBSP}787${NBSP}330${NBSP}kr`);
    expect(kr(400000)).toBe(`400${NBSP}000${NBSP}kr`);
  });
  it("ordningstal", () => {
    expect([1, 2, 3, 11, 12, 21, 22].map(ordinal)).toEqual(["1:a", "2:a", "3:e", "11:e", "12:e", "21:a", "22:a"]);
  });
});

describe("tid i Stockholm", () => {
  const now = new Date("2026-10-19T12:00:00Z"); // måndag 14:00
  it("i dag, i går, veckodag och datum", () => {
    expect(relTime("2026-10-19T08:05:00Z", now)).toBe("i dag 10:05");
    expect(relTime("2026-10-18T19:14:00Z", now)).toBe("i går 21:14");
    expect(relTime("2026-10-16T19:00:00Z", now)).toBe("fre 21:00");
    expect(relTime("2026-10-02T19:00:00Z", now)).toBe("fre 2 okt 21:00");
  });
  it("dag och datum", () => {
    expect(dayDate("2026-10-24")).toBe("lör 24 okt");
  });
});

describe("häst och lopp", () => {
  it("ålder och kön", () => {
    expect(ageSex(7, "stallion")).toBe("7 år hingst");
    expect(ageSex(5, "mare")).toBe("5 år sto");
    expect(ageSex(null, "gelding")).toBe("valack");
  });
  it("distans och startmetod", () => {
    expect(distShort(2140, "AUTO")).toBe("2140 a");
    expect(distShort(2140, "VOLTE")).toBe("2140 v");
  });
  it("kortar ATG:s loppnamn", () => {
    expect(shortRaceName("C.L. Müllers Memorial 2026 (Gr. II Int.) - STL Gulddivisionen (Försök 8 i Meeting 7 - Final Solvalla 26/12)")).toBe(
      "C.L. Müllers Memorial 2026 – STL Gulddivisionen",
    );
    expect(shortRaceName("RS Mustang - Spårtrappa - STL Stodivisionen (Försök 2 i Meeting 7 - Final Solvalla 26/12)")).toBe("RS Mustang – STL Stodivisionen");
    expect(shortRaceName("Johan Jacobssons Minne 2026")).toBe("Johan Jacobssons Minne 2026");
  });
  it("placering i tabellen", () => {
    expect(placeChar({ place: 1, galloped: false, disqualified: false })).toBe("1");
    expect(placeChar({ place: 0, galloped: true, disqualified: false })).toBe("g");
    expect(placeChar({ place: null, galloped: true, disqualified: true })).toBe("d");
    expect(placeChar({ place: 0, galloped: false, disqualified: false })).toBe("0");
    expect(placeLabel({ place: 0, galloped: true, disqualified: false })).toBe("galopp, oplacerad");
  });
  it("sammanfattar ändringar", () => {
    expect(changesSummary({ scratched: [1, 2], driverChanges: [1] })).toBe("2 strykningar, 1 kuskbyte");
    expect(changesSummary({ scratched: [], driverChanges: [] })).toBeNull();
  });
});

describe("vinstsumma kort", () => {
  it("kr, tkr och mkr", () => {
    expect(money(850)).toBe("850 kr");
    expect(money(448_200)).toBe("448 tkr");
    expect(money(5_385_500)).toBe("5,4 mkr");
    expect(money(25_406_500)).toBe("25 mkr");
    expect(money(null)).toBe("–");
  });
});
