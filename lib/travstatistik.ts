// travstatistik.se: hämtning och tolkning av HTML-tabellerna (specen 10.3).
// Tolkat innehåll sparas som JSON i StatsSnapshot.data.
//
// ---------------------------------------------------------------------------
// Verifierat mot fixturerna (sidorna visade omgången Gävle 17/10 2026):
//
// Allmänt
// - Sidorna anger charset=iso-8859-1, men fixturerna är sparade som UTF-8.
//   decodeHtml() provar strikt UTF-8 först och faller tillbaka på
//   windows-1252 (en övermängd av latin-1).
// - HTML:en är trasig: <font>, <strong> och <a> stängs inte, och sidan har
//   nästlade <html>/<body>. node-html-parser tappar då rader. Därför plockas
//   varje <table>…</table> ut för sig och formateringstaggar och länkar tas
//   bort innan tabellen tolkas.
// - Varje sida har rubriken "V85 TRAVSTATISTIK.SE <Bana> <d> <månad> <år>"
//   (V75 i stället för V85 när den spelformen gäller),
//   som används för rimlighetskontrollen (bana och datum mot omgången).
// - Tal skrivs med decimalpunkt ("15.8") och celler har ofta två värden:
//   "37 15.8" (antal, procent), "4 S=3" (antal, varav från spets),
//   "25 (50.0 %)".
//
// Per sida (sidnyckel → innehåll)
// - startnr (visaveckansnr.php): per avdelning klasskod (S, Sto, II, G, K,
//   III, B, I …), distans + a/v (+ ibland "Diam"/"Till"), antal lopp och
//   vinnare per startnummer 1–15 (antal och %). Därtill rader "Alla <distans>
//   <a|v>" för alla klasser och "Alla lopp". Som specen säger. OBS: bara för
//   ALLA BANOR – sidan har ingen uppdelning per bana, så urvalet "<bana>" i
//   S2b kan inte visa vinst % per startnummer från den här sidan.
// - rank (visaveckansrankvalny.php): AVVIKER. Inte rankning av veckans hästar
//   utan fördelningen av vinnarens rank (1:a–15:e) per avdelning, med
//   distansintervall "(1600 - 1680)". Visas som information.
// - ms (visaveckansMS.php): "Vinnaren rankad per mest streckad". Raderna
//   MS 1–MS 8 är INTE avdelningar utan loppen i en omgång sorterade efter hur
//   tungt favoriten är streckad (MS 1 = omgångens största favorit). Kolumn
//   "1:a" i MS 1 (54,5 %) är alltså "största favoriten vinner 54,5 %".
//   "Summa fr.o.m. 2016" ger favoritens vinst-% över alla lopp (36,7 %).
//   Topp 3-andel finns inte. Se favoriteWinPct() för hur raden väljs.
// - bana (visaveckansbana.php): tidigare V85/V75-omgångar på banan med
//   vinnarens rank (antal per rank och "S=" från spets) och rankpoäng. Ingen
//   vinst % per startnummer per bana.
// - kuskliga / tranarliga: en tabell med en sektion per år ("Kuskligan
//   2026", 2025 …). Kolumner: plac (tom = delad), namn ("Kihlström Ö",
//   "Djuse M E"), antal vinster, varit favorit, vunnit som favorit (antal och
//   %), vunnit rank 2–3, 4–6 och 7–. Bara innevarande års sektion sparas.
// - form (formtoppen.php): AVVIKER. Bara KUSKAR ("Formtoppen sedan år 2025
//   och vecka 42", 52 veckor), samma kolumner som ligan. Ingen tränarform.
// - senaste (visasenasteomg.php): AVVIKER. Inte förra omgångens resultat utan
//   "De 30 senaste omgångarna" filtrerade på utdelning (0–100 000 kr för
//   7 rätt), så den senaste omgången kan saknas. Duger inte för att se vilken
//   omgång sidorna visar – det görs med rubriken på varje sida i stället.
// - visameststreckadavd(.php|_metod.php)?Avd=n finns också (favoritstatistik
//   per klass, och per klass och startmetod). Tolkas av parseMsTable men
//   hämtas inte i E1.
// ---------------------------------------------------------------------------

import { parse } from "node-html-parser";

export const TS_BASE = "https://travstatistik.se";
export const TS_TIMEOUT_MS = 8_000;
export const TS_USER_AGENT = "Spelvärde (privat bruk)";

export const TS_PAGES = {
  startnr: "visaveckansnr.php",
  rank: "visaveckansrankvalny.php",
  ms: "visaveckansMS.php",
  bana: "visaveckansbana.php",
  kuskliga: "visakuskligan.php",
  tranarliga: "visatranarligan.php",
  form: "formtoppen.php",
  senaste: "visasenasteomg.php",
} as const;

export type TsPageKey = keyof typeof TS_PAGES;
export const TS_PAGE_KEYS = Object.keys(TS_PAGES) as TsPageKey[];

// ---- Avkodning och tabeller ----------------------------------------------------

export function decodeHtml(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const clean = (s: string) => s.replace(/[\s ]+/g, " ").trim();

// Alla tabeller på sidan som rader av celltexter.
export function extractTables(html: string): string[][][] {
  const tables: string[][][] = [];
  const re = /<table\b[\s\S]*?<\/table>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const frag = m[0]
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<\/?(font|strong|b|i|u|em|center|p|span|div|a|img)\b[^>]*>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n");
    const root = parse(frag);
    const rows = root.querySelectorAll("tr").map((tr) => tr.querySelectorAll("td,th").map((td) => clean(td.text)));
    tables.push(rows);
  }
  return tables;
}

// ---- Rubriken och rimlighetskontrollen -------------------------------------------

const MONTHS: Record<string, number> = {
  januari: 1, februari: 2, mars: 3, april: 4, maj: 5, juni: 6,
  juli: 7, augusti: 8, september: 9, oktober: 10, november: 11, december: 12,
};

export type PageHeader = { trackName: string; date: string };

export function parsePageHeader(html: string): PageHeader | null {
  const text = clean(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " "));
  // "V85 TRAVSTATISTIK.SE …" i dag, "V75 TRAVSTATISTIK.SE …" när V75 kommer tillbaka.
  const m = /(?:V\d{2}|GS75) TRAVSTATISTIK\.SE\s+(.+?)\s+(\d{1,2})\s+([a-zåäö]+)\s+(\d{4})/i.exec(text);
  if (!m) return null;
  const month = MONTHS[m[3].toLowerCase()];
  if (!month) return null;
  const date = `${m[4]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return { trackName: m[1].trim(), date };
}

const normTrack = (s: string) => s.toLowerCase().normalize("NFC").replace(/\s+/g, " ").trim();

// Sant om sidan visar omgången (samma bana och datum).
export function headerMatchesRound(header: PageHeader | null, round: { trackName: string; date: string }): boolean {
  return !!header && header.date === round.date && normTrack(header.trackName) === normTrack(round.trackName);
}

export const WRONG_ROUND_ERROR = "Sidan visar en annan omgång";

// ---- Celltolkning ------------------------------------------------------------------

const toNum = (s: string | undefined): number | null => {
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

// "37 15.8" → { count: 37, pct: 15.8 }. Tom cell → null.
export function countPct(cell: string | undefined): { count: number; pct: number | null } | null {
  const m = /^(\d+)(?:\s+\(?(\d+(?:[.,]\d+)?)\s*%?\)?)?$/.exec(clean(cell ?? ""));
  if (!m) return null;
  return { count: parseInt(m[1], 10), pct: toNum(m[2]) };
}

// "4 S=3" → { count: 4, fromLead: 3 }.
function countLead(cell: string | undefined): { count: number; fromLead: number } | null {
  const m = /^(\d+)(?:\s+S=(\d+))?$/.exec(clean(cell ?? ""));
  if (!m) return null;
  return { count: parseInt(m[1], 10), fromLead: m[2] ? parseInt(m[2], 10) : 0 };
}

// "2140 a Diam" / "1640 a (1600 - 1680)" → distans, metod, tillägg, intervall.
export function parseDistanceCell(cell: string) {
  const m = /^(\d{3,4})\s*([av])\b\s*(.*)$/i.exec(clean(cell));
  if (!m) return null;
  const rest = m[3];
  const range = /\((\d+)\s*-\s*(\d+)\)/.exec(rest);
  return {
    distance: parseInt(m[1], 10),
    method: (m[2].toLowerCase() === "a" ? "AUTO" : "VOLTE") as "AUTO" | "VOLTE",
    extra: clean(rest.replace(/\([^)]*\)/, "")) || null,
    range: range ? ([parseInt(range[1], 10), parseInt(range[2], 10)] as [number, number]) : null,
  };
}

export type Bucket = { n: number; count: number; pct: number | null };

function buckets(cells: string[]): Bucket[] {
  const out: Bucket[] = [];
  cells.forEach((c, i) => {
    const v = countPct(c);
    if (v) out.push({ n: i + 1, count: v.count, pct: v.pct });
  });
  return out;
}

// ---- startnr ---------------------------------------------------------------------------

export type StartnrLeg = {
  leg: number;
  classCode: string;
  distance: number;
  method: "AUTO" | "VOLTE";
  extra: string | null;
  races: number;
  byNumber: Bucket[];
};
export type StartnrGroup = { distance: number; method: "AUTO" | "VOLTE"; races: number; byNumber: Bucket[] };
export type StartnrData = { legs: StartnrLeg[]; all: StartnrGroup[]; allRaces: { races: number; byNumber: Bucket[] } | null };

export function parseStartnr(html: string): StartnrData {
  const rows = extractTables(html).flat();
  const legs: StartnrLeg[] = [];
  const all: StartnrGroup[] = [];
  let allRaces: StartnrData["allRaces"] = null;
  for (const r of rows) {
    const leg = /^Avd (\d)$/.exec(r[0] ?? "");
    if (leg && r.length >= 5) {
      const d = parseDistanceCell(r[2]);
      const races = toNum(r[3]);
      if (!d || races === null) continue;
      legs.push({ leg: +leg[1], classCode: r[1], distance: d.distance, method: d.method, extra: d.extra, races, byNumber: buckets(r.slice(4)) });
      continue;
    }
    const grp = /^Alla (\d{3,4}) ([av])$/.exec(r[0] ?? "");
    if (grp) {
      const races = toNum(r[1]);
      if (races === null) continue;
      all.push({ distance: +grp[1], method: grp[2] === "a" ? "AUTO" : "VOLTE", races, byNumber: buckets(r.slice(2)) });
      continue;
    }
    if (r[0] === "Alla lopp") {
      const races = toNum(r[1]);
      if (races !== null) allRaces = { races, byNumber: buckets(r.slice(2)) };
    }
  }
  return { legs, all, allRaces };
}

// ---- rank ------------------------------------------------------------------------------

export type RankLeg = {
  leg: number;
  classCode: string;
  distance: number;
  method: "AUTO" | "VOLTE";
  range: [number, number] | null;
  races: number;
  byRank: Bucket[];
};
export type RankData = { legs: RankLeg[] };

export function parseRank(html: string): RankData {
  const legs: RankLeg[] = [];
  for (const r of extractTables(html).flat()) {
    const leg = /^Avd (\d)$/.exec(r[0] ?? "");
    if (!leg || r.length < 5) continue;
    const d = parseDistanceCell(r[2]);
    const races = toNum(r[3]);
    if (!d || races === null) continue;
    legs.push({ leg: +leg[1], classCode: r[1], distance: d.distance, method: d.method, range: d.range, races, byRank: buckets(r.slice(4)) });
  }
  return { legs };
}

// ---- ms (och visameststreckadavd) -------------------------------------------------------

export type MsRow = { msRank: number; races: number; byWinnerRank: Bucket[] };
export type MsData = { title: string | null; rows: MsRow[]; total: { races: number; byWinnerRank: Bucket[] } | null };

// Fungerar för visaveckansMS ("MS 1" …) och visameststreckadavd ("1" …).
export function parseMsTable(html: string): MsData {
  const rows: MsRow[] = [];
  let total: MsData["total"] = null;
  let title: string | null = null;
  for (const r of extractTables(html).flat()) {
    if (/^Avd\. \d/.test(r[0] ?? "")) title = r[0];
    const m = /^(?:MS )?(\d{1,2})$/.exec(r[0] ?? "");
    if (m && r.length >= 5 && r[1] === "" && r[2] === "") {
      const races = toNum(r[3]);
      if (races !== null) rows.push({ msRank: +m[1], races, byWinnerRank: buckets(r.slice(4)) });
      continue;
    }
    if (/^Summa (fr\.o\.m\.|alla lopp)/.test(r[0] ?? "") && !total) {
      const races = toNum(r[1]);
      if (races !== null) total = { races, byWinnerRank: buckets(r.slice(2)) };
    }
  }
  return { title, rows, total };
}

// Favoritens vinst-% för ett lopp. `msRank` = loppets plats när omgångens
// lopp sorteras efter favoritens streck, störst först (1–8). Utan streck
// (msRank null) används snittet för alla lopp.
export function favoriteWinPct(ms: MsData, msRank: number | null): number | null {
  if (msRank !== null) {
    const row = ms.rows.find((r) => r.msRank === msRank);
    const first = row?.byWinnerRank.find((b) => b.n === 1);
    if (first?.pct != null) return first.pct;
  }
  return ms.total?.byWinnerRank.find((b) => b.n === 1)?.pct ?? null;
}

// Loppens MS-rang ur favoritens streck per avdelning (null om streck saknas).
export function msRanks(favoriteStreckByLeg: Record<number, number | null>): Record<number, number | null> {
  const legs = Object.entries(favoriteStreckByLeg)
    .filter(([, v]) => v !== null)
    .map(([leg, v]) => ({ leg: +leg, v: v as number }))
    .sort((a, b) => b.v - a.v);
  const out: Record<number, number | null> = {};
  for (const leg of Object.keys(favoriteStreckByLeg)) out[+leg] = null;
  legs.forEach((x, i) => (out[x.leg] = i + 1));
  return out;
}

// ---- bana ------------------------------------------------------------------------------

export type BanaRound = { year: number; week: number; label: string; byRank: { n: number; count: number; fromLead: number }[]; rankPoints: number | null };
export type BanaData = { trackName: string | null; rounds: BanaRound[] };

export function parseBana(html: string): BanaData {
  const rows = extractTables(html).flat();
  const titleRow = rows.find((r) => r.some((c) => /^Rankingen för banan/.test(c)));
  const trackName = titleRow ? /Rankingen för banan (.+?) samt/.exec(titleRow.join(" "))?.[1] ?? null : null;
  const rounds: BanaRound[] = [];
  for (const r of rows) {
    const m = /^(\d{4}) (\d{2})\b\s*(.*)$/.exec(r[0] ?? "");
    if (!m || r.length < 17) continue;
    const byRank: BanaRound["byRank"] = [];
    r.slice(1, 16).forEach((c, i) => {
      const v = countLead(c);
      if (v) byRank.push({ n: i + 1, ...v });
    });
    rounds.push({ year: +m[1], week: +m[2], label: m[3], byRank, rankPoints: toNum(r[16]) });
  }
  return { trackName, rounds };
}

// ---- kuskliga, tranarliga, form -------------------------------------------------------

export type LeagueRow = {
  rank: number;
  name: string;
  wins: number;
  favorite: number;
  favoriteWins: number;
  favoriteWinPct: number | null;
  wonRank23: number;
  wonRank46: number;
  wonRank7: number;
};
export type LeagueData = { title: string | null; year: number | null; rows: LeagueRow[] };

function leagueRow(r: string[], prevRank: number): LeagueRow | null {
  if (r.length < 8) return null;
  const rank = r[0] === "" ? prevRank : toNum(r[0]);
  const wins = toNum(r[2]);
  const fav = toNum(r[3]);
  const favWins = countPct(r[4]);
  if (rank === null || !r[1] || wins === null || fav === null || !favWins) return null;
  return {
    rank,
    name: r[1],
    wins,
    favorite: fav,
    favoriteWins: favWins.count,
    favoriteWinPct: favWins.pct,
    wonRank23: toNum(r[5]) ?? 0,
    wonRank46: toNum(r[6]) ?? 0,
    wonRank7: toNum(r[7]) ?? 0,
  };
}

// Ligorna: bara den första (innevarande års) sektionen. Formtoppen: hela listan.
export function parseLeague(html: string): LeagueData {
  const rows = extractTables(html).flat();
  let title: string | null = null;
  let year: number | null = null;
  const out: LeagueRow[] = [];
  let prevRank = 0;
  for (const r of rows) {
    if (r.length === 1 && /^(Kusk|Tränar|Häst)ligan \d{4}$|^Formtoppen/.test(r[0])) {
      if (title) break;
      title = r[0];
      year = toNum(/\d{4}/.exec(r[0])?.[0]);
      continue;
    }
    if (!title) continue;
    const row = leagueRow(r, prevRank);
    if (row) {
      out.push(row);
      prevRank = row.rank;
    }
  }
  return { title, year, rows: out };
}

// ---- senaste --------------------------------------------------------------------------

export type SenasteRound = { year: number; week: number; trackCode: string; date: string; payout8: number | null; payout7: number | null };
export type SenasteData = { rounds: SenasteRound[] };

export function parseSenaste(html: string): SenasteData {
  const rounds: SenasteRound[] = [];
  const kr = (s: string | undefined) => toNum((s ?? "").replace(/\s/g, ""));
  for (const r of extractTables(html).flat()) {
    if (!/^\d{4}$/.test(r[0] ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(r[3] ?? "")) continue;
    rounds.push({ year: +r[0], week: +r[1], trackCode: r[2], date: r[3], payout8: kr(r[4]), payout7: kr(r[5]) });
  }
  return { rounds };
}

// ---- Samlad tolkning per sidnyckel --------------------------------------------------------

export type TsPageData = {
  startnr: StartnrData;
  rank: RankData;
  ms: MsData;
  bana: BanaData;
  kuskliga: LeagueData;
  tranarliga: LeagueData;
  form: LeagueData;
  senaste: SenasteData;
};

export function parsePage<K extends TsPageKey>(key: K, html: string): TsPageData[K] {
  switch (key) {
    case "startnr": return parseStartnr(html) as TsPageData[K];
    case "rank": return parseRank(html) as TsPageData[K];
    case "ms": return parseMsTable(html) as TsPageData[K];
    case "bana": return parseBana(html) as TsPageData[K];
    case "kuskliga":
    case "tranarliga":
    case "form": return parseLeague(html) as TsPageData[K];
    case "senaste": return parseSenaste(html) as TsPageData[K];
  }
  throw new Error(`Okänd sida ${String(key)}`);
}

// Räcker det tolkade för att vara användbart? Tom tabell ⇒ sidan har ändrat form.
export function isEmptyParse(key: TsPageKey, data: unknown): boolean {
  const d = data as Record<string, unknown>;
  if (key === "startnr" || key === "rank") return !(d.legs as unknown[]).length;
  if (key === "ms") return !(d.rows as unknown[]).length;
  if (key === "bana" || key === "senaste") return !(d.rounds as unknown[]).length;
  return !(d.rows as unknown[]).length;
}

export type TsResult<K extends TsPageKey = TsPageKey> =
  | { key: K; ok: true; header: PageHeader; data: TsPageData[K] }
  | { key: K; ok: false; error: string; header: PageHeader | null };

// Tolkar en hämtad sida och gör rimlighetskontrollen mot omgången.
export function interpretPage<K extends TsPageKey>(key: K, html: string, round: { trackName: string; date: string }): TsResult<K> {
  const header = parsePageHeader(html);
  if (!headerMatchesRound(header, round)) return { key, ok: false, error: WRONG_ROUND_ERROR, header };
  const data = parsePage(key, html);
  if (isEmptyParse(key, data)) return { key, ok: false, error: "Sidan kunde inte tolkas", header };
  return { key, ok: true, header: header!, data };
}

// ---- Hämtning --------------------------------------------------------------------------

export type TsFetch = (path: string) => Promise<string>;

export const tsFetch: TsFetch = async (path) => {
  let res: Response;
  try {
    res = await fetch(`${TS_BASE}/${path}`, {
      cache: "no-store",
      headers: { "User-Agent": TS_USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(TS_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Kunde inte nå travstatistik.se");
  }
  if (!res.ok) throw new Error(`travstatistik.se svarade ${res.status}`);
  return decodeHtml(new Uint8Array(await res.arrayBuffer()));
};
