import { describe, expect, it } from "vitest";
import { defaultLiveLeg, digitStep, flushDigit, horseAria, liveResultList, liveTabs, newlyStartedLeg, parseLegParam, raceLine, rowSr, statusSaved } from "@/lib/live-view";
import { mkMark, mkRace, mkStart } from "@/lib/test-round";
import type { StartDto, StartResultDto, SubmittedRowDto } from "@/lib/types";

const res = (place: number | null, p: Partial<StartResultDto> = {}): StartResultDto => ({ place, finishOrder: null, disqualified: false, galloped: false, kmTime: null, finalOdds: null, ...p });
const st = (n: number, result: StartResultDto | null, p: Partial<StartDto> = {}) => mkStart(`s${n}`, n, { result, ...p });
const row = (leg: number, nums: number[]): SubmittedRowDto => ({ roundId: "r", selections: { [leg]: nums }, rows: 1, cost: 1, rowPrice: 0.5, markedAt: "", markedLate: false, updatedAt: "" });
const noTags = () => [] as string[];
const list = (starts: StartDto[], sub: SubmittedRowDto | null = null, tags: (id: string) => string[] = noTags) => liveResultList(mkRace(4, starts), sub, tags);
const T0 = Date.parse("2026-10-24T17:00:00Z");

describe("liveResultList (17.4)", () => {
  it("1. placerade i ordning", () => {
    expect(list([st(1, res(6)), st(2, res(2)), st(3, res(1)), st(4, res(4)), st(5, res(3))]).map((r) => r.place)).toEqual([1, 2, 3, 4, 6]);
  });
  it("2. dött lopp: båda ettor efter startnummer, sedan 3", () => {
    expect(list([st(5, res(1)), st(2, res(1)), st(1, res(3))]).map((r) => r.start.number)).toEqual([2, 5, 1]);
  });
  it("3. place 0 med finishOrder 7 och 5: 5 före 7, efter placerade", () => {
    expect(list([st(1, res(0, { finishOrder: 7 })), st(2, res(0, { finishOrder: 5 })), st(3, res(1))]).map((r) => r.start.number)).toEqual([3, 2, 1]);
  });
  it("4–6. diskad efter oplacerade, struken saknas, utan result sist bland oplacerade", () => {
    const rows = list([st(1, res(null, { disqualified: true })), st(2, res(0)), st(3, null), st(4, res(1)), st(5, res(2), { scratched: true })]);
    expect(rows.map((r) => r.start.number)).toEqual([4, 2, 3, 1]);
    expect(rows.map((r) => r.placeText)).toEqual(["1", "–", "–", "d"]);
    expect(rows.map((r) => r.kind)).toEqual(["placed", "unplaced", "unplaced", "disqualified"]);
  });
  it("7. top3 är sant för 1–3, falskt för 4 och diskad, också diskad med place 1", () => {
    const rows = list([st(1, res(1)), st(2, res(3)), st(3, res(4)), st(4, res(1, { disqualified: true }))]);
    expect(rows.map((r) => [r.start.number, r.top3])).toEqual([[1, true], [2, true], [3, false], [4, false]]);
  });
  it("8–9. Bet med plats 3, 4, diskad; Bet utan outcome läses från mark", () => {
    const b = (bet = true) => mkMark("x", { bet, betOdds: 2.4 });
    const rows = list([st(1, res(3), { mark: b() }), st(2, res(4), { mark: b() }), st(3, res(null, { disqualified: true }), { mark: b() }), st(4, res(1))]);
    expect(rows.map((r) => [r.start.number, r.bet?.hit ?? null])).toEqual([[4, null], [1, true], [2, false], [3, false]]);
    expect(rows[1].bet?.odds).toBe(2.4);
  });
  it("10–12. RAD: hit när hästen vann, annars inte, inget fält utan rad", () => {
    const starts = [st(1, res(1)), st(2, res(2))];
    expect(list(starts, row(4, [1, 2])).map((r) => r.rad)).toEqual([{ hit: true }, { hit: false }]);
    expect(list(starts).map((r) => r.rad)).toEqual([null, null]);
  });
  it("13. tre taggar: två + 1, alla i skärmläsartexten", () => {
    const r = list([st(1, res(1))], null, () => ["Galopp", "Dödens", "Tröttnade"])[0];
    expect(r.shownTags).toEqual(["Galopp", "Dödens"]);
    expect(r.moreTags).toBe(1);
    expect(r.sr).toContain("Taggar: Galopp, Dödens, Tröttnade.");
  });
  it("14. rowSr är exakt meningen i 14.1", () => {
    const s = st(7, res(1), { horse: { ...mkStart("a", 1).horse, name: "Nordic Sunset" }, driver: { id: "d", name: "A. Lindqvist" } as StartDto["driver"], mark: mkMark("x", { bet: true, betOdds: 2.4 }) });
    const r = list([s], row(4, [7]), () => ["Tog spets", "Ledde hela vägen"])[0];
    expect(r.sr).toBe("1:a, nummer 7, Nordic Sunset, A. Lindqvist. Bet, spelad till 2,40, träff. Med i din inlämnade rad, vann loppet. Taggar: Tog spets, Ledde hela vägen.");
    expect(rowSr({ start: mkStart("a", 3), kind: "unplaced", place: null, bet: null, rad: null, tags: [] })).toMatch(/^Oplacerad, nummer 3,/);
    expect(rowSr({ start: mkStart("a", 5), kind: "disqualified", place: null, bet: null, rad: null, tags: [] })).toMatch(/^Diskad, nummer 5,/);
  });
});

describe("defaultLiveLeg (3.2)", () => {
  const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
  const races = [mkRace(1, [], { startAt: at(-120) }), mkRace(2, [], { startAt: at(-60) }), mkRace(3, [], { startAt: at(-10) }), mkRace(4, [], { startAt: at(20) })];
  it("15. pågående före otaggat", () => {
    expect(defaultLiveLeg(races, () => 0, T0, false)).toBe(3);
  });
  it("otaggat före första, och väntar på läsningen högst tills tiden gått", () => {
    const done = [mkRace(1, [], { startAt: at(-120), resultAt: at(-100) }), mkRace(2, [], { startAt: at(-60), resultAt: at(-40) })];
    expect(defaultLiveLeg(done, (l) => (l === 1 ? 3 : 0), T0, false)).toBe(2);
    expect(defaultLiveLeg(done, () => 2, T0, false)).toBe(1);
    expect(defaultLiveLeg(done, () => null, T0, false)).toBeNull();
    expect(defaultLiveLeg(done, () => null, T0, true)).toBe(1);
    expect(defaultLiveLeg(done, (l) => (l === 1 ? "failed" : 2), T0, false)).toBe(1);
  });
  it("inställt hoppas över, inget startat ger första", () => {
    const off = [mkRace(1, [], { startAt: at(-120), cancelled: true, resultAt: null }), mkRace(2, [], { startAt: at(-60), resultAt: at(-40) })];
    expect(defaultLiveLeg(off, () => 0, T0, false)).toBe(2);
    expect(defaultLiveLeg([mkRace(1, [], { startAt: at(5) }), mkRace(2, [], { startAt: at(30) })], () => null, T0, false)).toBe(1);
  });
  it("avd i adressen: ogiltigt behandlas som saknat", () => {
    expect(parseLegParam("3", races)).toBe(3);
    expect(parseLegParam("9", races)).toBeNull();
    expect(parseLegParam("x", races)).toBeNull();
    expect(parseLegParam(null, races)).toBeNull();
  });
});

describe("loppraden och texterna", () => {
  it("16. V75: 7 lopp och V75-n, utan resultat i etiketten", () => {
    const races = Array.from({ length: 7 }, (_, i) => mkRace(i + 1, [st(1, res(1))], { startAt: new Date(T0 - 3_600_000).toISOString(), resultAt: new Date(T0).toISOString() }));
    const tabs = liveTabs("V75", races, { 1: { tagged: 3, total: 15 } }, T0);
    expect(tabs).toHaveLength(7);
    expect(tabs[0].name).toBe("V75-1");
    expect(tabs[0].count).toBe("3/15");
    expect(tabs[0].label).toContain("3 av 15 taggade");
    expect(tabs.map((t) => t.label).join(" ")).not.toMatch(/vann|plac|träff/i);
  });
  it("17. ingen text innehåller Avd", () => {
    const r = mkRace(4, [], { startAt: new Date(T0 - 60_000).toISOString() });
    const texts = [raceLine(r, "waiting", false, true).text, raceLine(r, "before", false, false).text, raceLine(r, "late", false, false).text, raceLine(r, "result", false, false).text, raceLine(r, "result", true, false).text, ...liveTabs("V85", [r], {}, T0).map((t) => t.label)];
    expect(texts.join(" ")).not.toMatch(/\bavd/i);
  });
  it("dolt lopp säger resultat dolt, visat säger resultat visas", () => {
    const r = mkRace(4, [], { startAt: "2026-10-24T15:50:00Z" });
    expect(raceLine(r, "result", false, false).text).toBe("Startade lör 17:50 · resultat dolt");
    expect(raceLine(r, "result", true, false).text).toBe("Startade lör 17:50 · resultat visas");
    expect(raceLine(r, "waiting", false, true)).toEqual({ text: "Pågår · startade 17:50", pulse: true });
  });
  it("kolumnens etikett säger aldrig placering", () => {
    const s = st(5, res(1), { horse: { ...mkStart("a", 1).horse, name: "Ble Du Rask" }, mark: mkMark("x", { bet: true, betOdds: 2.4, spelbar: true, interesting: true }) });
    expect(horseAria(s, true)).toBe("5 Ble Du Rask, Bet spelad till 2,40, med i din rad, Spelbar, Intressant");
  });
  it("status för tagg och borttagning", () => {
    expect(statusSaved("Galopp", "5 Ble Du Rask", false)).toBe("Galopp på 5 Ble Du Rask");
    expect(statusSaved("Galopp", "5 Ble Du Rask", true)).toBe("Tog bort Galopp från 5 Ble Du Rask");
  });
  it("nytt lopp: senast startade, inte det valda, och försvinner vid byte", () => {
    const at = (m: number) => new Date(T0 + m * 60_000).toISOString();
    const races = [mkRace(1, [], { startAt: at(-30) }), mkRace(2, [], { startAt: at(-2) })];
    expect(newlyStartedLeg(races, T0 - 600_000, T0, 1, [])).toBe(2);
    expect(newlyStartedLeg(races, T0 - 600_000, T0, 2, [])).toBeNull();
    expect(newlyStartedLeg(races, T0 - 600_000, T0, 1, [2])).toBeNull();
    expect(newlyStartedLeg(races, T0, T0, 1, [])).toBeNull();
  });
});

describe("tangenter: regeln mot fel häst (14.3)", () => {
  const fifteen = Array.from({ length: 15 }, (_, i) => i + 1);
  it("en etta väntar när loppet har 10 eller fler hästar", () => {
    expect(digitStep(null, "1", fifteen)).toEqual({ pick: null, pending: "1" });
    expect(digitStep("1", "2", fifteen)).toEqual({ pick: 12, pending: null });
    expect(digitStep(null, "7", fifteen)).toEqual({ pick: 7, pending: null });
  });
  it("färre än 10 hästar: direkt", () => {
    expect(digitStep(null, "1", [1, 2, 3])).toEqual({ pick: 1, pending: null });
  });
  it("väntande etta och en bokstav: ettan gäller innan taggen sätts", () => {
    expect(flushDigit("1", fifteen)).toBe(1);
    expect(flushDigit(null, fifteen)).toBeNull();
  });
  it("struken häst ignoreras", () => {
    const utan7 = fifteen.filter((n) => n !== 7);
    expect(digitStep(null, "7", utan7).pick).toBeNull();
    expect(flushDigit("1", utan7.filter((n) => n !== 1))).toBeNull();
  });
  it("andra siffran bildar inget nummer: första gäller", () => {
    expect(digitStep("1", "9", fifteen)).toEqual({ pick: 1, pending: null });
  });
});
