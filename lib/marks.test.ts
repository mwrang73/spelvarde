import { describe, expect, it } from "vitest";
import { applyMarkChange, EMPTY_MARK, parseMarkChange, sameMark, turnsSomethingOn, type MarkState } from "@/lib/marks";
import { ODDS_RANGE_ERROR } from "@/lib/odds-input";
import { spelbar } from "@/lib/spelbar";

const T1 = new Date("2026-10-22T18:00:00Z");
const T2 = new Date("2026-10-24T12:18:00Z");
const ctx = (now: Date, riktodds: number | null = 2.4) => ({ now, riktodds });
const isSpelbar = (m: MarkState, riktodds = 2.4) => spelbar({ interesting: m.interesting, unibetOdds: m.unibetOdds, riktodds, override: m.spelbarOverride });

describe("kroppen till PUT /api/marks/[startId]", () => {
  it("godkänner E2-fälten och avrundar odds", () => {
    expect(parseMarkChange({ interesting: true, spelbar: "on", bet: true, unibetOdds: 3.1, betOdds: null })).toEqual({
      ok: true,
      value: { interesting: true, spelbar: "on", bet: true, unibetOdds: 3.1, betOdds: null },
    });
  });
  it("avvisar fel värden, okända fält och tom kropp", () => {
    expect(parseMarkChange({ unibetOdds: 1 })).toEqual({ ok: false, error: ODDS_RANGE_ERROR });
    expect(parseMarkChange({ unibetOdds: 100 })).toEqual({ ok: false, error: ODDS_RANGE_ERROR });
    expect(parseMarkChange({ betOdds: "3,10" }).ok).toBe(false);
    expect(parseMarkChange({ spelbar: true }).ok).toBe(false);
    expect(parseMarkChange({ userId: "x" }).ok).toBe(false);
    expect(parseMarkChange({}).ok).toBe(false);
  });
  it("vad som räknas som att sätta något på (avvisas för strukna)", () => {
    expect(turnsSomethingOn({ interesting: true })).toBe(true);
    expect(turnsSomethingOn({ spelbar: "on" })).toBe(true);
    expect(turnsSomethingOn({ bet: true })).toBe(true);
    expect(turnsSomethingOn({ interesting: false, unibetOdds: 3.1 })).toBe(false);
  });
});

describe("applyMarkChange", () => {
  it("Unibet-odds: första gången, ändring (Ändrat från) och samma värde igen", () => {
    const a = applyMarkChange(EMPTY_MARK, { interesting: true, unibetOdds: 4.1 }, ctx(T1));
    expect(a).toMatchObject({ interesting: true, interestingAt: T1, unibetOdds: 4.1, unibetOddsAt: T1, unibetOddsPrev: null });
    expect(isSpelbar(a)).toBe(true);
    const b = applyMarkChange(a, { unibetOdds: 3.5 }, ctx(T2));
    expect(b).toMatchObject({ unibetOdds: 3.5, unibetOddsPrev: 4.1, unibetOddsAt: T2 });
    // Idempotent: samma kropp igen ändrar ingenting.
    expect(sameMark(applyMarkChange(b, { unibetOdds: 3.5 }, ctx(new Date())), b)).toBe(true);
    expect(sameMark(applyMarkChange(b, { interesting: true }, ctx(new Date())), b)).toBe(true);
    // Ta bort oddset.
    expect(applyMarkChange(b, { unibetOdds: null }, ctx(T2))).toMatchObject({ unibetOdds: null, unibetOddsPrev: null });
  });

  it("manuella val står kvar när oddset ändras", () => {
    const sugg = applyMarkChange(EMPTY_MARK, { interesting: true, unibetOdds: 3.1 }, ctx(T1));
    const off = applyMarkChange(sugg, { spelbar: "off" }, ctx(T1));
    expect(off.spelbarOverride).toBe("OFF");
    const off2 = applyMarkChange(off, { unibetOdds: 5 }, ctx(T2));
    expect(off2.spelbarOverride).toBe("OFF");
    expect(isSpelbar(off2)).toBe(false);

    const low = applyMarkChange(EMPTY_MARK, { interesting: true, unibetOdds: 1.25 }, ctx(T1, 1.35));
    const on = applyMarkChange(low, { spelbar: "on" }, ctx(T1, 1.35));
    expect(on.spelbarOverride).toBe("ON");
    expect(isSpelbar(applyMarkChange(on, { unibetOdds: 1.1 }, ctx(T2, 1.35)), 1.35)).toBe(true);
    // Återställ till förslag.
    expect(applyMarkChange(on, { spelbar: "auto" }, ctx(T2, 1.35)).spelbarOverride).toBe("NONE");
  });

  it("Spelbar för hand gör hästen Intressant, och borttagen Intressant nollställer override", () => {
    const s = applyMarkChange(EMPTY_MARK, { spelbar: "on" }, ctx(T1));
    expect(s).toMatchObject({ interesting: true, interestingAt: T1, spelbarOverride: "ON" });
    const i = applyMarkChange(s, { interesting: false }, ctx(T2));
    expect(i).toMatchObject({ interesting: false, interestingAt: null, spelbarOverride: "NONE" });
    // Hopslagen kropp där Intressant = false och Spelbar = on: Intressant vinner.
    expect(applyMarkChange(s, { interesting: false, spelbar: "on" }, ctx(T2))).toMatchObject({ interesting: false, spelbarOverride: "NONE" });
  });

  it("Bet sätter bet-odds = Unibet-odds, som följer med när oddset rättas", () => {
    const a = applyMarkChange(EMPTY_MARK, { interesting: true, unibetOdds: 4.1 }, ctx(T1));
    const b = applyMarkChange(a, { bet: true }, ctx(T2));
    expect(b).toMatchObject({ bet: true, betAt: T2, betOdds: 4.1 });
    const c = applyMarkChange(b, { unibetOdds: 3.8 }, ctx(T2));
    expect(c).toMatchObject({ unibetOdds: 3.8, betOdds: 3.8, unibetOddsPrev: 4.1 });
    // Satta olika: bet-oddset står kvar.
    const d = applyMarkChange(c, { betOdds: 4.0 }, ctx(T2));
    const e = applyMarkChange(d, { unibetOdds: 3.5 }, ctx(T2));
    expect(e).toMatchObject({ unibetOdds: 3.5, betOdds: 4.0 });
    // Bet igen ändrar ingenting (idempotent), Bet av tar bort bet-odds.
    expect(sameMark(applyMarkChange(e, { bet: true }, ctx(new Date())), e)).toBe(true);
    expect(applyMarkChange(e, { bet: false }, ctx(T2))).toMatchObject({ bet: false, betAt: null, betOdds: null });
  });

  it("Bet på vilken häst som helst, även utan odds, och odds + Bet i samma kropp", () => {
    expect(applyMarkChange(EMPTY_MARK, { bet: true }, ctx(T1))).toMatchObject({ bet: true, betOdds: null, interesting: false });
    expect(applyMarkChange(EMPTY_MARK, { bet: true, unibetOdds: 2.6 }, ctx(T1))).toMatchObject({ bet: true, betOdds: 2.6, unibetOdds: 2.6 });
    expect(applyMarkChange(EMPTY_MARK, { bet: true, unibetOdds: 2.6, betOdds: 2.7 }, ctx(T1))).toMatchObject({ betOdds: 2.7 });
    // Bet-odds utan Bet sparas inte.
    expect(applyMarkChange(EMPTY_MARK, { betOdds: 2.7 }, ctx(T1)).betOdds).toBeNull();
  });
});
