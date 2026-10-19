import { describe, expect, it } from "vitest";
import { computePhase, dayDateLabel, isRoundFinished, nextStep, phaseBounds, phaseRail, type NextStepRace } from "@/lib/phase";

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
const round = (rs: NextStepRace[], fetchStatus: "COMPLETE" | "PARTIAL" = "COMPLETE") => ({ id: "r1", date: D, fetchStatus, races: rs });

describe("faser (3.1)", () => {
  it("gränserna D−2 18:00 och D 12:00 i svensk tid", () => {
    const b = phaseBounds(D);
    expect(b.oddsFrom.toISOString()).toBe("2026-10-22T16:00:00.000Z");
    expect(b.liveFrom.toISOString()).toBe("2026-10-24T10:00:00.000Z");
  });
  it("Analys, Odds, Live, Klart", () => {
    expect(computePhase(D, races(), at("2026-10-19T19:00:00Z"))).toBe("ANALYS");
    expect(computePhase(D, races(), at("2026-10-22T15:59:00Z"))).toBe("ANALYS");
    expect(computePhase(D, races(), at("2026-10-22T16:00:00Z"))).toBe("ODDS");
    expect(computePhase(D, races(), at("2026-10-24T09:59:00Z"))).toBe("ODDS");
    expect(computePhase(D, races(), at("2026-10-24T10:00:00Z"))).toBe("LIVE");
    expect(computePhase(D, races({ hasResult: true }), at("2026-10-24T17:00:00Z"))).toBe("KLART");
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
  it("2. ofullständig hämtning går före allt annat", () => {
    expect(nextStep({ now, round: round(races(), "PARTIAL"), nextAvailable: null }).kind).toBe("RESUME_FETCH");
  });
  it("8. Analys: första avdelningen som inte är genomgången", () => {
    const s = nextStep({ now, round: round(races({}, { 1: { reviewed: true }, 2: { reviewed: true } })), nextAvailable: null });
    expect(s.kind).toBe("ANALYZE_LEG");
    expect(s.title).toBe("Analysera avd 3 – Lopp 3");
    expect(s.action).toEqual({ type: "link", label: "Till avd 3", href: "/omgang/r1/avd/3" });
  });
  it("8. allt genomgånget: ingen primärknapp", () => {
    const s = nextStep({ now, round: round(races({ reviewed: true })), nextAvailable: null });
    expect(s).toMatchObject({ kind: "ALL_REVIEWED", title: "Allt genomgånget – odds fylls i torsdag kväll", action: null });
  });
  it("5–7. Odds-steg bara när E2 är påslaget", () => {
    const oddsNow = at("2026-10-23T08:00:00Z");
    const rs = round(races({ reviewed: true }));
    const e1 = { odds: false, coupon: false, live: false, raceView: false, stats: false };
    expect(nextStep({ now: oddsNow, round: rs, nextAvailable: null, interestingWithoutOdds: 3, features: e1 }).kind).toBe("ALL_REVIEWED");
    const f = { odds: true, coupon: true, live: true, raceView: true, stats: true };
    expect(nextStep({ now: oddsNow, round: rs, nextAvailable: null, interestingWithoutOdds: 3, features: f }).title).toBe("Fyll i Unibets odds – 3 kvar");
    expect(nextStep({ now: oddsNow, round: rs, nextAvailable: null, spelbarWithoutBet: 2, features: f }).title).toBe("Markera Bet – 2 spelbara");
    expect(nextStep({ now: oddsNow, round: rs, nextAvailable: null, features: f }).kind).toBe("BUILD_COUPON");
    expect(nextStep({ now: oddsNow, round: rs, nextAvailable: null, hasCoupon: true, features: f }).kind).toBe("ALL_REVIEWED");
  });
  it("3–4. Live: larm först, sedan nästa lopp", () => {
    const liveNow = at("2026-10-24T13:30:00Z");
    const f = { odds: true, coupon: true, live: true, raceView: true, stats: true };
    const rs = round(races());
    expect(nextStep({ now: liveNow, round: rs, nextAvailable: null, unackedAlarms: [{ leg: 7, horseName: "Mateo di Quattro", kind: "RUSH" }], features: f }).title).toBe("Rusning i avd 7 – Mateo di Quattro");
    const s = nextStep({ now: liveNow, round: rs, nextAvailable: null });
    expect(s.title).toBe("Avd 3 startar 15:44");
    expect(s.action).toBeNull();
  });
  it("9. Klart: hämta nästa om den finns", () => {
    const done = round(races({ hasResult: true }));
    const later = at("2026-10-25T19:00:00Z");
    expect(nextStep({ now: later, round: done, nextAvailable: { ...next, gameId: "V85_2026-10-31_5_5", date: "2026-10-31", trackName: "Solvalla" } }).title).toBe("Hämta omgång – V85 Solvalla lör 31 okt");
    expect(nextStep({ now: later, round: done, nextAvailable: null }).kind).toBe("ROUND_DONE");
  });
});
