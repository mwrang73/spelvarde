import { describe, expect, it } from "vitest";
import { applyMarkChange, EMPTY_MARK } from "@/lib/marks";
import { keypadVerdict, riktoddsSentence } from "@/lib/odds-keypad";
import { parseFactorText, riktLabel, riktShort, riktX, uninterestingUndo, xEffectText, xOf } from "@/lib/xfactor-ui";

const S = { xFactorTror: 1.25, xFactorStark: 1.5 };

describe("xOf och riktX", () => {
  it("utan Mark eller från före E2.1 är läget Ingen och riktoddset det vanliga", () => {
    expect(xOf(null)).toBe("NONE");
    expect(xOf({} as never)).toBe("NONE");
    expect(riktX({ riktodds: 3, mark: null })).toBe(3);
  });
  it("med X används serverns riktoddsX, eller faktorerna om de skickas", () => {
    const mark = { xFactor: "TROR", riktoddsX: 2.4 } as never;
    expect(riktX({ riktodds: 3, mark })).toBe(2.4);
    expect(riktX({ riktodds: 3, mark }, { xFactorTror: 1.5, xFactorStark: 2 })).toBe(2);
    expect(riktX({ riktodds: null, mark })).toBeNull();
  });
});

describe("texterna", () => {
  it("S2: skärmläsartexten", () => {
    expect(riktLabel(3, "TROR", 2.4)).toBe("Riktodds 3,00, med X-faktor 2,40");
    expect(riktLabel(3, "NONE", 3)).toBe("Riktodds 3,00");
  });
  it("S4-arket och S6a: kort form", () => {
    expect(riktShort(3, "TROR", 2.4)).toBe("rikt 3,00 → X 2,40");
    expect(riktShort(3, "NONE", 3)).toBe("rikt 3,00");
    expect(riktShort(null, "STARK", null)).toBe("rikt –");
  });
  it("S3: effektraden", () => {
    const base = { riktodds: 3, unibetOdds: null, factors: S, prev: null };
    expect(xEffectText({ ...base, x: "NONE" })).toBeNull();
    expect(xEffectText({ ...base, x: "TROR" })).toBe("Riktodds 3,00 · med X-faktor 2,40");
    expect(xEffectText({ ...base, x: "STARK" })).toBe("Riktodds 3,00 · med X-faktor 2,00");
    expect(xEffectText({ ...base, riktodds: null, x: "TROR" })).toBe("Riktodds saknas. X-faktorn används när riktoddset finns.");
  });
  it("S3: effektraden säger när bytet ändrade förslaget (6.8)", () => {
    // Riktodds 3,20 och Unibet 2,80: inte föreslagen utan X, föreslagen med Tror på (2,56).
    const base = { riktodds: 3.2, unibetOdds: 2.8, factors: S };
    expect(xEffectText({ ...base, x: "TROR", prev: "NONE" })).toBe("Riktodds 3,20 · med X-faktor 2,56 · nu föreslagen som Spelbar");
    // Stark känsla → Tror på med Unibet 2,20: 2,13 föreslås, 2,56 inte.
    expect(xEffectText({ ...base, unibetOdds: 2.2, x: "TROR", prev: "STARK" })).toBe("Riktodds 3,20 · med X-faktor 2,56 · inte längre föreslagen");
    expect(xEffectText({ ...base, x: "STARK", prev: "TROR" })).toBe("Riktodds 3,20 · med X-faktor 2,13");
  });
  it("S3 och S4: meningen och resultatraden jämför mot riktoddset med X", () => {
    expect(riktoddsSentence({ unibetOdds: 3.1, riktodds: 2.4, interesting: true, spelbar: true, override: "NONE", ref: "riktoddset med X-faktor" })).toBe("Spelbar: Unibet ger 0,70 mer än riktoddset med X-faktor");
    expect(keypadVerdict({ odds: 3.1, riktodds: 2.4, interesting: true, override: "NONE", guideline: 2, ref: "riktoddset med X" }).text).toBe("+0,70 över riktoddset med X · föreslås som Spelbar");
    // Riktlinjen gäller fortfarande Unibet-oddset.
    expect(keypadVerdict({ odds: 1.9, riktodds: 1.5, interesting: true, override: "NONE", guideline: 2, ref: "riktoddset med X" }).below).toBe(true);
  });
});

describe("uninterestingUndo (Intressant släcks)", () => {
  it("bara Intressant: ingen toast", () => {
    expect(uninterestingUndo({ spelbar: false, spelbarOverride: "NONE", xFactor: "NONE" })).toBeNull();
  });
  it("bara Spelbar", () => {
    expect(uninterestingUndo({ spelbar: true, spelbarOverride: "NONE", xFactor: "NONE" })).toEqual({ text: "Spelbar togs också bort", undo: { interesting: true } });
    expect(uninterestingUndo({ spelbar: true, spelbarOverride: "ON" })?.undo).toEqual({ interesting: true, spelbar: "on" });
  });
  it("bara X-faktor, och både Spelbar och X-faktor", () => {
    expect(uninterestingUndo({ spelbar: false, spelbarOverride: "NONE", xFactor: "TROR" })).toEqual({ text: "X-faktor togs också bort", undo: { interesting: true, xFactor: "TROR" } });
    expect(uninterestingUndo({ spelbar: false, spelbarOverride: "OFF", xFactor: "STARK" })?.undo).toEqual({ interesting: true, xFactor: "STARK", spelbar: "off" });
    expect(uninterestingUndo({ spelbar: true, spelbarOverride: "ON", xFactor: "STARK" })).toEqual({ text: "Spelbar och X-faktor togs också bort", undo: { interesting: true, xFactor: "STARK", spelbar: "on" } });
  });
  it("Ångra återställer Intressant, Spelbar och X-faktor i ett steg, och källstödet ligger kvar", () => {
    const now = new Date("2026-10-22T10:00:00Z");
    const ctx = { now, riktodds: 3.2, factors: S };
    // Unibet 2,45: inte föreslagen ens med Tror på (2,56, mer än toleransen 0,10 under), så Spelbar är satt för hand.
    let m = applyMarkChange(EMPTY_MARK, { interesting: true, unibetOdds: 2.45, xFactor: "TROR", spelbar: "on", sourceSupport: 2 }, ctx);
    expect(m.spelbarOverride).toBe("ON");
    const before = { spelbar: true, spelbarOverride: m.spelbarOverride, xFactor: m.xFactor };
    m = applyMarkChange(m, { interesting: false }, ctx);
    expect(m).toMatchObject({ interesting: false, xFactor: "NONE", spelbarOverride: "NONE", sourceSupport: 2 });
    m = applyMarkChange(m, uninterestingUndo(before)!.undo, ctx);
    expect(m).toMatchObject({ interesting: true, xFactor: "TROR", spelbarOverride: "ON", sourceSupport: 2 });
  });
});

describe("parseFactorText (S10)", () => {
  it("tar komma och punkt inom 1,05–3,00", () => {
    expect(parseFactorText("1,25")).toBe(1.25);
    expect(parseFactorText(" 1.5 ")).toBe(1.5);
    expect(parseFactorText("3")).toBe(3);
    expect(parseFactorText("1,05")).toBe(1.05);
  });
  it("avvisar annat", () => {
    for (const t of ["", "1", "1,04", "3,01", "1,255", "abc", "10"]) expect(parseFactorText(t)).toBeNull();
  });
});
