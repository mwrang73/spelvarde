// Texterna för V85-raden (docs/specs/e6-v85-rad.md) med Bjerke-fixturen, i V85 och V75.
// E6b (docs/specs/e6b-max-per-lopp.md 6 och 8): exempel 1 och 2 ur lib/tippa.fixture.ts.
import { describe, expect, it } from "vitest";
import { buildRad } from "@/lib/tippa";
import { bjerkeLegs, bjerkeRules, ex1Legs, ex1Rules, ex2Legs, ex2Rules, withStart } from "@/lib/tippa.fixture";
import {
  allFitText,
  boldParts,
  capHelp,
  capValue,
  copyChangedText,
  desktopSummary,
  favHelp,
  favOutText,
  favStrip,
  favStripLabel,
  favValue,
  legSubline,
  legTypeLabel,
  legWhy,
  legWhyStarted,
  listSummary,
  liveSummary,
  ownOverText,
  ownSpikValue,
  previewChangeText,
  previewPickedLabel,
  prioHelp,
  prioHelpStarted,
  prioSheetSub,
  prioSheetValue,
  copyBlockedReason,
  prelimText,
  spikPreviewTexts,
  reasonClass,
  reasonLabel,
  rulesDontFitText,
  scratchNotices,
  spikHelp,
  suggestionLabel,
  suggestionToast, templateDeviationText } from "@/lib/tippa-text";

const legs = bjerkeLegs();
const r = buildRad(legs, bjerkeRules());
const saved = { selections: Object.fromEntries(Object.entries(r.selections).map(([k, v]) => [k, v])), rows: r.rows, cost: r.cost };

describe("Regler för raden", () => {
  it("Spikar", () => {
    expect(spikHelp(r)).toBe("Appen väljer 3, i de lopp där modellen är säkrast: avd 2, 8 och 6.");
    expect(ownSpikValue(r)).toBe("1 av 4");
    expect(spikHelp(buildRad(legs, bjerkeRules({ locked: {}, spikCount: 1 })))).toBe("Appen väljer 1, i loppet där modellen är säkrast: avd 2.");
    expect(spikHelp(buildRad(legs, bjerkeRules({ locked: {}, spikCount: 0 })))).toBe("Inga spikar. Alla lopp får minst 3 hästar.");
    expect(spikHelp(buildRad(legs, bjerkeRules({ spikCount: 1 })))).toBe("Spiken är din egen.");
    expect(spikHelp(buildRad(legs, bjerkeRules({ locked: { 1: [7], 2: [2], 4: [1], 6: [3] }, spikCount: 4 })))).toBe("Alla 4 är dina egna.");
    expect(spikHelp(buildRad(legs, bjerkeRules(), { favLimit: 2 }))).toBe(
      "Appen väljer 3, i de lopp där modellen är säkrast: avd 8, 6 och 7. Avd 2 hoppades över: spiken där vore favoriten, och favoritspärren är full.",
    );
    const few = buildRad(legs, bjerkeRules({ locked: { 1: [7, 10], 3: [5, 9], 4: [1] } }));
    expect(spikHelp(few)).toContain(` Högst ${few.spikMax} spikar nu: övriga lopp är dina egna val, det prioriterade loppet, inställda eller saknar riktodds.`);
    const noRikt = buildRad(
      legs.map((l) => ({ ...l, starts: l.starts.map((s) => ({ ...s, riktX: null })) })),
      bjerkeRules(),
    );
    expect(spikHelp(noRikt)).toBe("Riktodds saknas, så appen väljer inga spikar. Du kan välja egna.");
  });

  it("Prioriterat lopp, Alla (Bjerke)", () => {
    expect(prioHelp(r)).toBe("Avd 5 får **alla 12**, mest öppna loppet. Favoriten har **14,2 %**.");
    expect(prioHelp(buildRad(legs, bjerkeRules({ allgMode: "CHOSEN", allgLeg: 3 })))).toMatch(/^Avd 3 får \*\*(alla \d+|\d+ av \d+)\*\*, ditt val\./);
    expect(prioHelp(buildRad(legs, bjerkeRules({ allgMode: "CHOSEN", allgLeg: 4 })))).toBe("Din valda avd 4 är ditt eget val och låst, så appen prioriterar avd 5. Avd 5 får **alla 12**.");
    const cancelled = legs.map((l) => (l.leg === 3 ? { ...l, cancelled: true } : l));
    expect(prioHelp(buildRad(cancelled, bjerkeRules({ allgMode: "CHOSEN", allgLeg: 3 })))).toBe("Din valda avd 3 är inställd, så appen prioriterar avd 5. Avd 5 får **alla 12**.");
    expect(prioHelp(buildRad(legs, bjerkeRules({ allgMode: "CHOSEN", allgLeg: 9 })))).toBe("Din valda avd 9 kan inte prioriteras, så appen prioriterar avd 5. Avd 5 får **alla 12**.");
    const prelim = legs.map((l) => ({ ...l, starts: l.starts.map((s) => ({ ...s, streck: null })) }));
    expect(prioHelp(buildRad(prelim, bjerkeRules()))).toMatch(/^Avd \d får \*\*.+\*\*, mest öppna loppet enligt modellen\.( Favoriten har \*\*\d+,\d %\*\* enligt modellen\.)?$/);
    const allLocked = buildRad(legs, bjerkeRules({ locked: Object.fromEntries(legs.map((l) => [l.leg, [l.starts[0].number]])), spikCount: 8 }));
    expect(prioHelp(allLocked)).toBe("Inget lopp kan prioriteras: alla är dina egna val eller inställda.");
    expect(capValue(r)).toBe("Alla");
    expect(capHelp(r)).toEqual({ text: "Inget tak. Avd 5 får **alla 12**, som en allgardering.", over: null });
  });

  it("Favoritspärren", () => {
    expect(favValue(r)).toBe("4 av 8");
    expect(favHelp(r)).toBe("Favoriten (mest streckad) får vara med i högst **4 lopp på V85**. Bortvald i avd 1 och 7, där modellen tror minst på den.");
    expect(favStripLabel(r)).toBe("Favoriten är med i avdelning 2, 3, 4 och 5. Bortvald av spärren i avdelning 1 och 7. Högst 4 på V85.");
    expect(favStrip(r).map((c) => c.small)).toEqual(["spärr", "✓ fav", "✓ fav", "✓ fav", "✓ fav", "–", "spärr", "–"]);
    const own = buildRad(legs, bjerkeRules({ locked: { 2: [2], 3: [5], 6: [7], 8: [1] } }));
    expect(favValue(own)).toBe("5 av 8 · över");
    expect(favHelp(own)).toBe("Dina egna val har favoriten i 5 lopp, över spärren på 4. Inget blockeras.");
    const spikes = buildRad(legs, bjerkeRules({ spikCount: 7 }), { favLimit: 2 });
    expect(favHelp(spikes)).toMatch(/^Spikarna kräver favoriten i \d lopp, över spärren på 2\. Välj färre spikar för att hålla spärren\.$/);
    expect(favHelp(buildRad(legs, bjerkeRules({ budget: 100_000 })))).toContain("Bortvald i avd 1 och 7");
  });
});

describe("Avdelningskortet", () => {
  it("typ, underrad och varför-raden", () => {
    expect(r.legs.map((l) => legTypeLabel(l))).toEqual(["3 hästar", "Spik", "4 hästar", "Egen spik", "Alla 12", "Spik", "4 hästar", "Spik"]);
    expect(legTypeLabel(r.legs[0], true)).toBe("Startat");
    expect(legSubline(r.legs[0])).toBe("12 startande · fav 31,0 %");
    expect(legWhy(r, 2)).toBe("Säkrast enligt modellen: rikt **1,22**, lägst av loppen som kunde bli spik.");
    expect(legWhy(r, 8)).toBe("Säkrast enligt modellen: rikt **1,30**. Favoriten 1 Moe Tjalve har rikt **1,85** (33,5 %).");
    expect(legWhy(r, 4)).toBe("Din spik. Avdelningen är låst och räknas inte om.");
    expect(legWhy(r, 5)).toBe("Prioriterat, mest öppna loppet: favoriten **6 Tekno Odin** har **14,2 %**, lägst av omgångens favoriter. Inget tak, så alla 12 är med. Hos ATG trycker du på **Alla**.");
    expect(legWhy(buildRad(legs, bjerkeRules({ allgMode: "CHOSEN", allgLeg: 5 })), 5)).toBe("Prioriterat, ditt val: favoriten **6 Tekno Odin** har **14,2 %**. Inget tak, så alla 12 är med. Hos ATG trycker du på **Alla**.");
    expect(legWhy(r, 1)).toBeNull();
    expect(legWhy(buildRad(legs, bjerkeRules({ locked: { 4: [1], 7: [3, 4] } })), 7)).toBe("Ditt val. Avdelningen är låst och räknas inte om.");
    const cancelled = buildRad(
      legs.map((l) => (l.leg === 1 ? { ...l, cancelled: true } : l)),
      bjerkeRules(),
    );
    expect(legWhy(cancelled, 1)).toBe("Loppet är inställt. Hos ATG räknas alla hästar som vinnare, så en häst räcker.");
    expect(legSubline(cancelled.legs[0])).toBe("Inställt");
    const two = buildRad(
      legs.map((l) => (l.leg === 1 ? { ...l, starts: l.starts.map((s) => ({ ...s, scratched: ![3, 7].includes(s.number) })) } : l)),
      bjerkeRules(),
    );
    expect(legWhy(two, 1)).toBe("Bara 2 startande. Båda är med.");
    expect(legWhyStarted("SPIK")).toBe("Spik vid spelstopp.");
    expect(legWhyStarted("OPEN")).toBeNull();
  });

  it("spärrraden", () => {
    expect(favOutText(r, 1)).toBe("Ej med: **3 Lannem Lyn**, favorit 31,0 %. Favoritspärren: modellen tror minst på den jämfört med strecket (rikt **2,10**).");
    expect(favOutText(r, 3)).toBeNull();
  });

  it("skälen som ord och klasser", () => {
    expect(r.legs[6].horses.map((h) => h.reasons.map(reasonLabel).join(", "))).toEqual(["Topp 3, 4 signaler", "Topp 3", "Mellan, Felstreckad, 4 signaler", "Skräll, 4 signaler"]);
    expect(["LOW", "NOMEL", "PRE", "SIG10", "FAV"].map((c) => reasonLabel(c as never))).toEqual(["Ingen under 5 %", "Ingen mellan", "Prel.", "10 signaler", "Favorit"]);
    expect(["SKR", "FEL", "SIG4", "LOW"].map((c) => reasonClass(c as never))).toEqual(["skr", "fel", "sig", "wrn"]);
  });

  it("rubrikerna", () => {
    expect(listSummary(r)).toBe("27 hästar · 576 rader · 9 understreckade");
    expect(desktopSummary(r)).toBe("27 hästar · spikar i avd 2, 4, 6 och 8 · avd 5 prioriterad, alla 12 · favoriten bortvald i avd 1 och 7");
    expect(boldParts("a **b** c")).toEqual([
      { text: "a ", bold: false },
      { text: "b", bold: true },
      { text: " c", bold: false },
    ]);
  });
});

describe("Budgeten", () => {
  it("reglerna ryms inte, förslagen och live-regionen", () => {
    const x = buildRad(legs, bjerkeRules({ budget: 30 }));
    expect(rulesDontFitText(x)).toBe(
      "**Reglerna ryms inte i 30 kr.** 4 spikar, prioriterat lopp avd 5 (minst 10 hästar) och minst 2 hästar i de 3 andra loppen ger minst 80 rader, alltså 40,00 kr. Ingen ny rad föreslås förrän det ryms.",
    );
    expect(x.suggestions.map(suggestionLabel)).toEqual(["Höj till 40 kr", "5 spikar · minst 20,00 kr"]);
    expect(x.suggestions.map(suggestionToast)).toEqual(["Budgeten är 40 kr · Ångra", "5 spikar · Ångra"]);
    expect(liveSummary(x)).toBe("Reglerna ryms inte i 30 kronor. Behövs minst 40,00 kronor.");
    expect(liveSummary(r)).toBe("4 spikar. 576 rader, 288,00 kronor. Kvar 0,00 kronor.");
    const own = buildRad(legs, bjerkeRules({ budget: 20, locked: { 4: [1], 7: [3, 4] } }));
    expect(rulesDontFitText(own)).toContain(", ditt eget val i avd 7 (2 hästar) och minst 2 hästar i de 2 andra loppen");
  });

  it("eget val ryms inte", () => {
    const x = buildRad(legs, bjerkeRules({ budget: 100, locked: { 4: [1], 7: [2, 3, 4, 5, 7, 8, 9, 11, 14] } }));
    expect(ownOverText(x)).toBe("**Avd 7 med 9 hästar ryms inte.** Även när de andra loppen har minsta antal blir raden 360 rader · 180,00 kr. Ingenting blockeras, men raden är över budget.");
    expect(x.suggestions.map(suggestionLabel)).toEqual(["Ändra avd 7", "Höj till 180 kr"]);
    expect(liveSummary(x)).toBe("360 rader, 180,00 kronor. Över budget med 80,00 kronor.");
    expect(previewChangeText(r, x, 7)).toContain("Raden blir 360 rader · 180,00 kr, över budget med 80,00 kr.");
  });
});

describe("Förhandsvisningen (A4)", () => {
  it("meningarna", () => {
    const x = buildRad(legs, bjerkeRules({ locked: { 4: [1], 7: [3, 4, 8, 11, 14] } }));
    expect(previewChangeText(r, x, 7)).toBe("Avd 3 går från 4 till 3 hästar (1 Järvsö Elina tas bort) för att raden ska komma nära **288 kr**. Övriga avdelningar ändras inte.");
    const spik = buildRad(legs, bjerkeRules({ locked: { 4: [1], 6: [3, 7] } }));
    expect(previewChangeText(r, spik, 6)).toContain("Spiken flyttar från avd 6 till avd 7.");
    const allg = buildRad(legs, bjerkeRules({ locked: { 4: [1], 5: [6, 2] } }));
    expect(previewChangeText(r, allg, 5)).toContain(`Det prioriterade loppet flyttar till avd ${allg.prioLeg}.`);
    const one = buildRad(legs, bjerkeRules({ spikCount: 1 }));
    const more = buildRad(legs, bjerkeRules({ spikCount: 1, locked: { 4: [1], 2: [2] } }));
    expect(previewChangeText(one, more, 2)).toContain("Antal spikar blir 2.");
    expect(previewChangeText(r, x, 7, [])).toBe("Ingen häst vald. Stänger du arket väljer appen avdelningen igen.");
    expect([0, 1, 5].map(previewPickedLabel)).toEqual(["Ingen häst vald", "1 häst · egen spik", "5 hästar · låst"]);
  });
});

describe("Strykningar och kopiering", () => {
  it("strykningsbanderollerna", () => {
    const t = buildRad(withStart(legs, 7, 11, { scratched: true }), bjerkeRules());
    expect(scratchNotices(saved, t)).toEqual([
      expect.objectContaining({ kind: "SCRATCHED", leg: 7, tone: "warn", role: "status", text: "**11 Tangen Haap i avd 7 är struken.** Den togs bort, och 5 Odd Herakles kom med i stället som Mellan. Raden är fortfarande 576 rader · 288,00 kr." }),
    ]);
    const spik = buildRad(withStart(legs, 4, 1, { scratched: true }), bjerkeRules());
    expect(scratchNotices(saved, spik)[0]).toMatchObject({ kind: "OWN_SPIK", role: "alert", text: "**Din spik 1 Baron Tilly i avd 4 är struken.** Hos ATG ersätts den med reservhästen. Välj en ny spik, eller låt appen välja." });
    const own = buildRad(withStart(legs, 7, 8, { scratched: true }), bjerkeRules({ locked: { 4: [1], 7: [3, 8] } }));
    expect(scratchNotices(null, own)[0].text).toBe("**8 Stål Viking i avd 7 är struken** och togs bort ur ditt val.");
    const all = buildRad(withStart(withStart(legs, 7, 8, { scratched: true }), 7, 3, { scratched: true }), bjerkeRules({ locked: { 4: [1], 7: [3, 8] } }));
    expect(scratchNotices(null, all)[0].text).toBe("**Alla dina hästar i avd 7 är strukna.** Appen väljer avdelningen igen.");
    const none = buildRad(
      legs.map((l) => (l.leg === 3 ? { ...l, starts: l.starts.map((s) => ({ ...s, scratched: true })) } : l)),
      bjerkeRules(),
    );
    expect(scratchNotices(null, none)[0].text).toBe("**Avd 3 har inga startande hästar.** Raden kan inte kopieras förrän loppet är inställt hos ATG. Hämta omgången igen.");
    expect(scratchNotices(saved, r)).toEqual([]);
  });

  it("ändrad sedan kopiering", () => {
    const now = new Date("2026-10-31T15:00:00Z");
    const t = buildRad(withStart(legs, 7, 11, { scratched: true }), bjerkeRules());
    expect(copyChangedText("2026-10-31T13:05:00.000Z", saved.selections, t, now)).toBe(
      "**Raden har ändrats sedan du kopierade den** i dag 14:05. Avd 7 är ändrad. Kopiera igen om du vill spela den nya raden.",
    );
    expect(copyChangedText("2026-10-31T13:05:00.000Z", saved.selections, r, now)).toBeNull();
    expect(copyChangedText(null, null, r, now)).toBeNull();
  });
});

describe("V75", () => {
  it("spärren och spikarna i texterna", () => {
    const x = buildRad(legs.slice(0, 7), bjerkeRules({ gameType: "V75", spikCount: 3 }));
    expect(favHelp(x)).toContain("högst **3 lopp på V75**");
    expect(favStripLabel(x)).toContain("Högst 3 på V75.");
    expect(favValue(x)).toMatch(/ av 7$/);
  });
});

describe("Arket Välj egen spik (A5)", () => {
  it("egen spik 7 Dreamliner Sund i avd 6: favoriten tas bort i avd 3", () => {
    const after = buildRad(legs, bjerkeRules({ locked: { 4: [1], 6: [7] } }));
    expect(spikPreviewTexts(r, after, 6, 7)).toEqual(["**Favoriten blir med i 5 av 8.** Appen tar då bort favoriten i avd 3 i stället (5 Mellby Harley, S och B 2,40), eftersom ditt val går först."]);
  });
  it("spik i det prioriterade loppet och fler egna spikar än antalet", () => {
    const before = buildRad(legs, bjerkeRules({ spikCount: 1 }));
    const after = buildRad(legs, bjerkeRules({ spikCount: 2, locked: { 4: [1], 5: [2] } }));
    const t = spikPreviewTexts(before, after, 5, 2);
    expect(t).toContain(`Avd 5 är prioriterat lopp nu. Prioriteringen flyttar till avd ${after.prioLeg}, näst mest öppna loppet.`);
    expect(t).toContain("Du har redan 1 egen spik. Antal spikar blir 2.");
  });
  it("valt prioriterat lopp blir Auto", () => {
    const before = buildRad(legs, bjerkeRules({ allgMode: "CHOSEN", allgLeg: 3 }));
    const after = buildRad(legs, bjerkeRules({ locked: { 4: [1], 3: [2] } }));
    expect(spikPreviewTexts(before, after, 3, 2)).toContain("Avd 3 är ditt prioriterade lopp. Väljer du spik här blir prioriterat lopp Auto.");
  });
  it("inget annat lopp kan prioriteras", () => {
    const lockAll = (except: number) => Object.fromEntries(legs.filter((l) => l.leg !== except).map((l) => [l.leg, [l.starts[0].number]]));
    const before = buildRad(legs, bjerkeRules({ locked: lockAll(5), spikCount: 7 }));
    const after = buildRad(legs, bjerkeRules({ locked: { ...lockAll(5), 5: [2] }, spikCount: 8 }));
    expect(before.prioLeg).toBe(5);
    expect(spikPreviewTexts(before, after, 5, 2)).toContain("Avd 5 är prioriterat lopp nu. Inget annat lopp kan prioriteras.");
  });
});

describe("Vyns banderoller", () => {
  it("strecket kommer måndag före omgångens vecka, annars saknas än", () => {
    expect(prelimText("2026-10-31", new Date("2026-10-24T10:00:00Z"))).toMatch(/^\*\*Strecket kommer måndag\.\*\* Raden är preliminär/);
    expect(prelimText("2026-10-31", new Date("2026-10-26T08:00:00Z"))).toMatch(/^\*\*Strecket saknas än\.\*\*/);
  });
  it("orsaken till att Kopiera är avstängd", () => {
    expect(copyBlockedReason(r)).toBeNull();
    expect(copyBlockedReason(buildRad(legs, bjerkeRules({ budget: 30 })))).toBe("Raden ryms inte i budgeten.");
    expect(copyBlockedReason(buildRad(withStart(legs, 4, 1, { scratched: true }), bjerkeRules()))).toBe("Välj en ny spik i avd 4 först.");
  });
});

describe("Avvikelser från mallen (budgeten som mål)", () => {
  it("texten nämner allgarderingen och loppen med 2 hästar", () => {
    expect(templateDeviationText(r)).toBeNull();
    const x = buildRad(legs, bjerkeRules({ budget: 100 }));
    const t = templateDeviationText(x)!;
    expect(t).toMatch(/^För att komma nära din budget avviker raden från mallen\./);
    if (x.prioShort) expect(t).toContain(`Avd ${x.prioLeg} har ${12 - x.prioShort} av 12 hästar`);
    for (const l of x.relaxedLegs) expect(t).toContain(`${l}`);
  });
});

// ---- E6b: Max hästar per lopp och prioriterat lopp (docs/specs/e6b-max-per-lopp.md 6) ----------

describe("E6b: texterna med taket", () => {
  const L = ex1Legs();
  const t7 = buildRad(L, ex1Rules());
  const alla = buildRad(L, ex1Rules({ maxPerLeg: null }));
  const t3 = buildRad(L, ex1Rules({ maxPerLeg: 3 }));
  const short = buildRad(ex2Legs(), ex2Rules(), { favLimit: 8 });
  const allaShort = buildRad(L, ex1Rules({ maxPerLeg: null, budget: 150 }));
  const own9 = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  it("capHelp och stegarens värde", () => {
    expect(capValue(t7)).toBe("7");
    expect(capValue(buildRad(L, ex1Rules({ maxPerLeg: 15 })))).toBe("Alla");
    expect(capHelp(t7)).toEqual({ text: "Inget lopp får fler än **7 hästar**. Appen tar färre där budgeten gör mer nytta i andra lopp.", over: null });
    expect(capHelp(t3).text).toBe("Inget lopp får fler än **3 hästar**. Lägre går inte: varje öppet lopp behöver topp 3, mellan och skräll.");
    expect(capHelp(alla).text).toBe("Inget tak. Avd 5 får **alla 13**, som en allgardering.");
    expect(capHelp(allaShort).text).toBe("Inget tak. Det prioriterade loppet får alla sina hästar om budgeten räcker.");
    expect(capHelp(buildRad(L, ex1Rules({ locked: { 3: own9 } }))).over).toBe("Ditt eget val i avd 3 har 9. Ditt val går först, och inget blockeras.");
    expect(capHelp(buildRad(L, ex1Rules({ locked: { 3: own9, 7: own9.slice(0, 8) } }))).over).toBe("Dina egna val i avd 3 och 7 har fler än 7. Ditt val går först, och inget blockeras.");
  });

  it("prioHelp", () => {
    expect(prioHelp(t7)).toBe("Avd 5 får **7 av 13**, mest öppna loppet. Favoriten har **16,4 %**.");
    expect(prioHelp(buildRad(L, ex1Rules({ allgMode: "CHOSEN", allgLeg: 2 })))).toBe("Avd 2 får **7 av 10**, ditt val. Favoriten har **55,0 %**.");
    expect(prioHelp(short)).toBe("Avd 5 får **6 av 13**, mest öppna loppet. Budgeten räcker inte till 7 där.");
    expect(prioHelp(alla)).toBe("Avd 5 får **alla 13**, mest öppna loppet. Favoriten har **16,4 %**.");
    expect(prioHelp(buildRad(L, ex1Rules({ allgMode: "CHOSEN", allgLeg: 6, maxPerLeg: 12 })))).toBe("Avd 6 får **alla 10**, ditt val. Taket 12 är fler än de startande.");
    expect(prioHelp(buildRad(L, ex1Rules({ budget: 20 })))).toBe("Avd 5, mest öppna loppet. Favoriten har **16,4 %**.");
    expect(prioHelp(buildRad(L, ex1Rules({ allgMode: "CHOSEN", allgLeg: 3, locked: { 3: [1, 2] } })))).toMatch(/^Din valda avd 3 är ditt eget val och låst, så appen prioriterar avd 5\. Avd 5 får \*\*\d+ av 13\*\*\.$/);
    const cancelled = L.map((l) => (l.leg === 3 ? { ...l, cancelled: true } : l));
    expect(prioHelp(buildRad(cancelled, ex1Rules({ allgMode: "CHOSEN", allgLeg: 3 })))).toMatch(/^Din valda avd 3 är inställd, så appen prioriterar avd 5\. Avd 5 får \*\*\d+ av 13\*\*\.$/);
  });

  it("prioHelp efter spelstopp och arkets texter", () => {
    expect(prioHelpStarted({ leg: 5, kind: "PRIO", count: 7, field: 13 }, "AUTO")).toBe("Avd 5 fick **7 av 13** hästar (Auto).");
    expect(prioHelpStarted({ leg: 5, kind: "PRIO", count: 7, field: 13 }, "CHOSEN")).toBe("Avd 5 fick **7 av 13** hästar (ditt val).");
    expect(prioHelpStarted({ leg: 5, kind: "ALLG", count: 13, field: 13 }, "AUTO")).toBe("Avd 5 allgarderades.");
    expect(prioHelpStarted(null, null)).toBe("Inget lopp prioriterades.");
    expect(prioSheetSub(t7)).toBe("Loppet får upp till 7 hästar, om budgeten räcker. Inget lopp får fler än 7.");
    expect(prioSheetSub(alla)).toBe("Loppet får alla sina hästar, om budgeten räcker. Appen räknar om resten.");
    expect(prioSheetValue(t7, 5)).toBe("7 av 13");
    expect(prioSheetValue(alla, 5)).toBe("Alla 13");
    expect(prioSheetValue(t7, 1)).toBeNull();
  });

  it("avdelningskortet för P", () => {
    expect(legTypeLabel(t7.legs[4])).toBe("7 av 13");
    expect(legTypeLabel(short.legs[4])).toBe("6 av 13");
    expect(legTypeLabel(alla.legs[4])).toBe("Alla 13");
    const out = t7.legs[4].field.map((h) => h.number).filter((n) => !t7.legs[4].selection.includes(n));
    const ej = `${out.slice(0, -1).join(", ")} och ${out[out.length - 1]}`;
    expect(legWhy(t7, 5)).toBe(`Prioriterat, mest öppna loppet: favoriten **1 H1** har **16,4 %**, lägst av omgångens favoriter. Taket 7 är nått. Ej med: ${ej}.`);
    expect(legWhy(buildRad(L, ex1Rules({ allgMode: "CHOSEN", allgLeg: 5 })), 5)).toBe(`Prioriterat, ditt val: favoriten **1 H1** har **16,4 %**. Taket 7 är nått. Ej med: ${ej}.`);
    expect(legWhy(short, 5)).toBe("Prioriterat, mest öppna loppet. **Taket är 7, men budgeten räcker till 6 här.** Höj budgeten för att få med fler.");
    expect(legWhy(buildRad(ex2Legs(), ex2Rules({ allgMode: "CHOSEN", allgLeg: 5 }), { favLimit: 8 }), 5)).toBe("Prioriterat, ditt val. **Taket är 7, men budgeten räcker till 6 här.** Höj budgeten för att få med fler.");
    expect(legWhy(allaShort, 5)).toBe("Prioriterat, mest öppna loppet. **Budgeten räcker till 11 av 13 här.** Höj budgeten för att få med alla.");
    expect(legWhy(alla, 5)).toBe("Prioriterat, mest öppna loppet: favoriten **1 H1** har **16,4 %**, lägst av omgångens favoriter. Inget tak, så alla 13 är med. Hos ATG trycker du på **Alla**.");
    expect(legWhy(buildRad(L, ex1Rules({ maxPerLeg: null, allgMode: "CHOSEN", allgLeg: 5 })), 5)).toBe("Prioriterat, ditt val: favoriten **1 H1** har **16,4 %**. Inget tak, så alla 13 är med. Hos ATG trycker du på **Alla**.");
    expect(legWhy(buildRad(L, ex1Rules({ allgMode: "CHOSEN", allgLeg: 6, maxPerLeg: 12 })), 6)).toBe("Prioriterat, ditt val: favoriten **1 H1** har **55,0 %**. Taket 12 är fler än de startande, så alla 10 är med. Hos ATG trycker du på **Alla**.");
    expect(legWhyStarted("PRIO", { count: 7, field: 13, cap: 7 })).toBe("Prioriterat lopp vid spelstopp: **7 av 13**, tak 7.");
    expect(legWhyStarted("PRIO", { count: 11, field: 13, cap: null })).toBe("Prioriterat lopp vid spelstopp: **11 av 13**, inget tak.");
    expect(legWhyStarted("ALLG")).toBe("Allgardering vid spelstopp.");
  });

  it("sammanfattningen, reglerna ryms inte och budgetrutan", () => {
    expect(desktopSummary(t7)).toBe("22 hästar · spikar i avd 2 och 6 · avd 5 prioriterad, 7 av 13 · favoriten bortvald i avd 1, 3, 4 och 7");
    expect(desktopSummary(alla)).toContain(" · avd 5 prioriterad, alla 13 · ");
    expect(rulesDontFitText(buildRad(L, ex1Rules({ budget: 20 })))).toBe(
      "**Reglerna ryms inte i 20 kr.** 2 spikar, prioriterat lopp avd 5 (minst 5 hästar) och minst 2 hästar i de 5 andra loppen ger minst 160 rader, alltså 80,00 kr. Ingen ny rad föreslås förrän det ryms.",
    );
    expect(t3.allFit && t3.capLimited).toBe(true);
    expect(allFitText(t3)).toBe("Budgeten räcker till fler hästar än taket på 3 tillåter.");
    expect(allFitText(alla)).toBe("Budgeten räcker till alla hästar i de öppna loppen.");
  });

  it("previewChangeText: P tappar en häst och P flyttar", () => {
    const x = buildRad(L, ex1Rules({ locked: { 4: [1, 2, 3, 4] } }));
    expect(previewChangeText(t7, x, 4)).toContain("Avd 5 går från 7 till 6 hästar (6 H6 tas bort) för att raden ska komma nära **400 kr**.");
    const moved = buildRad(L, ex1Rules({ allgMode: "CHOSEN", allgLeg: 3 }));
    expect(previewChangeText(t7, moved, 3)).toContain("Det prioriterade loppet flyttar till avd 3.");
    expect(previewChangeText(buildRad(L, ex1Rules({ allgMode: "CHOSEN", allgLeg: 2 })), buildRad(L, ex1Rules()), 2)).toContain("Det prioriterade loppet flyttar till avd 5.");
  });

  it("spikPreviewTexts i P (exempel 1)", () => {
    const after = buildRad(L, ex1Rules({ locked: { 5: [1] }, spikCount: 3 }));
    expect(spikPreviewTexts(t7, after, 5, 1)).toContain(`Avd 5 är prioriterat lopp nu. Prioriteringen flyttar till avd ${after.prioLeg}, näst mest öppna loppet.`);
  });

  it("templateDeviationText med tak och Alla", () => {
    expect(templateDeviationText(short)).toBe("För att komma nära din budget avviker raden från mallen. Avd 5 har 6 av 13 hästar (taket är 7).");
    expect(templateDeviationText(allaShort)).toMatch(/^För att komma nära din budget avviker raden från mallen\. Avd 5 har 11 av 13 hästar\. Avd /);
  });

  it("V75", () => {
    const v75 = buildRad(L.slice(0, 7), ex1Rules({ gameType: "V75" }));
    expect(capHelp(v75).text).toBe("Inget lopp får fler än **7 hästar**. Appen tar färre där budgeten gör mer nytta i andra lopp.");
    expect(prioHelp(v75)).toMatch(/^Avd 5 får \*\*\d+ av 13\*\*, mest öppna loppet\./);
    expect(legTypeLabel(v75.legs[4])).toMatch(/^\d+ av 13$/);
  });
});
