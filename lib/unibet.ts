// Unibets racing-API (specen e2.2, 10.5). Inofficiellt: samma GraphQL-API som
// unibet.se:s travsida använder, utan inloggning och med introspektionen
// avstängd. All tolkning ligger här, med egna typvakter som i lib/atg.ts:
// okända eller saknade fält ger null och en varning, aldrig en krasch. Testas
// mot sparade svar i test/fixtures/unibet/ (lib/unibet.test.ts).
//
// ---------------------------------------------------------------------------
// Verifierat mot riktiga svar 2026-10-21 (fixturerna):
//
// Banor och lopp (viewer.meetings)
// - countryCodes:["SE"] ger ett tomt svar, så alla länder hämtas och
//   filtreras på meetingKey ".H.SWE.<bana>", t.ex. "202610241100.H.SWE.jagersro".
// - Banan i nyckeln är gemener utan å/ä/ö, och blanksteg skrivs som "_"
//   ("globe_derby", "albion_park"). Båda sidor normaliseras därför med
//   normalizeTrack, som tar bort allt utom a–z och 0–9.
// - eventKey har loppets egen timme som prefix och skiljer sig alltså från
//   meetingKey ("202610241300.H.SWE.jagersro.5" i mötet "202610241100…").
//   Nyckeln tas därför alltid från events[], den byggs aldrig själv.
// - events[].sequence är loppnumret på banan (Race.raceNumber).
// - events[].status: "Open", "Closed" och "Abandoned" har setts. Lopp som har
//   körts försvinner ur listan under dagen.
//
// Lopp (viewer.event)
// - hasFixedPrices = false och prices = [] före öppning, trots att
//   marknaderna står som "Open".
// - competitors[].sequence = startnumret, status "Starter" eller "Scratched".
//   En struken häst har prices med price = 0.
// - prices[].betType "FixedPlace" (plats) och "FixedWin" (vinnare), price
//   oavrundat (1.1818181818). Ordningen mellan dem varierar.
// ---------------------------------------------------------------------------

export const UNIBET_URL = "https://rsa.unibet.co.uk/api/v1/graphql";
export const UNIBET_ORIGIN = "https://www.unibet.se";
export const UNIBET_TIMEOUT_MS = 8_000;
// Spärren (6.9): högst en oddshämtning per omgång och 2 minuter.
export const ODDS_LOCK_MS = 2 * 60_000;
// Gamla odds (6.9): samma gräns som strecket.
export const ODDS_STALE_MS = 12 * 3600_000;
// Mark.unibetOdds har samma gränser som inskrivna odds (lib/odds-input.ts).
export const MARK_ODDS_MIN = 1.01;
export const MARK_ODDS_MAX = 99.99;

export type Warn = (message: string) => void;

// ---- Typvakter --------------------------------------------------------------

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
  return n !== null && Number.isInteger(n) ? n : null;
}

// Avrundning till hundradelar innan något sparas eller jämförs (6.9):
// 1,1666666667 blir 1,17.
export const round2 = (x: number) => Math.round(x * 100) / 100;

// ---- Banans namn ------------------------------------------------------------

// "Jägersro" → "jagersro", "Åby" → "aby", "Östersund" → "ostersund",
// "Globe Derby" / "globe_derby" → "globederby". Gemener, å och ä blir a, ö
// blir o, övriga accenter tas bort, och allt utom a–z och 0–9 försvinner.
export function normalizeTrack(name: string): string {
  return name
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Hästnamn för kontrollen (bara loggen): "Kaley D.c." och "Kaley D.C." är samma.
export const normalizeHorse = (name: string) => normalizeTrack(name);

// ---- Tidsfönstret -------------------------------------------------------------

// Omgångens datum 00:00–23:59:59.999 i Europe/Stockholm, i UTC.
// stockholmMidnight skickas in (lib/stockholm-time.ts) så att filen inte
// beror på serverns tidszon.
export function dayWindow(date: string, toUtc: (local: string) => Date): { start: string; end: string } {
  const start = toUtc(`${date}T00:00`);
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  const end = new Date(toUtc(`${next}T00:00`).getTime() - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

// ---- Frågorna -----------------------------------------------------------------

const EVENT_KEY_RE = /^\d{12}\.H\.[A-Z]{3}\.[a-z0-9_]{1,60}\.\d{1,2}$/;
export const isEventKey = (x: unknown): x is string => typeof x === "string" && EVENT_KEY_RE.test(x);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function meetingsQuery(window: { start: string; end: string }): string {
  if (!ISO_RE.test(window.start) || !ISO_RE.test(window.end)) throw new Error("Ogiltigt tidsfönster.");
  return `query { viewer { meetings(raceTypes:["H"], countryCodes:[], clientCountryCode:"SE", startDateTime:"${window.start}", endDateTime:"${window.end}") { meetingKey name events { eventKey sequence eventDateTimeUtc status } } } }`;
}

export function eventQuery(eventKey: string): string {
  if (!isEventKey(eventKey)) throw new Error("Ogiltig eventKey.");
  return `query { viewer { event(eventKey:"${eventKey}", clientCountryCode:"SE") { hasFixedPrices markets { name priceTypes { code name status } } competitors { name sequence status prices { betType code price flucs { price timestampUtc } } } } } }`;
}

// ---- Banor och lopp -------------------------------------------------------------

export type UnibetEvent = { eventKey: string; sequence: number; startUtc: string | null; status: string | null };
export type UnibetMeeting = { meetingKey: string; name: string | null; country: string | null; track: string | null; events: UnibetEvent[] };

// "202610241100.H.SWE.jagersro" → { country: "SWE", track: "jagersro" }.
function meetingParts(key: string): { country: string; track: string } | null {
  const m = /^\d{12}\.H\.([A-Z]{3})\.([a-z0-9_]+)$/.exec(key);
  return m ? { country: m[1], track: m[2] } : null;
}

function viewer(json: unknown, warn: Warn): Obj | null {
  const root = obj(json);
  if (!root) {
    warn("Unibet: svaret är inget objekt");
    return null;
  }
  if (arr(root.errors).length) warn(`Unibet: ${arr(root.errors).length} fel i svaret`);
  const v = obj(obj(root.data)?.viewer);
  if (!v) warn("Unibet: data.viewer saknas");
  return v;
}

export function parseMeetings(json: unknown, warn: Warn = () => {}): UnibetMeeting[] {
  const v = viewer(json, warn);
  if (!v) return [];
  const out: UnibetMeeting[] = [];
  for (const raw of arr(v.meetings)) {
    const m = obj(raw);
    const meetingKey = str(m?.meetingKey);
    if (!m || !meetingKey) {
      warn("Unibet: möte utan meetingKey");
      continue;
    }
    const parts = meetingParts(meetingKey);
    const events: UnibetEvent[] = [];
    for (const rawEv of arr(m.events)) {
      const e = obj(rawEv);
      const eventKey = str(e?.eventKey);
      const sequence = int(e?.sequence);
      if (!e || !eventKey || !isEventKey(eventKey) || sequence === null) {
        warn(`Unibet: lopp utan giltig eventKey eller sequence i ${meetingKey}`);
        continue;
      }
      events.push({ eventKey, sequence, startUtc: str(e.eventDateTimeUtc), status: str(e.status) });
    }
    out.push({ meetingKey, name: str(m.name), country: parts?.country ?? null, track: parts?.track ?? null, events });
  }
  return out;
}

// Loppen på omgångens bana per loppnummer. Svenska travmöten vars bana i
// nyckeln motsvarar trackName. Finns banan i flera möten slås de ihop. null
// när banan inte finns hos Unibet ("Unibet har inga odds än").
export function pickTrackEvents(meetings: UnibetMeeting[], trackName: string): Map<number, UnibetEvent> | null {
  const want = normalizeTrack(trackName);
  if (!want) return null;
  const hits = meetings.filter((m) => m.country === "SWE" && m.track !== null && normalizeTrack(m.track) === want);
  if (!hits.length) return null;
  const out = new Map<number, UnibetEvent>();
  for (const m of hits) for (const e of m.events) if (!out.has(e.sequence)) out.set(e.sequence, e);
  return out;
}

// ---- Ett lopp -----------------------------------------------------------------------

export type UnibetCompetitor = {
  number: number;
  name: string | null;
  // Unibets status, t.ex. "Starter". Saknas fältet blir det "Unknown".
  status: string;
  // Startar enligt Unibet (status "Starter").
  starter: boolean;
  // Avrundade priser. null när priset saknas, är 0 eller under 1,00.
  place: number | null;
  win: number | null;
};

export type ParsedUnibetEvent = {
  hasFixedPrices: boolean;
  competitors: UnibetCompetitor[];
  // Inga odds än (6.9): hasFixedPrices = false, eller ingen startande häst
  // har ett platsodds.
  noPrices: boolean;
};

function price(prices: unknown[], betType: string): number | null {
  for (const raw of prices) {
    const p = obj(raw);
    if (str(p?.betType) !== betType) continue;
    const v = num(p?.price);
    return v !== null && v >= 1 ? round2(v) : null;
  }
  return null;
}

export function parseEvent(json: unknown, warn: Warn = () => {}): ParsedUnibetEvent | null {
  const v = viewer(json, warn);
  const e = obj(v?.event);
  if (!e) {
    warn("Unibet: event saknas i svaret");
    return null;
  }
  const hasFixedPrices = e.hasFixedPrices === true;
  if (typeof e.hasFixedPrices !== "boolean") warn("Unibet: hasFixedPrices saknas");
  const competitors: UnibetCompetitor[] = [];
  const seen = new Set<number>();
  for (const raw of arr(e.competitors)) {
    const c = obj(raw);
    const number = int(c?.sequence);
    if (!c || number === null || number < 1) {
      warn("Unibet: häst utan giltigt startnummer");
      continue;
    }
    if (seen.has(number)) {
      warn(`Unibet: startnummer ${number} finns två gånger`);
      continue;
    }
    seen.add(number);
    const status = str(c.status) ?? "Unknown";
    if (!str(c.status)) warn(`Unibet: status saknas för nr ${number}`);
    const starter = status === "Starter";
    const prices = arr(c.prices);
    competitors.push({
      number,
      name: str(c.name),
      status,
      starter,
      place: starter ? price(prices, "FixedPlace") : null,
      win: starter ? price(prices, "FixedWin") : null,
    });
  }
  competitors.sort((a, b) => a.number - b.number);
  const noPrices = !hasFixedPrices || !competitors.some((c) => c.starter && c.place !== null);
  return { hasFixedPrices, competitors, noPrices };
}

// Platsoddset som skrivs till Mark.unibetOdds: över 99,99 blir 99,99 (fältets
// gräns), under 1,01 räknas som inget pris. Det oavkortade värdet sparas i
// UnibetPrice.
export function markOddsOf(place: number | null): number | null {
  if (place === null || place < MARK_ODDS_MIN) return null;
  return Math.min(place, MARK_ODDS_MAX);
}

// ---- Hämtning -----------------------------------------------------------------------

export class UnibetError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = "UnibetError";
  }
}

// En GraphQL-fråga in, tolkad JSON ut. Byts mot fixturer i testerna.
export type UnibetFetch = (query: string) => Promise<unknown>;

// Riktigt anrop. Bara på servern (CORS och origin-headern).
export const unibetFetch: UnibetFetch = async (query) => {
  let res: Response;
  try {
    res = await fetch(UNIBET_URL, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json", origin: UNIBET_ORIGIN },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(UNIBET_TIMEOUT_MS),
    });
  } catch (e) {
    throw new UnibetError(e instanceof Error && e.name === "TimeoutError" ? "Unibet svarade inte i tid" : "Kunde inte nå Unibet");
  }
  if (!res.ok) throw new UnibetError(`Unibet svarade ${res.status}`, res.status);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new UnibetError("Unibet svarade med ogiltig data");
  }
  // GraphQL-fel utan data (t.ex. en ändrad fråga) är ett misslyckat anrop.
  const root = obj(json);
  if (root && arr(root.errors).length && !obj(root.data)) throw new UnibetError("Unibet svarade med ett fel");
  return json;
};
