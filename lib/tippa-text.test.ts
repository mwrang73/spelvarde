// Texterna för V85-raden (docs/specs/e6-v85-rad.md) med Bjerke-fixturen, i V85 och V75.
import { describe, expect, it } from "vitest";
import { buildRad } from "@/lib/tippa";
import { bjerkeLegs, bjerkeRules, withStart } from "@/lib/tippa.fixture";
import {
  allgHelp,
  boldParts,
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
    expect(spikHelp(buildRad(legs, bjerkeRules({ locked: {}, spikCount: 0 })))).toBe("Inga spikar. Alla lopp utom allgarderingen får minst 3 hästar.");
    expect(spikHelp(buildRad(legs, bjerkeRules({ spikCount: 1 })))).toBe("Spiken är din egen.");
    expect(spikHelp(buildRad(legs, bjerkeRules({ locked: { 1: [7], 2: [2], 4: [1], 6: [3] }, spikCount: 4 })))).toBe("Alla 4 är dina egna.");
    expect(spikHelp(buildRad(legs, bjerkeRules(), { favLimit: 2 }))).toBe(
      "Appen väljer 3, i de lopp där modellen är säkrast: avd 8, 6 och 7. Avd 2 hoppades över: spiken där vore favoriten, och favoritspärren är full.",
    );
    const few = buildRad(legs, bjerkeRules({ locked: { 1: [7, 10], 3: [5, 9], 4: [1] } }));
    expect(spikHelp(few)).toContain(` Högst ${few.spikMax} spikar nu: övriga lopp är dina egna val, allgarderingen, inställda eller saknar riktodds.`);
    const noRikt = buildRad(
      legs.map((l) => ({ ...l, starts: l.starts.map((s) => ({ ...s, riktX: null })) })),
      bjerkeRules(),
    );
    expect(spikHelp(noRikt)).toBe("Riktodds saknas, så appen väljer inga spikar. Du kan välja egna.");
  });

  it("Allgardering", () => {
    expect(allgHelp(r)).toBe("Avd 5, mest öppna loppet. Favoriten har **14,2 %**.");
    expect(allgHelp(buildRad(legs, bjerkeRules({ allgMode: "CHOSEN", allgLeg: 3 })))).toBe("Avd 3, ditt val. Favoriten har **27,5 %**.");
    expect(allgHelp(buildRad(legs, bjerkeRules({ allgMode: "CHOSEN", allgLeg: 4 })))).toBe("Din valda avd 4 är låst, så appen valde avd 5.");
    const cancelled = legs.map((l) => (l.leg === 3 ? { ...l, cancelled: true } : l));
    expect(allgHelp(buildRad(cancelled, bjerkeRules({ allgMode: "CHOSEN", allgLeg: 3 })))).toBe("Din valda avd 3 är inställd, så appen valde avd 5.");
    const prelim = legs.map((l) => ({ ...l, starts: l.starts.map((s) => ({ ...s, streck: null })) }));
    expect(allgHelp(buildRad(prelim, bjerkeRules()))).toMatch(/^Avd \d, mest öppna loppet enligt modellen\.$/);
    const allLocked = buildRad(legs, bjerkeRules({ locked: Object.fromEntries(legs.map((l) => [l.leg, [l.starts[0].number]])), spikCount: 8 }));
    expect(allgHelp(allLocked)).toBe("Ingen avdelning kan allgarderas: alla är dina egna val eller inställda.");
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
    expect(legWhy(r, 5)).toBe("Mest öppna loppet: favoriten **6 Tekno Odin** har **14,2 %**, lägst av omgångens favoriter. 7 hästar har minst 5 %.");
    expect(legWhy(buildRad(legs, bjerkeRules({ allgMode: "CHOSEN", allgLeg: 5 })), 5)).toBe("Ditt val av allgardering. Favoriten **6 Tekno Odin** har **14,2 %**.");
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
    expect(desktopSummary(r)).toBe("27 hästar · spikar i avd 2, 4, 6 och 8 · allgardering i avd 5 · favoriten bortvald i avd 1 och 7");
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
      "**Reglerna ryms inte i 30 kr.** 4 spikar, allgardering av avd 5 (10 hästar) och minst 2 hästar i de 3 andra loppen ger minst 80 rader, alltså 40,00 kr. Ingen ny rad föreslås förrän det ryms.",
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
    expect(previewChangeText(r, allg, 5)).toContain(`Allgarderingen flyttar till avd ${allg.prioLeg}.`);
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
  it("spik i den allgarderade avdelningen och fler egna spikar än antalet", () => {
    const before = buildRad(legs, bjerkeRules({ spikCount: 1 }));
    const after = buildRad(legs, bjerkeRules({ spikCount: 2, locked: { 4: [1], 5: [2] } }));
    const t = spikPreviewTexts(before, after, 5, 2);
    expect(t).toContain(`Avd 5 allgarderas nu. Allgarderingen flyttar till avd ${after.prioLeg}, näst mest öppna loppet.`);
    expect(t).toContain("Du har redan 1 egen spik. Antal spikar blir 2.");
  });
  it("vald allgardering blir Auto", () => {
    const before = buildRad(legs, bjerkeRules({ allgMode: "CHOSEN", allgLeg: 3 }));
    const after = buildRad(legs, bjerkeRules({ locked: { 4: [1], 3: [2] } }));
    expect(spikPreviewTexts(before, after, 3, 2)).toContain("Avd 3 är din allgardering. Väljer du spik här blir allgarderingen Auto.");
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
