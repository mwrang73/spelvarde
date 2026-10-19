// Loppets klass (Race.classLabel) ur loppnamn och villkor (specen 10.3 punkt 5).
//
// Avvikelse mot specens lista, verifierad mot fixturerna: ATG har också
// "Kallblodsdivisionen" (V85 Gävle 2026-10-17, avd 5), så den finns med.
// "Brons mot Silver" står i loppnamnet som "STL Bronsdivisionen mot STL
// Silverdivisionen". Grupplopp står som "(Gr. II Int.)" i namnet.

export const KNOWN_CLASSES = [
  "Gulddivisionen",
  "Silverdivisionen",
  "Bronsdivisionen",
  "Stodivisionen",
  "Diamantstoet",
  "Kallblodsdivisionen",
  "Klass I",
  "Klass II",
  "Klass III",
  "Brons mot Silver",
  "Lärlingslopp",
  "Övrigt",
] as const;

export type RaceClass = (typeof KNOWN_CLASSES)[number];

export type RaceClassInfo = {
  base: RaceClass;
  // "Gr. II" eller "Gr. II Int.", annars null.
  group: string | null;
  label: string;
};

function baseClass(text: string): RaceClass {
  const t = text.toLowerCase();
  if (/bronsdivisionen\s+mot\s+(stl\s+)?silverdivisionen/.test(t)) return "Brons mot Silver";
  if (t.includes("gulddivisionen")) return "Gulddivisionen";
  if (t.includes("silverdivisionen")) return "Silverdivisionen";
  if (t.includes("bronsdivisionen")) return "Bronsdivisionen";
  if (t.includes("diamantstoet")) return "Diamantstoet";
  if (t.includes("stodivisionen")) return "Stodivisionen";
  if (t.includes("kallblodsdivisionen")) return "Kallblodsdivisionen";
  const k = /\bklass\s+(iii|ii|i)\b/.exec(t);
  if (k) return k[1] === "iii" ? "Klass III" : k[1] === "ii" ? "Klass II" : "Klass I";
  if (t.includes("lärlingslopp") || t.includes("lärlingar")) return "Lärlingslopp";
  return "Övrigt";
}

export function raceClass(name: string, terms: string[] = []): RaceClassInfo {
  // Namnet väger tyngst. Villkoren används bara om namnet inte säger något.
  let base = baseClass(name);
  if (base === "Övrigt") base = baseClass(terms.join(" "));
  const g = /\bGr\.\s*(III|II|I)\b(\s*Int\.)?/.exec(name);
  const group = g ? `Gr. ${g[1]}${g[2] ? " Int." : ""}` : null;
  const label = group ? (base === "Övrigt" ? group : `${group} ${base}`) : base;
  return { base, group, label };
}
