import { describe, expect, it } from "vitest";
import { applyMarkChange, EMPTY_MARK, mergeMarkBodies, parseMarkChange, sameMark, turnsSomethingOn, type MarkChange, type MarkState } from "@/lib/marks";
import { ODDS_RANGE_ERROR } from "@/lib/odds-input";
import { spelbar } from "@/lib/spelbar";
import { riktoddsX, SOURCE_SUPPORT_ERROR, X_FACTOR_ERROR, X_NEEDS_INTERESTING } from "@/lib/xfactor";

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

describe("E2.1: X-faktor och källstöd i ändringen (6.8, 12)", () => {
  const F = { xFactorTror: 1.25, xFactorStark: 1.5 };
  const cx = (now: Date, riktodds: number | null = 3.2) => ({ now, riktodds, factors: F });
  const spelbarX = (m: MarkState, riktodds = 3.2) => spelbar({ interesting: m.interesting, unibetOdds: m.unibetOdds, riktodds: riktoddsX(riktodds, m.xFactor, F), override: m.spelbarOverride });

  it("kroppen: xFactor och sourceSupport, fel värden och 400-kombinationen", () => {
    expect(parseMarkChange({ xFactor: "TROR", sourceSupport: 3 })).toEqual({ ok: true, value: { xFactor: "TROR", sourceSupport: 3 } });
    expect(parseMarkChange({ sourceSupport: null })).toEqual({ ok: true, value: { sourceSupport: null } });
    expect(parseMarkChange({ xFactor: "tror" })).toEqual({ ok: false, error: X_FACTOR_ERROR });
    expect(parseMarkChange({ xFactor: null })).toEqual({ ok: false, error: X_FACTOR_ERROR });
    expect(parseMarkChange({ sourceSupport: 21 })).toEqual({ ok: false, error: SOURCE_SUPPORT_ERROR });
    expect(parseMarkChange({ sourceSupport: 1.5 })).toEqual({ ok: false, error: SOURCE_SUPPORT_ERROR });
    expect(parseMarkChange({ interesting: false, xFactor: "STARK" })).toEqual({ ok: false, error: X_NEEDS_INTERESTING });
    expect(parseMarkChange({ interesting: false, xFactor: "NONE" }).ok).toBe(true);
    expect(turnsSomethingOn({ xFactor: "TROR" })).toBe(true);
    expect(turnsSomethingOn({ sourceSupport: 2 })).toBe(true);
    expect(turnsSomethingOn({ xFactor: "NONE", sourceSupport: null })).toBe(false);
  });

  it("X > Ingen tänder Intressant och sätter xFactorAt; Ingen släcker aldrig Intressant", () => {
    const a = applyMarkChange(EMPTY_MARK, { xFactor: "TROR" }, cx(T1));
    expect(a).toMatchObject({ interesting: true, interestingAt: T1, xFactor: "TROR", xFactorAt: T1 });
    const b = applyMarkChange(a, { xFactor: "NONE" }, cx(T2));
    expect(b).toMatchObject({ interesting: true, interestingAt: T1, xFactor: "NONE", xFactorAt: null });
    // Redan Intressant: interestingAt står kvar.
    const c = applyMarkChange(b, { xFactor: "STARK" }, cx(T2));
    expect(c).toMatchObject({ interestingAt: T1, xFactor: "STARK", xFactorAt: T2 });
  });

  it("interesting: false nollställer X och override men inte källstödet; Ångra återställer i ett anrop", () => {
    const on = applyMarkChange(EMPTY_MARK, { interesting: true, unibetOdds: 1.5, spelbar: "on", xFactor: "TROR", sourceSupport: 2 }, cx(T1));
    expect(on).toMatchObject({ spelbarOverride: "ON", xFactor: "TROR", sourceSupport: 2 });
    const off = applyMarkChange(on, { interesting: false }, cx(T2));
    expect(off).toMatchObject({ interesting: false, spelbarOverride: "NONE", xFactor: "NONE", xFactorAt: null, sourceSupport: 2 });
    const undo = applyMarkChange(off, { interesting: true, spelbar: "on", xFactor: "TROR" }, cx(T2));
    expect(undo).toMatchObject({ interesting: true, spelbarOverride: "ON", xFactor: "TROR", sourceSupport: 2 });
  });

  it("Spelbar räknas mot riktoddset med X: 3,20 och Unibet 2,80 föreslås bara med Tror på", () => {
    const i = applyMarkChange(EMPTY_MARK, { interesting: true, unibetOdds: 2.8 }, cx(T1));
    expect(spelbarX(i)).toBe(false);
    const x = applyMarkChange(i, { xFactor: "TROR" }, cx(T1));
    expect(spelbarX(x)).toBe(true);
    // Tryck på Spelbar = samma som förslaget med X → NONE (inte ON).
    expect(applyMarkChange(x, { spelbar: "on" }, cx(T1)).spelbarOverride).toBe("NONE");
    // X och Spelbar i samma kropp: X läggs på först.
    expect(applyMarkChange(i, { xFactor: "TROR", spelbar: "on" }, cx(T1)).spelbarOverride).toBe("NONE");
    expect(applyMarkChange(i, { spelbar: "on" }, cx(T1)).spelbarOverride).toBe("ON");
  });

  it("override ON/OFF står kvar när X ändras", () => {
    const i = applyMarkChange(EMPTY_MARK, { interesting: true, unibetOdds: 2.8 }, cx(T1));
    const off = applyMarkChange(applyMarkChange(i, { xFactor: "TROR" }, cx(T1)), { spelbar: "off" }, cx(T1));
    expect(off.spelbarOverride).toBe("OFF");
    for (const x of ["NONE", "STARK", "TROR"] as const) {
      const n = applyMarkChange(off, { xFactor: x }, cx(T2));
      expect(n.spelbarOverride).toBe("OFF");
      expect(spelbarX(n)).toBe(false);
    }
    const on = applyMarkChange(i, { spelbar: "on" }, cx(T1));
    expect(applyMarkChange(on, { xFactor: "STARK" }, cx(T2)).spelbarOverride).toBe("ON");
  });

  it("idempotent: samma kropp två gånger ger samma tillstånd", () => {
    const body = { xFactor: "STARK", sourceSupport: 4 } as const;
    const a = applyMarkChange(EMPTY_MARK, body, cx(T1));
    expect(sameMark(applyMarkChange(a, body, cx(T2)), a)).toBe(true);
    const off = applyMarkChange(a, { interesting: false }, cx(T2));
    expect(sameMark(applyMarkChange(off, { interesting: false }, cx(new Date())), off)).toBe(true);
    expect(sameMark(applyMarkChange(a, { sourceSupport: 3 }, cx(T2)), a)).toBe(false);
  });

  it("utkorgens sammanslagning: släck + tänd ger ingen 400 och samma slutläge", () => {
    const seq = (bodies: Record<string, unknown>[], from: MarkState) => bodies.reduce<MarkState>((m, b) => applyMarkChange(m, (parseMarkChange(b) as { value: MarkChange }).value, cx(T1)), from);
    const from = applyMarkChange(EMPTY_MARK, { interesting: true, unibetOdds: 1.5, spelbar: "on", xFactor: "STARK" }, cx(T1));
    const pairs: [Record<string, unknown>, Record<string, unknown>][] = [
      [{ interesting: false }, { xFactor: "TROR" }],
      [{ interesting: false }, { spelbar: "on" }],
      [{ xFactor: "TROR" }, { interesting: false }],
      [{ xFactor: "TROR" }, { xFactor: "STARK" }],
      [{ interesting: false }, { sourceSupport: 3 }],
    ];
    for (const [a, b] of pairs) {
      const merged = mergeMarkBodies(a, b);
      const parsed = parseMarkChange(merged);
      expect(parsed.ok).toBe(true);
      const one = applyMarkChange(from, (parsed as { value: MarkChange }).value, cx(T1));
      const two = seq([a, b], from);
      expect({ ...one, interestingAt: null }).toEqual({ ...two, interestingAt: null });
    }
  });
});
