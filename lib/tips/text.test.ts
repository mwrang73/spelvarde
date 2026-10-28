import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractArticle, normalizeUrl, normQuote, stageOf, textHash, truncateAtParagraph } from "@/lib/tips/text";

const FX = path.join(__dirname, "..", "..", "test", "fixtures", "travstugan");
const html = (f: string) => readFileSync(path.join(FX, f), "utf8");

describe("extractArticle (10.6)", () => {
  it("syntetisk sida: titel utan sajtnamn, tid och brödtext utan meny, sidfot och delning", () => {
    const r = extractArticle(html("syntetisk-tidiga.html"), "https://travstugan.se/syntetisk-tidiga");
    if (!r.ok) throw new Error(r.error);
    expect(r.article.title).toBe("Tidiga V85: Baronen är guldet");
    expect(r.article.publishedAt?.toISOString()).toBe("2026-10-27T07:30:00.000Z");
    expect(r.article.url).toBe("https://travstugan.se/syntetisk-tidiga");
    for (const m of ["Veckans fynd är Fly Express.", "Gigant Tider är vår spik.", "Baron Tilly är starkast i loppet", "Skrällen: Peacekeeper", "Peggy Boko är ett lås i sexan.", "Blizzard Diamant är rättmätig favorit"]) expect(r.article.text).toContain(m);
    expect(r.article.text).not.toContain("Dela på Facebook");
    expect(r.article.text).not.toContain("Copyright");
    expect(r.article.text).not.toContain("Travskola");
    expect(r.article.text).not.toContain("Läs också");
    // Klassen "lead-in" är inte en annons.
    expect(r.article.text).toContain("Lördagens V85 körs på Bjerke");
  });
  it("Travstugans artikel: rubriken, tiden ur JSON-LD och texten ur .prose", () => {
    const r = extractArticle(html("tidiga-v85-baronen-ar-guldet.html"), "https://travstugan.se/tidiga-v85-baronen-ar-guldet");
    if (!r.ok) throw new Error(r.error);
    expect(r.article.title).toBe("TIDIGA V85: Baronen är Guldet!?");
    expect(r.article.publishedAt?.toISOString()).toBe("2026-10-27T13:55:00.000Z");
    expect(r.article.text).toContain("Ett norskt skrällbud i loppet är 2 Peacekeeper");
    expect(r.article.text).not.toMatch(/Casino|Cookiepolicy|Prenumerera/);
    expect(stageOf(r.article.title)).toBe("EARLY");
  });
  it("Travcash: små <article>-kort hoppas över, texten tas ur .post-single__body", () => {
    const r = extractArticle(html("travcash-v85-bjerke-tidiga.html"), "https://travcash.se/v85-tips/v85-tips-lordag-bjerke-31-10-tidiga-tankar/");
    if (!r.ok) throw new Error(r.error);
    expect(r.article.title).toContain("Bjerke 31/10");
    expect(r.article.publishedAt?.toISOString()).toBe("2026-10-26T12:39:02.000Z");
    expect(r.article.text).toContain("6 Sauron Zon har säkerligen gått framåt");
    expect(r.article.text).toContain("10 Hankypanky Leonie är troligtvis överlägsen");
    expect(r.article.text).not.toContain("review-card");
    expect(stageOf(r.article.title)).toBe("EARLY");
  });
  it("en sida med för lite text ger felet om inloggning", () => {
    expect(extractArticle(html("fem-tippar-v85-hemmastallet-i-slutet.html"), "https://travstugan.se/fem-tippar-v85-hemmastallet-i-slutet")).toEqual({
      ok: false,
      error: "artikeln innehöll för lite text, kanske kräver den inloggning.",
    });
    expect(extractArticle("<html><body><article><p>Kort.</p></article></body></html>", "https://x.se/a")).toMatchObject({ ok: false });
  });
  it("45 000 tecken kortas vid en styckegräns under 40 000", () => {
    const para = "Ett stycke om hästar. ".repeat(45) + "\n\n";
    const text = para.repeat(Math.ceil(45_000 / para.length));
    const r = truncateAtParagraph(text, 40_000);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(40_000);
    expect(r.text.endsWith("hästar.")).toBe(true);
    expect(truncateAtParagraph("kort", 40_000)).toEqual({ text: "kort", truncated: false });
    const page = `<html><body><article>${`<p>${"Lång text om travet. ".repeat(40)}</p>`.repeat(60)}</article></body></html>`;
    const ex = extractArticle(page, "https://x.se/a");
    expect(ex.ok && ex.article.truncated && ex.article.text.length <= 40_000).toBe(true);
  });
});

describe("normQuote och textHash", () => {
  it("citattecken, hårt mellanslag, tankstreck och ellips", () => {
    expect(normQuote("“lås”")).toBe(normQuote('"lås"'));
    expect(normQuote("spår 1")).toBe("spår 1");
    expect(normQuote("a – b — c")).toBe("a - b - c");
    expect(normQuote("så…")).toBe("så...");
    expect(normQuote("  rad\n\nny  ")).toBe("rad ny");
  });
  it("samma hash när bara blanksteg skiljer sig, olika när ett ord ändras", () => {
    expect(textHash("Peggy Boko är ett lås.\n\nI sexan.")).toBe(textHash("Peggy Boko  är ett lås. I sexan."));
    expect(textHash("Peggy Boko är ett lås.")).not.toBe(textHash("Peggy Boko är en spik."));
    expect(textHash("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("normalizeUrl", () => {
  it("tar bort #, utm_* och / sist men behåller andra parametrar", () => {
    expect(normalizeUrl("https://travstugan.se/v85/?utm_source=x&id=3&utm_medium=y#top")).toBe("https://travstugan.se/v85?id=3");
    expect(normalizeUrl("https://travstugan.se/")).toBe("https://travstugan.se");
    expect(normalizeUrl("http://travstugan.se/a")).toBe("https://travstugan.se/a");
  });
});
