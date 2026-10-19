import { describe, expect, it } from "vitest";
import { addDaysToDateString, parseAtgTime, stockholmDateString } from "@/lib/stockholm-time";

describe("svensk tid", () => {
  it("ATG-tider utan tidszon är svensk tid, över sommar- och vintertid", () => {
    expect(parseAtgTime("2026-10-24T15:00:00")!.toISOString()).toBe("2026-10-24T13:00:00.000Z");
    expect(parseAtgTime("2026-10-31T15:00:00")!.toISOString()).toBe("2026-10-31T14:00:00.000Z");
    expect(parseAtgTime("2026-10-17T15:00:43")!.toISOString()).toBe("2026-10-17T13:00:43.000Z");
    expect(parseAtgTime("2026-10-24T13:00:00Z")!.toISOString()).toBe("2026-10-24T13:00:00.000Z");
    expect(parseAtgTime("nej")).toBeNull();
    expect(parseAtgTime(undefined)).toBeNull();
  });
  it("datumsträngar", () => {
    expect(stockholmDateString(new Date("2026-10-24T22:30:00Z"))).toBe("2026-10-25");
    expect(addDaysToDateString("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDaysToDateString("2026-10-24", -2)).toBe("2026-10-22");
  });
});
