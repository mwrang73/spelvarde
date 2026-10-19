// Svensk tid (Europe/Stockholm). Kopierad från Tabellgissningen. ATG:s tider
// saknar tidszon och är svensk väggklockstid.
// Rena funktioner, inget paket: bara Intl.

const TZ = "Europe/Stockholm";

const partsFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

// Egna namn i stället för Intl:s, så att texten blir exakt densamma i alla
// webbläsare och i Node (CLDR-versioner skiljer sig, t.ex. "okt" / "okt.").
const WEEKDAYS_SHORT = ["sön", "mån", "tis", "ons", "tors", "fre", "lör"];
const WEEKDAYS_LONG = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];
const MONTHS_SHORT = ["jan", "feb", "mars", "apr", "maj", "juni", "juli", "aug", "sep", "okt", "nov", "dec"];
const MONTHS_LONG = [
  "januari", "februari", "mars", "april", "maj", "juni",
  "juli", "augusti", "september", "oktober", "november", "december",
];

export type StockholmParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = söndag
  weekdayShort: string; // "lör"
  weekdayLong: string; // "lördag"
  monthShort: string; // "okt"
  monthLong: string; // "oktober"
};

function pad(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

// Väggklockan i Stockholm vid ett givet ögonblick.
export function stockholmParts(date: Date): StockholmParts {
  if (!(date instanceof Date) || isNaN(date.getTime())) throw new Error("Ogiltigt datum.");
  const map: Record<string, number> = {};
  for (const p of partsFormat.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = parseInt(p.value, 10);
  }
  const weekday = new Date(Date.UTC(map.year, map.month - 1, map.day)).getUTCDay();
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
    weekday,
    weekdayShort: WEEKDAYS_SHORT[weekday],
    weekdayLong: WEEKDAYS_LONG[weekday],
    monthShort: MONTHS_SHORT[map.month - 1],
    monthLong: MONTHS_LONG[map.month - 1],
  };
}

// Väggklockan i Stockholm, uttryckt som om den vore UTC (bara för att räkna
// ut förskjutningen).
function wallAsUtcMs(date: Date): number {
  const p = stockholmParts(date);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

// "2026-10-10T15:15" -> Date (UTC-ögonblicket då klockan är 15:15 i Stockholm).
// Kastar vid ogiltig sträng, datum som inte finns (31 februari) och klockslag
// som inte finns (02:00-02:59 natten då sommartiden börjar). Klockslag som
// finns två gånger (02:00-02:59 natten då vintertiden börjar) tolkas som det
// senare av de två, alltså vintertid.
export function stockholmLocalToUtc(local: string): Date {
  const m = typeof local === "string" ? LOCAL_RE.exec(local.trim()) : null;
  if (!m) throw new Error("Ogiltig tid.");
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  const hour = parseInt(m[4], 10);
  const minute = parseInt(m[5], 10);
  const second = m[6] ? parseInt(m[6], 10) : 0;
  if (year < 2000 || year > 2100) throw new Error("Ogiltig tid.");
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) throw new Error("Ogiltig tid.");

  const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(wanted);
  // Date.UTC rullar över ogiltiga datum (31 feb -> 3 mars) - då finns datumet inte.
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new Error("Datumet finns inte.");

  // Gissa att UTC = väggtiden, läs av vilken väggtid gissningen motsvarar i
  // Stockholm och dra av skillnaden. En gång till, ifall gissningen och svaret
  // ligger på var sin sida om ett byte mellan sommar- och vintertid.
  let result = wanted - (wallAsUtcMs(new Date(wanted)) - wanted);
  const secondOffset = wallAsUtcMs(new Date(result)) - result;
  result = wanted - secondOffset;
  if (wallAsUtcMs(new Date(result)) !== wanted) throw new Error("Klockslaget finns inte.");
  return new Date(result);
}

// Omvänt, för att fylla i datetime-local-fält: Date -> "2026-10-10T15:15".
export function utcToStockholmLocal(date: Date): string {
  const p = stockholmParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

// Dagens datum i Stockholm, till parseRoundPaste (årtalshärledningen).
export function stockholmToday(now: Date): { year: number; month: number; day: number } {
  const p = stockholmParts(now);
  return { year: p.year, month: p.month, day: p.day };
}

// Visning i svensk tid:
//   "time"    -> "15:15"
//   "dayTime" -> "lör 10 okt 15:15"
//   "long"    -> "lördag 10 oktober 2026"
// Behövs någon annan sammansättning: bygg den av stockholmParts().
export function formatStockholm(date: Date | string, style: "time" | "dayTime" | "long"): string {
  const p = stockholmParts(typeof date === "string" ? new Date(date) : date);
  const time = `${pad(p.hour)}:${pad(p.minute)}`;
  if (style === "time") return time;
  if (style === "dayTime") return `${p.weekdayShort} ${p.day} ${p.monthShort} ${time}`;
  return `${p.weekdayLong} ${p.day} ${p.monthLong} ${p.year}`;
}

// "2026-10-24" för ett ögonblick, i svensk tid.
export function stockholmDateString(date: Date): string {
  const p = stockholmParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

// "2026-10-24" + n dagar (kalenderdagar, oberoende av tidszon).
export function addDaysToDateString(date: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error("Ogiltigt datum.");
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// Tolkar ATG:s tider. Utan tidszon ("2026-10-24T15:00:00") är det svensk
// väggklockstid. Med "Z" eller förskjutning tolkas den som den står.
export function parseAtgTime(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const s = value.trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return null;
  try {
    return stockholmLocalToUtc(`${m[1]}T${m[2]}${m[3] ? ":" + m[3] : ""}`);
  } catch {
    return null;
  }
}
