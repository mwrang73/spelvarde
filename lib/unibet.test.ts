import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stockholmLocalToUtc } from "@/lib/stockholm-time";
import { dayWindow, eventQuery, isEventKey, markOddsOf, meetingsQuery, normalizeTrack, parseEvent, parseMeetings, pickTrackEvents, round2 } from "@/lib/unibet";

const FX = path.join(__dirname, "..", "test", "fixtures", "unibet");
const fx = (f: string) => JSON.parse(readFileSync(path.join(FX, f), "utf8"));

describe("Unibet: banans namn", () => {
  it("gemener, å/ä → a, ö → o, inga blanksteg, bindestreck eller understreck", () => {
    expect(normalizeTrack("Jägersro")).toBe("jagersro");
    expect(normalizeTrack("Åby")).toBe("aby");
    expect(normalizeTrack("Östersund")).toBe("ostersund");
    expect(normalizeTrack("Bergsåker")).toBe("bergsaker");
    expect(normalizeTrack("Färjestad")).toBe("farjestad");
    expect(normalizeTrack("Globe Derby")).toBe(normalizeTrack("globe_derby"));
    expect(normalizeTrack("Sundbyholm-Eskilstuna")).toBe("sundbyholmeskilstuna");
  });
});

describe("Unibet: tidsfönstret", () => {
  it("lördagen 24 oktober (sommartid) blir 22:00–21:59:59.999 UTC", () => {
    expect(dayWindow("2026-10-24", stockholmLocalToUtc)).toEqual({ start: "2026-10-23T22:00:00.000Z", end: "2026-10-24T21:59:59.999Z" });
  });
  it("dagen då sommartiden slutar är 25 timmar lång", () => {
    expect(dayWindow("2026-10-25", stockholmLocalToUtc)).toEqual({ start: "2026-10-24T22:00:00.000Z", end: "2026-10-25T22:59:59.999Z" });
  });
  it("frågorna byggs bara med giltiga värden", () => {
    expect(meetingsQuery(dayWindow("2026-10-24", stockholmLocalToUtc))).toContain('startDateTime:"2026-10-23T22:00:00.000Z"');
    expect(() => meetingsQuery({ start: '"){x}', end: "y" })).toThrow();
    expect(eventQuery("202610241300.H.SWE.jagersro.5")).toContain('eventKey:"202610241300.H.SWE.jagersro.5"');
    expect(() => eventQuery('x") { y }')).toThrow();
    expect(isEventKey("202610241300.H.SWE.jagersro.5")).toBe(true);
    expect(isEventKey("202610241300.H.SWE.jagersro")).toBe(false);
  });
});

describe("Unibet: banor och lopp (meetings 2026-10-24)", () => {
  const meetings = parseMeetings(fx("meetings-2026-10-24.json"));

  it("tolkar alla möten, med land och bana ur nyckeln", () => {
    expect(meetings.length).toBe(13);
    const j = meetings.find((m) => m.track === "jagersro")!;
    expect(j).toMatchObject({ meetingKey: "202610241100.H.SWE.jagersro", name: "Jagersro", country: "SWE" });
    expect(j.events).toHaveLength(12);
  });
  it("V85-1 på Jägersro är lopp 5 hos Unibet, med loppets egen nyckel", () => {
    const events = pickTrackEvents(meetings, "Jägersro")!;
    expect(events.get(5)).toEqual({ eventKey: "202610241300.H.SWE.jagersro.5", sequence: 5, startUtc: "2026-10-24T13:00:00Z", status: "Open" });
    expect([...events.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
  it("en bana som inte finns ger null", () => {
    expect(pickTrackEvents(meetings, "Solvalla")).toBeNull();
    expect(pickTrackEvents(meetings, "")).toBeNull();
  });
  it("utländska banor hittas (V85 på Bjerke 2026-10-31), även med ø", () => {
    expect(pickTrackEvents(meetings, "Harstad")!.size).toBeGreaterThan(0);
    expect(pickTrackEvents(meetings, "Sørlandet")!.size).toBeGreaterThan(0);
    const bjerke = parseMeetings({ data: { viewer: { meetings: [{ meetingKey: "202610311200.H.NOR.bjerke", name: "Bjerke", events: [{ eventKey: "202610311400.H.NOR.bjerke.5", sequence: 5, eventDateTimeUtc: "2026-10-31T14:00:00Z", status: "Open" }] }] } } });
    expect(pickTrackEvents(bjerke, "Bjerke")!.get(5)!.eventKey).toBe("202610311400.H.NOR.bjerke.5");
  });
  it("heter en svensk och en utländsk bana likadant gäller den svenska", () => {
    const ev = (key: string) => ({ meetingKey: key, name: "X", events: [{ eventKey: `${key}.1`, sequence: 1, eventDateTimeUtc: "2026-10-31T14:00:00Z", status: "Open" }] });
    const both = parseMeetings({ data: { viewer: { meetings: [ev("202610311200.H.NOR.bana"), ev("202610311200.H.SWE.bana")] } } });
    expect(pickTrackEvents(both, "Bana")!.get(1)!.eventKey).toBe("202610311200.H.SWE.bana.1");
  });
  it("dagens möten (2026-10-21): Solvalla och Åby", () => {
    const today = parseMeetings(fx("meetings-2026-10-21.json"));
    expect(pickTrackEvents(today, "Solvalla")!.get(8)!.eventKey).toBe("202610211900.H.SWE.solvalla.8");
    expect(pickTrackEvents(today, "Åby")!.has(6)).toBe(true);
  });
  it("okänd form ger en tom lista och varningar, ingen krasch", () => {
    const warnings: string[] = [];
    expect(parseMeetings(null, (w) => warnings.push(w))).toEqual([]);
    expect(parseMeetings({ data: { viewer: { meetings: [{ name: "X" }, { meetingKey: "202610241100.H.SWE.x", events: [{ eventKey: 1 }] }] } } }, (w) => warnings.push(w))).toEqual([
      { meetingKey: "202610241100.H.SWE.x", name: null, country: "SWE", track: "x", events: [] },
    ]);
    expect(warnings.length).toBe(3);
  });
});

describe("Unibet: ett lopp", () => {
  it("före öppning (V85-1 Jägersro i onsdags): inga odds än", () => {
    const e = parseEvent(fx("event-202610241300.H.SWE.jagersro.5.json"))!;
    expect(e.hasFixedPrices).toBe(false);
    expect(e.noPrices).toBe(true);
    expect(e.competitors).toHaveLength(12);
    expect(e.competitors[4]).toEqual({ number: 5, name: "Kaley D.c.", status: "Starter", starter: true, place: null, win: null });
  });
  it("med odds (Solvalla lopp 8): plats och vinnare avrundade, struken hos Unibet utan pris", () => {
    const e = parseEvent(fx("event-202610211900.H.SWE.solvalla.8.json"))!;
    expect(e.hasFixedPrices).toBe(true);
    expect(e.noPrices).toBe(false);
    expect(e.competitors.map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // 1,5714285714 → 1,57 och 1,9090909091 → 1,91; ordningen FixedWin/FixedPlace spelar ingen roll.
    expect(e.competitors[1]).toMatchObject({ number: 2, status: "Starter", starter: true, place: 1.57, win: 3.5 });
    expect(e.competitors[9]).toMatchObject({ number: 10, place: 1.91, win: 5.5 });
    expect(e.competitors[6]).toMatchObject({ number: 7, status: "Scratched", starter: false, place: null, win: null });
  });
  it("avrundning: 1,1666666667 blir 1,17 och 2,375 blir 2,38", () => {
    expect(round2(1.1666666667)).toBe(1.17);
    expect(round2(2.375)).toBe(2.38);
    const e = parseEvent({ data: { viewer: { event: { hasFixedPrices: true, competitors: [{ sequence: 3, name: "A", status: "Starter", prices: [{ betType: "FixedPlace", price: 1.1666666667 }, { betType: "FixedWin", price: 201 }] }] } } } })!;
    expect(e.competitors[0]).toMatchObject({ place: 1.17, win: 201 });
  });
  it("hasFixedPrices men inga platsodds räknas som inga odds än", () => {
    const e = parseEvent({ data: { viewer: { event: { hasFixedPrices: true, competitors: [{ sequence: 1, status: "Starter", prices: [] }] } } } })!;
    expect(e.noPrices).toBe(true);
  });
  it("okänd form: null eller varningar, ingen krasch", () => {
    const warnings: string[] = [];
    expect(parseEvent({ data: { viewer: { event: null } } }, (w) => warnings.push(w))).toBeNull();
    const e = parseEvent({ data: { viewer: { event: { competitors: [{ sequence: "x" }, { sequence: 2 }, { sequence: 2 }] } } } }, (w) => warnings.push(w))!;
    expect(e.competitors).toEqual([{ number: 2, name: null, status: "Unknown", starter: false, place: null, win: null }]);
    expect(e.noPrices).toBe(true);
    expect(warnings.length).toBeGreaterThanOrEqual(4);
  });
  it("platsoddset till Mark: högst 99,99 och minst 1,01", () => {
    expect(markOddsOf(2.75)).toBe(2.75);
    expect(markOddsOf(151)).toBe(99.99);
    expect(markOddsOf(1)).toBeNull();
    expect(markOddsOf(null)).toBeNull();
  });
});
