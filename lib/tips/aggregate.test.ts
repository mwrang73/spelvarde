import { describe, expect, it } from "vitest";
import { compareOrder, resolveSupersede, roundTipCounts, startTipSummary, type SummaryTip } from "@/lib/tips/aggregate";

const early = { id: "a", createdAt: new Date("2026-10-27T10:00:00Z"), articlePublishedAt: new Date("2026-10-27T07:30:00Z"), articleFirstSeenAt: new Date("2026-10-27T10:00:00Z") };
const final = { id: "b", createdAt: new Date("2026-10-30T10:00:00Z"), articlePublishedAt: new Date("2026-10-30T07:30:00Z"), articleFirstSeenAt: new Date("2026-10-30T10:00:00Z") };
const t = (o: Partial<SummaryTip>): SummaryTip => ({ sourceId: "ts", role: "SPIK", review: "APPROVED", supersededById: null, startId: "s1", sourceEnabled: true, ...o });

describe("ersatt roll och källstöd (6.11)", () => {
  it("godkänd Skräll från tidiga, sedan Nämnd från slutliga: Nämnd gäller, support 0 och sources 1", () => {
    expect(resolveSupersede(final, early)).toEqual({ kind: "replaces", supersededId: "a" });
    expect(startTipSummary([t({ role: "SKRALL", supersededById: "b" }), t({ role: "NAMND" })])).toEqual({ role: "NAMND", sources: 1, support: 0 });
  });
  it("omvänd ordning: den tidiga blir historik direkt", () => expect(resolveSupersede(early, final)).toEqual({ kind: "older", currentId: "b" }));
  it("inget gällande: inget ersätts", () => expect(resolveSupersede(early, null)).toEqual({ kind: "none" }));
  it("publiceringstid saknas: firstSeenAt avgör, sedan createdAt", () => {
    const x = { ...early, articlePublishedAt: null };
    expect(compareOrder(final, x)).toBeGreaterThan(0);
    expect(compareOrder({ ...early, id: "c", createdAt: new Date("2026-10-27T10:00:01Z") }, early)).toBeGreaterThan(0);
  });
  it("ta bort det gällande: det ersatta gäller igen (summan räknas om)", () => {
    expect(startTipSummary([t({ role: "SKRALL" })])).toEqual({ role: "SKRALL", sources: 1, support: 1 });
  });
  it("två källor med Spik och Favorit, och en avstängd", () => {
    const two = [t({ role: "SPIK" }), t({ sourceId: "tc", role: "FAVORIT" })];
    expect(startTipSummary(two)).toEqual({ role: "SPIK", sources: 2, support: 2 });
    expect(startTipSummary([two[0], { ...two[1], sourceEnabled: false }])).toEqual({ role: "SPIK", sources: 1, support: 1 });
  });
  it("Avrådan räknas inte i support, väntande räknas inte alls", () => {
    expect(startTipSummary([t({ role: "AVRADAN" })])).toEqual({ role: "AVRADAN", sources: 1, support: 0 });
    expect(startTipSummary([t({ review: "PENDING" })])).toBeNull();
  });
  it("antalen för omgången", () => {
    const c = roundTipCounts([
      { review: "PENDING", match: "SURE", startId: "s1", supersededById: null, locked: false },
      { review: "PENDING", match: "UNSURE", startId: "s2", supersededById: null, locked: false },
      { review: "PENDING", match: "NONE", startId: null, supersededById: null, locked: false },
      { review: "PENDING", match: "SURE", startId: "s3", supersededById: "x", locked: false },
      { review: "PENDING", match: "SURE", startId: "s4", supersededById: null, locked: true },
      { review: "APPROVED", match: "SURE", startId: "s5", supersededById: null, locked: false },
      { review: "APPROVED", match: "SURE", startId: "s5", supersededById: null, locked: false, sourceEnabled: true },
      { review: "APPROVED", match: "SURE", startId: "s6", supersededById: "y", locked: false },
    ]);
    expect(c).toEqual({ pending: 3, pendingSure: 1, pendingUnsure: 2, approved: 2, approvedHorses: 1 });
  });
});
