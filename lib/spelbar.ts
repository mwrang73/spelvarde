// Spelbar (specen 6.1). Räknas fram vid läsning och lagras inte. I E1 finns
// inget riktodds än, så förslaget blir alltid false; funktionen används ändå
// redan nu så att svaren från PUT /api/marks har sin slutliga form.

export type Override = "NONE" | "ON" | "OFF";

export function forslag(m: { interesting: boolean; unibetOdds: number | null; riktodds: number | null }): boolean {
  return m.interesting && m.unibetOdds !== null && m.riktodds !== null && m.unibetOdds > m.riktodds;
}

export function spelbar(m: { interesting: boolean; unibetOdds: number | null; riktodds: number | null; override: Override }): boolean {
  if (m.override === "ON") return true;
  if (m.override === "OFF") return false;
  return forslag(m);
}
