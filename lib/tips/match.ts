// Koppling av ett tips till en start (E5 6.11 "Koppling till start"). Ren modul.
//
// Ordningen när avd + nr finns men namnet är ett annat:
//   1. nära namn (close) → NAME_SPELLING
//   2. namnet finns exakt i samma avd → NUMBER_MISMATCH
//   3. namnet finns exakt en gång i en annan avd → LEG_MISMATCH (specens
//      testfall "Avd 2, nr 5, Mellby Harley" går före raden NAME_MISMATCH)
//   4. annars NAME_MISMATCH på avd + nr.
// Finns avd men inte numret i avdelningen behandlas det som att numret är fel.

export type StartRef = { startId: string; leg: number; number: number; name: string; scratched: boolean };
export type TipFlag =
  | "NO_MATCH"
  | "ROLE_WORD_UNKNOWN"
  | "ROLE_CONFLICT"
  | "ROLE_WORD_MISSING"
  | "NAME_MISMATCH"
  | "NAME_SPELLING"
  | "NUMBER_MISMATCH"
  | "NUMBER_MISSING"
  | "LEG_MISMATCH"
  | "LEG_MISSING"
  | "QUOTE_NO_NAME"
  | "SCRATCHED";

// Visningsordningen (6.11): den första flaggan i listan visas på kortet.
export const FLAG_ORDER: TipFlag[] = [
  "NO_MATCH",
  "ROLE_WORD_UNKNOWN",
  "ROLE_CONFLICT",
  "ROLE_WORD_MISSING",
  "NAME_MISMATCH",
  "NAME_SPELLING",
  "NUMBER_MISMATCH",
  "NUMBER_MISSING",
  "LEG_MISMATCH",
  "LEG_MISSING",
  "QUOTE_NO_NAME",
  "SCRATCHED",
];
export const sortFlags = (flags: TipFlag[]): TipFlag[] => [...new Set(flags)].sort((a, b) => FLAG_ORDER.indexOf(a) - FLAG_ORDER.indexOf(b));
export const isTipFlag = (v: unknown): v is TipFlag => typeof v === "string" && (FLAG_ORDER as string[]).includes(v);

// Gemener, utan landskod inom parentes, utan ' ’ . *, bindestreck till
// blanksteg, å/ä → a, ö/ø → o, æ → ae, é/è → e, ü → u, blanksteg ihop.
export function normHorse(name: string): string {
  return name
    .normalize("NFC")
    .toLowerCase()
    .replace(/\([a-z]{2,3}\)/g, " ")
    .replace(/['’.*]/g, "")
    .replace(/[-‐–]/g, " ")
    .replace(/[åä]/g, "a")
    .replace(/[öø]/g, "o")
    .replace(/æ/g, "ae")
    .replace(/[éè]/g, "e")
    .replace(/ü/g, "u")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// Levenshtein högst 2 mellan de normaliserade namnen, och båda minst 5 tecken.
export function close(a: string, b: string): boolean {
  const x = normHorse(a);
  const y = normHorse(b);
  return x.length >= 5 && y.length >= 5 && levenshtein(x, y) <= 2;
}

// Närmaste namn (close) i avdelningen, annars i omgången, annars null.
export function suggestStart(name: string, leg: number | null, starts: StartRef[]): StartRef | null {
  const n = normHorse(name);
  const best = (pool: StartRef[]) =>
    pool
      .filter((s) => close(s.name, name))
      .map((s) => ({ s, d: levenshtein(normHorse(s.name), n) }))
      .sort((a, b) => a.d - b.d || a.s.leg - b.s.leg || a.s.number - b.s.number)[0]?.s ?? null;
  return (leg !== null ? best(starts.filter((s) => s.leg === leg)) : null) ?? best(starts);
}

export type LinkResult = { match: "SURE" | "UNSURE" | "NONE"; start: StartRef | null; flags: TipFlag[]; suggestion: StartRef | null };

export function linkTip(input: { leg: number | null; number: number | null; horseName: string }, starts: StartRef[]): LinkResult {
  const name = normHorse(input.horseName);
  const same = (s: StartRef) => normHorse(s.name) === name;
  const inLeg = input.leg !== null ? starts.filter((s) => s.leg === input.leg) : [];
  const exactInLeg = inLeg.find(same) ?? null;
  const exactInRound = starts.filter(same);
  const onlyOne = exactInRound.length === 1 ? exactInRound[0] : null;
  const done = (match: LinkResult["match"], start: StartRef | null, flags: TipFlag[]): LinkResult => {
    if (start?.scratched) {
      flags = [...flags, "SCRATCHED"];
      if (match === "SURE") match = "UNSURE";
    }
    return { match, start, flags, suggestion: null };
  };

  if (input.leg !== null && input.number !== null) {
    const at = inLeg.find((s) => s.number === input.number) ?? null;
    if (at) {
      if (same(at)) return done("SURE", at, []);
      if (close(at.name, input.horseName)) return done("UNSURE", at, ["NAME_SPELLING"]);
      if (exactInLeg) return done("UNSURE", exactInLeg, ["NUMBER_MISMATCH"]);
      if (onlyOne) return done("UNSURE", onlyOne, ["LEG_MISMATCH"]);
      return done("UNSURE", at, ["NAME_MISMATCH"]);
    }
    if (exactInLeg) return done("UNSURE", exactInLeg, ["NUMBER_MISMATCH"]);
  }
  if (input.leg !== null && input.number === null && exactInLeg) return done("UNSURE", exactInLeg, ["NUMBER_MISSING"]);
  if (onlyOne && (input.leg === null || onlyOne.leg !== input.leg)) return done("UNSURE", onlyOne, [input.leg === null ? "LEG_MISSING" : "LEG_MISMATCH"]);
  const suggestion = suggestStart(input.horseName, input.leg, starts);
  return { match: "NONE", start: null, flags: ["NO_MATCH"], suggestion };
}
