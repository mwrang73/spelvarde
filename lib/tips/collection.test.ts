import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dateTokens, findArticleLinks, gameTypeRegex, isRelevant, readerFor } from "@/lib/tips/collection";
import { extractArticle } from "@/lib/tips/text";

const FX = path.join(__dirname, "..", "..", "test", "fixtures");
const html = (f: string) => readFileSync(path.join(FX, "travstugan", f), "utf8");
const round = { gameType: "V85", trackName: "Bjerke", date: "2026-10-31" };
// Omgångens hästar ur ATG-fixturen för Bjerke 31 okt.
const game = JSON.parse(readFileSync(path.join(FX, "atg", "game-V85_2026-10-31_78_5-foreign.json"), "utf8")) as { races: { starts: { horse: { name: string } }[] }[] };
const horses = game.races.flatMap((r) => r.starts.map((s) => s.horse.name));
const now = new Date("2026-10-27T21:00:00Z");
const article = (f: string) => {
  const r = extractArticle(html(f), `https://travstugan.se/${f.replace(/\.html$/, "")}`);
  if (!r.ok) throw new Error(r.error);
  return r.article;
};

describe("findArticleLinks (10.6)", () => {
  it("riktiga v85.html: V85-artiklar i sidans ordning, utan taggsidor och utan samlingssidan", () => {
    const links = findArticleLinks(html("v85.html"), "https://travstugan.se/v85", round);
    expect(links.length).toBeGreaterThan(0);
    expect(links.length).toBeLessThanOrEqual(8);
    expect(links[0]).toEqual({ url: "https://travstugan.se/tidiga-v85-baronen-ar-guldet", title: "TIDIGA V85: Baronen är Guldet!?" });
    expect(links.map((l) => l.url)).not.toContain("https://travstugan.se/v85");
    expect(links.some((l) => /\/(author|tag|kategori)\//.test(l.url))).toBe(false);
    expect(links.every((l) => /v85/i.test(l.url + l.title))).toBe(true);
    expect(new Set(links.map((l) => l.url)).size).toBe(links.length);
  });
  it("utan V85 i länkarna: länkar med banans namn eller datumet", () => {
    const page = `<a href="/nyheter/bjerke-infor-lordag">Inför helgen</a><a href="/annat">Annat</a><a href="/tag/bjerke">Tagg</a><a href="https://annan.se/bjerke">Extern</a>`;
    expect(findArticleLinks(page, "https://travstugan.se/v85", round)).toEqual([{ url: "https://travstugan.se/nyheter/bjerke-infor-lordag", title: "Inför helgen" }]);
  });
  it("spelformens skrivsätt", () => {
    const re = gameTypeRegex("V85");
    for (const s of ["V85", "v85", "V 85", "v-85", "tidiga-v85-baronen"]) expect(re.test(s)).toBe(true);
    for (const s of ["V850", "v86", "XV85A"]) expect(re.test(s)).toBe(false);
    expect(gameTypeRegex("GS75").test("gs-75 tips")).toBe(true);
  });
  it("läsaren väljs efter adressen", () => {
    expect(readerFor({ url: "https://travstugan.se/v85" })).toBe("COLLECTION");
    expect(readerFor({ url: "https://www.travcash.se/x" })).toBe("COLLECTION");
    expect(readerFor({ url: "https://example.se/tips" })).toBe("PAGE");
    expect(readerFor({ url: "https://travstugan.se/v85", kind: "PAGE" })).toBe("PAGE");
  });
});

describe("isRelevant (10.6)", () => {
  const r = { ...round, horses };
  it("veckans artikel ja", () => expect(isRelevant(article("tidiga-v85-baronen-ar-guldet.html"), r, now)).toMatchObject({ relevant: true, reason: null }));
  it("förra veckans artikel nej: nämner 0 av omgångens hästar", () =>
    expect(isRelevant(article("korrigering-pa-v85.html"), r, now)).toEqual({ relevant: false, reason: "nämner 0 av omgångens hästar", horses: 0 }));
  it("3 hästar men publicerad 10 dagar före nej", () => {
    const a = { title: "Bjerke", text: "Baron Tilly, Peacekeeper och Peggy Boko på Bjerke.", publishedAt: new Date("2026-10-21T10:00:00Z") };
    expect(isRelevant(a, r, now)).toMatchObject({ relevant: false, reason: "publicerad för mer än 7 dagar sedan" });
  });
  it("rätt hästar men varken bana, datum eller V85 nej", () => {
    const a = { title: "Hästarna", text: "Baron Tilly, Peacekeeper och Peggy Boko är bra.", publishedAt: null };
    expect(isRelevant(a, r, now)).toMatchObject({ relevant: false, reason: "nämner inte bana, datum eller V85" });
  });
  it("dateTokens för lördag 31 oktober 2026", () => {
    expect(dateTokens("2026-10-31")).toEqual(expect.arrayContaining(["31 oktober", "31 okt", "31/10", "31.10", "2026-10-31", "lördag"]));
  });
});
