import { describe, expect, it } from "vitest";
import { aiSettings, costUsd, dayStart, nextDayStart } from "@/lib/tips/quota";

describe("dygnsgränsen (6.11)", () => {
  it("dygnsstarten efter sommartidsbytet 2026-10-25", () => {
    expect(dayStart(new Date("2026-10-25T01:30:00Z")).toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(nextDayStart(new Date("2026-10-25T01:30:00Z")).toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });
  it("00:00 svensk tid, sommar och vinter", () => {
    expect(dayStart(new Date("2026-10-27T22:59:00Z")).toISOString()).toBe("2026-10-26T23:00:00.000Z");
    expect(dayStart(new Date("2026-10-27T23:00:00Z")).toISOString()).toBe("2026-10-27T23:00:00.000Z");
    expect(nextDayStart(new Date("2026-07-01T10:00:00Z")).toISOString()).toBe("2026-07-01T22:00:00.000Z");
  });
  it("kostnaden", () => {
    expect(costUsd(10_000, 1_000, 3, 15)).toBe(0.045);
    expect(costUsd(9_000, 800, 3, 15)).toBe(0.039);
  });
  it("gränsen och priserna ur miljön", () => {
    expect(aiSettings({})).toEqual({ limit: 20, priceIn: 3, priceOut: 15 });
    expect(aiSettings({ SPELVARDE_AI_DAILY_LIMIT: "5", ANTHROPIC_PRICE_IN_PER_MTOK: "2.5", ANTHROPIC_PRICE_OUT_PER_MTOK: "x" })).toEqual({ limit: 5, priceIn: 2.5, priceOut: 15 });
  });
});
