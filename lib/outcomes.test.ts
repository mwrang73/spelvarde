import { describe, expect, it } from "vitest";
import { byPlace, freezeValues, hitOf, nextResultsSyncAt, outcomeSummary, shouldFreeze, summaryText, trollspotAtStart, type FreezeMark } from "@/lib/outcomes";
import type { TrollRace } from "@/lib/trollspot";

const settings = { spelbarTolerance: 0.1, xFactorTror: 1.25, xFactorStark: 1.5 };
const mark = (p: Partial<FreezeMark> = {}): FreezeMark => ({ interesting: true, bet: false, spelbarOverride: "NONE", unibetOdds: null, betOdds: null, xFactor: "NONE", sourceSupport: null, ...p });

describe("freezeValues (6.4)", () => {
  it("Spelbar räknas mot riktoddset med X-faktor och toleransen vid frysningen", () => {
    // riktodds 3,00 ÷ 1,25 = 2,40; Unibet 2,35 ligger 0,05 under: nära, Spelbar.
    const v = freezeValues(mark({ xFactor: "TROR", unibetOdds: 2.35, sourceSupport: 2 }), 3, settings, 4);
    expect(v).toMatchObject({ interesting: true, spelbar: true, bet: false, riktodds: 3, riktoddsX: 2.4, xFactor: "TROR", xFactorValue: 1.25, unibetOdds: 2.35, sourceSupport: 2, sourceTotal: 4 });
    // Utan tolerans är samma odds inte Spelbar.
    expect(freezeValues(mark({ xFactor: "TROR", unibetOdds: 2.35 }), 3, { ...settings, spelbarTolerance: 0 }, 4).spelbar).toBe(false);
    // Användarens egna faktorer gäller.
    expect(freezeValues(mark({ xFactor: "STARK" }), 3, { ...settings, xFactorStark: 2 }, 0)).toMatchObject({ riktoddsX: 1.5, xFactorValue: 2 });
  });
  it("override ON är Spelbar, OFF aldrig; Bet och bet-oddset följer med", () => {
    expect(freezeValues(mark({ spelbarOverride: "ON" }), null, settings, 0).spelbar).toBe(true);
    expect(freezeValues(mark({ spelbarOverride: "OFF", unibetOdds: 9 }), 2, settings, 0).spelbar).toBe(false);
    expect(freezeValues(mark({ interesting: false, bet: true, betOdds: 2.5 }), 2, settings, 0)).toMatchObject({ bet: true, betOdds: 2.5, interesting: false, spelbar: false });
  });
  it("utan Mark (bara Trollspöt): inga markeringar, X = NONE och faktorn 1,00", () => {
    expect(freezeValues(null, 2.8, settings, 3)).toEqual({ interesting: false, spelbar: false, bet: false, unibetOdds: null, betOdds: null, riktodds: 2.8, xFactor: "NONE", xFactorValue: 1, riktoddsX: 2.8, sourceSupport: null, sourceTotal: 3 });
  });
  it("källorna begränsas till databasens 0–20", () => {
    expect(freezeValues(null, null, settings, 25).sourceTotal).toBe(20);
  });
  it("vilka som fryses: I, B eller Trollspöt", () => {
    expect(shouldFreeze(null, false)).toBe(false);
    expect(shouldFreeze(null, true)).toBe(true);
    expect(shouldFreeze({ interesting: false, bet: false }, false)).toBe(false);
    expect(shouldFreeze({ interesting: true, bet: false }, false)).toBe(true);
    expect(shouldFreeze({ interesting: false, bet: true }, false)).toBe(true);
  });
});

describe("hitOf", () => {
  it("1–3 utan diskning är träff; 4, 5+, 0, null och diskad är miss; inställt null", () => {
    expect([1, 2, 3].map((p) => hitOf(p, false, false))).toEqual([true, true, true]);
    expect([4, 5, 12, 0, null].map((p) => hitOf(p, false, false))).toEqual([false, false, false, false, false]);
    expect(hitOf(2, true, false)).toBe(false);
    expect(hitOf(1, false, true)).toBeNull();
  });
});

describe("outcomeSummary", () => {
  const row = (p: Partial<Parameters<typeof outcomeSummary>[0][number]>) => ({ interesting: false, spelbar: false, bet: false, trollspotRank: null, hit: null, ...p });
  it("räknar per grupp, en häst i flera grupper, och hoppar över rader utan resultat", () => {
    const s = outcomeSummary([
      row({ interesting: true, spelbar: true, bet: true, hit: true }),
      row({ interesting: true, bet: true, hit: false }),
      row({ interesting: true, hit: true, trollspotRank: 3 }),
      row({ trollspotRank: 1, hit: true }),
      row({ trollspotRank: 7, hit: false }),
      row({ interesting: true, hit: true }),
      // Inget resultat än / inställt lopp: räknas inte.
      row({ interesting: true, bet: true, hit: null }),
    ]);
    expect(s).toEqual({ bet: { hits: 1, total: 2 }, spelbar: { hits: 1, total: 1 }, interesting: { hits: 3, total: 4 }, trollspot: { hits: 2, total: 3 } });
    expect(summaryText(s)).toBe("Bet 1/2 träff · Spelbar 1/1 topp 3 · Intressant 3/4 topp 3 · Trollspöt 2/3 topp 3.");
    expect(summaryText(outcomeSummary([]))).toBeNull();
  });
});

describe("dött lopp", () => {
  it("samma placering står i startnummerordning, oplacerade sist", () => {
    const rows = [{ place: 2, number: 9 }, { place: 1, number: 5 }, { place: 2, number: 3 }, { place: 0, number: 1 }, { place: null, number: 2 }];
    expect(rows.sort(byPlace).map((r) => r.number)).toEqual([5, 3, 9, 1, 2]);
  });
});

describe("Trollspöt vid loppets start (18)", () => {
  // Två lopp med tio hästar var. Lopp 1 startar först; när det har startat
  // fylls listan på med hästar ur lopp 2.
  const field = (leg: number, startAt: string, chances: number[]): TrollRace => ({
    id: `r${leg}`,
    leg,
    startAt,
    cancelled: false,
    starts: chances.map((p, i) => ({ id: `r${leg}s${i + 1}`, number: i + 1, scratched: false, streck: [40, 9, 8, 7, 7, 6, 6, 6, 6, 5][i], probTop3: p, riktodds: Math.round(100 / p) / 100 })),
  });
  const r1 = field(1, "2026-10-24T13:00:00.000Z", [0.8, 0.5, 0.45, 0.3, 0.25, 0.2, 0.2, 0.15, 0.15, 0.1]);
  const r2 = field(2, "2026-10-24T13:30:00.000Z", [0.8, 0.6, 0.55, 0.5, 0.48, 0.46, 0.44, 0.42, 0.4, 0.38]);

  it("varje lopp räknas vid sin egen starttid, och bara loppets hästar får plats", () => {
    const m = trollspotAtStart([r1, r2], 0.1);
    const ranks1 = [...m].filter(([id]) => id.startsWith("r1")).map(([, t]) => t.rank);
    const ranks2 = [...m].filter(([id]) => id.startsWith("r2")).map(([, t]) => t.rank);
    expect(ranks1.length).toBeGreaterThan(0);
    expect(ranks2.length).toBeGreaterThan(ranks1.length);
    // Vid lopp 1:s start har lopp 2 de högsta chanserna och tar de första platserna.
    expect(Math.min(...ranks1)).toBeGreaterThan(1);
    // Vid lopp 2:s start är lopp 1 borta: lopp 2 fyller listan från plats 1.
    expect(ranks2.sort((a, b) => a - b)).toEqual(Array.from({ length: ranks2.length }, (_, i) => i + 1));
    for (const t of m.values()) {
      expect(t.rank).toBeGreaterThanOrEqual(1);
      expect(t.rank).toBeLessThanOrEqual(10);
      expect(t.minOdds).toBeGreaterThanOrEqual(2);
      expect(t.estOdds).toBeGreaterThanOrEqual(1.8);
    }
  });
  it("only begränsar till de lopp som fryses; utan streck blir listan tom", () => {
    const m = trollspotAtStart([r1, r2], 0.1, new Set(["r2"]));
    expect([...m.keys()].every((id) => id.startsWith("r2"))).toBe(true);
    const noStreck = { ...r1, starts: r1.starts.map((s) => ({ ...s, streck: null })) };
    expect(trollspotAtStart([noStreck], 0.1).size).toBe(0);
  });
});

describe("nästa automatiska hämtning", () => {
  const races = [{ startAt: new Date("2026-10-24T13:00:00Z"), hasResult: false, cancelled: false }];
  it("60 s efter senaste claimet medan ett lopp väntar, högst 30 min efter start", () => {
    expect(nextResultsSyncAt(races, new Date("2026-10-24T13:05:00Z"), new Date("2026-10-24T13:05:20Z"))?.toISOString()).toBe("2026-10-24T13:06:00.000Z");
    expect(nextResultsSyncAt(races, null, new Date("2026-10-24T13:05:00Z"))?.toISOString()).toBe("2026-10-24T13:05:00.000Z");
    expect(nextResultsSyncAt(races, null, new Date("2026-10-24T13:31:00Z"))).toBeNull();
    expect(nextResultsSyncAt([{ ...races[0], hasResult: true }], null, new Date("2026-10-24T13:05:00Z"))).toBeNull();
    expect(nextResultsSyncAt(races, null, new Date("2026-10-24T12:59:00Z"))).toBeNull();
  });
});
