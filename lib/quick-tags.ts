// Snabbval under loppet (specen 6.6). Taggarna sparas som text på en
// kommentar av typen RACE, en per häst och start. Ordningen är den som visas,
// och tangenten är kortkommandot på desktop. Ändras utan migrering.
export const QUICK_TAGS = [
  { tag: "Galopp", key: "G" },
  { tag: "Tog spets", key: "P" },
  { tag: "Ledde hela vägen", key: "L" },
  { tag: "Satt i rygg ledaren", key: "R" },
  { tag: "Satt fast i rygg", key: "F" },
  { tag: "Utvändigt utan rygg", key: "U" },
  { tag: "Dödens", key: "D" },
  { tag: "Dåligt läge", key: "A" },
  { tag: "Stark avslutning", key: "S" },
  { tag: "Spurtade i tredjespår", key: "T" },
  { tag: "Tröttnade", key: "M" },
  { tag: "Defensivt körd", key: "E" },
  { tag: "Diskad", key: "X" },
] as const;

export function quickTagForKey(key: string): string | null {
  const k = key.toUpperCase();
  return QUICK_TAGS.find((q) => q.key === k)?.tag ?? null;
}

// Slår av eller på en tagg och behåller snabbvalens ordning (egna taggar sist).
export function toggleTag(tags: string[], tag: string): string[] {
  const set = new Set(tags);
  if (set.has(tag)) set.delete(tag);
  else set.add(tag);
  const order = QUICK_TAGS.map((q) => q.tag as string);
  return [...set].sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)));
}
