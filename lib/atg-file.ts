// ATG-filen (docs/specs/e7-atg-fil.md 3 och 6.5): raden som XML för ATG:s
// Filinlämning. Ren funktion utan DOM, React och klocka. Texterna som bara
// handlar om filen finns också här, testade i lib/atg-file.test.ts.
//
// Formatet är inte provat mot ATG, se specens avsnitt 2.

import { GAME_ID_RE, gameTypeOfId, legName, legsFor, type GameType } from "@/lib/game-type";
import { stockholmParts } from "@/lib/stockholm-time";
import { joinSv, krText } from "@/lib/tippa-text";

const SCHEMA_URL = "https://www.atg.se/services/schemas/filebet/1.8.4/atg_filebetting.xsd";
const MARKS_LENGTH = 15;

const COUPON_ELEMENT: Record<GameType, string> = { V75: "v75Coupon", V85: "v85Coupon", V86: "v86Coupon", GS75: "gs75Coupon" };

export type AtgFileLeg = {
  leg: number;
  selection: number[];
  scratched: { number: number; name: string }[];
  cancelled: boolean;
};

export type AtgFileInput = { gameType: string; atgGameId: string; now: Date; legs: AtgFileLeg[] };

export type AtgFileErrorCode = "OVER_15" | "EMPTY_LEG" | "ALL_SCRATCHED" | "CANCELLED_EMPTY" | "EMPTY_ROW" | "BAD_ID";
export type AtgFileError = { code: AtgFileErrorCode; leg: number | null; numbers: number[]; text: string };

export type AtgFileRemoved = { leg: number; number: number; name: string };

export type AtgFileOk = {
  ok: true;
  xml: string;
  filename: string;
  rows: number;
  markedByLeg: Record<number, number[]>;
  removed: AtgFileRemoved[];
};
export type AtgFileResult = AtgFileOk | { ok: false; errors: AtgFileError[] };

// ---- CRC-16/ARC ---------------------------------------------------------------------------------

export const crcHex = (value: number) => value.toString(16).padStart(4, "0");

// Polynom 0x8005 reflekterat 0xA001, init 0, av texten i UTF-8.
export function crc16Arc(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crcHex(crc);
}

// ---- Filen --------------------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

export function marksOf(numbers: readonly number[]): string {
  const on = new Set(numbers);
  return Array.from({ length: MARKS_LENGTH }, (_, i) => (on.has(i + 1) ? "1" : "0")).join("");
}

// Spelformen, datum och bana ur ATG:s id. null = id:t går inte att använda.
function parseGameId(gameType: string, atgGameId: string): { element: string; date: string; track: number } | null {
  if (!GAME_ID_RE.test(atgGameId)) return null;
  const type = gameTypeOfId(atgGameId);
  if (!type || type !== gameType) return null;
  const [, date, track] = atgGameId.split("_");
  const trackNo = Number(track);
  if (type === "V86" && (trackNo < 1 || trackNo > 99)) return null;
  return { element: COUPON_ELEMENT[type], date, track: trackNo };
}

function legErrors(gameType: string, leg: number, input: AtgFileLeg | undefined, marked: number[]): AtgFileError[] {
  const name = legName(gameType, leg);
  const over = marked.filter((n) => n > MARKS_LENGTH);
  if (over.length) {
    const many = over.length > 1;
    return [
      {
        code: "OVER_15",
        leg,
        numbers: over,
        text: `Startnummer ${joinSv(over)} i ${name} får inte plats i ATG-filen, som bara har startnummer 1–15. Ta bort ${many ? "hästarna" : "hästen"} ur ${name}, eller fyll i raden för hand hos ATG.`,
      },
    ];
  }
  if (marked.length) return [];
  if (input?.cancelled) return [{ code: "CANCELLED_EMPTY", leg, numbers: [], text: `${name} är inställt och har ingen häst att markera. Fyll i raden för hand hos ATG.` }];
  if (input?.selection.length) return [{ code: "ALL_SCRATCHED", leg, numbers: [], text: `Alla valda hästar i ${name} är strukna. Välj nya hästar i ${name} först.` }];
  return [{ code: "EMPTY_LEG", leg, numbers: [], text: `${name} har inga valda hästar. Välj hästar i ${name} först.` }];
}

export function buildAtgFile({ gameType, atgGameId, now, legs }: AtgFileInput): AtgFileResult {
  const errors: AtgFileError[] = [];
  const game = parseGameId(gameType, atgGameId);
  if (!game) errors.push({ code: "BAD_ID", leg: null, numbers: [], text: "Omgångens id hos ATG går inte att läsa, så ATG-filen kan inte skapas. Hämta omgången igen." });

  const legCount = legsFor(gameType);
  const markedByLeg: Record<number, number[]> = {};
  const removed: AtgFileRemoved[] = [];
  const legErrs: AtgFileError[] = [];
  let anySelected = false;
  for (let leg = 1; leg <= legCount; leg++) {
    const input = legs.find((l) => l.leg === leg);
    const unique = Array.from(new Set(input?.selection ?? [])).sort((a, b) => a - b);
    if (unique.length) anySelected = true;
    const marked: number[] = [];
    for (const n of unique) {
      const struck = input?.scratched.find((s) => s.number === n);
      if (struck) removed.push({ leg, number: n, name: struck.name });
      else marked.push(n);
    }
    markedByLeg[leg] = marked;
    legErrs.push(...legErrors(gameType, leg, input, marked));
  }
  if (anySelected) errors.push(...legErrs);
  else errors.push({ code: "EMPTY_ROW", leg: null, numbers: [], text: "Raden har inga valda hästar." });

  if (errors.length || !game) return { ok: false, errors };

  const p = stockholmParts(now);
  const trackAttr = gameType === "V86" ? ` trackcode="${game.track}"` : "";
  const legLines = Object.keys(markedByLeg).map((k) => `      <leg legno="${k}" marks="${marksOf(markedByLeg[Number(k)])}"/>`);
  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<issuer xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="${SCHEMA_URL}" company="Spelvarde" product="Spelvarde" version="1.0" createddate="${p.year}-${pad(p.month)}-${pad(p.day)}" createdtime="${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}" schemaversion="ATG File Betting XSD ver 1.8">`,
    `  <betcoupons>`,
    `    <${game.element} couponid="1" date="${game.date}"${trackAttr} betmultiplier="1">`,
    ...legLines,
    `    </${game.element}>`,
    `  </betcoupons>`,
    `</issuer>`,
    ``,
  ].join("\n");

  return {
    ok: true,
    xml,
    filename: `${gameType.toLowerCase()}_${game.date}_${crc16Arc(xml)}.xml`,
    rows: Object.values(markedByLeg).reduce((acc, m) => acc * m.length, 1),
    markedByLeg,
    removed,
  };
}

// ---- Texterna i arket Spela hos ATG (avsnitt 8) --------------------------------------------------

export const ATG_NOT_TRIED_TEXT = "**ATG-filen är inte provad hos ATG än.** Tar ATG inte emot den, fyll i raden för hand med kupongen.";
export const ATG_DOWNLOAD_FAILED_TEXT = "Filen kunde inte laddas ner i den här webbläsaren. Prova igen, eller fyll i raden för hand hos ATG.";
export const ATG_NO_SUBMIT_TEXT = "Appen lämnar inte in något. Spelet läggs först när du bekräftar hos ATG.";
export const ATG_COPY_HELP_TEXT = "Texten som kopieras har loppen i ordning, och sist rader och kostnad. Den är ett stöd när du fyller i raden för hand.";
export const ATG_SAFARI_TEXT = "Laddas filen inte ner med appen på hemskärmen? Öppna Spelvärde i Safari och prova där.";
export const ATG_FILE_CHANGED_TEXT = "Raden har ändrats sedan filen laddades ner. Ladda ner en ny fil.";
export const ATG_COPIED_TEXT = "Raden är kopierad.";

export const atgStartedHelp = (gameType: string) => `${gameType} har startat, så ATG-filen går inte längre att ladda ner.`;
export const atgStartedError = (gameType: string) => `${gameType} har startat. ATG-filen skapades inte.`;
export const atgAllgHelp = (gameType: string, leg: number) => `${legName(gameType, leg)} är allgarderad. Fyller du i raden för hand trycker du på **Alla** i ${legName(gameType, leg)}.`;
export const atgRemovedText = (gameType: string, r: AtgFileRemoved) => `**${r.number} ${r.name} i ${legName(gameType, r.leg)} är struken** och är inte med i ATG-filen.`;
export const atgRowPriceText = (rowPrice: number, cost: number) => `**Radpriset i appen är ${krText(rowPrice)}.** Filen har inget radpris, så ATG kan visa ett annat pris än ${krText(cost)}. Jämför priset innan du bekräftar.`;
export const atgCompareStep = (rows: number, cost: number) => `Jämför rader och pris hos ATG med raden här: **${rows} ${rows === 1 ? "rad" : "rader"} · ${krText(cost)}**. Bekräfta bara om allt stämmer. Ett bekräftat spel kan inte ångras.`;
