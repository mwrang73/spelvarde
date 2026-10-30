// Flaggornas texter (E5 6.11). Den första flaggan i FLAG_ORDER visas. Ren
// modul: servern skickar texterna i TipDto (flagText, flagShort), och
// klienten kan använda samma funktioner.
import { FLAG_ORDER, type TipFlag } from "@/lib/tips/match";
import { ROLE_LABEL, type TipRole } from "@/lib/tips/roles";
import { legName } from "@/lib/game-type";

export type FlagStart = { leg: number; number: number; name: string };
export type FlagInput = {
  flags: string[];
  rawHorseName: string;
  role: TipRole;
  roleWord: string | null;
  leg: number | null;
  number: number | null;
  start: FlagStart | null;
  suggestion: FlagStart | null;
};

const first = (flags: string[]): TipFlag | null => FLAG_ORDER.find((f) => flags.includes(f)) ?? null;

export function flagText(t: FlagInput, gameType: string): string | null {
  const f = first(t.flags);
  const s = t.start;
  switch (f) {
    case null:
      return null;
    case "NO_MATCH":
      return t.suggestion
        ? `Kunde inte kopplas till en häst i ${t.leg !== null ? `${legName(gameType, t.leg)}` : "omgången"}. Närmast är ${t.suggestion.number} ${t.suggestion.name}.`
        : "Kunde inte kopplas till en häst i omgången.";
    case "ROLE_WORD_UNKNOWN":
      return `Osäker roll: texten säger "${t.roleWord ?? ""}", som tolkades som ${ROLE_LABEL[t.role]}.`;
    case "ROLE_CONFLICT":
      return `Osäker roll: "${t.roleWord ?? ""}" tolkades som ${ROLE_LABEL[t.role]}.`;
    case "ROLE_WORD_MISSING":
      return "Osäker roll: citatet säger inte tydligt vilken roll hästen har.";
    case "NAME_MISMATCH":
      return s ? `Artikeln säger "${t.rawHorseName}", men nr ${s.number} i ${legName(gameType, s.leg)} heter ${s.name}.` : `Artikeln säger "${t.rawHorseName}".`;
    case "NAME_SPELLING":
      return s ? `Namnet stavas "${t.rawHorseName}" i artikeln. Kopplat till ${s.number} ${s.name}.` : `Namnet stavas "${t.rawHorseName}" i artikeln.`;
    case "NUMBER_MISMATCH":
      return s ? `Artikeln säger nr ${t.number ?? "?"}, men ${s.name} har nr ${s.number} i ${legName(gameType, s.leg)}.` : `Artikeln säger nr ${t.number ?? "?"}.`;
    case "NUMBER_MISSING":
      return "Numret stod inte i texten. Kopplat på namnet.";
    case "LEG_MISMATCH":
      return s ? `Artikeln säger ${legName(gameType, t.leg ?? "?")}, men ${s.name} går i ${legName(gameType, s.leg)}.` : `Artikeln säger ${legName(gameType, t.leg ?? "?")}.`;
    case "LEG_MISSING":
      return "Loppet stod inte i texten. Kopplat på namnet.";
    case "QUOTE_NO_NAME":
      return "Citatet nämner inte hästen. Kontrollera att det gäller rätt häst.";
    case "SCRATCHED":
      return "Hästen är struken.";
  }
}

export function flagShort(t: FlagInput): string | null {
  const f = first(t.flags);
  switch (f) {
    case null:
      return null;
    case "NO_MATCH":
      return "Ej kopplad";
    case "ROLE_WORD_UNKNOWN":
      return `Osäker roll: "${t.roleWord ?? ""}"`;
    case "ROLE_CONFLICT":
    case "ROLE_WORD_MISSING":
      return "Osäker roll";
    case "NAME_MISMATCH":
      return "Annat namn";
    case "NAME_SPELLING":
      return `Stavas "${t.rawHorseName}"`;
    case "NUMBER_MISMATCH":
      return "Annat nummer";
    case "NUMBER_MISSING":
      return "Nummer saknas";
    case "LEG_MISMATCH":
      return "Annat lopp";
    case "LEG_MISSING":
      return "Lopp saknas";
    case "QUOTE_NO_NAME":
      return "Namnet saknas i citatet";
    case "SCRATCHED":
      return "Struken";
  }
}
