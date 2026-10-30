// Spårfördel: hästen startar från loppets statistiskt bästa spår för vinst (v),
// plats (p) eller båda (vp). Läser statistikraden, som redan räknar bort
// strukna hästar och bygger på Alla banor. Vill vi senare väga in banans eget
// bästa spår (trackBestWin, trackBestPlace) är det här det ändras.

import type { RaceStatsLine } from "@/lib/types";

export type PostEdge = "v" | "p" | "vp";

export function postEdge(line: Pick<RaceStatsLine, "bestNumber" | "bestPlace">, number: number): PostEdge | null {
  const v = line.bestNumber?.number === number;
  const p = line.bestPlace?.number === number;
  return v && p ? "vp" : v ? "v" : p ? "p" : null;
}

// Skärmläsartext och förklaring.
export function postEdgeText(edge: PostEdge | null): string {
  if (edge === "vp") return "bästa spår för vinst och plats";
  if (edge === "v") return "bästa spår för vinst";
  if (edge === "p") return "bästa spår för plats";
  return "";
}
