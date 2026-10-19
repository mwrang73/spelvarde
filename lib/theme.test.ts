import { describe, expect, it } from "vitest";
import { THEME_COLORS, THEME_INIT_SCRIPT, THEME_STORAGE_KEY, parseStoredTheme, resolveTheme } from "@/lib/theme";

// Kör skriptet mot en minimal låtsas-DOM och jämför med de rena funktionerna.
function runScript(stored: string | null, dark: boolean, storageThrows = false) {
  const attrs: Record<string, string> = {};
  const meta: Record<string, string> = {};
  const doc = {
    documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) },
    querySelector: () => null,
    createElement: () => ({ setAttribute: (k: string, v: string) => (meta[k] = v) }),
    head: { appendChild: () => {} },
  };
  const win = {
    localStorage: { getItem: (k: string) => { if (storageThrows) throw new Error("blockerad"); return k === THEME_STORAGE_KEY ? stored : null; } },
    matchMedia: () => ({ matches: dark }),
  };
  new Function("document", "window", THEME_INIT_SCRIPT)(doc, win);
  return { attrs, meta };
}

describe("tema", () => {
  it("skriptet följer parseStoredTheme + resolveTheme", () => {
    for (const stored of [null, "light", "dark", "system", "skräp"]) {
      for (const dark of [false, true]) {
        const { attrs, meta } = runScript(stored, dark);
        const choice = parseStoredTheme(stored);
        expect(attrs["data-theme-choice"]).toBe(choice);
        expect(attrs["data-theme"]).toBe(resolveTheme(choice, dark));
        expect(meta.content).toBe(THEME_COLORS[resolveTheme(choice, dark)]);
      }
    }
  });
  it("tål blockerad lagring", () => {
    expect(runScript("dark", true, true).attrs["data-theme"]).toBe("dark");
    expect(runScript("dark", false, true).attrs["data-theme"]).toBe("light");
  });
});
