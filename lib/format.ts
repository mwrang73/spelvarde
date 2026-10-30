// Visning av tal, tider och hästuppgifter på svenska (DESIGN.md, Typografi).
// Rena funktioner utan DOM, används av komponenterna och testas i
// lib/format.test.ts. All tid i Europe/Stockholm.

import { addDaysToDateString, stockholmDateString, stockholmParts } from "@/lib/stockholm-time";
import type { StartMethod } from "@/lib/types";

const pad = (n: number) => String(n).padStart(2, "0");
const NBSP = " ";
export const MINUS = "−";

// 12.2 → "12,2 %" (en decimal). null → "–".
export function pct(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return `${value.toFixed(decimals).replace(".", ",")}${NBSP}%`;
}

// 3.1 → "3,10". null → "–".
export function odds(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return value.toFixed(2).replace(".", ",");
}

// 2787330 → "2 787 330" med hårt mellanslag.
export function thousands(value: number): string {
  const s = String(Math.round(Math.abs(value)));
  const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return value < 0 ? `${MINUS}${grouped}` : grouped;
}

export function kr(value: number): string {
  return `${thousands(value)}${NBSP}kr`;
}

// Vinstsumma utan enhet, avrundad till hela tusental: "850", "448 000",
// "5 386 000". null → "–". I löptext skrivs "kr" efter.
export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return thousands(value < 1000 ? value : Math.round(value / 1000) * 1000);
}

// "15:00"
export function hhmm(iso: string | Date): string {
  const p = stockholmParts(typeof iso === "string" ? new Date(iso) : iso);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

// Relativ tid som i Tabellgissningen: "i dag 14:05", "i går 21:00",
// "sön 21:14" (inom en vecka bakåt) och annars "fre 23 okt 21:00".
export function relTime(iso: string | Date, now: Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const p = stockholmParts(d);
  const time = `${pad(p.hour)}:${pad(p.minute)}`;
  const day = stockholmDateString(d);
  const today = stockholmDateString(now);
  if (day === today) return `i dag ${time}`;
  if (day === addDaysToDateString(today, -1)) return `i går ${time}`;
  if (day > addDaysToDateString(today, -7) && day < today) return `${p.weekdayShort} ${time}`;
  return `${p.weekdayShort} ${p.day} ${p.monthShort} ${time}`;
}

// "2026-10-24" → "lör 24 okt"
export function dayDate(date: string): string {
  const p = stockholmParts(new Date(`${date}T12:00:00Z`));
  return `${p.weekdayShort} ${p.day} ${p.monthShort}`;
}

// "2026-09-13" → "13 sep"
export function shortDay(date: string): string {
  const p = stockholmParts(new Date(`${date}T12:00:00Z`));
  return `${p.day} ${p.monthShort}`;
}

export function methodLabel(m: StartMethod | null | undefined): string {
  return m === "VOLTE" ? "volte" : m === "AUTO" ? "auto" : "";
}

// "2140 a" / "2140 v"
export function distShort(distance: number | null, method: StartMethod | null): string {
  if (!distance) return "–";
  return `${distance}${method ? ` ${method === "VOLTE" ? "v" : "a"}` : ""}`;
}

const SEX: Record<string, string> = { stallion: "hingst", mare: "sto", gelding: "valack" };

export function sexLabel(sex: string | null | undefined): string {
  if (!sex) return "";
  return SEX[sex.toLowerCase()] ?? sex;
}

// "7 år hingst"
export function ageSex(age: number | null, sex: string | null): string {
  return [age ? `${age} år` : "", sexLabel(sex)].filter(Boolean).join(" ");
}

// Ett långt ATG-loppnamn kortat för täta rader: parenteser ("(Försök 2 i
// Meeting 7 …)", "(Gr. II Int.)") och "Spårtrappa" tas bort. Klassen står
// ändå som chip. Resten kortas med ellipsis i CSS, och title har hela namnet.
export function shortRaceName(name: string): string {
  const cut = name
    .replace(/\s*\([^)]*\)/g, "")
    .split(" - ")
    .map((p) => p.trim())
    .filter((p) => p && p !== "Spårtrappa")
    .join(" – ");
  return cut || name;
}

// Plural för räknare: plural(2, "strykning", "strykningar").
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// "Ändrat sedan förra hämtningen: 2 strykningar, 1 kuskbyte". null utan ändringar.
export function changesSummary(changes: { scratched: unknown[]; driverChanges: unknown[] } | null | undefined): string | null {
  if (!changes) return null;
  const parts: string[] = [];
  if (changes.scratched.length) parts.push(plural(changes.scratched.length, "strykning", "strykningar"));
  if (changes.driverChanges.length) parts.push(plural(changes.driverChanges.length, "kuskbyte", "kuskbyten"));
  return parts.length ? parts.join(", ") : null;
}

// Placering i formtabellen: "1"–"9", "0" (oplacerad), "d" eller "g".
export function placeChar(r: { place: number | null; galloped: boolean; disqualified: boolean }): string {
  if (r.disqualified) return "d";
  if (r.place !== null && r.place >= 1 && r.place <= 9) return String(r.place);
  if (r.galloped) return "g";
  return "0";
}

// Skärmläsartext för placeringen ovan.
export function placeLabel(r: { place: number | null; galloped: boolean; disqualified: boolean }): string {
  const base = r.disqualified ? "diskad" : r.place !== null && r.place >= 1 && r.place <= 9 ? `${r.place}:a` : "oplacerad";
  return r.galloped ? `galopp, ${base}` : base;
}

export function ordinal(n: number): string {
  const last = n % 10;
  const lastTwo = n % 100;
  return `${n}:${(last === 1 || last === 2) && lastTwo !== 11 && lastTwo !== 12 ? "a" : "e"}`;
}
