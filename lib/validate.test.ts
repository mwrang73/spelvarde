import { describe, expect, it } from "vitest";
import { isUuid, normalizeSourceUrl, parseCommentBody, parseReviewBody, parseSettingsBody, parseSourceName, parseSourcePatch, SOURCE_URL_ERROR } from "@/lib/validate";

const H = "c" + "a".repeat(24);
describe("validering", () => {
  it("review", () => {
    expect(parseReviewBody({ reviewed: true, noneInteresting: true })).toEqual({ ok: true, value: { reviewed: true, noneInteresting: true } });
    expect(parseReviewBody({ reviewed: false, noneInteresting: true })).toEqual({ ok: true, value: { reviewed: false, noneInteresting: false } });
    expect(parseReviewBody({}).ok).toBe(false);
  });
  it("kommentar", () => {
    expect(parseCommentBody({ horseId: H, kind: "NOTE", tags: ["Galopp", "Galopp"], text: "Bra" })).toEqual({ ok: true, value: { horseId: H, startId: null, roundId: null, kind: "NOTE", tags: ["Galopp"], text: "Bra" } });
    expect(parseCommentBody({ horseId: "x" }).ok).toBe(false);
    expect(parseCommentBody({ horseId: H, kind: "RACE" }).ok).toBe(false);
    expect(parseCommentBody({ horseId: H, text: "x".repeat(4001) }).ok).toBe(false);
    expect(parseCommentBody({ horseId: H, tags: Array(21).fill("a") }).ok).toBe(false);
    expect(isUuid("3b241101-e2bb-4255-8caf-4136c566a962")).toBe(true);
    expect(isUuid("../../etc")).toBe(false);
  });
  it("inställningar: tema, radpris och riktlinje (larmgränsen kommer i E3)", () => {
    expect(parseSettingsBody({ theme: "dark" })).toEqual({ ok: true, value: { theme: "dark" } });
    expect(parseSettingsBody({ theme: "blå" }).ok).toBe(false);
    expect(parseSettingsBody({ theme: "dark", rowPrice: 1 })).toEqual({ ok: true, value: { theme: "dark", rowPrice: 1 } });
    expect(parseSettingsBody({ spelbarGuideline: 2.1 })).toEqual({ ok: true, value: { spelbarGuideline: 2.1 } });
    expect(parseSettingsBody({ spelbarGuideline: 1 }).ok).toBe(false);
    expect(parseSettingsBody({ rowPrice: 0 }).ok).toBe(false);
    expect(parseSettingsBody({ rowPrice: 0.555 }).ok).toBe(false);
    expect(parseSettingsBody({ rushThresholdPe: 12 }).ok).toBe(false);
    expect(parseSettingsBody({}).ok).toBe(false);
    expect(parseSettingsBody({ userId: "x" }).ok).toBe(false);
  });
  it("inställningar: X-faktorerna 1,05–3,00 (E2.1)", () => {
    expect(parseSettingsBody({ xFactorTror: 1.3, xFactorStark: 1.6 })).toEqual({ ok: true, value: { xFactorTror: 1.3, xFactorStark: 1.6 } });
    expect(parseSettingsBody({ xFactorTror: 1.05 }).ok).toBe(true);
    expect(parseSettingsBody({ xFactorStark: 3 }).ok).toBe(true);
    for (const bad of [1.04, 3.01, 1.255, "1,25", null]) expect(parseSettingsBody({ xFactorTror: bad })).toEqual({ ok: false, error: "Faktorn ska ligga mellan 1,05 och 3,00." });
  });
  it("källor: bara https, inga interna adresser", () => {
    expect(normalizeSourceUrl("https://www.travronden.se/v85#x")).toEqual({ ok: true, value: "https://www.travronden.se/v85" });
    for (const bad of ["http://travronden.se", "travronden.se", "https://localhost/x", "https://10.0.0.1/", "https://user:pw@site.se/", "javascript:alert(1)", 42]) {
      expect(normalizeSourceUrl(bad)).toEqual({ ok: false, error: SOURCE_URL_ERROR });
    }
    expect(parseSourceName(undefined, "https://www.atg.se/x")).toEqual({ ok: true, value: "atg.se" });
    expect(parseSourcePatch({ enabled: false })).toEqual({ ok: true, value: { enabled: false } });
    expect(parseSourcePatch({}).ok).toBe(false);
  });
});
