// Testfallen i docs/specs/e6-v85-rad.md, 14 (lib/tippa.test.ts, punkt 1–29).
import { describe, expect, it } from "vitest";
import { rowCount } from "@/lib/coupon";
import { applyFavLimit, buildRad, chooseSpikes, defaultSpikCount, legFacts, maximizeHorses, minimumPicks, rankScore, type LegFacts, type TippaLeg, type TippaStart, openHiOf } from "@/lib/tippa";
import { bjerkeLegs, bjerkeRules, withStart } from "@/lib/tippa.fixture";
import { previewChangeText, rulesDontFitText, scratchNotice } from "@/lib/tippa-text";

const MOCKUP = { 1: [7, 10, 12], 2: [2], 3: [1, 5, 9, 13], 4: [1], 5: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 6: [3], 7: [3, 4, 11, 14], 8: [4] };

const horse = (legs: TippaLeg[], leg: number, name: string) => {
  const f = legFacts(legs.find((l) => l.leg === leg)!);
  return f.runners.find((h) => h.name === name)!;
};

const st = (number: number, streck: number | null, riktX: number | null, o: Partial<TippaStart> = {}): TippaStart => ({
  number,
  name: `H${number}`,
  scratched: false,
  streck,
  riktX,
  signals: 0,
  interesting: false,
  spelbar: false,
  bet: false,
  betOdds: null,
  xFactor: "NONE",
  ...o,
});

describe("Bjerke (fixturen)", () => {
  const legs = bjerkeLegs();
  const r = buildRad(legs, bjerkeRules());

  it("1. ger mockupens rad", () => {
    expect(r.selections).toEqual(MOCKUP);
    expect(r.rows).toBe(576);
    expect(r.cost).toBe(288);
    expect(r.status).toBe("OK");
    expect(r.allgLeg).toBe(5);
    expect(r.allgAuto).toBe(true);
    expect(r.spikLegs).toEqual([2, 8, 6]);
    expect(r.ownSpikLegs).toEqual([4]);
    expect(r.favBanned).toEqual([1, 7]);
    expect(r.favCount).toBe(4);
    expect(r.favOver).toBeNull();
    expect(r.horses).toBe(27);
    expect(r.canCopy).toBe(true);
    expect(r.legs.map((l) => l.kind)).toEqual(["OPEN", "SPIK", "OPEN", "OWN_SPIK", "ALLG", "SPIK", "OPEN", "SPIK"]);
  });

  it("2. skälen och hästordningen", () => {
    const reasons = (leg: number) => Object.fromEntries(r.legs[leg - 1].horses.map((h) => [h.number, h.reasons]));
    expect(reasons(1)).toEqual({ 7: ["T3", "SIG4"], 10: ["MEL", "FEL"], 12: ["SKR", "SIG5"] });
    expect(reasons(3)).toEqual({ 5: ["T3", "SIG4", "FAV"], 9: ["MEL", "SIG4"], 1: ["MEL", "FEL"], 13: ["SKR"] });
    expect(reasons(7)).toEqual({ 3: ["T3", "SIG4"], 11: ["T3"], 4: ["MEL", "FEL", "SIG4"], 14: ["SKR", "SIG4"] });
    expect(r.legs[2].horses.map((h) => h.number)).toEqual([5, 9, 1, 13]);
    expect(r.legs[6].horses.map((h) => h.number)).toEqual([3, 11, 4, 14]);
    expect(r.legRoles.legs["1"]).toEqual({ k: "OPEN", h: { 7: ["T3", "SIG4"], 10: ["MEL", "FEL"], 12: ["SKR", "SIG5"] }, favOut: 3 });
    expect(r.legRoles.legs["2"]).toEqual({ k: "SPIK", h: { 2: ["T3", "SIG6", "FAV"] } });
    expect(r.legRoles.legs["4"]).toEqual({ k: "OWN_SPIK", h: { 1: ["T3", "SIG5", "FAV"] } });
    expect(r.legRoles.legs["5"]).toEqual({ k: "ALLG", fav: 6 });
    expect(r.legRoles).toMatchObject({ v: 1, prelim: false, favLimit: 4 });
    expect(JSON.stringify(r.legRoles).length).toBeLessThan(6000);
  });

  it("3. rangpoäng och felstreckade", () => {
    expect(horse(legs, 1, "Rälsen Rask").score).toBe(7914);
    expect(horse(legs, 1, "Fly Express").score).toBe(6862);
    expect(horse(legs, 3, "Mellby Harley").score).toBe(8256);
    expect(horse(legs, 3, "Järvsö Elina").score).toBe(5804);
    expect(horse(legs, 7, "Blizzard Diamant").score).toBe(8597);
    expect(horse(legs, 7, "Tangen Haap").score).toBe(6248);
    for (const [leg, name] of [[1, "Fly Express"], [3, "Järvsö Elina"], [7, "Stoltheim Prinsen"]] as const) expect(horse(legs, leg, name).fel).toBe(true);
    for (const [leg, name] of [[1, "Kaptein Sabeltann"], [3, "Hulda Hall"], [3, "Admiral Kåre"], [7, "Tangen Haap"], [7, "Ble Rapp"]] as const) expect(horse(legs, leg, name).fel).toBe(false);
    // Kaptein Sabeltann: 2,71 pe över strecket, under gränsen 3.
    const k = horse(legs, 1, "Kaptein Sabeltann");
    expect(k.share! - k.streck!).toBeCloseTo(2.71, 2);
    expect(rankScore({ riktX: 2, signals: 1, fel: false, bet: false, spelbar: false, interesting: false, xFactor: "TROR" })).toBe(5000 + 300 + 500);
  });

  it("4. valet mellan 11-hästarsraderna (R = 50)", () => {
    const open = [1, 3, 7].map((leg) => {
      const f = legFacts(legs[leg - 1]);
      const m = minimumPicks(f, true && leg !== 3);
      const gains = [0];
      for (const h of m.rest) gains.push(gains[gains.length - 1] + h.score);
      return { lo: m.lo, hi: m.lo + m.rest.length, gains };
    });
    expect(open.map((l) => l.lo)).toEqual([3, 3, 3]);
    const best = maximizeHorses(open, 50)!;
    expect(best.k).toEqual([3, 4, 4]);
    expect(best.horses).toBe(11);
    expect(best.score).toBe(12052);
    const scoreOf = (k: number[]) => k.reduce((a, x, i) => a + open[i].gains[x - open[i].lo], 0);
    expect(scoreOf([4, 3, 4])).toBe(10394);
    expect(scoreOf([3, 5, 3])).toBe(10104);
  });

  it("5. 100 kr: reglerna ryms inte", () => {
    const x = buildRad(legs, bjerkeRules({ budget: 100 }));
    expect(x.status).toBe("RULES_DONT_FIT");
    expect(x.minRows).toBe(324);
    expect(x.minCost).toBe(162);
    expect(x.suggestions).toEqual([{ kind: "BUDGET", budget: 162 }, { kind: "SPIKES", spikCount: 5, minCost: 54 }]);
    expect(x.canCopy).toBe(false);
    expect(rulesDontFitText(x)).toBe(
      "**Reglerna ryms inte i 100 kr.** 4 spikar, allgardering av avd 5 (12 hästar) och minst 3 hästar i de 3 andra loppen ger minst 324 rader, alltså 162,00 kr. Ingen ny rad föreslås förrän det ryms.",
    );
  });

  it("6. 5 spikar", () => {
    const x = buildRad(legs, bjerkeRules({ spikCount: 5 }));
    expect(x.spikLegs).toEqual([2, 8, 6, 7]);
    expect(x.legs[6].kind).toBe("SPIK");
    expect(x.legs[6].horses[0].name).toBe("Blizzard Diamant");
    expect(x.minRows).toBe(108);
  });

  it("7. eget val i avd 7 (A4) och förhandsvisningen", () => {
    const x = buildRad(legs, bjerkeRules({ locked: { 4: [1], 7: [3, 4, 8, 11, 14] } }));
    expect(x.rows).toBe(540);
    expect(x.cost).toBe(270);
    expect(x.selections[3]).toEqual([5, 9, 13]);
    expect(x.legs[6].kind).toBe("OWN");
    expect(previewChangeText(r, x, 7)).toContain("Avd 3 går från 4 till 3 hästar (1 Järvsö Elina tas bort) för att raden ska rymmas i **300 kr**.");
  });

  it("8. eget val i avd 7 med 9 hästar ryms inte", () => {
    const x = buildRad(legs, bjerkeRules({ locked: { 4: [1], 7: [2, 3, 4, 5, 7, 8, 9, 11, 14] } }));
    expect(x.status).toBe("OWN_OVER_BUDGET");
    expect(x.rows).toBe(972);
    expect(x.cost).toBe(486);
    expect(x.suggestions).toEqual([{ kind: "EDIT_LEG", leg: 7 }, { kind: "BUDGET", budget: 486 }]);
    expect(x.canCopy).toBe(true);
  });

  it("9. egen spik 7 Dreamliner Sund i avd 6 (A5)", () => {
    const x = buildRad(legs, bjerkeRules({ locked: { 4: [1], 6: [7] } }));
    expect(x.spikEffective).toBe(4);
    expect(x.spikLegs).toEqual([2, 8]);
    expect(x.ownSpikLegs).toEqual([4, 6]);
    expect(x.favBanned).toEqual([1, 3, 7]);
    expect(x.selections[3]).toEqual([1, 2, 9, 13]);
    expect(x.favCount).toBe(4);
  });

  it("10. över spärren av egna val", () => {
    const x = buildRad(legs, bjerkeRules({ locked: { 2: [2], 3: [5], 6: [7], 8: [1] } }));
    expect(x.favCount).toBe(5);
    expect(x.favOver).toBe("OWN");
    expect(x.status).toBe("OK");
    // Spec: "spärrad i 1 och 7". Avd 4 (Baron Tilly) är också öppen här och får favoriten spärrad.
    expect(x.favBanned).toEqual(expect.arrayContaining([1, 7]));
    expect(x.favBanned).toEqual([1, 4, 7]);
  });
});

describe("spikar och spärren", () => {
  it("11. spik hoppas över när spärren är full, och varv 2", () => {
    const legs = bjerkeLegs();
    const x = buildRad(legs, bjerkeRules(), { favLimit: 2 });
    expect(x.skippedSpik).toEqual([2]);
    expect(x.spikLegs).toEqual([8, 6, 7]);
    expect(x.favOver).toBeNull();
    const y = buildRad(legs, bjerkeRules({ spikCount: 7 }), { favLimit: 2 });
    // Kandidaterna utan favorit: 8, 6, 7, 1. Två till behövs: 2 och 3 (favoriter) i varv 2.
    expect(y.spikLegs).toEqual([8, 6, 7, 1, 2, 3]);
    expect(y.favOver).toBe("SPIKES");
    expect(y.skippedSpik).toEqual([]);
    // Direkt: tre kandidater, den säkraste är favorit och kvoten 0.
    const f = (leg: number, riktX: number, isFav: boolean) => ({ leg, isFav, horse: { riktX } as never });
    const c = [f(1, 1.2, true), f(2, 1.3, false), f(3, 1.4, false)];
    expect(chooseSpikes(c, 1, 0)).toMatchObject({ skipped: [1], overSpikes: false });
    expect(chooseSpikes(c, 1, 0).spikes.map((s) => s.leg)).toEqual([2]);
    expect(chooseSpikes(c, 3, 0).spikes.map((s) => s.leg)).toEqual([2, 3, 1]);
    expect(chooseSpikes(c, 3, 0).overSpikes).toBe(true);
  });

  it("12. behållordningen", () => {
    const fake = (leg: number, kvot: number, bet = false): LegFacts => {
      const fav = { number: 1, favorite: true, kvot, spelbar: false, bet } as never;
      return { leg, prelim: false, runners: [fav, {}, {}, {}] as never, favorite: fav, scratched: [] };
    };
    expect(applyFavLimit([fake(1, 0.5), fake(2, 0.8), fake(3, 1.2)], 1)).toEqual({ allowed: [3], banned: [1, 2] });
    expect(applyFavLimit([fake(1, 0.5, true), fake(2, 0.8), fake(3, 1.2)], 1)).toEqual({ allowed: [1], banned: [2, 3] });
    expect(applyFavLimit([fake(1, 0.5), fake(2, 0.8)], -2)).toEqual({ allowed: [], banned: [1, 2] });
  });
});

describe("strykningar", () => {
  const base = buildRad(bjerkeLegs(), bjerkeRules());

  it("13. struken häst i appens avdelning (mockupens läge)", () => {
    const legs = withStart(bjerkeLegs(), 7, 11, { scratched: true });
    const x = buildRad(legs, bjerkeRules());
    expect(x.selections[7]).toEqual([3, 4, 5, 14]);
    const l7 = x.legs[6];
    expect(l7.field.find((h) => h.number === 4)!.group).toBe("T3");
    expect(l7.horses.find((h) => h.number === 5)!.reasons[0]).toBe("MEL");
    expect(x.rows).toBe(576);
    expect(scratchNotice({ selections: base.selections, rows: base.rows, cost: base.cost }, x, 7, 11)).toBe(
      "**11 Tangen Haap i avd 7 är struken.** Den togs bort, och 5 Odd Herakles kom med i stället som Mellan. Raden är fortfarande 576 rader · 288,00 kr.",
    );
  });

  it("14. struken egen spik", () => {
    const x = buildRad(withStart(bjerkeLegs(), 4, 1, { scratched: true }), bjerkeRules());
    expect(x.struckOwnSpik).toEqual([4]);
    expect(x.canCopy).toBe(false);
    expect(x.legs[3]).toMatchObject({ kind: "OWN_SPIK", selection: [1], horses: [] });
    expect(x.ownSpikes).toBe(1);
    expect(x.rows % 1).toBe(0);
    expect(x.rows).toBe(Object.values(x.selections).reduce((a, s) => a * s.length, 1));
  });

  it("15. strukna i eget val", () => {
    const one = buildRad(withStart(bjerkeLegs(), 7, 8, { scratched: true }), bjerkeRules({ locked: { 4: [1], 7: [3, 8] } }));
    expect(one.legs[6]).toMatchObject({ kind: "OWN_SPIK", selection: [3] });
    expect(one.struckRemoved).toEqual([{ leg: 7, numbers: [8] }]);
    expect(one.locked[7]).toEqual([3]);
    const both = buildRad(withStart(withStart(bjerkeLegs(), 7, 8, { scratched: true }), 7, 3, { scratched: true }), bjerkeRules({ locked: { 4: [1], 7: [3, 8] } }));
    expect(both.unlockedLegs).toEqual([7]);
    expect(both.locked[7]).toBeUndefined();
    expect(both.legs[6].kind).not.toBe("OWN");
    expect(both.selections[7].some((n) => n === 3 || n === 8)).toBe(false);
  });
});

describe("minsta val och lägen", () => {
  it("16. ingen skräll", () => {
    const data: [number, number, number][] = [
      [2, 36.0, 1.6],
      [1, 15.0, 2.4],
      [3, 11.0, 2.8],
      [6, 9.4, 2.6],
      [4, 8.0, 3.5],
      [5, 7.2, 4.0],
      [7, 6.9, 4.5],
      [8, 6.5, 3.0],
    ];
    const leg: TippaLeg = { leg: 1, startAt: "", cancelled: false, starts: data.map(([n, s, x]) => st(n, s, x, n === 2 ? { spelbar: true, interesting: true } : n === 6 ? { signals: 4 } : {})) };
    const f = legFacts(leg);
    const m = minimumPicks(f, false);
    expect([...m.picks].sort((a, b) => a - b)).toEqual([2, 6, 8]);
    expect(m.sub).toEqual({ 8: "LOW" });
    const rules = { gameType: "V85", budget: 1, rowPrice: 0.5, spikCount: 0, allgMode: "AUTO" as const, allgLeg: null, locked: {} };
    // I en hel rad: avd 1 är öppen (allgarderingen hamnar i ett annat lopp).
    const other = (n: number): TippaLeg => ({ leg: n, startAt: "", cancelled: false, starts: [st(1, 50, 1.5), st(2, 30, 2), st(3, 20, 3)] });
    const allg: TippaLeg = { leg: 8, startAt: "", cancelled: false, starts: [st(1, 10, 3), st(2, 10, 3)] };
    const x = buildRad([leg, ...[2, 3, 4, 5, 6, 7].map(other), allg], { ...rules, budget: 1000 });
    expect(x.legs[0].horses.find((h) => h.number === 8)!.reasons).toEqual(["LOW", "FEL"]);
  });

  it("17. få startande", () => {
    const keep = (n: number[]) => (l: TippaLeg): TippaLeg => (l.leg !== 1 ? l : { ...l, starts: l.starts.map((s) => ({ ...s, scratched: !n.includes(s.number) })) });
    const two = buildRad(bjerkeLegs().map(keep([3, 7])), bjerkeRules());
    expect(two.legs[0]).toMatchObject({ kind: "OPEN", few: true, selection: [3, 7], favBanned: false });
    expect(two.status).toBe("OK");
    const one = buildRad(bjerkeLegs().map(keep([7])), bjerkeRules());
    expect(one.legs[0]).toMatchObject({ kind: "OPEN", few: true, selection: [7] });
    expect(one.spikLegs).not.toContain(1);
    expect(one.spikEffective).toBe(4);
  });

  it("18. inställt lopp", () => {
    const legs = bjerkeLegs().map((l) => (l.leg === 1 ? { ...l, cancelled: true } : l));
    const x = buildRad(legs, bjerkeRules({ allgMode: "CHOSEN", allgLeg: 1 }));
    expect(x.legs[0]).toMatchObject({ kind: "CANCELLED", selection: [7] });
    expect(x.spikLegs).not.toContain(1);
    expect(x.allgLeg).not.toBe(1);
    expect(x.allgFallback).toBe("CANCELLED");
    expect(x.favCount).toBe(x.legs.filter((l) => l.kind !== "CANCELLED" && l.favorite && l.selection.includes(l.favorite.number)).length);
    expect(x.legRoles.legs["1"].k).toBe("CANCELLED");
  });

  it("19. lopp utan startande", () => {
    const legs = bjerkeLegs().map((l) => (l.leg === 3 ? { ...l, starts: l.starts.map((s) => ({ ...s, scratched: true })) } : l));
    const x = buildRad(legs, bjerkeRules());
    expect(x.legs[2].kind).toBe("NO_STARTERS");
    expect(x.noStarters).toEqual([3]);
    expect(x.canCopy).toBe(false);
    expect(x.rows).toBeGreaterThan(0);
  });

  it("20. preliminär", () => {
    const legs = bjerkeLegs().map((l) => ({ ...l, starts: l.starts.map((s) => ({ ...s, streck: null })) }));
    const x = buildRad(legs, bjerkeRules());
    expect(x.prelim).toBe(true);
    for (const l of x.legs) {
      for (const h of l.field) {
        expect(h.reasons[0]).toBe("PRE");
        expect(h.reasons).not.toContain("FEL");
      }
      const lowest = [...l.field].sort((a, b) => a.riktX! - b.riktX! || a.number - b.number)[0];
      expect(l.favorite!.number).toBe(lowest.number);
    }
    // Grupperna efter modellens andel.
    const f1 = legFacts(legs[0]);
    expect(f1.runners.filter((h) => h.group === "T3").map((h) => h.number).sort((a, b) => a - b)).toEqual([3, 7, 10]);
    // Allgarderingen = lägst favoritandel bland de fria.
    const free = [1, 2, 3, 5, 6, 7, 8].map((n) => legFacts(legs[n - 1]));
    const expected = free.sort((a, b) => a.favorite!.share! - b.favorite!.share! || a.leg - b.leg)[0].leg;
    expect(x.allgLeg).toBe(expected);
  });

  it("21. riktodds saknas", () => {
    const legs = bjerkeLegs().map((l) => ({ ...l, starts: l.starts.map((s) => ({ ...s, riktX: null })) }));
    const x = buildRad(legs, bjerkeRules());
    expect(x.noRikt).toBe(true);
    expect(x.spikMax).toBe(x.ownSpikes);
    expect(x.spikLegs).toEqual([]);
    expect(x.spikEffective).toBe(1);
    // Raden bygger på strecket: favoriten är mest streckad.
    expect(x.legs[0].favorite!.number).toBe(3);
  });

  it("22. mycket hög budget", () => {
    const x = buildRad(bjerkeLegs(), bjerkeRules({ budget: 100_000 }));
    expect(x.allFit).toBe(true);
    for (const l of x.legs.filter((l) => l.kind === "OPEN")) expect(l.selection.length).toBe(l.hi);
    expect(x.status).toBe("OK");
  });

  it("23. budget 0", () => {
    const x = buildRad(bjerkeLegs(), bjerkeRules({ budget: 0 }));
    expect(x.status).toBe("RULES_DONT_FIT");
    expect(x.maxRows).toBe(0);
    expect(x.suggestions[0]).toEqual({ kind: "BUDGET", budget: 162 });
  });

  it("24. V75", () => {
    const legs = bjerkeLegs().slice(0, 7);
    const x = buildRad(legs, bjerkeRules({ gameType: "V75", spikCount: 3 }));
    expect(x.legs).toHaveLength(7);
    expect(x.favLimit).toBe(3);
    expect(x.spikMax).toBeLessThanOrEqual(6);
    expect(x.rows).toBe(rowCount(x.selections, 7));
    expect(x.favCount).toBeLessThanOrEqual(3);
    expect(x.favOver).toBeNull();
    // 6 spikar: två favoritspikar behövs i varv 2 och bryter spärren på 3.
    const six = buildRad(legs, bjerkeRules({ gameType: "V75", spikCount: 6 }));
    expect(six.spikEffective).toBe(6);
    expect(six.favOver).toBe("SPIKES");
    expect(buildRad(legs, bjerkeRules({ gameType: "V75", spikCount: 9 })).spikEffective).toBeLessThanOrEqual(6);
  });

  it("25. allgardering vald i låst avdelning", () => {
    const x = buildRad(bjerkeLegs(), bjerkeRules({ allgMode: "CHOSEN", allgLeg: 4 }));
    expect(x.allgFallback).toBe("LOCKED");
    expect(x.allgLeg).toBe(5);
    const y = buildRad(bjerkeLegs(), bjerkeRules({ allgMode: "CHOSEN", allgLeg: 3 }));
    expect(y).toMatchObject({ allgLeg: 3, allgFallback: null, allgAuto: false });
  });
});

describe("maximizeHorses", () => {
  it("26. motexemplet till den giriga regeln", () => {
    const m = maximizeHorses(
      [
        { lo: 3, hi: 4, gains: [0, 0] },
        { lo: 3, hi: 12, gains: new Array(10).fill(0) },
      ],
      36,
    )!;
    expect(m.k).toEqual([3, 12]);
    expect(m.horses).toBe(15);
  });

  it("27. lika antal och poäng: den billigaste", () => {
    const m = maximizeHorses(
      [
        { lo: 1, hi: 3, gains: [0, 0, 0] },
        { lo: 1, hi: 3, gains: [0, 0, 0] },
      ],
      5,
    )!;
    expect(m.horses).toBe(4);
    expect(m.product).toBe(3);
    expect(maximizeHorses([{ lo: 3, hi: 4, gains: [0, 1] }], 2)).toBeNull();
  });
});

describe("standardvärden och ordning", () => {
  it("28. defaultSpikCount", () => {
    expect(defaultSpikCount(bjerkeLegs(), bjerkeRules())).toBe(4);
    expect(defaultSpikCount(bjerkeLegs(), bjerkeRules({ budget: 100 }))).toBe(5);
    expect(defaultSpikCount(bjerkeLegs(), bjerkeRules({ budget: 0 }))).toBe(7);
  });

  it("29. ordningsoberoende", () => {
    const a = buildRad(bjerkeLegs(), bjerkeRules());
    const rev = bjerkeLegs()
      .reverse()
      .map((l) => ({ ...l, starts: [...l.starts].reverse() }));
    expect(buildRad(rev, bjerkeRules())).toEqual(a);
  });
});

describe("taket för öppna lopp (Mikael 2026-10-28)", () => {
  it("ett öppet lopp får högst hälften av hästarna, aldrig färre än minsta valet", () => {
    expect(openHiOf(3, 9, 12)).toBe(6);
    expect(openHiOf(3, 2, 12)).toBe(5);
    expect(openHiOf(3, 1, 5)).toBe(3);
  });
  it("hög budget: bara allgarderingen har alla hästar", () => {
    const r = buildRad(bjerkeLegs(), { ...bjerkeRules(), budget: 100_000 });
    for (const l of r.legs) if (l.kind === "OPEN") expect(l.selection.length).toBeLessThanOrEqual(Math.max(3, Math.floor(l.field.length / 2)));
    expect(r.legs.filter((l) => l.field.length > 1 && l.selection.length === l.field.length).map((l) => l.kind)).toEqual(["ALLG"]);
  });
});
