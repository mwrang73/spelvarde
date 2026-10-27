import { describe, expect, it } from "vitest";
import { countsAsSupport, ROLE_LABEL, roleOfWord, roleStrength, TIP_ROLES } from "@/lib/tips/roles";

describe("roller (6.11)", () => {
  it("orden ger rollen, normaliserat", () => {
    expect(roleOfWord("lås")).toBe("SPIK");
    expect(roleOfWord("  LÅSET ")).toBe("SPIK");
    expect(roleOfWord("starkast")).toBe("FAVORIT");
    expect(roleOfWord("given   vinnare")).toBe("FAVORIT");
    expect(roleOfWord("Skrällen")).toBe("SKRALL");
    expect(roleOfWord("lita inte")).toBe("AVRADAN");
    expect(roleOfWord("fynd")).toBeNull();
    expect(roleOfWord(null)).toBeNull();
  });
  it("starkast först och källstödet räknar Spik, Favorit och Skräll", () => {
    expect([...TIP_ROLES].sort((a, b) => roleStrength(a) - roleStrength(b))).toEqual(["SPIK", "FAVORIT", "SKRALL", "AVRADAN", "NAMND"]);
    expect(TIP_ROLES.filter(countsAsSupport)).toEqual(["SPIK", "FAVORIT", "SKRALL"]);
    expect(ROLE_LABEL.SKRALL).toBe("Skräll");
  });
});
