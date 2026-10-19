import { describe, expect, it } from "vitest";
import { createThrottle } from "@/lib/login-throttle";

describe("inloggningsspärr", () => {
  it("spärrar efter max försök inom fönstret och släpper sedan", () => {
    const t = createThrottle(3, 1000);
    for (let i = 0; i < 3; i++) t.fail("a", 0);
    expect(t.blocked("a", 500)).toBe(true);
    expect(t.blocked("b", 500)).toBe(false);
    expect(t.blocked("a", 1500)).toBe(false);
    t.fail("a", 1500);
    t.reset("a");
    expect(t.blocked("a", 1500)).toBe(false);
  });
});
