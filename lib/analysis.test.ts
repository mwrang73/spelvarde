import { describe, expect, it } from "vitest";
import { board, groupOf, overTime, playQuality, roundAnalysis, type AnalysisRow } from "@/lib/analysis";

let n = 0;
const row = (o: Partial<AnalysisRow> = {}): AnalysisRow => ({
  startId: `s${++n}`,
  leg: 1,
  number: n,
  horseName: `Häst ${n}`,
  driverName: null,
  interesting: true,
  spelbar: false,
  bet: false,
  betOdds: null,
  unibetOdds: null,
  riktodds: 2,
  riktoddsX: 2,
  xFactor: "NONE",
  trollspotRank: null,
  place: null,
  disqualified: false,
  galloped: false,
  hit: false,
  tags: [],
  ...o,
});

describe("efteranalysen", () => {
  it("tavlan: enheter, kronor och brytpunkt", () => {
    const b = board([row({ bet: true, betOdds: 2.6, hit: true, place: 2 }), row({ bet: true, betOdds: 2.15, hit: true }), row({ bet: true, betOdds: 3.4, hit: false }), row({ bet: true, betOdds: 1.9, hit: false })]);
    expect(b).toMatchObject({ bets: 4, hits: 2, counted: 4, units: 0.75, kr: 75, avgOdds: 2.51 });
    expect(b.breakEven).toBeCloseTo(0.398, 3);
    // Bet utan odds räknas i träff men inte i enheter.
    expect(board([row({ bet: true, hit: true })])).toMatchObject({ bets: 1, hits: 1, counted: 0, units: 0, noOdds: 1 });
  });
  it("bra och svagt spel bedöms på beslutet", () => {
    expect(playQuality(row({ bet: true, betOdds: 2.6, riktoddsX: 2.2 })).quality).toBe("good");
    expect(playQuality(row({ bet: true, betOdds: 1.9, riktoddsX: 2.1 }))).toEqual({ quality: "bad", reason: "Spelad under riktoddset och under 2,00" });
    expect(playQuality(row({ bet: true, betOdds: 1.95, riktoddsX: 1.6 })).quality).toBe("bad");
  });
  it("mot väntat: bättre bara om skillnaden är minst en standardavvikelse", () => {
    const rows = Array.from({ length: 5 }, () => row({ spelbar: true, riktoddsX: 4, hit: true }));
    expect(groupOf("spelbar", "Spelbar", rows)).toMatchObject({ n: 5, hits: 5, expected: 1.25, verdict: "better", support: "ok" });
    expect(groupOf("spelbar", "Spelbar", rows.slice(0, 2)).support).toBe("few");
    const inline = [row({ riktoddsX: 2, hit: true }), row({ riktoddsX: 2, hit: false }), row({ riktoddsX: 2, hit: true }), row({ riktoddsX: 2, hit: false })];
    expect(groupOf("interesting", "Intressant", inline).verdict).toBe("inline");
  });
  it("slutsatser: resultat först, spel utan värde och spelbara du lät bli", () => {
    const a = roundAnalysis([
      row({ bet: true, betOdds: 2.6, riktoddsX: 2.2, hit: true, place: 2, horseName: "Fly Express" }),
      row({ bet: true, betOdds: 1.9, riktoddsX: 2.1, hit: false, horseName: "Vardø Storm", tags: ["Galopp"] }),
      row({ spelbar: true, unibetOdds: 2.3, riktoddsX: 2.1, hit: true, place: 3, horseName: "Mellby Harley" }),
    ]);
    expect(a.conclusions[0].title).toBe("Du träffade 1 av 2 Bet och gick plus 0,60 enheter.");
    expect(a.conclusions[1].title).toBe("Vardø Storm var veckans enda spel utan värde, och det missade.");
    expect(a.conclusions[2].title).toBe("Du spelade inte Mellby Harley, som kom 3:e.");
    expect(a.missed[0].units).toBe(1.3);
    expect(a.plays.map((p) => p.quality)).toEqual(["good", "bad"]);
    expect(a.tags.unplaced).toEqual([{ tag: "Galopp", count: 1 }]);
  });
  it("över tid: visas från 4 omgångar eller 20 Bet", () => {
    const r = (i: number) => ({ roundId: `r${i}`, date: `2026-10-0${i}`, trackName: "Solvalla", gameType: "V85", rows: [row({ bet: true, betOdds: 2.2, hit: i % 2 === 0 })] });
    expect(overTime([r(1), r(2), r(3)]).enough).toBe(false);
    const o = overTime([r(1), r(2), r(3), r(4)]);
    expect(o.enough).toBe(true);
    expect(o.board).toMatchObject({ bets: 4, hits: 2, units: 0.4 });
    expect(o.rounds.map((x) => x.units)).toEqual([-1, 1.2, -1, 1.2]);
  });
});
