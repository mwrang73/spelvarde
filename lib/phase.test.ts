import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Features } from "@/lib/features";
import { computePhase, dayDateLabel, firstStartOf, isRoundFinished, nextStep, phaseBounds, phaseRail, roundDayPassed, runningRace, type NextStepRace } from "@/lib/phase";

const D = "2026-10-24";
// 8 lopp från 15:00 svensk tid (13:00Z, sommartid) med 22 min mellanrum.
const races = (over: Partial<NextStepRace> = {}, perLeg: Record<number, Partial<NextStepRace>> = {}): NextStepRace[] =>
  Array.from({ length: 8 }, (_, i) => ({
    leg: i + 1,
    name: `Lopp ${i + 1}`,
    startAt: new Date(Date.UTC(2026, 9, 24, 13, i * 22)),
    hasResult: false,
    cancelled: false,
    reviewed: false,
    ...over,
    ...perLeg[i + 1],
  }));
const at = (iso: string) => new Date(iso);
// Flaggorna före och efter Live (E8). Testerna anger dem själva, så att de inte
// ändrar betydelse när features.raceView slås på.
const FLAG_OFF: Features = { odds: true, coupon: true, live: false, raceView: false, stats: false, results: true, tips: true };
const FLAG_ON: Features = { ...FLAG_OFF, raceView: true };
const round = (rs: NextStepRace[], fetchStatus: "COMPLETE" | "PARTIAL" = "COMPLETE") => ({ id: "r1", date: D, fetchStatus, races: rs });

describe("faser (3.1)", () => {
  it("gränserna D−2 18:00 och reserven D 12:00 i svensk tid", () => {
    const b = phaseBounds(D);
    expect(b.oddsFrom.toISOString()).toBe("2026-10-22T16:00:00.000Z");
    expect(b.liveFrom.toISOString()).toBe("2026-10-24T10:00:00.000Z");
  });
  it("Analys, Odds, Live, Klart", () => {
    expect(computePhase(D, races(), at("2026-10-19T19:00:00Z"))).toBe("ANALYS");
    expect(computePhase(D, races(), at("2026-10-22T15:59:00Z"))).toBe("ANALYS");
    expect(computePhase(D, races(), at("2026-10-22T16:00:00Z"))).toBe("ODDS");
    expect(computePhase(D, races(), at("2026-10-24T09:59:00Z"))).toBe("ODDS");
    expect(computePhase(D, races(), at("2026-10-24T13:00:00Z"))).toBe("LIVE");
    expect(computePhase(D, races({ hasResult: true }), at("2026-10-24T17:00:00Z"))).toBe("KLART");
  });
  it("E8: Odds gäller till första start, inte D 12:00", () => {
    // Första start 16:20 svensk tid = 14:20Z.
    const rs = races({ startAt: at("2026-10-24T15:00:00Z") }, { 1: { startAt: at("2026-10-24T14:20:00Z") } });
    expect(computePhase(D, rs, at("2026-10-24T10:00:00Z"))).toBe("ODDS");
    expect(computePhase(D, rs, at("2026-10-24T14:19:59Z"))).toBe("ODDS");
    expect(computePhase(D, rs, at("2026-10-24T14:20:00Z"))).toBe("LIVE");
  });
  it("E8: omgång utan lopp får D 12:00 som reserv", () => {
    expect(computePhase(D, [], at("2026-10-24T09:59:00Z"))).toBe("ODDS");
    expect(computePhase(D, [], at("2026-10-24T10:00:00Z"))).toBe("LIVE");
  });
  it("E8: inställt lopp räknas som första start, som spelstoppet", () => {
    const rs = races({ startAt: at("2026-10-24T15:00:00Z") }, { 1: { startAt: at("2026-10-24T13:00:00Z"), cancelled: true } });
    expect(computePhase(D, rs, at("2026-10-24T13:00:01Z"))).toBe("LIVE");
    expect(firstStartOf(rs)?.toISOString()).toBe("2026-10-24T13:00:00.000Z");
    expect(firstStartOf([])).toBeNull();
  });
  it("Klart gäller också före första start om allt har resultat", () => {
    expect(computePhase(D, races({ hasResult: true }), at("2026-10-24T10:00:00Z"))).toBe("KLART");
  });
  it("Live tidigare om ett lopp har startat", () => {
    const rs = races({}, { 1: { startAt: at("2026-10-23T12:00:00Z") } });
    expect(computePhase(D, rs, at("2026-10-23T12:01:00Z"))).toBe("LIVE");
  });
  it("Klart när startade lopp har resultat och resten är inställda", () => {
    const rs = races({ hasResult: true }, { 8: { hasResult: false, cancelled: true } });
    expect(isRoundFinished(rs)).toBe(true);
    expect(isRoundFinished(races({ cancelled: true }))).toBe(false);
  });
  it("fasraden", () => {
    const rail = phaseRail(D, "ODDS");
    expect(rail.map((s) => s.state)).toEqual(["done", "current", "upcoming", "upcoming"]);
    expect(rail[1].dayLabel).toBe("tors 18:00");
    expect(rail[2].dayLabel).toBe("lör 12:00");
    expect(dayDateLabel(D)).toBe("lör 24 okt");
  });
  it("E8: fasraden visar första start, och D 12:00 utan lopp", () => {
    const first = at("2026-10-24T14:20:00Z");
    const rail = phaseRail(D, "ODDS", first);
    expect(rail[2].dayLabel).toBe("lör 16:20");
    expect(rail[2].from).toBe(first.toISOString());
    const none = phaseRail(D, "ODDS", null);
    expect(none[2].dayLabel).toBe("lör 12:00");
    expect(none[2].from).toBe("2026-10-24T10:00:00.000Z");
  });
});

describe("Nästa steg (3.2)", () => {
  const now = at("2026-10-19T19:00:00Z");
  const next = { gameId: "V85_2026-10-24_7_5", trackName: "Jägersro", date: D, fetched: false };

  it("1. ingen omgång: Hämta omgång med bana och datum", () => {
    const s = nextStep({ now, round: null, nextAvailable: next });
    expect(s.kind).toBe("FETCH_ROUND");
    expect(s.title).toBe("Hämta omgång – V85 Jägersro lör 24 okt");
    expect(s.action).toEqual({ type: "fetch", label: "Hämta omgång", gameId: "V85_2026-10-24_7_5" });
    expect(nextStep({ now, round: null, nextAvailable: null }).title).toBe("Hämta omgång");
  });
  it("1. med spelformen V75: texterna säger V75", () => {
    const s = nextStep({ now, gameType: "V75", round: null, nextAvailable: { ...next, gameId: "V75_2026-11-28_5_5", date: "2026-11-28", trackName: "Solvalla" } });
    expect(s.title).toBe("Hämta omgång – V75 Solvalla lör 28 nov");
    expect(s.text).toBe("Hämta veckans V75 från ATG. Startlistan brukar finnas från söndag kväll.");
    expect(nextStep({ now, gameType: "V75", round: null, nextAvailable: null }).text).toContain("veckans V75");
  });
  it("1. klar omgång: Hämta nästa omgång när den inte är hämtad", () => {
    const tue = at("2026-10-27T10:00:00Z");
    const nxt = { gameId: "V85_2026-10-31_5_5", trackName: "Solvalla", date: "2026-10-31", fetched: false };
    const done = round(races({ hasResult: true, reviewed: true }));
    expect(nextStep({ now: tue, round: done, nextAvailable: nxt })).toMatchObject({ kind: "FETCH_ROUND", action: { type: "fetch", gameId: "V85_2026-10-31_5_5" } });
    expect(nextStep({ now: tue, round: done, nextAvailable: { ...nxt, fetched: true } }).kind).not.toBe("FETCH_ROUND");
  });
  it("1. ett resultat saknas men dagen har passerat: Hämta nästa omgång ändå", () => {
    const nxt = { gameId: "V85_2026-10-31_5_5", trackName: "Solvalla", date: "2026-10-31", fetched: false };
    const stuck = round(races({ hasResult: true, reviewed: true }, { 8: { hasResult: false } }));
    expect(nextStep({ now: at("2026-10-24T21:00:00Z"), round: stuck, nextAvailable: nxt }).kind).toBe("LIVE_WAITING");
    expect(nextStep({ now: at("2026-10-25T08:00:00Z"), round: stuck, nextAvailable: nxt }).kind).toBe("FETCH_ROUND");
    expect(roundDayPassed(D, at("2026-10-24T21:59:00Z"))).toBe(false);
    expect(roundDayPassed(D, at("2026-10-24T22:00:00Z"))).toBe(true);
  });
  it("2. ofullständig hämtning går före allt annat", () => {
    expect(nextStep({ now, round: round(races(), "PARTIAL"), nextAvailable: null }).kind).toBe("RESUME_FETCH");
  });
  it("8. Analys: första loppet som inte är genomgången", () => {
    const s = nextStep({ now, round: round(races({}, { 1: { reviewed: true }, 2: { reviewed: true } })), nextAvailable: null });
    expect(s.kind).toBe("ANALYZE_LEG");
    expect(s.title).toBe("Analysera V85-3 – Lopp 3");
    expect(s.action).toEqual({ type: "link", label: "Till V85-3", href: "/omgang/r1/avd/3" });
  });
  it("8. allt genomgånget: ingen primärknapp", () => {
    const s = nextStep({ now, round: round(races({ reviewed: true })), nextAvailable: null });
    expect(s).toMatchObject({ kind: "ALL_REVIEWED", title: "Allt genomgånget – odds fylls i torsdag kväll", action: null });
  });
  it("5–7. Odds-steg bara när E2 är påslaget", () => {
    const oddsNow = at("2026-10-23T08:00:00Z");
    const rs = round(races({ reviewed: true }));
    const e1 = { odds: false, coupon: false, live: false, raceView: false, stats: false, results: false, tips: false };
    expect(nextStep({ now: oddsNow, round: rs, nextAvailable: null, interestingWithoutOdds: 3, features: e1 }).kind).toBe("ALL_REVIEWED");
    const f = { odds: true, coupon: true, live: true, raceView: true, stats: true, results: true, tips: false };
    expect(nextStep({ now: oddsNow, round: rs, nextAvailable: null, interestingWithoutOdds: 3, features: f }).title).toBe("Fyll i Unibets odds – 3 kvar");
    expect(nextStep({ now: oddsNow, round: rs, nextAvailable: null, spelbarWithoutBet: 2, features: f }).title).toBe("Markera Bet – 2 spelbara");
    expect(nextStep({ now: oddsNow, round: rs, nextAvailable: null, features: f }).kind).toBe("BUILD_COUPON");
    expect(nextStep({ now: oddsNow, round: rs, nextAvailable: null, hasCoupon: true, features: f }).kind).toBe("ALL_REVIEWED");
  });
  it("3–4. Live: larm först, sedan nästa lopp", () => {
    const liveNow = at("2026-10-24T13:30:00Z");
    const f = { odds: true, coupon: true, live: true, raceView: true, stats: true, results: true, tips: false };
    const rs = round(races());
    expect(nextStep({ now: liveNow, round: rs, nextAvailable: null, unackedAlarms: [{ leg: 7, horseName: "Mateo di Quattro", kind: "RUSH" }], features: f }).title).toBe("Rusning i V85-7 – Mateo di Quattro");
    const s = nextStep({ now: liveNow, round: rs, nextAvailable: null, features: FLAG_OFF });
    expect(s.title).toBe("V85-3 startar 15:44");
    // E4a: meningen är loppnamnet utan markeringar, och knappen leder till S2.
    expect(s.text).toBe("Lopp 3");
    expect(s.action).toEqual({ type: "link", label: "Till V85-3", href: "/omgang/r1/avd/3" });
  });
  it("4. E4a: dina hästar i nästa avdelning", () => {
    const liveNow = at("2026-10-24T13:30:00Z");
    const rs = round(races({}, { 3: { mine: [{ name: "Blixt Lane", label: "Bet" }, { name: "Django Silver", label: "Intressant" }] } }));
    expect(nextStep({ now: liveNow, round: rs, nextAvailable: null, features: FLAG_OFF }).text).toBe("Blixt Lane är Bet. Django Silver är Intressant.");
    // Före E4a: ingen knapp och loppnamnet.
    const e1 = { odds: true, coupon: true, live: false, raceView: false, stats: false, results: false, tips: false };
    expect(nextStep({ now: liveNow, round: rs, nextAvailable: null, features: e1 })).toMatchObject({ text: "Lopp 3", action: null });
  });
  it("4b. E4a: alla har startat, väntar på resultat med länk", () => {
    const late = at("2026-10-24T16:20:00Z");
    const rs = round(races({ hasResult: true }, { 7: { hasResult: false }, 8: { hasResult: false } }));
    const s = nextStep({ now: late, round: rs, nextAvailable: null, features: FLAG_OFF });
    expect(s).toMatchObject({ kind: "LIVE_WAITING", title: "Väntar på resultat i V85-7", text: "Placeringen hämtas automatiskt från ATG." });
    expect(s.action).toEqual({ type: "link", label: "Till V85-7", href: "/omgang/r1/avd/7" });
  });
  it("9. Efteranalysen är klar, med summeringen", () => {
    const done = round(races({ hasResult: true }));
    const later = at("2026-10-25T19:00:00Z");
    const summary = { bet: { hits: 2, total: 4 }, spelbar: { hits: 3, total: 6 }, interesting: { hits: 6, total: 13 }, trollspot: { hits: 2, total: 3 } };
    expect(nextStep({ now: later, round: done, nextAvailable: null, summary, features: FLAG_OFF })).toMatchObject({
      kind: "SEE_ANALYSIS",
      title: "Efteranalysen är klar",
      text: "Bet 2/4 träff · Spelbar 3/6 topp 3 · Intressant 6/13 topp 3 · Trollspöt 2/3 topp 3.",
      action: { type: "link", label: "Se efteranalysen", href: "/omgang/r1/analys" },
    });
    const noTroll = { ...summary, trollspot: { hits: 0, total: 0 } };
    expect(nextStep({ now: later, round: done, nextAvailable: null, summary: noTroll, features: FLAG_OFF }).text).toBe("Bet 2/4 träff · Spelbar 3/6 topp 3 · Intressant 6/13 topp 3.");
  });
  it("9. Klart: hämta nästa om den finns", () => {
    const done = round(races({ hasResult: true }));
    const later = at("2026-10-25T19:00:00Z");
    expect(nextStep({ now: later, round: done, nextAvailable: { ...next, gameId: "V85_2026-10-31_5_5", date: "2026-10-31", trackName: "Solvalla" } }).title).toBe("Hämta omgång – V85 Solvalla lör 31 okt");
    expect(nextStep({ now: later, round: done, nextAvailable: null }).kind).toBe("SEE_ANALYSIS");
  });
});

describe("Nästa steg med Live (E8 3.5)", () => {
  // V85-1 startar 15:00 (13:00Z), därefter var 22:a minut. V85-4 startar 16:06 (14:06Z).
  const step = (now: string, rs: NextStepRace[], over: Partial<Parameters<typeof nextStep>[0]> = {}) => nextStep({ now: at(now), round: round(rs), nextAvailable: null, features: FLAG_ON, ...over });
  const done = (...legs: number[]) => Object.fromEntries(legs.map((l) => [l, { hasResult: true }]));

  it("ett lopp startat för 10 min sedan utan resultat: LIVE_RUNNING", () => {
    const s = step("2026-10-24T14:16:00Z", races({}, done(1, 2, 3)));
    expect(s).toMatchObject({ kind: "LIVE_RUNNING", title: "V85-4 pågår", text: "Lopp 4", action: { type: "link", label: "Till Live", href: "/omgang/r1/live?avd=4" } });
  });
  it("pågår: meningen med dina hästar", () => {
    const rs = races({}, { ...done(1, 2, 3), 4: { mine: [{ name: "Blixt Lane", label: "Bet" }] } });
    expect(step("2026-10-24T14:16:00Z", rs).text).toBe("Blixt Lane är Bet.");
  });
  it("31 min sedan, nästa lopp finns: LIVE_NEXT_RACE", () => {
    const early = { startAt: at("2026-10-24T13:00:00Z"), hasResult: true };
    const rs = races({ startAt: at("2026-10-24T15:00:00Z") }, { 1: early, 2: early, 3: early, 4: { startAt: at("2026-10-24T14:00:00Z") } });
    const s = step("2026-10-24T14:31:00Z", rs);
    expect(s).toMatchObject({ kind: "LIVE_NEXT_RACE", title: "V85-5 startar 17:00", action: { type: "link", label: "Till Live", href: "/omgang/r1/live?avd=5" } });
  });
  it("exakt 30 min efter start pågår loppet fortfarande", () => {
    const rs = races({ startAt: at("2026-10-24T15:00:00Z") }, { 4: { startAt: at("2026-10-24T14:00:00Z") } });
    expect(step("2026-10-24T14:30:00Z", rs).kind).toBe("LIVE_RUNNING");
  });
  it("runningRace: senast startade, inställt och klart hoppas över", () => {
    const rs = races({ startAt: at("2026-10-24T18:00:00Z") }, { 2: { startAt: at("2026-10-24T14:00:00Z") }, 3: { startAt: at("2026-10-24T14:10:00Z") }, 4: { startAt: at("2026-10-24T14:15:00Z"), cancelled: true }, 5: { startAt: at("2026-10-24T14:16:00Z"), hasResult: true } });
    expect(runningRace(rs, at("2026-10-24T14:20:00Z"))?.leg).toBe(3);
    expect(runningRace(rs, at("2026-10-24T13:00:00Z"))).toBeNull();
  });
  it("alla startade, V85-7 saknar: LIVE_WAITING", () => {
    const s = step("2026-10-24T18:00:00Z", races({ hasResult: true }, { 7: { hasResult: false } }));
    expect(s).toMatchObject({ kind: "LIVE_WAITING", title: "Väntar på resultat i V85-7", text: "Placeringen hämtas automatiskt från ATG.", action: { type: "link", label: "Till Live", href: "/omgang/r1/live?avd=7" } });
  });
  it("flaggan av: dagens kort, oförändrat", () => {
    const s = step("2026-10-24T14:16:00Z", races({}, done(1, 2, 3)), { features: FLAG_OFF });
    expect(s).toMatchObject({ kind: "LIVE_NEXT_RACE", title: "V85-5 startar 16:28", action: { type: "link", label: "Till V85-5", href: "/omgang/r1/avd/5" } });
    const odds = step("2026-10-23T08:00:00Z", races({ reviewed: true }), { features: FLAG_OFF, hasCoupon: true });
    expect(odds.title).toBe("Allt genomgånget – odds fylls i torsdag kväll");
  });
  it("Klart: kortet avslöjar inget, och utan E4a heller inget", () => {
    const summary = { bet: { hits: 2, total: 4 }, spelbar: { hits: 3, total: 6 }, interesting: { hits: 6, total: 13 }, trollspot: { hits: 2, total: 3 } };
    const s = step("2026-10-25T19:00:00Z", races({ hasResult: true }), { summary });
    expect(s).toMatchObject({ kind: "SEE_ANALYSIS", title: "Efteranalysen är klar", text: "Efteranalysen visar resultatet för alla lopp.", action: { type: "link", label: "Se efteranalysen", href: "/omgang/r1/analys" } });
    expect(s.text).not.toMatch(/träff|topp 3/i);
    const noResults = step("2026-10-25T19:00:00Z", races({ hasResult: true }), { summary, features: { ...FLAG_ON, results: false } });
    expect(noResults.kind).toBe("ROUND_DONE");
    expect(noResults.text).not.toMatch(/träff|topp 3/i);
  });
  it("fas Odds, allt klart: första start i rubriken", () => {
    const s = step("2026-10-24T10:00:00Z", races({ reviewed: true }), { hasCoupon: true });
    expect(s).toEqual({ kind: "ALL_REVIEWED", title: "Allt klart – första start lör 15:00", text: "Alla åtta lopp är genomgångna. Live börjar när första loppet startar.", action: null });
  });
  it("fas Analys, allt genomgånget: rubriken står kvar", () => {
    const s = step("2026-10-19T19:00:00Z", races({ reviewed: true }));
    expect(s.title).toBe("Allt genomgånget – odds fylls i torsdag kväll");
  });
  it("V75: texterna säger V75-n och sju lopp", () => {
    const seven = races({}, done(1, 2, 3)).slice(0, 7);
    const v75 = { id: "r1", date: D, gameType: "V75", fetchStatus: "COMPLETE" as const, races: seven };
    expect(nextStep({ now: at("2026-10-24T14:16:00Z"), round: v75, nextAvailable: null, features: FLAG_ON }).title).toBe("V75-4 pågår");
    const before = { ...v75, races: seven.map((r) => ({ ...r, hasResult: false, reviewed: true })) };
    expect(nextStep({ now: at("2026-10-24T12:00:00Z"), round: before, nextAvailable: null, features: FLAG_ON, hasCoupon: true }).text).toContain("Alla sju lopp");
  });
  it("/lopp/ används inte längre i phase.ts", () => {
    expect(readFileSync(path.join(__dirname, "phase.ts"), "utf8")).not.toContain("/lopp/");
  });
});
