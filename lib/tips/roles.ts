// Rollerna i Hämta tips (E5 6.11). Ren modul, används av både servern och klienten.
//
// - Orden jämförs normaliserat (gemener, blanksteg ihop). Listan kan byggas ut.
// - "Fynd" finns medvetet inte i listan: AI:n väljer Skräll och tipset flaggas
//   (Mikaels beslut 2).
// - Källstödet räknar bara Spik, Favorit och Skräll (Claudes beslut 2).

export const TIP_ROLES = ["SPIK", "FAVORIT", "SKRALL", "AVRADAN", "NAMND"] as const;
export type TipRole = (typeof TIP_ROLES)[number];

export const isTipRole = (v: unknown): v is TipRole => typeof v === "string" && (TIP_ROLES as readonly string[]).includes(v);

export const ROLE_LABEL: Record<TipRole, string> = {
  SPIK: "Spik",
  FAVORIT: "Favorit",
  SKRALL: "Skräll",
  AVRADAN: "Avrådan",
  NAMND: "Nämnd",
};

export const ROLE_WORDS: Record<TipRole, readonly string[]> = {
  // "spikarna" är tillagt efter Travstugans rubrik "BÄSTA TIDIGA SPIKARNA" (fixturen 27 okt 2026).
  SPIK: ["spik", "spiken", "spikar", "spikarna", "spikförslag", "lås", "låset", "låsning", "singel", "singelstreck"],
  FAVORIT: ["favorit", "favoriten", "storfavorit", "starkast", "starkaste", "given vinnare", "huvudchans"],
  SKRALL: ["skräll", "skrällen", "skrällbud", "skrälldrag", "outsider", "outsidern"],
  AVRADAN: ["avrådan", "avråder", "överspelad", "falsk favorit", "undvik", "lita inte"],
  NAMND: [],
};

// Gemener, NFC och blanksteg ihop.
export const normWord = (s: string) => s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

const WORD_ROLE = new Map<string, TipRole>();
for (const role of TIP_ROLES) for (const w of ROLE_WORDS[role]) WORD_ROLE.set(normWord(w), role);

// Rollen som ordet ger utan flagga, eller null när ordet inte finns i listan.
export function roleOfWord(word: string | null | undefined): TipRole | null {
  if (!word) return null;
  return WORD_ROLE.get(normWord(word)) ?? null;
}

// 0 = starkast. Ordningen: Spik, Favorit, Skräll, Avrådan, Nämnd.
export const roleStrength = (role: TipRole): number => TIP_ROLES.indexOf(role);

// Räknas rollen i källstödet ("källan pekar ut hästen")?
export const countsAsSupport = (role: TipRole): boolean => role === "SPIK" || role === "FAVORIT" || role === "SKRALL";
