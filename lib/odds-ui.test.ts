import { describe, expect, it } from "vitest";
import { boxVerdict, classOf, movementOf, movementShort, movementSr, parseTolerance, replacedNote, scratchedAtUnibet, signedOdds, sparkPoints, svSr, unmarkedItems, crossedUnderMax, overMaxRikt } from "@/lib/odds-ui";
import { historyChart, historyRows } from "@/lib/odds-history";
import { mkMark, mkRace, mkStart } from "@/lib/test-round";
import type { UnibetHistoryPoint } from "@/lib/types";

const NOW = Date.parse("2026-10-22T19:05:00.000Z");

describe("skillnaden sv", () => {
  it("tecken och två decimaler", () => {
    expect(signedOdds(0.31)).toBe("+0,31");
    expect(signedOdds(-0.07)).toBe("−0,07");
    expect(signedOdds(0)).toBe("±0,00");
    expect(signedOdds(1.1666666 - 1)).toBe("+0,17");
  });
  it("skärmläsartexten", () => {
    expect(svSr("over", 0.31)).toBe(" över riktoddset, spelbart");
    expect(svSr("near", -0.07)).toBe(" under riktoddset, nära, spelbart");
    expect(svSr("under", -0.15)).toBe(" under riktoddset");
  });
  it("klassen räknas själv för äldre cachade svar", () => {
    const s = mkStart("a", 1, { riktodds: 2.05, mark: { ...mkMark("a", { unibetOdds: 1.98 }), oddsClass: undefined as never } });
    expect(classOf(s, 0.1)).toBe("near");
    expect(classOf(s, 0)).toBe("under");
  });
});

describe("Riktodds över 5", () => {
  it("overMaxRikt och crossedUnderMax", () => {
    expect(overMaxRikt(mkStart("x", 1, { riktodds: 5.01 }))).toBe(true);
    expect(overMaxRikt(mkStart("x", 1, { riktodds: 5 }))).toBe(false);
    const before = mkRace(1, [mkStart("a", 1, { riktodds: 6 }), mkStart("b", 2, { riktodds: 4 }), mkStart("c", 3, { riktodds: 7 })]);
    const after = mkRace(1, [mkStart("a", 1, { riktodds: 4.5 }), mkStart("b", 2, { riktodds: 3 }), mkStart("c", 3, { riktodds: 5.5 })]);
    expect(crossedUnderMax([before], [after])).toEqual(["a"]);
  });
});

describe("Inte markerade men spelbara odds", () => {
  it("bara omarkerade, utan Bet, inte strukna, före start, över eller nära; störst först", () => {
    const rows = [
      mkStart("a", 4, { riktodds: 4.8, mark: mkMark("a", { unibetOdds: 5.5, oddsClass: "over" }) }),
      mkStart("b", 9, { riktodds: 4.1, mark: mkMark("b", { unibetOdds: 4.05, oddsClass: "near" }) }),
      // Riktodds över 5: inte intressant även om oddset är bättre.
      mkStart("h", 7, { riktodds: 6, mark: mkMark("h", { unibetOdds: 9, oddsClass: "over" }) }),
      mkStart("c", 2, { riktodds: 3, mark: mkMark("c", { unibetOdds: 4, oddsClass: "over", interesting: true }) }),
      mkStart("d", 3, { riktodds: 3, mark: mkMark("d", { unibetOdds: 4, oddsClass: "over", bet: true }) }),
      mkStart("e", 5, { riktodds: 3, scratched: true, mark: mkMark("e", { unibetOdds: 4, oddsClass: "over" }) }),
      mkStart("f", 6, { riktodds: 3, mark: mkMark("f", { unibetOdds: 2.5, oddsClass: "under" }) }),
    ];
    const started = mkRace(1, [mkStart("g", 1, { riktodds: 2, mark: mkMark("g", { unibetOdds: 3, oddsClass: "over" }) })], { started: true });
    const items = unmarkedItems([started, mkRace(2, rows)], NOW, 0.1);
    expect(items.map((i) => i.start.id)).toEqual(["a", "b"]);
    expect(items.every((i) => i.troll === null)).toBe(true);
  });
  it("e4a 18: Trollspöt-hästar först efter plats, utan dubbletter, även utan odds", () => {
    // Avd 3: ett fält med streck och modell (som i lib/trollspot.test.ts), så att Trollspöt har hästar.
    const st = (n: number, streck: number, p: number, o: Parameters<typeof mkStart>[2] = {}) => mkStart(`t${n}`, n, { streck, probTop3: p, riktodds: Math.round(100 / p) / 100, ...o });
    const field = [
      st(1, 40, 0.8),
      st(2, 9, 0.5, { mark: mkMark("t2", { unibetOdds: 3, oddsClass: "over" }) }),
      st(3, 8, 0.45),
      st(4, 7, 0.3, { mark: mkMark("t4", { interesting: true }) }),
      // Trollspöt-häst med odds under gränsen: står ändå med (en gång).
      st(5, 7, 0.25, { mark: mkMark("t5", { unibetOdds: 2, oddsClass: "under" }) }),
      st(6, 6, 0.2, { scratched: true }),
      st(7, 6, 0.2),
      st(8, 6, 0.15),
      st(9, 6, 0.15),
      st(10, 5, 0.1),
    ];
    const other = mkRace(2, [mkStart("o1", 1, { riktodds: 3, mark: mkMark("o1", { unibetOdds: 4, oddsClass: "over" }) })]);
    const items = unmarkedItems([other, mkRace(3, field)], NOW, 0.1);
    const ids = items.map((i) => i.start.id);
    // t4 (Intressant) och t6 (struken) är inte med. t1 och t2 har för lågt
    // uppskattat odds för Trollspöt; t2 kommer med på sina spelbara odds, efter
    // Trollspöt-hästarna (lika skillnad som o1, som står i en tidigare avdelning).
    expect(ids).toEqual(["t3", "t5", "t7", "t8", "t9", "t10", "o1", "t2"]);
    expect(new Set(ids).size).toBe(ids.length);
    const ranks = items.map((i) => i.troll?.rank ?? null);
    expect(ranks.slice(6)).toEqual([null, null]);
    expect(ranks.slice(0, 6)).toEqual([...(ranks.slice(0, 6) as number[])].sort((a, b) => a - b));
    // En Trollspöt-häst utan odds: ingen skillnad, men minst X.
    const t3 = items.find((i) => i.start.id === "t3")!;
    expect(t3.diff).toBeNull();
    expect(t3.troll!.minOdds).toBeGreaterThanOrEqual(2);
  });
});

describe("rörelsen", () => {
  const u = (first: number | null, at = "2026-10-22T19:05:00.000Z", firstAt: string | null = "2026-10-22T16:02:00.000Z") => ({ place: 2.45, win: 7.5, status: "Starter", at, first, firstAt });
  it("upp, ned, samma och ny", () => {
    const up = mkStart("a", 1, { unibet: u(2.2), mark: mkMark("a", { unibetOdds: 2.45, unibetOddsSource: "UNIBET" }) });
    const mv = movementOf(up);
    expect(movementShort(mv, 2.45)).toBe("▲ fr 2,20");
    expect(movementSr(mv, () => "tors 18:02")).toBe("Upp från 2,20 sedan tors 18:02, lägre chans enligt marknaden");
    expect(movementShort(movementOf({ ...up, unibet: u(2.6) }), 2.45)).toBe("▼ fr 2,60");
    expect(movementShort(movementOf({ ...up, unibet: u(2.45) }), 2.45)).toBe("= 2,45");
    // Bara en ögonblicksbild med odds: "Ny".
    expect(movementShort(movementOf({ ...up, unibet: u(2.45, "2026-10-22T19:05:00.000Z", "2026-10-22T19:05:00.000Z") }), 2.45)).toBe("Ny");
    expect(movementOf({ ...up, mark: mkMark("a", { unibetOdds: null }) }).kind).toBe("none");
  });
  it("kurvans punkter", () => {
    const p = sparkPoints([2.2, 2.45], 2.14, 44, 20)!;
    expect(p.points.split(" ")).toHaveLength(2);
    expect(p.last[0]).toBe(44);
    expect(sparkPoints([2.2], 2.1, 44, 20)).toBeNull();
  });
});

describe("rad 3 och hästkortet", () => {
  it("Ersatte ditt 3,10, inte längre föreslagen", () => {
    const s = mkStart("k", 5, { riktodds: 2.9, mark: mkMark("k", { interesting: true, unibetOdds: 2.75, spelbar: false, replacedOdds: 3.1, replacedByFetchId: "f1" }) });
    expect(replacedNote(s, "f1", 0.1)).toEqual({ from: 3.1, lostForslag: true });
    // Ångra gäller bara den senaste hämtningen.
    expect(replacedNote(s, "f2", 0.1)).toBeNull();
  });
  it("struken hos Unibet", () => {
    expect(scratchedAtUnibet(mkMark("x", { unibetOdds: null, unibetOddsSource: "UNIBET" }))).toBe(true);
    expect(scratchedAtUnibet(mkMark("x", { unibetOdds: null, unibetOddsSource: null }))).toBe(false);
  });
  it("meningen i RiktoddsBox", () => {
    const base = { interesting: true, spelbar: true, override: "NONE" as const, tolerance: 0.1, withX: false };
    expect(boxVerdict({ ...base, unibetOdds: 2.15, riktodds: 2.1 })).toEqual({ cls: "over", diff: "+0,05", lead: "Spelbar", text: ", Unibet ger mer än riktoddset." });
    expect(boxVerdict({ ...base, unibetOdds: 2.03, riktodds: 2.1 })).toEqual({ cls: "near", diff: "−0,07 nära", lead: "Spelbar", text: ", Unibet ligger högst 0,10 under riktoddset." });
    expect(boxVerdict({ ...base, unibetOdds: 2.03, riktodds: 2.1, withX: true })?.text).toBe(", Unibet ligger högst 0,10 under riktoddset med X-faktor.");
    expect(boxVerdict({ ...base, unibetOdds: 1.95, riktodds: 2.1 })).toBeNull();
    expect(boxVerdict({ ...base, spelbar: false, interesting: false, unibetOdds: 2.15, riktodds: 2.1 })?.lead).toBeNull();
  });
  it("toleransen i S10", () => {
    expect(parseTolerance("0,10")).toBe(0.1);
    expect(parseTolerance("0")).toBe(0);
    expect(parseTolerance("0,5")).toBe(0.5);
    expect(parseTolerance("0,51")).toBeNull();
    expect(parseTolerance("-0,1")).toBeNull();
    expect(parseTolerance("0,105")).toBeNull();
    expect(parseTolerance("abc")).toBeNull();
  });
});

describe("Unibets odds över tid", () => {
  // Crew Lane i mockupen: riktodds 2,10, fem hämtningar.
  const at = ["2026-10-22T16:02:00.000Z", "2026-10-22T19:05:00.000Z", "2026-10-23T07:12:00.000Z", "2026-10-23T18:40:00.000Z", "2026-10-24T09:35:00.000Z"];
  const se = [2.1, 2.4, 2.25, 2.2, 2.15];
  const ws = [6.5, 6, 6, 5.75, 5.5];
  const hist: UnibetHistoryPoint[] = at.map((a, i) => ({ fetchId: `f${i}`, at: a, place: se[i], win: ws[i], status: "Starter" }));

  it("kurvan: punkter, dagar och skärmläsartext", () => {
    const c = historyChart(hist, 2.1, 0.1, "Crew Lane")!;
    expect(c.count).toBe(5);
    expect(c.from).toBe("tors 18:02");
    expect(c.days.map((d) => d.label)).toEqual(["TORS", "FRE", "LÖR"]);
    expect(c.points.map((p) => p.cls)).toEqual(["near", "over", "over", "over", "over"]);
    expect(c.aria).toBe("Unibets platsodds för Crew Lane: tors 18:02 2,10, tors 21:05 2,40, fre 09:12 2,25, fre 20:40 2,20, lör 11:35 2,15. Riktodds 2,10. Spelbar i 5 av 5 hämtningar, nära i 1.");
    expect(c.band!.riktY).toBeLessThan(c.band!.nearY);
    expect(historyChart(hist.slice(0, 1), 2.1, 0.1, "Crew Lane")).toBeNull();
  });
  it("listan: senaste först, Första och Bet", () => {
    const rows = historyRows(hist, 2.1, 0.1, { at: "2026-10-23T08:00:00.000Z", odds: 2.25 });
    expect(rows.map((r) => r.when)).toEqual(["lör 11:35", "fre 20:40", "fre 09:12", "tors 21:05", "tors 18:02"]);
    expect(rows[4].tags).toEqual(["Första"]);
    expect(rows[2].tags).toEqual(["Bet 2,25"]);
    const scr = historyRows([...hist, { fetchId: "s", at: "2026-10-24T10:00:00.000Z", place: null, win: null, status: "Scratched" }], 2.1, 0.1, null);
    expect(scr[0].place).toBeNull();
  });
});
