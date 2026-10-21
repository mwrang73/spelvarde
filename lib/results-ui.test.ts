import { describe, expect, it } from "vitest";
import { POLL_INTERVAL_MS, POLL_WINDOW_MS } from "@/lib/outcomes";
import {
  allLegsDone,
  checkedLine,
  hasAnyMarks,
  initialDelay,
  latestIso,
  legRow,
  nextWakeAt,
  placedRowSr,
  pollActive,
  resultAnnouncement,
  resultMode,
  retryDelay,
  showsResultToggle,
  summaryBoxes,
  summarySr,
} from "@/lib/results-ui";
import { raceResultView } from "@/lib/results-view";
import { mkRace, mkStart } from "@/lib/test-round";
import type { OutcomeSummary, StartDto, StartOutcomeDto } from "@/lib/types";

const out = (p: Partial<StartOutcomeDto> = {}): StartOutcomeDto => ({
  interesting: false,
  spelbar: false,
  bet: false,
  xFactor: "NONE",
  hit: null,
  place: null,
  disqualified: false,
  unibetOdds: null,
  trollspotRank: null,
  trollspotMinOdds: null,
  trollspotEstOdds: null,
  ...p,
});
const res = (place: number | null, p: Partial<NonNullable<StartDto["result"]>> = {}) => ({ place, finishOrder: place, disqualified: false, galloped: false, kmTime: null, finalOdds: null, ...p });
const hc = (hits: number, total: number) => ({ hits, total });
const sum = (bet: [number, number], spelbar: [number, number], interesting: [number, number], trollspot: [number, number] = [0, 0]): OutcomeSummary => ({
  bet: hc(...bet),
  spelbar: hc(...spelbar),
  interesting: hc(...interesting),
  trollspot: hc(...trollspot),
});

const START = "2026-10-24T15:13:00.000Z";
const t0 = Date.parse(START);
const MIN = 60_000;

describe("resultMode", () => {
  const race = mkRace(7, [], { startAt: START });
  it("före start, väntar högst 30 min, sedan sent", () => {
    expect(resultMode(race, t0 - 1)).toBe("before");
    expect(resultMode(race, t0)).toBe("waiting");
    expect(resultMode(race, t0 + POLL_WINDOW_MS)).toBe("waiting");
    expect(resultMode(race, t0 + POLL_WINDOW_MS + 1)).toBe("late");
  });
  it("started från servern räcker även om klockan går efter", () => {
    expect(resultMode({ ...race, started: true }, t0 - 5 * MIN)).toBe("waiting");
  });
  it("resultat och inställt går före klockan", () => {
    expect(resultMode({ ...race, resultAt: START }, t0 + 99 * MIN)).toBe("result");
    expect(resultMode({ ...race, cancelled: true }, t0 - 99 * MIN)).toBe("cancelled");
  });
  it("segmentkontrollen visas efter start och för inställda", () => {
    expect(showsResultToggle(race, t0 - 1)).toBe(false);
    expect(showsResultToggle(race, t0 + 1)).toBe(true);
    expect(showsResultToggle({ ...race, cancelled: true }, t0 - MIN)).toBe(true);
  });
});

describe("pollningen (6.10)", () => {
  const r1 = mkRace(1, [], { startAt: START });
  const r2 = mkRace(2, [], { startAt: new Date(t0 + 22 * MIN).toISOString() });
  it("aktiv bara inom 30 min efter start för lopp utan resultat", () => {
    expect(pollActive([r1, r2], t0 - 1)).toBe(false);
    expect(pollActive([r1, r2], t0 + MIN)).toBe(true);
    expect(pollActive([{ ...r1, resultAt: START }, r2], t0 + MIN)).toBe(false);
    expect(pollActive([{ ...r1, cancelled: true }, r2], t0 + MIN)).toBe(false);
    // r1 är för gammal, men r2 har startat.
    expect(pollActive([r1, r2], t0 + 40 * MIN)).toBe(true);
    expect(pollActive([r1, r2], t0 + 22 * MIN + POLL_WINDOW_MS + 1)).toBe(false);
  });
  it("vaknar vid nästa starttid", () => {
    expect(nextWakeAt([r1, r2], t0 - MIN)).toBe(t0);
    expect(nextWakeAt([r1, r2], t0 + MIN)).toBe(t0 + 22 * MIN);
    expect(nextWakeAt([r1, { ...r2, cancelled: true }], t0 + MIN)).toBeNull();
  });
  it("60 s normalt, 5/10/15 s efter fel, sedan 60 s", () => {
    expect(retryDelay(0)).toBe(POLL_INTERVAL_MS);
    expect([1, 2, 3].map(retryDelay)).toEqual([5_000, 10_000, 15_000]);
    expect(retryDelay(4)).toBe(POLL_INTERVAL_MS);
  });
  it("startar om räknat från förra försöket", () => {
    expect(initialDelay(null, 0, t0)).toBe(0);
    expect(initialDelay(t0 - 20_000, 0, t0)).toBe(40_000);
    expect(initialDelay(t0 - 90_000, 0, t0)).toBe(0);
    expect(initialDelay(t0 - 2_000, 1, t0)).toBe(3_000);
  });
  it("raden Senast kollat · nästa", () => {
    expect(checkedLine("2026-10-24T15:16:00.000Z", Date.parse("2026-10-24T15:17:00.000Z"))).toBe("Senast kollat 17:16 · nästa 17:17");
    expect(checkedLine(null, null)).toBeNull();
    expect(latestIso("2026-10-24T15:16:00.000Z", "2026-10-24T15:15:00.000Z")).toBe("2026-10-24T15:16:00.000Z");
    expect(latestIso(null, undefined)).toBeNull();
  });
});

describe("summeringen", () => {
  it("tre rutor, '–' och 'ingen' för tom grupp, Trollspöt bara med hästar", () => {
    const b = summaryBoxes(sum([1, 2], [0, 0], [3, 4]));
    expect(b.map((x) => [x.label, x.value, x.unit])).toEqual([
      ["Bet", "1 / 2", "träff"],
      ["Spelbar", "–", "ingen"],
      ["Intressant", "3 / 4", "topp 3"],
    ]);
    expect(summaryBoxes(sum([1, 2], [1, 2], [3, 4], [2, 3])).map((x) => x.label)).toContain("Trollspöt");
  });
  it("skärmläsartexten", () => {
    expect(summarySr(sum([1, 2], [1, 2], [3, 4]))).toBe("Bet: 1 av 2 träff. Spelbar: 1 av 2 topp 3. Intressant: 3 av 4 topp 3.");
    expect(summarySr(sum([0, 0], [1, 2], [3, 4], [2, 3]))).toBe("Bet: ingen. Spelbar: 1 av 2 topp 3. Intressant: 3 av 4 topp 3. Trollspöt: 2 av 3 topp 3.");
  });
  it("inga markeringar", () => {
    expect(hasAnyMarks(sum([0, 0], [0, 0], [0, 0]))).toBe(false);
    expect(hasAnyMarks(sum([0, 0], [0, 0], [0, 0], [0, 1]))).toBe(true);
    expect(hasAnyMarks(null)).toBe(false);
  });
});

const driver = (name: string) => ({ id: name, name, firstName: "", lastName: "", shortName: null });
const starts = [
  mkStart("e", 5, { horse: { id: "h5", name: "Kentucky River", sex: null, age: null, record: null, earnings: null }, driver: driver("Magnus A Djuse"), result: res(1), outcome: out({ bet: true, interesting: true, spelbar: true, hit: true }) }),
  mkStart("j", 10, { horse: { id: "h10", name: "Barack Face", sex: null, age: null, record: null, earnings: null }, result: res(6, { galloped: true }), outcome: out({ bet: true, interesting: true, hit: false }) }),
  mkStart("b", 2, { result: res(2), outcome: out({ interesting: true, hit: true, trollspotRank: 3 }) }),
  mkStart("x", 3, { result: res(3) }),
];
const race = mkRace(7, starts, { startAt: START, started: true, resultAt: "2026-10-24T15:19:00.000Z", summary: sum([1, 2], [1, 1], [2, 3], [1, 1]) });

describe("texter i resultatvyn", () => {
  const v = raceResultView(race);
  it("raden för skärmläsaren", () => {
    expect(placedRowSr(v.placed[0])).toBe("1:a, nummer 5, Kentucky River, Magnus A Djuse. Bet, träff.");
    expect(placedRowSr(v.placed[1])).toBe("2:a, nummer 2, Häst b. Intressant. Trollspöt.");
    expect(placedRowSr(v.placed[2])).toBe("3:e, nummer 3, Häst x.");
  });
  it("uppläsningen när resultatet kommer", () => {
    expect(resultAnnouncement(7, v.placed, race.summary)).toBe("Resultat i avd 7: Kentucky River vann. Bet 1 av 2 träff.");
    expect(resultAnnouncement(7, v.placed, sum([0, 0], [0, 0], [0, 0]))).toBe("Resultat i avd 7: Kentucky River vann.");
  });
});

describe("S1: avdelningsraderna", () => {
  it("före start, pågår, inställt", () => {
    const r = mkRace(7, [], { startAt: START });
    expect(legRow(r, t0 - 1)).toEqual({ kind: "before" });
    expect(legRow(r, t0 + MIN)).toEqual({ kind: "live", line2: "Startade 17:13 · väntar på resultat" });
    expect(legRow(r, t0 + 99 * MIN).kind).toBe("live");
    expect(legRow({ ...r, cancelled: true }, t0 + MIN)).toEqual({ kind: "cancelled" });
  });
  it("vinnare och Bet med placering eller miss", () => {
    expect(legRow(race, t0 + 10 * MIN)).toEqual({ kind: "result", title: "Vinnare 5 Kentucky River", line2: "Bet: 5 Kentucky River 1:a · 10 Barack Face miss", bet: { hits: 1, total: 2 } });
  });
  it("utan Bet: Intressant n/m topp 3, utan markeringar: Inga markeringar", () => {
    const noBet = mkRace(3, [mkStart("a", 1, { result: res(1), outcome: out({ interesting: true, hit: true }) })], { startAt: START, resultAt: START, summary: sum([0, 0], [0, 0], [1, 1]) });
    expect(legRow(noBet, t0)).toMatchObject({ title: "Vinnare 1 Häst a", line2: "Intressant 1/1 topp 3", bet: null });
    const none = mkRace(3, [mkStart("a", 1, { result: res(1) })], { startAt: START, resultAt: START, summary: sum([0, 0], [0, 0], [0, 0]) });
    expect(legRow(none, t0)).toMatchObject({ line2: "Inga markeringar", bet: null });
  });
  it("omgången klar när alla har resultat eller är inställda", () => {
    expect(allLegsDone([{ resultAt: START, cancelled: false }, { resultAt: null, cancelled: true }])).toBe(true);
    expect(allLegsDone([{ resultAt: START, cancelled: false }, { resultAt: null, cancelled: false }])).toBe(false);
    expect(allLegsDone([])).toBe(false);
  });
});
