import { describe, expect, it } from "vitest";
import { chainBanners, markWord, mmss, scanLockLeft, scanStepText, sourcesSub, tipsLine, unsureLine, type ChainOutcome } from "@/lib/tips-ui";
import type { RoundTipsDto, TipDto } from "@/lib/types";

const base: ChainOutcome = { sources: [{ sourceId: "s", name: "Travstugan", status: "ok" }], unchanged: 0, articles: [], waiting: 0, notConfigured: false, roundClosed: false, since: "i dag 21:14", roundLabel: "V85 Bjerke lör 31 okt" };
const t = (o: Partial<RoundTipsDto>): RoundTipsDto => ({ approved: 0, horses: 0, pending: 0, lastReadAt: null, lastSourceName: "Travstugan", sourcesRead: 1, ...o });

describe("markWord", () => {
  it("markerar första förekomsten skiftlägesokänsligt", () => {
    expect(markWord("Veckans Fynd är Fly Express. fynd", "fynd")).toEqual(["Veckans ", "Fynd", " är Fly Express. fynd"]);
    expect(markWord("Inget här", "spik")).toBeNull();
    expect(markWord("Text", null)).toBeNull();
  });
});

describe("banderollen", () => {
  it("nya tips med tillägg", () => {
    const b = chainBanners({ ...base, articles: [{ articleId: "a", title: "T", kind: "ok", created: 6, horses: ["1", "2", "3", "4", "5", "6"], unlinked: 1, discardedQuote: 2, truncated: true, cutOff: false }] });
    expect(b).toHaveLength(1);
    expect(b[0].tone).toBe("ok");
    expect(b[0].strong).toBe("6 tips på 6 hästar");
    expect(b[0].text).toContain("från 1 artikel. Granska dem innan de räknas.");
    expect(b[0].text).toContain("1 tips gäller en häst som inte kunde kopplas.");
    expect(b[0].text).toContain("2 tips kastades eftersom citatet inte fanns i texten.");
    expect(b[0].text).toContain("Artikeln var lång, och bara början lästes.");
  });
  it("inget nytt och ingen artikel", () => {
    expect(chainBanners({ ...base, unchanged: 1 })[0].strong).toBe("Inget nytt sedan i dag 21:14.");
    const none = chainBanners({ ...base, sources: [{ sourceId: "s", name: "Travstugan", status: "noArticle" }] })[0];
    expect(none.strong).toBe("Travstugan har ingen artikel om V85 Bjerke lör 31 okt än.");
  });
  it("AI-fel, dygnsgräns, saknad nyckel och alla källor fel", () => {
    const err = chainBanners({ ...base, articles: [{ articleId: "a", title: "X", kind: "failed", error: 'AI:n kunde inte tolka "X". Svaret gick inte att läsa. Försök igen räknas som en ny läsning.' }] })[0];
    expect(err).toMatchObject({ tone: "err", strong: 'AI:n kunde inte tolka "X".', retryArticleId: "a" });
    expect(chainBanners({ ...base, waiting: 2 })[0].text).toContain("2 artiklar väntar");
    expect(chainBanners({ ...base, notConfigured: true })[0].strong).toBe("Hämta tips är inte inställt.");
    expect(chainBanners({ ...base, sources: [{ sourceId: "s", name: "T", status: "error" }] })[0].strong).toBe("Ingen källa gick att läsa.");
  });
});

describe("tipsraden i S1", () => {
  it("godkända med att granska", () => {
    const l = tipsLine(t({ approved: 6, horses: 6, pending: 1 }), 1, false, "i dag 21:14")!;
    expect(l.strong).toBe("6");
    expect(l.rest).toBe(" på 6 hästar · Travstugan i dag 21:14");
    expect(l.links.map((x) => x.label)).toEqual(["1 att granska", "Hämta igen"]);
  });
  it("bara att granska, inga tips, klart och dold", () => {
    expect(tipsLine(t({ pending: 6 }), 1, false, null)!.links[0].label).toBe("Granska");
    expect(tipsLine(null, 1, false, null)!.lead).toBe("Tips: inga hämtade än");
    expect(tipsLine(t({ approved: 6, horses: 6, sourcesRead: 2 }), 1, true, "tis 21:14")!).toMatchObject({ rest: "6 på 6 hästar · 2 källor tis 21:14", links: [] });
    expect(tipsLine(null, 0, false, null)).toBeNull();
  });
});

describe("övrigt", () => {
  it("spärren gäller bara när alla påslagna är lästa nyss", () => {
    const now = Date.parse("2026-10-27T20:00:00Z");
    expect(scanLockLeft(["2026-10-27T19:59:30Z"], now)).toBe(30);
    expect(scanLockLeft(["2026-10-27T19:59:30Z", null], now)).toBe(0);
    expect(scanLockLeft(["2026-10-27T19:58:00Z"], now)).toBe(0);
    expect(mmss(45)).toBe("0:45");
  });
  it("texter", () => {
    expect(sourcesSub(1, "V85 Bjerke lör 31 okt")).toBe("1 påslagen källa · tips för V85 Bjerke lör 31 okt");
    expect(sourcesSub(3, null)).toBe("3 påslagna källor");
    expect(scanStepText("Travstugan", "ok", 1, 1)).toBe("Travstugan: 1 ny artikel");
    expect(scanStepText("Travstugan", "ok", 0, 1)).toBe("Travstugan: inget nytt");
    expect(scanStepText("Travstugan", "noArticle", 0, 0)).toBe("Travstugan: ingen artikel om omgången");
    const u = { horseName: "Fly Express", rawHorseName: "Fly Express", startLeg: 1, leg: 1 } as TipDto;
    expect(unsureLine([u], "V85")).toBe("1 osäkert tips väntar: Fly Express i V85-1");
    expect(unsureLine([u, u], "V85")).toBe("2 osäkra tips väntar.");
  });
});
