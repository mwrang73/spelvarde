import { describe, expect, it } from "vitest";
import { buildOddsQueue, initialKeypad, isDone, keyFromKeyboard, keypadReduce, keypadVerdict, MIN_ODDS_ERROR, riktoddsSentence, type KeypadKey, type KeypadState } from "@/lib/odds-keypad";
import { ODDS_RANGE_ERROR } from "@/lib/odds-input";

const press = (s: KeypadState, keys: KeypadKey[], savedOdds: number | null = null) => {
  const effects: unknown[] = [];
  for (const key of keys) {
    const r = keypadReduce(s, { type: "key", key }, { savedOdds });
    s = r.state;
    if (r.effect) effects.push(r.effect);
  }
  return { s, effects };
};

describe("knappsatsen (S4)", () => {
  it("3-1-0 ger 3,10, sparas direkt och hoppar vidare när timern går ut", () => {
    const { s, effects } = press(initialKeypad(13, 8), ["3", "1", "0"]);
    expect(s.digits).toBe("310");
    expect(effects).toEqual([{ type: "save", index: 8, odds: 3.1 }]);
    expect(s.advance).not.toBeNull();
    const after = keypadReduce(s, { type: "advance", token: s.advance! }, { savedOdds: 3.1 }).state;
    expect(after).toMatchObject({ index: 9, digits: "", advance: null });
  });

  it("ett nytt tryck avbryter hoppet: 1-2-5-0 blir 12,50 och kräver Nästa", () => {
    const a = press(initialKeypad(5), ["1", "2", "5"]);
    expect(a.effects).toEqual([{ type: "save", index: 0, odds: 1.25 }]);
    const token = a.s.advance!;
    const b = press(a.s, ["0"]);
    expect(b.s).toMatchObject({ digits: "1250", advance: null, index: 0 });
    // Timern som redan var på väg gör ingenting.
    expect(keypadReduce(b.s, { type: "advance", token }, { savedOdds: 1.25 }).state.index).toBe(0);
    // Femte siffran ignoreras.
    expect(press(b.s, ["7"]).s.digits).toBe("1250");
    const c = keypadReduce(b.s, { type: "key", key: "next" }, { savedOdds: 1.25 });
    expect(c.effect).toEqual({ type: "save", index: 0, odds: 12.5 });
    expect(c.state.index).toBe(1);
  });

  it("Radera under hoppet avbryter också", () => {
    const a = press(initialKeypad(5), ["2", "4", "0"]);
    const b = press(a.s, ["del"]);
    expect(b.s).toMatchObject({ digits: "24", advance: null });
  });

  it("intervallet 1,01–99,99: 1-0-0 hoppar inte och Nästa på 0,05 ger fel", () => {
    const a = press(initialKeypad(5), ["1", "0", "0"]);
    expect(a.effects).toEqual([]);
    expect(a.s).toMatchObject({ advance: null, error: MIN_ODDS_ERROR });
    const b = press(initialKeypad(5), ["5", "next"]);
    expect(b.effects).toEqual([]);
    expect(b.s).toMatchObject({ index: 0, error: ODDS_RANGE_ERROR });
    // 1-0-1 = 1,01 är godkänt och hoppar.
    expect(press(initialKeypad(5), ["1", "0", "1"]).effects).toEqual([{ type: "save", index: 0, odds: 1.01 }]);
    // En inledande nolla ignoreras.
    expect(press(initialKeypad(5), ["0", "3"]).s.digits).toBe("3");
  });

  it("Radera på tom display frågar bara när det finns ett sparat odds", () => {
    expect(press(initialKeypad(5), ["del"], null).s.confirmDelete).toBe(false);
    const a = press(initialKeypad(5), ["del"], 3.1);
    expect(a.s.confirmDelete).toBe(true);
    // Siffror och Nästa gäller inte medan frågan visas.
    expect(press(a.s, ["4", "next"], 3.1).s).toMatchObject({ digits: "", index: 0, confirmDelete: true });
    expect(keypadReduce(a.s, { type: "confirm", yes: false }, { savedOdds: 3.1 })).toEqual({ state: { ...a.s, confirmDelete: false }, effect: null });
    expect(keypadReduce(a.s, { type: "confirm", yes: true }, { savedOdds: 3.1 }).effect).toEqual({ type: "delete", index: 0 });
  });

  it("Nästa på tom display, Hoppa över och Föregående ändrar inget odds", () => {
    expect(press(initialKeypad(3), ["next"], 2.5)).toMatchObject({ effects: [], s: { index: 1 } });
    expect(press(initialKeypad(3), ["4", "skip"])).toMatchObject({ effects: [], s: { index: 1, digits: "" } });
    expect(press(initialKeypad(3, 2), ["prev"]).s.index).toBe(1);
    expect(press(initialKeypad(3, 0), ["prev"]).s.index).toBe(0);
  });

  it("samma odds som det sparade sparas inte igen", () => {
    expect(press(initialKeypad(3), ["3", "1", "0"], 3.1).effects).toEqual([]);
    expect(press(initialKeypad(3), ["1", "2", "5", "0", "next"], 12.5).effects).toEqual([{ type: "save", index: 0, odds: 1.25 }]);
  });

  it("kön är slut efter sista hästen, och Föregående går tillbaka till den", () => {
    const a = press(initialKeypad(2, 1), ["next"]);
    expect(isDone(a.s)).toBe(true);
    expect(press(a.s, ["5"]).s.digits).toBe("");
    expect(press(a.s, ["prev"]).s.index).toBe(1);
  });

  it("tangentbordet: siffror, Backsteg, Enter, ←, Tab; komma och punkt ignoreras", () => {
    expect(keyFromKeyboard({ key: "3" })).toBe("3");
    expect(keyFromKeyboard({ key: "," })).toBe("ignore");
    expect(keyFromKeyboard({ key: "." })).toBe("ignore");
    expect(keyFromKeyboard({ key: "Backspace" })).toBe("del");
    expect(keyFromKeyboard({ key: "Enter" })).toBe("next");
    expect(keyFromKeyboard({ key: "ArrowLeft" })).toBe("prev");
    expect(keyFromKeyboard({ key: "Tab" })).toBe("skip");
    expect(keyFromKeyboard({ key: "Tab", shiftKey: true })).toBeNull();
    expect(keyFromKeyboard({ key: "a" })).toBeNull();
    // "3,10" och "310" ger samma siffror.
    const keys = ["3", ",", "1", "0"].map((k) => keyFromKeyboard({ key: k })).filter((k): k is KeypadKey => !!k && k !== "ignore");
    expect(press(initialKeypad(2), keys).s.digits).toBe("310");
  });
});

describe("läget i ord", () => {
  const g = 2;
  it("resultatraden i S4", () => {
    expect(keypadVerdict({ odds: 3.1, riktodds: 2.4, interesting: true, override: "NONE", guideline: g })).toEqual({ tone: "ok", text: "0,70 över riktoddset · föreslås som Spelbar", below: false });
    expect(keypadVerdict({ odds: 1.25, riktodds: 1.35, interesting: true, override: "NONE", guideline: g })).toEqual({ tone: "no", text: "0,10 under riktoddset · inte spelbar", below: true });
    expect(keypadVerdict({ odds: 3.1, riktodds: 2.4, interesting: true, override: "OFF", guideline: g }).text).toBe("0,70 över riktoddset · Spelbar borttagen av dig");
    expect(keypadVerdict({ odds: 1.25, riktodds: 1.35, interesting: true, override: "ON", guideline: g }).tone).toBe("ok");
    expect(keypadVerdict({ odds: 3.1, riktodds: null, interesting: true, override: "NONE", guideline: g }).text).toBe("Riktodds saknas – hämta omgången igen. Oddset sparas ändå.");
    expect(keypadVerdict({ odds: null, riktodds: 2.4, interesting: true, override: "NONE", guideline: g }).tone).toBe("help");
  });
  it("meningen i hästkortet", () => {
    expect(riktoddsSentence({ unibetOdds: 4.1, riktodds: 3.2, interesting: true, spelbar: true, override: "NONE" })).toBe("Spelbar: Unibet ger 0,90 mer än riktoddset");
    expect(riktoddsSentence({ unibetOdds: 2.3, riktodds: 2.4, interesting: true, spelbar: false, override: "NONE" })).toBe("Inte spelbar: Unibet ger 0,10 mindre än riktoddset");
    expect(riktoddsSentence({ unibetOdds: null, riktodds: 2.4, interesting: true, spelbar: false, override: "NONE" })).toBe("Fyll i Unibet-odds för att se om hästen är spelbar");
    expect(riktoddsSentence({ unibetOdds: 4.1, riktodds: 3.2, interesting: true, spelbar: false, override: "OFF" })).toBe("Inte spelbar (borttagen av dig): Unibet ger 0,90 mer än riktoddset");
  });
});

describe("kön i S4", () => {
  const now = Date.parse("2026-10-22T18:00:00Z");
  const mk = (id: string, number: number, mark: { interesting?: boolean; bet?: boolean; unibetOdds?: number | null } | null, scratched = false) => ({
    id,
    number,
    scratched,
    mark: mark ? { interesting: !!mark.interesting, bet: !!mark.bet, unibetOdds: mark.unibetOdds ?? null } : null,
  });
  it("Intressant och Bet i ordning, de med odds sist, strukna och startade lopp hoppas över", () => {
    const races = [
      { leg: 2, startAt: "2026-10-24T13:00:00Z", started: false, cancelled: false, starts: [mk("b5", 5, { interesting: true }), mk("b1", 1, { interesting: true, unibetOdds: 3 }), mk("b2", 2, null)] },
      { leg: 1, startAt: "2026-10-24T12:40:00Z", started: false, cancelled: false, starts: [mk("a7", 7, { bet: true }), mk("a3", 3, { interesting: true }, true)] },
      { leg: 3, startAt: "2026-10-22T17:00:00Z", started: true, cancelled: false, starts: [mk("c1", 1, { interesting: true })] },
    ];
    expect(buildOddsQueue(races, now)).toEqual(["a7", "b5", "b1"]);
  });
});
