// X-faktorn i gränssnittet (specen 6.8, E2.1): texterna och de små beslut
// som S2, S3, S4, S6a och S10 delar. Rena funktioner utan React, testade i
// lib/xfactor-ui.test.ts. Beräkningen av riktoddset med X-faktor ligger i
// lib/xfactor.ts och är densamma som på servern.

import { odds } from "@/lib/format";
import type { MarkChange } from "@/lib/marks";
import { forslag } from "@/lib/spelbar";
import type { MarkDto, StartDto } from "@/lib/types";
import { riktoddsX, X_FACTOR_MAX, X_FACTOR_MIN, type XFactor, type XFactorSettings } from "@/lib/xfactor";

// Hästens läge. Utan Mark, eller med ett cachat svar från före E2.1, är
// läget Ingen (12, "Utan Mark …").
export const xOf = (m: Partial<Pick<MarkDto, "xFactor">> | null | undefined): XFactor => m?.xFactor ?? "NONE";

// Riktoddset som förslaget räknas mot: med X-faktor när hästen har X, annars
// det vanliga. Serverns (eller utkorgens) beräknade värde används i första hand.
export function riktX(s: Pick<StartDto, "riktodds" | "mark">, factors?: XFactorSettings): number | null {
  const x = xOf(s.mark);
  if (x === "NONE" || s.riktodds === null) return s.riktodds;
  if (factors) return riktoddsX(s.riktodds, x, factors);
  return s.mark?.riktoddsX ?? s.riktodds;
}

// Skärmläsartext och title i S2: "Riktodds 3,00, med X-faktor 2,40".
export function riktLabel(riktodds: number, x: XFactor, rx: number | null): string {
  if (x === "NONE" || rx === null) return `Riktodds ${odds(riktodds)}`;
  return `Riktodds ${odds(riktodds)}, med X-faktor ${odds(rx)}`;
}

// Kort form i sammanfattningsarket (S4) och S6a mobil: "rikt 3,00 → X 2,40".
export function riktShort(riktodds: number | null, x: XFactor, rx: number | null): string {
  if (x === "NONE" || riktodds === null || rx === null) return `rikt ${odds(riktodds)}`;
  return `rikt ${odds(riktodds)} → X ${odds(rx)}`;
}

// Effektraden under lägesväljaren i hästkortet:
// "Riktodds 3,00 · med X-faktor 2,40", och om det senaste bytet (prev → x)
// ändrade förslaget " · nu föreslagen som Spelbar" / " · inte längre föreslagen".
// null för Ingen (raden visas inte).
export function xEffectText(m: { riktodds: number | null; unibetOdds: number | null; x: XFactor; prev: XFactor | null; factors: XFactorSettings }): string | null {
  if (m.x === "NONE") return null;
  if (m.riktodds === null) return "Riktodds saknas. X-faktorn används när riktoddset finns.";
  const rx = riktoddsX(m.riktodds, m.x, m.factors);
  let text = `Riktodds ${odds(m.riktodds)} · med X-faktor ${odds(rx)}`;
  if (m.prev !== null && m.prev !== m.x) {
    // Tror på och Stark känsla tänder Intressant, så förslaget räknas med Intressant.
    const before = forslag({ interesting: true, unibetOdds: m.unibetOdds, riktodds: riktoddsX(m.riktodds, m.prev, m.factors) });
    const after = forslag({ interesting: true, unibetOdds: m.unibetOdds, riktodds: rx });
    if (after && !before) text += " · nu föreslagen som Spelbar";
    else if (!after && before) text += " · inte längre föreslagen";
  }
  return text;
}

// Toasten när Intressant släcks (6.1 och 6.8) och kroppen som Ångra skickar:
// en enda PUT med interesting: true, tidigare Spelbar och tidigare X-faktor.
// null när inget annat än Intressant försvann.
export function uninterestingUndo(m: Pick<MarkDto, "spelbar" | "spelbarOverride"> & Partial<Pick<MarkDto, "xFactor">>): { text: string; undo: MarkChange } | null {
  const x = xOf(m);
  const lostX = x !== "NONE";
  const lostS = m.spelbar;
  if (!lostX && !lostS) return null;
  const undo: MarkChange = { interesting: true };
  if (lostX) undo.xFactor = x;
  if (m.spelbarOverride === "ON") undo.spelbar = "on";
  else if (m.spelbarOverride === "OFF") undo.spelbar = "off";
  const text = lostX && lostS ? "Spelbar och X-faktor togs också bort" : lostX ? "X-faktor togs också bort" : "Spelbar togs också bort";
  return { text, undo };
}

// Fälten för faktorerna i S10: "1,25" → 1.25. null = ogiltigt (1,05–3,00,
// högst två decimaler).
export function parseFactorText(text: string): number | null {
  const t = text.replace(/\s/g, "").replace(",", ".");
  if (!/^\d(\.\d{1,2})?$/.test(t)) return null;
  const n = Math.round(Number(t) * 100) / 100;
  return n >= X_FACTOR_MIN && n <= X_FACTOR_MAX ? n : null;
}
