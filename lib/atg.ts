// ATG:s inofficiella API (racinginfo v1). All tolkning av ATG-data ligger här,
// med egna typvakter som inte litar på formen: okända eller saknade fält ger
// null och en varning i `warnings`, aldrig en krasch. Testas mot sparade svar
// i test/fixtures/atg/.
//
// ---------------------------------------------------------------------------
// Verifierat mot fixturerna 2026-10-19 (avvikelser och preciseringar mot
// specen 10.2):
//
// Spel (games/<id>)
// - Tider saknar tidszon: "2026-10-24T15:00:00" är svensk väggklockstid.
//   races[].startTime blir faktisk starttid efter loppet (t.ex. 15:00:43),
//   scheduledStartTime ligger kvar.
// - Spelets status: "upcoming" → "bettable" → "results". Loppens status:
//   "upcoming" och "results" (fler värden, t.ex. "cancelled", har inte setts;
//   status som innehåller "cancel" räknas som inställt).
// - prize är en TEXT ("Pris: 150.000-75.000-… kr"); förstapriset tolkas ur den.
// - terms är en lista med strängar.
// - Strykning: starts[].scratched === true. Fältet saknas helt för hästar
//   som inte är strukna.
// - Kuskbyte: ATG anger själv starts[].originalDriver (hela personen) när
//   kusken har bytts. Används som prevDriver om vi inte redan har en.
// - starts[].out === true förekommer vid resultat (hästen "utgick", kmTime
//   har då koden "u"). Det sparas inte separat; galopp/placering täcker det.
// - Kuskens statistik ligger i starts[].driver.statistics.years["<år>"]
//   och tränarens i starts[].horse.trainer.statistics.years["<år>"]:
//   { starts, earnings (öre), placement: {"1","2","3"}, winPercentage (hundradelar av %) }.
// - Hästens statistik: horse.statistics.years["<år>"] och .life, med
//   { starts, earnings (öre), placement, records[] }.
// - horse.money är vinstsumman i KRONOR (inte öre som i statistics).
// - Streck: starts[].pools.<spelform>.betDistribution (pools.V85, pools.V75 …)
//   i hundradelar av procent (1924 = 19,24 %). Saknas helt innan spelet har
//   öppnat (fixturen
//   "upcoming" har inga pools alls) – då sparas ingen snapshot.
// - pools.vinnare.odds är heltal i hundradelar (170 = 1,70).
// - pools.plats per häst: { minOdds, maxOdds } i hundradelar. Finns både före
//   och efter loppet; efter resultat sparas de i Start.placeOddsMin/Max för
//   backtest. Strukna hästar har 0.
// - Resultat: starts[].result = { place, finishOrder, kmTime, finalOdds,
//   prizeMoney, galloped?, disqualified? }. finalOdds är ett DECIMALTAL
//   (19.6), inte hundradelar. place = 0 betyder oplacerad. Vid diskning
//   saknas place och disqualified === true (oftast med galloped === true).
//   Strukna hästar har result med bara finishOrder ≥ 50 och finalOdds 0.
// - kmTime är ett objekt: { minutes, seconds, tenths } eller { code } när
//   tid saknas ("u", "6", "tr2" …).
//
// Start (races/<raceId>/start/<nr>)
// - horse.results.records[]: date, place (STRÄNG, "7" / "0"), kmTime (objekt
//   som ovan), odds (heltal i hundradelar), galloped?, disqualified?,
//   scratched? (hästen var struken i det loppet – räknas inte som start),
//   race { id, number, startMethod, firstPrize (öre) }, track { id, name },
//   start { distance, postPosition, driver { firstName, lastName } }.
// - Distans, spår och kusk ligger alltså i record.start, startmetod i
//   record.race. Utländska lopp kan sakna postPosition och driver.id.
// - horse.results.hasMoreRecords anger att listan är avkortad.
//
// Kalender (calendar/day/<d>) – verifierad med ett anrop 2026-10-19, sparad
// som calendar-2026-10-24.json: games.V85[] = { id, status, startTime,
// scheduledStartTime, tracks: [banId], races: [raceId…] }. Samma form för
// V75, V86 och GS75. tracks[] = { id, name, sport ("trot"), countryCode
// ("SE"), races: [{ id, number, status, startTime }] }.
//
// Lopp (races/<raceId>) – verifierat 2026-10-19 (2026-10-10_5_1): samma
// loppobjekt som i games/<id>.races[] (id, date, number, distance,
// startMethod, track { id, name, countryCode }, status, starts[]), med
// starts[].result som ovan. Används av statistikbasen (lib/hist.ts).
// ---------------------------------------------------------------------------

import { gameTypeOfId, legsFor, type GameType } from "@/lib/game-type";
import { parseAtgTime } from "@/lib/stockholm-time";

export const ATG_BASE = "https://www.atg.se/services/racinginfo/v1/api";
export const ATG_TIMEOUT_MS = 6_000;
export const ATG_USER_AGENT = "Spelvärde (privat bruk)";

// ---- Typvakter ------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const obj = (x: unknown): Obj | null => (isObj(x) ? x : null);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() !== "" ? x.trim() : null);
function num(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x))) return Number(x);
  return null;
}
function int(x: unknown): number | null {
  const n = num(x);
  return n === null ? null : Math.trunc(n);
}
const bool = (x: unknown): boolean => x === true;

export type Warn = (message: string) => void;

// ---- Typer ut ur tolkningen ----------------------------------------------

export type AtgStartMethod = "AUTO" | "VOLTE";

export type YearStats = {
  starts: number;
  wins: number;
  seconds: number;
  thirds: number;
  // Procent med två decimaler, 18.3 = 18,30 %.
  winPercentage: number | null;
  // Kronor.
  earnings: number | null;
};

export type PersonStats = Record<string, YearStats>;
export type HorseStats = { years: Record<string, YearStats>; life: YearStats | null };

export type ParsedPerson = {
  atgPersonId: number;
  firstName: string;
  lastName: string;
  shortName: string | null;
  location: string | null;
  stats: PersonStats | null;
};

export type ParsedResult = {
  place: number | null;
  finishOrder: number | null;
  disqualified: boolean;
  galloped: boolean;
  kmTime: string | null;
  finalOdds: number | null;
  placeOddsMin: number | null;
  placeOddsMax: number | null;
};

export type ParsedStart = {
  number: number;
  postPosition: number | null;
  distance: number;
  scratched: boolean;
  horse: {
    atgHorseId: number;
    name: string;
    sex: string | null;
    age: number | null;
    birthYear: number | null;
    country: string | null;
  };
  record: string | null;
  earnings: number | null;
  horseStats: HorseStats | null;
  shoes: unknown;
  sulky: unknown;
  driver: ParsedPerson | null;
  trainer: ParsedPerson | null;
  originalDriver: ParsedPerson | null;
  // Hundradelar av procent, null när spelets pool inte finns än.
  streck: number | null;
  // Vinnarodds just nu (decimaltal), före loppet.
  winOdds: number | null;
  result: ParsedResult | null;
};

export type ParsedRace = {
  atgRaceId: string;
  leg: number;
  raceNumber: number;
  name: string;
  startAt: Date;
  scheduledStartAt: Date | null;
  distance: number;
  startMethod: AtgStartMethod;
  prize: number | null;
  prizeText: string | null;
  terms: string[];
  status: string | null;
  hasResult: boolean;
  cancelled: boolean;
  starts: ParsedStart[];
  // Antal starter i ATG:s svar. Fler än starts = några gick inte att läsa.
  atgStarts: number;
};

export type ParsedGame = {
  atgGameId: string;
  status: string | null;
  date: string;
  trackId: number;
  trackName: string;
  firstStartAt: Date;
  races: ParsedRace[];
  hasStreck: boolean;
  gameType: GameType;
};

export type CalendarGame = {
  id: string;
  status: string | null;
  startTime: Date;
  trackIds: number[];
  // Bannamnet ur kalenderns tracks[] (null om det saknas).
  trackName: string | null;
};

export type ParsedRecord = {
  date: string;
  trackName: string;
  trackId: number | null;
  atgRaceRef: string | null;
  raceNumber: number | null;
  distance: number | null;
  startMethod: AtgStartMethod | null;
  postPosition: number | null;
  place: number | null;
  galloped: boolean;
  disqualified: boolean;
  scratched: boolean;
  kmTime: string | null;
  odds: number | null;
  driverName: string | null;
  firstPrize: number | null;
};

export type ParsedStartDetail = {
  raceId: string | null;
  startNumber: number | null;
  atgHorseId: number | null;
  horseStats: HorseStats | null;
  driver: ParsedPerson | null;
  trainer: ParsedPerson | null;
  records: ParsedRecord[];
  hasMoreRecords: boolean;
};

// ---- Hjälpare ---------------------------------------------------------------

export function parseStartMethod(x: unknown): AtgStartMethod | null {
  const s = str(x)?.toLowerCase();
  if (s === "auto") return "AUTO";
  if (s === "volte") return "VOLTE";
  return null;
}

// { minutes: 1, seconds: 12, tenths: 9 } → "1.12,9". { code: "u" } → "u".
export function formatKmTime(x: unknown): string | null {
  const o = obj(x);
  if (!o) return null;
  const m = int(o.minutes);
  const s = int(o.seconds);
  const t = int(o.tenths);
  if (m !== null && s !== null && t !== null) return `${m}.${String(s).padStart(2, "0")},${t}`;
  // Vid diskning skickar ATG ofta en ren sifferkod ({ code: "11" }) som inte
  // är en tid. Visa den inte, så att den inte läses som km-tid.
  const code = str(o.code);
  return code && /^\d+$/.test(code) ? null : code;
}

// horse.record { code: "aM", time } → "1.11,8aM".
export function formatRecord(x: unknown): string | null {
  const o = obj(x);
  if (!o) return null;
  const time = formatKmTime(o.time);
  if (!time || !/^\d/.test(time)) return null;
  return `${time}${str(o.code) ?? ""}`;
}

// "Pris: 150.000-75.000-40.000 … kr" → 150000.
export function parseFirstPrize(text: string | null): number | null {
  if (!text) return null;
  const m = /Pris:\s*([\d.\s]+)/i.exec(text);
  if (!m) return null;
  const n = parseInt(m[1].replace(/[.\s]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function yearStats(x: unknown): YearStats | null {
  const o = obj(x);
  if (!o) return null;
  const placement = obj(o.placement) ?? {};
  const wp = num(o.winPercentage);
  const earn = num(o.earnings);
  return {
    starts: int(o.starts) ?? 0,
    wins: int(placement["1"]) ?? 0,
    seconds: int(placement["2"]) ?? 0,
    thirds: int(placement["3"]) ?? 0,
    winPercentage: wp === null ? null : wp / 100,
    earnings: earn === null ? null : Math.round(earn / 100),
  };
}

function personStats(x: unknown): PersonStats | null {
  const years = obj(obj(x)?.years);
  if (!years) return null;
  const out: PersonStats = {};
  for (const [year, v] of Object.entries(years)) {
    const ys = yearStats(v);
    if (ys && /^\d{4}$/.test(year)) out[year] = ys;
  }
  return Object.keys(out).length ? out : null;
}

function horseStats(x: unknown): HorseStats | null {
  const o = obj(x);
  if (!o) return null;
  const years = personStats(o) ?? {};
  const life = yearStats(o.life);
  if (!Object.keys(years).length && !life) return null;
  return { years, life };
}

// Utländska hästar och personer (t.ex. norska kallblod) saknar id hos ATG,
// och kuskarna har id 0. De får ett eget negativt id av namnet (FNV-1a), så
// att de går att spara och känns igen nästa hämtning. ATG:s egna id är > 0.
export function syntheticId(key: string): number {
  let h = 0x811c9dc5;
  for (const ch of key.normalize("NFC").toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return -((h % 2_000_000_000) + 1);
}

const realId = (x: unknown): number | null => {
  const n = int(x);
  return n !== null && n > 0 ? n : null;
};

export function parsePerson(x: unknown, warn?: Warn, where = "person"): ParsedPerson | null {
  const o = obj(x);
  if (!o) return null;
  const firstName = str(o.firstName);
  const lastName = str(o.lastName);
  if (!lastName) {
    warn?.(`${where}: saknar efternamn`);
    return null;
  }
  return {
    atgPersonId: realId(o.id) ?? syntheticId(`person|${firstName ?? ""}|${lastName}`),
    firstName: firstName ?? "",
    lastName,
    shortName: str(o.shortName),
    location: str(o.location),
    stats: personStats(o.statistics),
  };
}

const toOdds = (hundredths: number | null) => (hundredths === null || hundredths <= 0 ? null : hundredths / 100);

// ---- Kalendern --------------------------------------------------------------

export function parseCalendarDay(json: unknown, warn?: Warn, gameType: GameType = "V85"): CalendarGame[] {
  const games = obj(obj(json)?.games);
  if (!games) {
    warn?.("kalender: games saknas");
    return [];
  }
  const trackNames = new Map<number, string>();
  for (const t of arr(obj(json)?.tracks)) {
    const id = int(obj(t)?.id);
    const name = str(obj(t)?.name);
    if (id !== null && name) trackNames.set(id, name);
  }
  const out: CalendarGame[] = [];
  for (const g of arr(games[gameType])) {
    const o = obj(g);
    const id = str(o?.id);
    const startTime = parseAtgTime(o?.startTime) ?? parseAtgTime(o?.scheduledStartTime);
    if (!o || !id || !id.startsWith(`${gameType}_`) || !startTime) {
      warn?.(`kalender: ${gameType}-spel utan id eller starttid`);
      continue;
    }
    const trackIds = arr(o.tracks).map(int).filter((n): n is number => n !== null);
    out.push({ id, status: str(o.status), startTime, trackIds, trackName: trackNames.get(trackIds[0]) ?? null });
  }
  return out;
}

// Första spelet vars första start är senare än nu − 12 h (specen 10.1 steg 1).
export function pickNextGame(games: CalendarGame[], now: Date): CalendarGame | null {
  const limit = now.getTime() - 12 * 3600_000;
  const candidates = games.filter((g) => g.startTime.getTime() > limit).sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  return candidates[0] ?? null;
}

// ---- Spelet -----------------------------------------------------------------

function parseResult(start: Obj, warn: Warn, where: string): ParsedResult | null {
  const r = obj(start.result);
  if (!r) return null;
  const plats = obj(obj(start.pools)?.plats);
  const place = int(r.place);
  const finishOrder = int(r.finishOrder);
  const finalOdds = num(r.finalOdds);
  // Struken häst: result finns men bara med finishOrder och finalOdds 0.
  if (place === null && finishOrder === null && r.disqualified === undefined) {
    warn(`${where}: result utan placering`);
  }
  return {
    place,
    finishOrder,
    disqualified: bool(r.disqualified),
    galloped: bool(r.galloped),
    kmTime: formatKmTime(r.kmTime),
    finalOdds: finalOdds !== null && finalOdds > 0 ? finalOdds : null,
    placeOddsMin: toOdds(int(plats?.minOdds)),
    placeOddsMax: toOdds(int(plats?.maxOdds)),
  };
}

function parseStart(x: unknown, raceDate: string, warn: Warn, where: string, gameType: GameType = "V85"): ParsedStart | null {
  const s = obj(x);
  if (!s) return null;
  const number = int(s.number);
  const distance = int(s.distance);
  const horse = obj(s.horse);
  const horseName = str(horse?.name);
  if (number === null || distance === null || !horse || !horseName) {
    warn(`${where}: start saknar nummer, distans eller häst`);
    return null;
  }
  const w = `${where} nr ${number}`;
  const age = int(horse.age);
  const raceYear = parseInt(raceDate.slice(0, 4), 10);
  const birthYear = age !== null && Number.isFinite(raceYear) ? raceYear - age : null;
  const country = str(horse.nationality) ?? str(horse.country) ?? null;
  const horseId = realId(horse.id) ?? syntheticId(`horse|${horseName}|${country ?? ""}|${birthYear ?? ""}`);
  const pools = obj(s.pools);
  const scratched = bool(s.scratched);
  const streck = int(obj(pools?.[gameType])?.betDistribution);
  const hasResult = obj(s.result) !== null && !scratched;
  const money = int(horse.money);
  return {
    number,
    postPosition: int(s.postPosition),
    distance,
    scratched,
    horse: {
      atgHorseId: horseId,
      name: horseName,
      sex: str(horse.sex),
      age,
      birthYear,
      country,
    },
    record: formatRecord(horse.record),
    earnings: money,
    horseStats: horseStats(horse.statistics),
    shoes: horse.shoes ?? null,
    sulky: horse.sulky ?? null,
    driver: parsePerson(s.driver, warn, `${w} kusk`),
    trainer: parsePerson(horse.trainer, warn, `${w} tränare`),
    originalDriver: s.originalDriver ? parsePerson(s.originalDriver, warn, `${w} ursprunglig kusk`) : null,
    streck: streck !== null && streck >= 0 && streck <= 10000 ? streck : null,
    winOdds: toOdds(int(obj(pools?.vinnare)?.odds)),
    result: hasResult ? parseResult(s, warn, w) : null,
  };
}

export function parseGame(json: unknown, warn: Warn = () => {}): ParsedGame | null {
  const g = obj(json);
  const id = str(g?.id);
  if (!g || !id) {
    warn("spel: id saknas");
    return null;
  }
  const gameType = gameTypeOfId(id) ?? "V85";
  const races: ParsedRace[] = [];
  arr(g.races).forEach((x, index) => {
    const r = obj(x);
    const where = `${id} avd ${index + 1}`;
    if (!r) return warn(`${where}: inget lopp`);
    const atgRaceId = str(r.id);
    const raceNumber = int(r.number);
    const startAt = parseAtgTime(r.startTime) ?? parseAtgTime(r.scheduledStartTime);
    const distance = int(r.distance);
    const startMethod = parseStartMethod(r.startMethod);
    const date = str(r.date) ?? id.split("_")[1] ?? "";
    if (!atgRaceId || raceNumber === null || !startAt || distance === null) {
      return warn(`${where}: saknar id, nummer, starttid eller distans`);
    }
    if (!startMethod) warn(`${where}: okänd startmetod ${String(r.startMethod)}`);
    const status = str(r.status);
    const prizeText = str(r.prize);
    const rawStarts = arr(r.starts);
    const starts = rawStarts.map((s) => parseStart(s, date, warn, where, gameType)).filter((s): s is ParsedStart => s !== null);
    races.push({
      atgRaceId,
      leg: index + 1,
      raceNumber,
      name: str(r.name) ?? `Lopp ${raceNumber}`,
      startAt,
      scheduledStartAt: parseAtgTime(r.scheduledStartTime),
      distance,
      startMethod: startMethod ?? "AUTO",
      prize: parseFirstPrize(prizeText),
      prizeText,
      terms: arr(r.terms).map(str).filter((t): t is string => t !== null),
      status,
      hasResult: status === "results" && starts.some((s) => s.result !== null),
      cancelled: !!status && status.toLowerCase().includes("cancel"),
      starts,
      atgStarts: rawStarts.length,
    });
  });
  const first = obj(arr(g.races)[0]);
  const track = obj(first?.track);
  const trackId = int(track?.id);
  const trackName = str(track?.name);
  const dateFromId = /^[A-Z0-9]+_(\d{4}-\d{2}-\d{2})_/.exec(id)?.[1] ?? str(first?.date);
  if (!races.length || trackId === null || !trackName || !dateFromId) {
    warn(`${id}: saknar lopp, bana eller datum`);
    return null;
  }
  const legs = legsFor(gameType);
  if (races.length !== legs) warn(`${id}: ${races.length} lopp i stället för ${legs}`);
  return {
    atgGameId: id,
    status: str(g.status),
    date: dateFromId,
    trackId,
    trackName,
    firstStartAt: races.reduce((min, r) => (r.startAt < min ? r.startAt : min), races[0].startAt),
    races,
    hasStreck: races.some((r) => r.starts.some((s) => s.streck !== null)),
    gameType,
  };
}

// ---- Startens tidigare lopp ---------------------------------------------------

export function parseRecord(x: unknown, warn: Warn = () => {}): ParsedRecord | null {
  const r = obj(x);
  const date = str(r?.date);
  const track = obj(r?.track);
  const trackName = str(track?.name);
  if (!r || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !trackName) {
    warn("record: saknar datum eller bana");
    return null;
  }
  const race = obj(r.race);
  const start = obj(r.start);
  const driver = obj(start?.driver);
  const driverName = [str(driver?.firstName), str(driver?.lastName)].filter(Boolean).join(" ") || null;
  const firstPrize = int(race?.firstPrize);
  return {
    date,
    trackName,
    trackId: int(track?.id),
    atgRaceRef: str(race?.id),
    raceNumber: int(race?.number),
    distance: int(start?.distance),
    startMethod: parseStartMethod(race?.startMethod),
    postPosition: int(start?.postPosition),
    // place är en sträng ("7", "0") och saknas vid diskning och strykning.
    place: int(r.place),
    galloped: bool(r.galloped),
    disqualified: bool(r.disqualified),
    scratched: bool(r.scratched),
    kmTime: formatKmTime(r.kmTime),
    odds: toOdds(int(r.odds)),
    driverName,
    firstPrize: firstPrize === null ? null : Math.round(firstPrize / 100),
  };
}

export function parseStartDetail(json: unknown, warn: Warn = () => {}): ParsedStartDetail | null {
  const o = obj(json);
  const horse = obj(o?.horse);
  if (!o || !horse) {
    warn("start: horse saknas");
    return null;
  }
  const results = obj(horse.results);
  if (!results) warn("start: horse.results saknas");
  const seen = new Set<string>();
  const records: ParsedRecord[] = [];
  for (const x of arr(results?.records)) {
    const rec = parseRecord(x, warn);
    if (!rec) continue;
    // Unikhet i databasen är (häst, datum, bana). Två lopp samma dag på samma
    // bana (försök + final) behåller det första i ATG:s ordning (nyast först).
    const key = `${rec.date}|${rec.trackName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push(rec);
  }
  return {
    raceId: str(o.raceId),
    startNumber: int(o.startNumber),
    atgHorseId: realId(horse.id),
    horseStats: horseStats(horse.statistics),
    driver: parsePerson(o.driver, warn, "start kusk"),
    trainer: parsePerson(horse.trainer, warn, "start tränare"),
    records,
    hasMoreRecords: bool(results?.hasMoreRecords),
  };
}

// ---- Statistikbasen: kalenderns lopp och hela lopp ------------------------------------

// Svenska travlopp i dagens kalender (lopp-id), bara de som har resultat.
export function swedishTrotRaceIds(json: unknown): string[] {
  const out: string[] = [];
  for (const t of arr(obj(json)?.tracks)) {
    const track = obj(t);
    if (!track || str(track.countryCode) !== "SE" || str(track.sport) !== "trot") continue;
    for (const r of arr(track.races)) {
      const race = obj(r);
      const id = str(race?.id);
      if (id && str(race?.status) === "results") out.push(id);
    }
  }
  return out;
}

export type HistStartParsed = {
  number: number;
  postPosition: number | null;
  distance: number;
  scratched: boolean;
  place: number | null;
  disqualified: boolean;
  galloped: boolean;
  finalOdds: number | null;
};

export type HistRaceParsed = {
  id: string;
  date: string;
  trackId: number;
  trackName: string;
  raceNumber: number;
  distance: number;
  startMethod: AtgStartMethod;
  starts: HistStartParsed[];
};

// Ett avgjort svenskt travlopp (races/<id>). null = inte avgjort, inte
// svenskt trav, inställt eller saknar det som statistiken behöver.
export function parseHistRace(json: unknown): HistRaceParsed | null {
  const r = obj(json);
  const id = str(r?.id);
  const date = str(r?.date);
  const track = obj(r?.track);
  const trackId = int(track?.id);
  const trackName = str(track?.name);
  const raceNumber = int(r?.number);
  const distance = int(r?.distance);
  const startMethod = parseStartMethod(r?.startMethod);
  if (!r || !id || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || trackId === null || !trackName || raceNumber === null || distance === null || !startMethod) return null;
  if (str(r.status) !== "results" || (str(r.sport) ?? "trot") !== "trot") return null;
  const country = str(track?.countryCode);
  if (country && country !== "SE") return null;
  const starts: HistStartParsed[] = [];
  for (const x of arr(r.starts)) {
    const s = obj(x);
    const number = int(s?.number);
    if (!s || number === null) continue;
    const scratched = bool(s.scratched);
    const res = obj(s.result);
    const odds = num(res?.finalOdds);
    starts.push({
      number,
      postPosition: int(s.postPosition),
      distance: int(s.distance) ?? distance,
      scratched,
      place: scratched ? null : int(res?.place),
      disqualified: !scratched && bool(res?.disqualified),
      galloped: !scratched && bool(res?.galloped),
      finalOdds: !scratched && odds !== null && odds > 0 && odds < 10000 ? odds : null,
    });
  }
  // Ett avgjort lopp har minst en häst med placering 1.
  if (!starts.some((s) => s.place === 1)) return null;
  return { id, date, trackId, trackName, raceNumber, distance, startMethod, starts };
}

// ---- Hämtning -------------------------------------------------------------------

export class AtgError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = "AtgError";
  }
}

export type AtgFetch = (path: string) => Promise<unknown>;

// Riktigt anrop mot ATG. Byts ut mot fixturer i testerna (se lib/fetch-round.ts).
export const atgFetch: AtgFetch = async (path) => {
  let res: Response;
  try {
    res = await fetch(`${ATG_BASE}/${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": ATG_USER_AGENT },
      signal: AbortSignal.timeout(ATG_TIMEOUT_MS),
    });
  } catch (e) {
    throw new AtgError(e instanceof Error && e.name === "TimeoutError" ? "ATG svarade inte i tid" : "Kunde inte nå ATG");
  }
  if (res.status === 404) throw new AtgError("ATG hittade inte spelet", 404);
  if (!res.ok) throw new AtgError(`ATG svarade ${res.status}`, res.status);
  try {
    return await res.json();
  } catch {
    throw new AtgError("ATG svarade med ogiltig data");
  }
};

export const atgPaths = {
  calendarDay: (date: string) => `calendar/day/${date}`,
  race: (raceId: string) => `races/${encodeURIComponent(raceId)}`,
  game: (gameId: string) => `games/${encodeURIComponent(gameId)}`,
  start: (raceId: string, number: number) => `races/${encodeURIComponent(raceId)}/start/${number}`,
};

// Kör `fn` över `items` med högst `limit` samtidiga anrop.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
