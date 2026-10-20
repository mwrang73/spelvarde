// Statistikbasen: alla svenska travlopp från ATG de senaste två åren, i egna
// tabeller (HistDay, HistRace, HistStart). Ersätter travstatistik.se för
// vinst % och plats % per startnummer, och gör att statistiken inte behöver
// läsas om vid varje omgång.
//
// Inläsningen går dag för dag, nyaste först, i korta anrop (S10:s knapp kör
// anropen i följd tills allt är inläst, cron-jobbet lägger till gårdagen).
// Varje dag är idempotent: lopp som redan finns hoppas över och en dag
// markeras som inläst först när alla dess lopp är sparade.
//
// Plats = placering 1–3 (inte diskad). Startnummer, inte spår: för autostart
// är de samma, för voltstart räknas startnumret som travstatistik.se gör.

import { Prisma, type PrismaClient } from "@prisma/client";
import { AtgError, atgPaths, mapLimit, parseHistRace, swedishTrotRaceIds, type AtgFetch, type HistRaceParsed } from "@/lib/atg";
import { addDaysToDateString, stockholmDateString } from "@/lib/stockholm-time";

type Db = PrismaClient;

export const HIST_YEARS = 2;
// Tidsbudget per anrop (Vercel avbryter efter 60 s).
export const HIST_BUDGET_MS = 40_000;
// Dagar per varv och samtidiga anrop mot ATG.
const DAYS_PER_BATCH = 5;
const ATG_PARALLEL = 8;

const dateOnly = (d: string) => new Date(`${d}T00:00:00Z`);
const dateStr = (d: Date) => d.toISOString().slice(0, 10);

// Intervallet som ska finnas: från samma dag för två år sedan till i går.
export function histRange(now: Date): { from: string; to: string } {
  const today = stockholmDateString(now);
  const to = addDaysToDateString(today, -1);
  const from = `${Number(today.slice(0, 4)) - HIST_YEARS}${today.slice(4)}`;
  return { from: from.endsWith("-02-29") ? from.replace("-02-29", "-02-28") : from, to };
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysToDateString(d, 1)) out.push(d);
  return out;
}

export type HistStatus = {
  from: string;
  to: string;
  daysTotal: number;
  daysDone: number;
  races: number;
  starts: number;
  // Äldsta och nyaste inlästa loppdag.
  firstDate: string | null;
  lastDate: string | null;
  lastImportedAt: string | null;
  complete: boolean;
};

export async function histStatus(db: Db, now = new Date()): Promise<HistStatus> {
  const { from, to } = histRange(now);
  const [daysDone, races, starts, first, last, latest] = await Promise.all([
    db.histDay.count({ where: { date: { gte: dateOnly(from), lte: dateOnly(to) } } }),
    db.histRace.count(),
    db.histStart.count(),
    db.histRace.findFirst({ orderBy: { date: "asc" }, select: { date: true } }),
    db.histRace.findFirst({ orderBy: { date: "desc" }, select: { date: true } }),
    db.histDay.findFirst({ orderBy: { importedAt: "desc" }, select: { importedAt: true } }),
  ]);
  const daysTotal = datesBetween(from, to).length;
  return {
    from,
    to,
    daysTotal,
    daysDone,
    races,
    starts,
    firstDate: first ? dateStr(first.date) : null,
    lastDate: last ? dateStr(last.date) : null,
    lastImportedAt: latest ? latest.importedAt.toISOString() : null,
    complete: daysDone >= daysTotal,
  };
}

export type HistImportResult = { status: HistStatus; days: number; races: number; failedDays: { date: string; error: string }[] };

async function saveRaces(db: Db, races: HistRaceParsed[]) {
  if (!races.length) return;
  await db.$transaction([
    db.histRace.createMany({
      skipDuplicates: true,
      data: races.map((r) => ({
        id: r.id,
        date: dateOnly(r.date),
        trackId: r.trackId,
        trackName: r.trackName,
        raceNumber: r.raceNumber,
        distance: r.distance,
        startMethod: r.startMethod,
        starters: r.starts.filter((s) => !s.scratched).length,
      })),
    }),
    db.histStart.createMany({
      skipDuplicates: true,
      data: races.flatMap((r) =>
        r.starts.map((s) => ({
          raceId: r.id,
          number: s.number,
          postPosition: s.postPosition,
          distance: s.distance,
          scratched: s.scratched,
          place: s.place,
          disqualified: s.disqualified,
          galloped: s.galloped,
          finalOdds: s.finalOdds,
        })),
      ),
    }),
  ]);
}

// Läser in dagar som saknas, nyaste först, tills tidsbudgeten är slut.
// maxDays begränsar antalet (cron-jobbet). Fel på en dag stoppar inte de andra;
// dagen försöks igen nästa gång.
export async function importHist(db: Db, atg: AtgFetch, opts: { now?: Date; budgetMs?: number; maxDays?: number } = {}): Promise<HistImportResult> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const budget = opts.budgetMs ?? HIST_BUDGET_MS;
  const { from, to } = histRange(now);
  const done = new Set((await db.histDay.findMany({ where: { date: { gte: dateOnly(from), lte: dateOnly(to) } }, select: { date: true } })).map((d) => dateStr(d.date)));
  let missing = datesBetween(from, to).filter((d) => !done.has(d)).reverse();
  if (opts.maxDays !== undefined) missing = missing.slice(0, opts.maxDays);

  let days = 0;
  let races = 0;
  const failedDays: HistImportResult["failedDays"] = [];
  for (let i = 0; i < missing.length && Date.now() - started < budget; i += DAYS_PER_BATCH) {
    const batch = missing.slice(i, i + DAYS_PER_BATCH);
    const calendars = await mapLimit(batch, 4, async (date) => {
      try {
        return { date, ids: swedishTrotRaceIds(await atg(atgPaths.calendarDay(date))), error: null };
      } catch (e) {
        if (e instanceof AtgError && e.status === 404) return { date, ids: [] as string[], error: null };
        return { date, ids: [] as string[], error: e instanceof Error ? e.message : "Kunde inte nå ATG" };
      }
    });
    const ok = calendars.filter((c) => !c.error);
    for (const c of calendars) if (c.error) failedDays.push({ date: c.date, error: c.error });
    const allIds = ok.flatMap((c) => c.ids);
    const have = new Set((await db.histRace.findMany({ where: { id: { in: allIds } }, select: { id: true } })).map((r) => r.id));
    const failedRace = new Set<string>();
    const parsed = await mapLimit(
      allIds.filter((id) => !have.has(id)),
      ATG_PARALLEL,
      async (id) => {
        try {
          return parseHistRace(await atg(atgPaths.race(id)));
        } catch (e) {
          if (e instanceof AtgError && e.status === 404) return null;
          failedRace.add(id.slice(0, 10));
          return null;
        }
      },
    );
    const found = parsed.filter((r): r is HistRaceParsed => r !== null);
    await saveRaces(db, found);
    races += found.length;
    for (const c of ok) {
      if (failedRace.has(c.date)) {
        failedDays.push({ date: c.date, error: "Några lopp gick inte att hämta" });
        continue;
      }
      await db.histDay.upsert({ where: { date: dateOnly(c.date) }, create: { date: dateOnly(c.date), races: c.ids.length }, update: { races: c.ids.length, importedAt: new Date() } });
      days++;
    }
  }
  if (days || races) clearPostCache();
  return { status: await histStatus(db, now), days, races, failedDays };
}

// ---- Vinst % och plats % per startnummer ------------------------------------------------------

export type StartMethod = "AUTO" | "VOLTE";

export type PostRow = { n: number; starts: number; wins: number; top3: number; winPct: number | null; placePct: number | null };

export type PostTable = {
  scope: "all" | "track";
  method: StartMethod;
  // Exakt distans eller distansgruppen när loppen på exakt distans är för få.
  distanceLabel: string;
  exact: boolean;
  races: number;
  from: string;
  to: string;
  byNumber: PostRow[];
};

// Minsta antal lopp för en tabell, och starter för att ett startnummer ska få procent.
export const MIN_RACES_ALL = 150;
export const MIN_RACES_TRACK = 40;
export const MIN_STARTS_PCT = 15;

type Range = { lo: number; hi: number; label: string };

export function distanceGroup(distance: number): Range {
  if (distance < 1800) return { lo: 0, hi: 1799, label: "kort distans (under 1 800 m)" };
  if (distance < 2400) return { lo: 1800, hi: 2399, label: "medeldistans (1 800–2 399 m)" };
  return { lo: 2400, hi: 99999, label: "lång distans (2 400 m och längre)" };
}

const pct1 = (a: number, b: number) => (b > 0 ? Math.round((1000 * a) / b) / 10 : null);

export function toRows(rows: { n: number; starts: number; wins: number; top3: number }[]): PostRow[] {
  return rows.map((r) => ({
    n: r.n,
    starts: r.starts,
    wins: r.wins,
    top3: r.top3,
    winPct: r.starts >= MIN_STARTS_PCT ? pct1(r.wins, r.starts) : null,
    placePct: r.starts >= MIN_STARTS_PCT ? pct1(r.top3, r.starts) : null,
  }));
}

const cache = new Map<string, { at: number; value: PostTable | null }>();
const CACHE_MS = 30 * 60_000;

export function clearPostCache() {
  cache.clear();
}

async function queryTable(db: Db, method: StartMethod, range: Range, from: string, to: string, trackId: number | null) {
  const track = trackId === null ? Prisma.empty : Prisma.sql`AND r."trackId" = ${trackId}`;
  const where = Prisma.sql`r."startMethod" = ${method}::"spelvarde"."StartMethod" AND r."distance" BETWEEN ${range.lo} AND ${range.hi}
    AND r."date" >= ${dateOnly(from)} AND r."date" < ${dateOnly(to)} ${track}`;
  const [count] = await db.$queryRaw<{ races: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS races FROM "spelvarde"."HistRace" r WHERE ${where}`);
  if (!count?.races) return { races: 0, rows: [] };
  const rows = await db.$queryRaw<{ n: number; starts: number; wins: number; top3: number }[]>(Prisma.sql`
    SELECT s."number" AS n, COUNT(*)::int AS starts,
      COUNT(*) FILTER (WHERE s."place" = 1)::int AS wins,
      COUNT(*) FILTER (WHERE s."place" BETWEEN 1 AND 3)::int AS top3
    FROM "spelvarde"."HistStart" s JOIN "spelvarde"."HistRace" r ON r."id" = s."raceId"
    WHERE ${where} AND NOT s."scratched"
    GROUP BY s."number" ORDER BY s."number"`);
  return { races: count.races, rows };
}

// Tabellen för loppets startmetod och distans, alla banor eller en bana, för
// lopp före `before` (omgångens datum) inom de två senaste åren. Exakt distans
// i första hand, annars distansgruppen. null = för få lopp.
export async function postTable(db: Db, q: { method: StartMethod; distance: number; trackId?: number | null; before: Date }): Promise<PostTable | null> {
  const to = dateStr(q.before);
  const from = `${Number(to.slice(0, 4)) - HIST_YEARS}${to.slice(4)}`.replace("-02-29", "-02-28");
  const trackId = q.trackId ?? null;
  const key = `${q.method}|${q.distance}|${trackId}|${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const min = trackId === null ? MIN_RACES_ALL : MIN_RACES_TRACK;
  let value: PostTable | null = null;
  const exactRange = { lo: q.distance, hi: q.distance, label: `${q.distance} m` };
  for (const [range, exact] of [[exactRange, true], [distanceGroup(q.distance), false]] as const) {
    const res = await queryTable(db, q.method, range, from, to, trackId);
    if (res.races >= min) {
      value = { scope: trackId === null ? "all" : "track", method: q.method, distanceLabel: range.label, exact, races: res.races, from, to, byNumber: toRows(res.rows) };
      break;
    }
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// Bästa startnummer bland loppets (ej strukna) för vinst och plats.
export function bestNumbers(table: PostTable | null, numbers: number[]): { win: PostRow | null; place: PostRow | null } {
  if (!table) return { win: null, place: null };
  const rows = table.byNumber.filter((r) => numbers.includes(r.n));
  const best = (k: "winPct" | "placePct") => rows.filter((r) => r[k] !== null).sort((a, b) => (b[k] ?? 0) - (a[k] ?? 0) || a.n - b.n)[0] ?? null;
  return { win: best("winPct"), place: best("placePct") };
}

// Minsta antal lopp för att banans eget bästa spår ska visas bredvid alla banors.
export const MIN_RACES_TRACK_BEST = 150;

// Tabeller för alla avdelningar i en omgång (alla banor, eller banan med
// trackId), en fråga per distinkt startmetod och distans.
export async function postTablesForRaces(db: Db, races: { leg: number; distance: number; startMethod: StartMethod }[], before: Date, trackId: number | null = null): Promise<Map<number, PostTable | null>> {
  const out = new Map<number, PostTable | null>();
  const keys = new Map<string, Promise<PostTable | null>>();
  for (const r of races) {
    const k = `${r.startMethod}|${r.distance}`;
    if (!keys.has(k)) keys.set(k, postTable(db, { method: r.startMethod, distance: r.distance, before, trackId }).catch(() => null));
  }
  for (const r of races) out.set(r.leg, await keys.get(`${r.startMethod}|${r.distance}`)!);
  return out;
}
