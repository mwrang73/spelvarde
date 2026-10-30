// ATG-filen (docs/specs/e7-atg-fil.md 6.5). Numren i beskrivningarna är specens testfall.
//
// Facit för CRC är räknat utanför funktionen: bit för bit med polynom 0x8005
// (MSB först, reflekterade in- och utdata) i ett separat Python-skript, och
// mot det publicerade kontrollvärdet för CRC-16/ARC ("123456789" = BB3D).
// Fall 6 (validering mot schemat) är en engångskontroll, inte ett enhetstest.
import { describe, expect, it } from "vitest";
import { ATG_NOT_TRIED_TEXT, atgCompareStep, atgRemovedText, atgRowPriceText, atgStartedError, atgStartedHelp, buildAtgFile, crc16Arc, crcHex, type AtgFileInput, type AtgFileLeg, type AtgFileOk } from "@/lib/atg-file";
import { buildRad } from "@/lib/tippa";
import { bjerkeLegs, bjerkeRules } from "@/lib/tippa.fixture";

const NOW = new Date("2026-10-31T12:05:09Z");
const ID = "V85_2026-10-31_5_5";

const leg = (n: number, selection: number[], over: Partial<AtgFileLeg> = {}): AtgFileLeg => ({ leg: n, selection, scratched: [], cancelled: false, ...over });
const allLegs = (count: number, over: Record<number, AtgFileLeg> = {}) => Array.from({ length: count }, (_, i) => over[i + 1] ?? leg(i + 1, [1, 2]));
const input = (over: Partial<AtgFileInput> = {}): AtgFileInput => ({ gameType: "V85", atgGameId: ID, now: NOW, legs: allLegs(8), ...over });
const ok = (i: Partial<AtgFileInput> = {}): AtgFileOk => {
  const r = buildAtgFile(input(i));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};
const errs = (i: Partial<AtgFileInput>) => {
  const r = buildAtgFile(input(i));
  if (r.ok) throw new Error("Filen skulle inte ha skapats.");
  return r.errors;
};
const marksIn = (xml: string) => [...xml.matchAll(/<leg legno="(\d+)" marks="([01]+)"\/>/g)].map((m) => ({ legno: Number(m[1]), marks: m[2] }));
const onV85Leg1 = (selection: number[], over: Partial<AtgFileLeg> = {}) => marksIn(ok({ legs: allLegs(8, { 1: leg(1, selection, over) }) }).xml)[0].marks;

describe("hela filen", () => {
  it("1: exakt text för V85, med CRC räknad utanför funktionen", () => {
    const sel = [[1, 2, 4], [2], [15], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], [3, 11], [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12], [1], [4]];
    const r = ok({ legs: sel.map((s, i) => leg(i + 1, s)) });
    expect(r.xml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<issuer xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://www.atg.se/services/schemas/filebet/1.8.4/atg_filebetting.xsd" company="Spelvarde" product="Spelvarde" version="1.0" createddate="2026-10-31" createdtime="13:05:09" schemaversion="ATG File Betting XSD ver 1.8">',
        "  <betcoupons>",
        '    <v85Coupon couponid="1" date="2026-10-31" betmultiplier="1">',
        '      <leg legno="1" marks="110100000000000"/>',
        '      <leg legno="2" marks="010000000000000"/>',
        '      <leg legno="3" marks="000000000000001"/>',
        '      <leg legno="4" marks="111111111111111"/>',
        '      <leg legno="5" marks="001000000010000"/>',
        '      <leg legno="6" marks="111111011111000"/>',
        '      <leg legno="7" marks="100000000000000"/>',
        '      <leg legno="8" marks="000100000000000"/>',
        "    </v85Coupon>",
        "  </betcoupons>",
        "</issuer>",
        "",
      ].join("\n"),
    );
    expect(r.filename).toBe("v85_2026-10-31_d731.xml");
  });

  it("2: lopp i ordning, exakt 8 leg, också när indata är i annan ordning", () => {
    const r = ok({ legs: allLegs(8).reverse() });
    expect(marksIn(r.xml).map((m) => m.legno)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it.each([
    ["V75", "V75_2026-11-29_5_5", "v75Coupon", "v75_2026-11-29_"],
    ["GS75", "GS75_2026-11-29_5_5", "gs75Coupon", "gs75_2026-11-29_"],
  ])("3: %s har rätt element, 7 leg och ingen trackcode", (gameType, atgGameId, element, prefix) => {
    const r = ok({ gameType, atgGameId, legs: allLegs(7) });
    expect(r.xml).toContain(`<${element} couponid="1" date="2026-11-29" betmultiplier="1">`);
    expect(marksIn(r.xml)).toHaveLength(7);
    expect(r.xml).not.toContain("trackcode");
    expect(r.filename.startsWith(prefix)).toBe(true);
  });

  it("4: V86 har trackcode", () => {
    const r = ok({ gameType: "V86", atgGameId: "V86_2026-11-04_5_5" });
    expect(r.xml).toContain('<v86Coupon couponid="1" date="2026-11-04" trackcode="5" betmultiplier="1">');
    expect(marksIn(r.xml)).toHaveLength(8);
    expect(r.filename.startsWith("v86_")).toBe(true);
  });

  it("5: V85 har ingen trackcode", () => {
    expect(ok().xml).not.toContain("trackcode");
  });

  it("7: alltid couponid 1 och betmultiplier 1, inga reserver eller v7/v8", () => {
    const { xml } = ok();
    expect(xml).toContain('couponid="1"');
    expect(xml).toContain('betmultiplier="1"');
    expect(xml).not.toMatch(/\b(r1|r2|v7|v8)=/);
  });
});

describe("marks", () => {
  it("8–11: position, bredd, osorterat och dubbletter", () => {
    expect(onV85Leg1([1, 2, 4])).toBe("110100000000000");
    expect(onV85Leg1([15])).toBe("000000000000001");
    expect(onV85Leg1(Array.from({ length: 15 }, (_, i) => i + 1))).toBe("111111111111111");
    expect(onV85Leg1([4, 1, 2, 4])).toBe("110100000000000");
  });

  it("12: allgarderat med en struken häst utanför valet", () => {
    const r = ok({ legs: allLegs(8, { 1: leg(1, [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12], { scratched: [{ number: 7, name: "Sjuan" }] }) }) });
    expect(marksIn(r.xml)[0].marks).toBe("111111011111000");
    expect(r.removed).toEqual([]);
  });

  it("13: struken i valet tas bort och räknas inte i rader", () => {
    const r = ok({ legs: allLegs(8, { 7: leg(7, [3, 8, 11], { scratched: [{ number: 8, name: "Stål Viking" }] }) }) });
    expect(marksIn(r.xml)[6].marks).toBe("001000000010000");
    expect(r.removed).toEqual([{ leg: 7, number: 8, name: "Stål Viking" }]);
    expect(r.rows).toBe(2 ** 7 * 2);
    expect(r.markedByLeg[7]).toEqual([3, 11]);
  });

  it("14: inställt lopp med en häst är ingen avvikelse", () => {
    const r = ok({ legs: allLegs(8, { 2: leg(2, [5], { cancelled: true }) }) });
    expect(marksIn(r.xml)[1].marks).toBe("000010000000000");
  });

});

describe("CRC och filnamn", () => {
  it("15: publicerat kontrollvärde", () => {
    expect(crc16Arc("123456789")).toBe("bb3d");
  });

  it("16: tom text och nollfyllnad", () => {
    expect(crc16Arc("")).toBe("0000");
    expect(crcHex(0x0a3f)).toBe("0a3f");
    // "idzc" är framsökt i det fristående skriptet: dess CRC är 0x0A3F.
    expect(crc16Arc("idzc")).toBe("0a3f");
  });

  it("17: filnamnet har CRC av exakt den returnerade texten, och annan tid ger annan CRC", () => {
    const a = ok();
    expect(a.filename).toBe(`v85_2026-10-31_${crc16Arc(a.xml)}.xml`);
    const b = ok({ now: new Date("2026-10-31T12:05:10Z") });
    expect(b.filename).not.toBe(a.filename);
  });

  it("18: bara ASCII, ingen BOM, inga CR", () => {
    const { xml } = ok();
    expect(/^[\x00-\x7f]*$/.test(xml)).toBe(true);
    expect(xml.charCodeAt(0)).not.toBe(0xfeff);
    expect(xml).not.toContain("\r");
    expect(xml.endsWith("</issuer>\n")).toBe(true);
  });
});

describe("tiden", () => {
  it("19: sommartid", () => {
    expect(ok({ now: new Date("2026-07-01T12:00:00Z") }).xml).toContain('createdtime="14:00:00"');
  });

  it("20: över midnatt i svensk tid", () => {
    const { xml } = ok({ now: new Date("2026-10-30T23:30:00Z") });
    expect(xml).toContain('createddate="2026-10-31"');
    expect(xml).toContain('createdtime="00:30:00"');
  });
});

describe("felen", () => {
  it("21: startnummer 16", () => {
    const e = errs({ legs: allLegs(8, { 3: leg(3, [1, 16]) }) });
    expect(e).toEqual([
      {
        code: "OVER_15",
        leg: 3,
        numbers: [16],
        text: "Startnummer 16 i V85-3 får inte plats i ATG-filen, som bara har startnummer 1–15. Ta bort hästen ur V85-3, eller fyll i raden för hand hos ATG.",
      },
    ]);
  });

  it("22: 16 och 17 i V75-2", () => {
    const e = errs({ gameType: "V75", atgGameId: "V75_2026-11-29_5_5", legs: allLegs(7, { 2: leg(2, [17, 16]) }) });
    expect(e[0].text).toBe("Startnummer 16 och 17 i V75-2 får inte plats i ATG-filen, som bara har startnummer 1–15. Ta bort hästarna ur V75-2, eller fyll i raden för hand hos ATG.");
  });

  it("23: fel i två lopp ger två poster", () => {
    expect(errs({ legs: allLegs(8, { 1: leg(1, [16]), 5: leg(5, []) }) }).map((x) => [x.code, x.leg])).toEqual([
      ["OVER_15", 1],
      ["EMPTY_LEG", 5],
    ]);
  });

  it("24: ett struket nummer över 15 är inget fel", () => {
    const r = ok({ legs: allLegs(8, { 1: leg(1, [2, 16], { scratched: [{ number: 16, name: "Sexton" }] }) }) });
    expect(marksIn(r.xml)[0].marks).toBe("010000000000000");
  });

  it("25: tomt lopp, alla strukna, inställt utan häst och hela raden tom", () => {
    expect(errs({ legs: allLegs(8, { 3: leg(3, []) }) })[0].text).toBe("V85-3 har inga valda hästar. Välj hästar i V85-3 först.");
    expect(errs({ legs: allLegs(8, { 3: leg(3, [4], { scratched: [{ number: 4, name: "Fyran" }] }) }) })[0].text).toBe("Alla valda hästar i V85-3 är strukna. Välj nya hästar i V85-3 först.");
    expect(errs({ legs: allLegs(8, { 3: leg(3, [], { cancelled: true }) }) })[0].text).toBe("V85-3 är inställt och har ingen häst att markera. Fyll i raden för hand hos ATG.");
    expect(errs({ legs: Array.from({ length: 8 }, (_, i) => leg(i + 1, [])) })).toEqual([{ code: "EMPTY_ROW", leg: null, numbers: [], text: "Raden har inga valda hästar." }]);
  });

  it("25: ett saknat lopp i indata är ett tomt lopp", () => {
    expect(errs({ legs: allLegs(8).filter((l) => l.leg !== 8) }).map((x) => [x.code, x.leg])).toEqual([["EMPTY_LEG", 8]]);
  });

  it("26: id som inte går att läsa, V86 med bana 120 och fel spelform", () => {
    const text = "Omgångens id hos ATG går inte att läsa, så ATG-filen kan inte skapas. Hämta omgången igen.";
    expect(errs({ atgGameId: "nonsens" })).toEqual([{ code: "BAD_ID", leg: null, numbers: [], text }]);
    expect(errs({ gameType: "V86", atgGameId: "V86_2026-11-04_120_5" })[0].text).toBe(text);
    expect(errs({ gameType: "V86", atgGameId: "V86_2026-11-04_0_5" })[0].code).toBe("BAD_ID");
    expect(errs({ gameType: "V85", atgGameId: "V75_2026-11-29_5_5" })[0].code).toBe("BAD_ID");
    // Bana 120 stoppar bara V86.
    expect(ok({ atgGameId: "V85_2026-10-31_120_5" }).xml).not.toContain("trackcode");
  });

  it("27: ingen text säger Avd eller avdelning, och flera fel samlas", () => {
    const e = errs({ atgGameId: "nonsens", legs: allLegs(8, { 1: leg(1, [16, 17]), 2: leg(2, [16]), 3: leg(3, []), 4: leg(4, [1], { scratched: [{ number: 1, name: "Ettan" }] }), 5: leg(5, [], { cancelled: true }) }) });
    expect(e).toHaveLength(6);
    for (const x of e) expect(x.text).not.toMatch(/avd/i);
  });
});

describe("mot buildRad och texterna", () => {
  it("28: Bjerke: avkodade marks och rader stämmer med raden", () => {
    const result = buildRad(bjerkeLegs(), bjerkeRules());
    const r = ok({ legs: result.legs.map((l) => ({ leg: l.leg, selection: l.selection, scratched: l.scratched, cancelled: l.kind === "CANCELLED" })) });
    const decoded = Object.fromEntries(marksIn(r.xml).map(({ legno, marks }) => [legno, [...marks].flatMap((c, i) => (c === "1" ? [i + 1] : []))]));
    expect(decoded).toEqual(result.selections);
    expect(r.rows).toBe(result.rows);
  });

  it("texterna i arket", () => {
    expect(atgRowPriceText(1, 288)).toBe("**Radpriset i appen är 1,00 kr.** Filen har inget radpris, så ATG kan visa ett annat pris än 288,00 kr. Jämför priset innan du bekräftar.");
    expect(atgRemovedText("V85", { leg: 7, number: 8, name: "Stål Viking" })).toBe("**8 Stål Viking i V85-7 är struken** och är inte med i ATG-filen.");
    expect(atgStartedHelp("V75")).toBe("V75 har startat, så ATG-filen går inte längre att ladda ner.");
    expect(atgStartedError("V85")).toBe("V85 har startat. ATG-filen skapades inte.");
    expect(atgCompareStep(576, 288)).toBe("Jämför rader och pris hos ATG med raden här: **576 rader · 288,00 kr**. Bekräfta bara om allt stämmer. Ett bekräftat spel kan inte ångras.");
    expect(ATG_NOT_TRIED_TEXT).toContain("inte provad");
  });
});
