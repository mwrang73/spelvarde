import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { flagShort, flagText } from "@/lib/tips/flags";
import type { StartRef } from "@/lib/tips/match";
import { BJERKE } from "@/lib/tips/testdata";
import { extractArticle, normQuote } from "@/lib/tips/text";
import { validateTips } from "@/lib/tips/validate";

const FX = path.join(__dirname, "..", "..", "test", "fixtures");
const read = (f: string) => readFileSync(path.join(FX, f), "utf8");
const text = (f: string) => {
  const r = extractArticle(read(`travstugan/${f}.html`), `https://travstugan.se/${f}`);
  if (!r.ok) throw new Error(r.error);
  return r.article.text;
};
const SYNT = text("syntetisk-tidiga");
const tip = (o: Record<string, unknown>) => ({ leg: null, number: null, roleWord: null, ...o });
const byName = <T extends { rawHorseName: string }>(ts: T[], n: string): T => ts.find((t) => t.rawHorseName === n)!;

describe("validateTips (6.11)", () => {
  it("mockupens sex tips mot den syntetiska texten: 5 säkra och Fly Express osäker", () => {
    const raw = JSON.parse(read("tips-ai/99f554a8abbe.json"));
    const r = validateTips(raw, SYNT, BJERKE, []);
    expect(r.discarded).toEqual({ shape: 0, quote: 0, duplicate: 0, overflow: 0 });
    const sure = r.tips.filter((t) => t.match === "SURE").map((t) => t.rawHorseName);
    expect(sure.sort()).toEqual(["Baron Tilly", "Blizzard Diamant", "Gigant Tider", "Peacekeeper", "Peggy Boko"]);
    const fly = byName(r.tips, "Fly Express");
    expect(fly).toMatchObject({ match: "UNSURE", flags: ["ROLE_WORD_UNKNOWN"], role: "SKRALL" });
    const flagIn = { ...fly, start: { leg: 1, number: 10, name: "Fly Express" }, suggestion: null };
    expect(flagText(flagIn)).toBe('Osäker roll: texten säger "fynd", som tolkades som Skräll.');
    expect(flagShort(flagIn)).toBe('Osäker roll: "fynd"');
    // "lås" ger Spik och "starkast" Favorit utan flagga.
    expect(byName(r.tips, "Peggy Boko")).toMatchObject({ role: "SPIK", flags: [] });
    expect(byName(r.tips, "Baron Tilly")).toMatchObject({ role: "FAVORIT", flags: [] });
    // Mellby Harly i avd 3 utan nummer: ej kopplad med förslag.
    const mh = byName(r.tips, "Mellby Harly");
    expect(mh).toMatchObject({ match: "NONE", startId: null, suggestedStartId: "s3_5", flags: ["NO_MATCH"] });
    expect(flagText({ ...mh, start: null, suggestion: { leg: 3, number: 5, name: "Mellby Harley" } })).toBe("Kunde inte kopplas till en häst i avd 3. Närmast är 5 Mellby Harley.");
  });
  it("citat som inte finns ordagrant kastas, typografiska citattecken godtas", () => {
    const text = 'Hon är "vårt lås" i sexan, Peggy Boko.';
    const r = validateTips(
      [
        tip({ leg: 6, number: 3, horseName: "Peggy Boko", role: "SPIK", roleWord: "lås", quote: "Hon är “vårt lås” i sexan, Peggy Boko." }),
        tip({ leg: 2, number: 2, horseName: "Gigant Tider", role: "SPIK", roleWord: "spik", quote: "Gigant Tider är en given spik." }),
      ],
      text,
      BJERKE,
      [],
    );
    expect(r.tips.map((t) => t.rawHorseName)).toEqual(["Peggy Boko"]);
    expect(r.discarded.quote).toBe(1);
  });
  it("rollordet: konflikt, saknas, och Nämnd utan ord", () => {
    const text = "Peggy Boko är vår favorit. Peacekeeper kan gå bra. Baron Tilly ska med.";
    const r = validateTips(
      [
        tip({ leg: 6, number: 3, horseName: "Peggy Boko", role: "SPIK", roleWord: "favorit", quote: "Peggy Boko är vår favorit." }),
        tip({ leg: 5, number: 2, horseName: "Peacekeeper", role: "SKRALL", roleWord: null, quote: "Peacekeeper kan gå bra." }),
        tip({ leg: 4, number: 1, horseName: "Baron Tilly", role: "NAMND", roleWord: null, quote: "Baron Tilly ska med." }),
      ],
      text,
      BJERKE,
      [],
    );
    expect(byName(r.tips, "Peggy Boko").flags).toEqual(["ROLE_CONFLICT"]);
    expect(byName(r.tips, "Peacekeeper").flags).toEqual(["ROLE_WORD_MISSING"]);
    expect(byName(r.tips, "Baron Tilly")).toMatchObject({ flags: [], match: "SURE" });
  });
  it("citat utan hästens namn flaggas, men namnets längsta ord räcker", () => {
    const text = "Hon är vårt lås, Peggy. Den här valacken är vår spik.";
    const r = validateTips(
      [
        tip({ leg: 6, number: 3, horseName: "Peggy Boko", role: "SPIK", roleWord: "lås", quote: "Hon är vårt lås, Peggy" }),
        tip({ leg: 2, number: 2, horseName: "Gigant Tider", role: "SPIK", roleWord: "spik", quote: "Den här valacken är vår spik." }),
      ],
      text,
      BJERKE,
      [],
    );
    expect(byName(r.tips, "Peggy Boko")).toMatchObject({ flags: [], match: "SURE" });
    expect(byName(r.tips, "Gigant Tider")).toMatchObject({ flags: ["QUOTE_NO_NAME"], match: "UNSURE" });
  });
  it("samma häst två gånger: Spik behålls, Nämnd kastas", () => {
    const text = "Peggy Boko nämns. Peggy Boko är vår spik.";
    const r = validateTips(
      [tip({ leg: 6, number: 3, horseName: "Peggy Boko", role: "NAMND", quote: "Peggy Boko nämns." }), tip({ leg: 6, number: 3, horseName: "Peggy Boko", role: "SPIK", roleWord: "spik", quote: "Peggy Boko är vår spik." })],
      text,
      BJERKE,
      [],
    );
    expect(r.tips).toHaveLength(1);
    expect(r.tips[0].role).toBe("SPIK");
    expect(r.discarded.duplicate).toBe(1);
  });
  it("61 poster: 60 sparas och 1 räknas som överskott", () => {
    const names = Array.from({ length: 61 }, (_, i) => `Okänd Häst ${i + 1}`);
    const text = names.map((n) => `${n} nämns här.`).join(" ");
    const r = validateTips(names.map((n) => tip({ horseName: n, role: "NAMND", quote: `${n} nämns här.` })), text, BJERKE, []);
    expect(r.tips).toHaveLength(60);
    expect(r.discarded.overflow).toBe(1);
  });
  it("tips i en avdelning som har startat sparas inte", () => {
    const raw = JSON.parse(read("tips-ai/99f554a8abbe.json"));
    const r = validateTips(raw, SYNT, BJERKE, [1, 2]);
    expect(r.skippedStarted).toBe(2);
    expect(r.tips.map((t) => t.rawHorseName)).not.toContain("Fly Express");
  });
  it("trasigt.json kastas helt utan undantag, och okänd form ger en tom lista", () => {
    expect(validateTips(JSON.parse(read("tips-ai/trasigt.json")), SYNT, BJERKE, [])).toEqual({ tips: [], discarded: { shape: 1, quote: 0, duplicate: 0, overflow: 0 }, skippedStarted: 0 });
    expect(validateTips("skräp", SYNT, BJERKE, []).tips).toEqual([]);
    expect(validateTips({ tips: [tip({ horseName: "X".repeat(61), role: "SPIK", quote: "1234567890" })] }, SYNT, BJERKE, []).discarded.shape).toBe(1);
  });
  it("Travstugans artikel med fixtur-AI-svaret: alla citat finns i texten, 5 säkra och 3 osäkra", () => {
    const real = text("tidiga-v85-baronen-ar-guldet");
    const game = JSON.parse(read("atg/game-V85_2026-10-31_78_5-foreign.json")) as { races: { starts: { number: number; horse: { name: string }; scratched?: boolean }[] }[] };
    const starts: StartRef[] = game.races.flatMap((r, i) => r.starts.map((s) => ({ startId: `${i + 1}_${s.number}`, leg: i + 1, number: s.number, name: s.horse.name, scratched: !!s.scratched })));
    const r = validateTips(JSON.parse(read("tips-ai/0628f8a69675.json")), real, starts, []);
    expect(r.discarded).toEqual({ shape: 0, quote: 0, duplicate: 0, overflow: 0 });
    expect(r.tips.every((t) => normQuote(real).includes(normQuote(t.quote)))).toBe(true);
    expect(r.tips.filter((t) => t.match === "SURE").map((t) => t.rawHorseName).sort()).toEqual(["Gigant Tider", "Jaguar Godiva", "Mimosa To Martini", "Peacekeeper", "Peggy Boko"]);
    expect(byName(r.tips, "Baron Tilly").flags).toEqual(["ROLE_WORD_UNKNOWN"]);
    expect(byName(r.tips, "Blizzard Diamant").flags).toEqual(["ROLE_WORD_MISSING"]);
    expect(byName(r.tips, "Fly Express").flags).toEqual(["ROLE_WORD_UNKNOWN"]);
  });
});

describe("flagText och flagShort", () => {
  const base = { rawHorseName: "Mellby Harly", role: "SKRALL" as const, roleWord: "favorit", leg: 2, number: 7, start: { leg: 3, number: 5, name: "Mellby Harley" }, suggestion: null };
  it.each([
    [["NAME_SPELLING"], 'Namnet stavas "Mellby Harly" i artikeln. Kopplat till 5 Mellby Harley.', 'Stavas "Mellby Harly"'],
    [["NUMBER_MISMATCH"], "Artikeln säger nr 7, men Mellby Harley har nr 5 i avd 3.", "Annat nummer"],
    [["LEG_MISMATCH"], "Artikeln säger avd 2, men Mellby Harley går i avd 3.", "Annan avd"],
    [["NAME_MISMATCH"], 'Artikeln säger "Mellby Harly", men nr 5 i avd 3 heter Mellby Harley.', "Annat namn"],
    [["SCRATCHED", "ROLE_CONFLICT"], 'Osäker roll: "favorit" tolkades som Skräll.', "Osäker roll"],
    [["NO_MATCH"], "Kunde inte kopplas till en häst i omgången.", "Ej kopplad"],
    [[], null, null],
  ])("%j", (flags, text, short) => {
    expect(flagText({ ...base, flags })).toBe(text);
    expect(flagShort({ ...base, flags })).toBe(short);
  });
});
