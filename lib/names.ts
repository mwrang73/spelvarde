// Koppling av kusk- och tränarnamn från travstatistik.se till Person (10.3).
//
// travstatistik.se skriver "Efternamn Initial(er)": "Kihlström Ö",
// "Djuse M E" (Mats E Djuse), "Jepson C J" (Carl Johan Jepson). Flera
// initialer förekommer alltså, verifierat mot kuskligan-fixturen. Alla
// initialer måste stämma mot förnamnens början, i ordning.

export function normalizeName(name: string): string {
  return name
    .normalize("NFC")
    .toLowerCase()
    .replace(/[-‐–]/g, " ")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type ParsedShortName = { lastName: string; initials: string[] };

// "Kihlström Ö" → { lastName: "kihlström", initials: ["ö"] }.
// Initialer är de avslutande orden med 1–2 bokstäver ("CJ" delas upp).
export function parseShortName(raw: string): ParsedShortName | null {
  const tokens = normalizeName(raw).split(" ").filter(Boolean);
  if (tokens.length < 2) return null;
  const initials: string[] = [];
  while (tokens.length > 1 && tokens[tokens.length - 1].length <= 2) {
    initials.unshift(...tokens.pop()!.split(""));
  }
  if (!initials.length) return null;
  return { lastName: tokens.join(" "), initials };
}

export type NamedPerson = { id: string; firstName: string; lastName: string };

export function matchesShortName(p: ParsedShortName, person: NamedPerson): boolean {
  if (normalizeName(person.lastName) !== p.lastName) return false;
  const firstTokens = normalizeName(person.firstName).split(" ").filter(Boolean);
  if (firstTokens.length < p.initials.length) {
    // "Ö" mot "Örjan": en initial räcker mot ett förnamn. Fler initialer än
    // förnamn går inte att verifiera.
    return false;
  }
  return p.initials.every((ch, i) => firstTokens[i].startsWith(ch));
}

export type AliasMatch = { rawName: string; personId: string | null; candidates: number };

// Exakt en träff bland omgångens personer kopplar. Ingen eller flera träffar
// ger personId null ("ej kopplad").
export function matchPerson(rawName: string, people: NamedPerson[]): AliasMatch {
  const parsed = parseShortName(rawName);
  if (!parsed) return { rawName, personId: null, candidates: 0 };
  const hits = people.filter((p) => matchesShortName(parsed, p));
  return { rawName, personId: hits.length === 1 ? hits[0].id : null, candidates: hits.length };
}
