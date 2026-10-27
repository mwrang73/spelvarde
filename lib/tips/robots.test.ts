import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isAllowed } from "@/lib/tips/robots";

const UA = "Spelvärde (privat bruk)";

describe("robots.txt (10.6)", () => {
  it("Disallow: / för * ger nej", () => expect(isAllowed("User-agent: *\nDisallow: /", "/v85", UA)).toBe(false));
  it("Allow: /v85 före ger ja för /v85, nej för annat", () => {
    const txt = "User-agent: *\nAllow: /v85\nDisallow: /";
    expect(isAllowed(txt, "/v85", UA)).toBe(true);
    expect(isAllowed(txt, "/v86", UA)).toBe(false);
  });
  it("tom fil eller saknad fil ger ja", () => {
    expect(isAllowed("", "/v85", UA)).toBe(true);
    expect(isAllowed(null, "/v85", UA)).toBe(true);
  });
  it("en sektion för Spelvärde går före *", () => {
    const txt = "User-agent: *\nDisallow:\n\nUser-agent: Spelvärde\nDisallow: /";
    expect(isAllowed(txt, "/v85", UA)).toBe(false);
    expect(isAllowed(txt, "/v85", "Annan")).toBe(true);
  });
  it("Travstugans robots.txt tillåter samlingssidan och artiklarna", () => {
    const txt = readFileSync(path.join(__dirname, "..", "..", "test", "fixtures", "travstugan", "robots.txt"), "utf8");
    expect(isAllowed(txt, "/v85", UA)).toBe(true);
    expect(isAllowed(txt, "/tidiga-v85-baronen-ar-guldet", UA)).toBe(true);
    expect(isAllowed(txt, "/hamta/x", UA)).toBe(false);
  });
  it("* och $ i mönstret", () => {
    expect(isAllowed("User-agent: *\nDisallow: /*.pdf$", "/a/b.pdf", UA)).toBe(false);
    expect(isAllowed("User-agent: *\nDisallow: /*.pdf$", "/a/b.pdf?x=1", UA)).toBe(true);
  });
});
