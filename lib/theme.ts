// Temat (DESIGN.md): valet light | dark | system sparas i localStorage under
// "sv-theme" och ska tåla blockerad lagring. Ren logik, ingen DOM.

export type ThemeChoice = "light" | "dark" | "system";
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "sv-theme";
// Webbläsarens fält runt sidan på mobilen: tavlans färg.
export const THEME_COLORS: Record<Theme, string> = { light: "#101317", dark: "#050607" };

export function parseStoredTheme(value: string | null | undefined): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): Theme {
  if (choice === "light" || choice === "dark") return choice;
  return systemPrefersDark ? "dark" : "light";
}

// Körs blockerande i <head> före första ritningen (app/layout.tsx), så att
// temat inte blinkar. Fast text utan data. Testas mot funktionerna ovan i
// lib/theme.test.ts. Går något fel visas ljust tema.
export const THEME_INIT_SCRIPT =
  `(function(){try{var d=document.documentElement,c="system",v=null;` +
  `try{v=window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}` +
  `if(v==="light"||v==="dark")c=v;var t=c;` +
  `if(c==="system"){t="light";try{if(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)t="dark"}catch(e){}}` +
  `d.setAttribute("data-theme",t);d.setAttribute("data-theme-choice",c);` +
  `var m=document.querySelector('meta[name="theme-color"]');` +
  `if(!m){m=document.createElement("meta");m.setAttribute("name","theme-color");document.head.appendChild(m)}` +
  `m.setAttribute("content",t==="dark"?${JSON.stringify(THEME_COLORS.dark)}:${JSON.stringify(THEME_COLORS.light)})` +
  `}catch(e){}})();`;
