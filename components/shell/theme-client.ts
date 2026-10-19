// Temat i webbläsaren (DESIGN.md Färger). Samma nyckel och attribut som
// skriptet i app/layout.tsx (lib/theme.ts), så att valet gäller från första
// ritningen vid nästa sidladdning.

import { THEME_COLORS, THEME_STORAGE_KEY, parseStoredTheme, resolveTheme, type ThemeChoice } from "@/lib/theme";

export function readThemeChoice(): ThemeChoice {
  try {
    return parseStoredTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

const systemDark = () => {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
};

export function applyTheme(choice: ThemeChoice, persist = true) {
  if (persist) {
    try {
      if (choice === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, choice);
    } catch {
      // Blockerad lagring: valet gäller tills sidan laddas om.
    }
  }
  const theme = resolveTheme(choice, systemDark());
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-theme-choice", choice);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}
