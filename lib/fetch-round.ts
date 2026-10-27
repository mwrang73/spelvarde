// Hämta omgång (specen 10.1): stegkedjan som klienten kör, ett kort anrop per
// steg. Steg 1 = spelet, steg 2–9 = hästarnas tidigare starter per
// avdelning, steg 10 = travstatistik.se (steg 11, riktodds, ligger i
// lib/riktodds-server.ts). Varje steg är idempotent (upsert och
// skipDuplicates), så Försök igen och Hämta igen dubblerar aldrig data.
//
// Gemensam data skrivs bara härifrån. userId används bara i FetchLog.
// Databas, ATG och travstatistik skickas in, så att kedjan går att testa mot
// fixturer (lib/fetch-round.db.test.ts).

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  AtgError,
  atgPaths,
  mapLimit,
  parseCalendarDay,
  parseGame,
  parseStartDetail,
  pickNextGame,
  type AtgFetch,
  type CalendarGame,
  type ParsedGame,
  type ParsedPerson,
} from "@/lib/atg";
import { DEFAULT_GAME_TYPE, GAME_ID_RE, gameTypeOfId, legsFor, type GameType } from "@/lib/game-type";
import { matchPerson, normalizeName, parseShortName } from "@/lib/names";
import { raceClass } from "@/lib/race-class";
import { computeRoundRiktodds } from "@/lib/riktodds-server";
import { addDaysToDateString, stockholmDateString } from "@/lib/stockholm-time";
import { TS_PAGES, TS_PAGE_KEYS, interpretPage, type LeagueData, type TsFetch } from "@/lib/travstatistik";
import type { FetchChanges } from "@/lib/types";

export type FetchDeps = {
  db: PrismaClient;
  atg: AtgFetch;
  ts: TsFetch;
  now?: () => Date;
  warn?: (message: string) => void;
};

export const ATG_CONCURRENCY = 6;
export const RECORDS_FRESH_MS = 12 * 3600_000;
export { GAME_ID_RE };

export class FetchStepError extends Error {
  constructor(message: string, readonly status = 502, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "FetchStepError";
  }
}

const dateOnly = (d: string) => new Date(`${d}T00:00:00Z`);
export const dateOnlyString = (d: Date) => d.toISOString().slice(0, 10);
const json = (x: unknown) => (x === null || x === undefined ? undefined : (x as Prisma.InputJsonValue));

// ---- Kalendern ----------------------------------------------------------------------

// Första spelet av spelformen i dag eller de 7 närmaste dagarna vars första
// start är senare än nu − 12 h.
export async function findNextGame(atg: AtgFetch, now: Date, gameType: GameType = DEFAULT_GAME_TYPE, warn?: (m: string) => void): Promise<CalendarGame | null> {
  const today = stockholmDateString(now);
  for (let i = 0; i <= 7; i++) {
    let data: unknown;
    try {
      data = await atg(atgPaths.calendarDay(addDaysToDateString(today, i)));
    } catch (e) {
      if (e instanceof AtgError && e.status === 404) continue;
      throw e;
    }
    const pick = pickNextGame(parseCalendarDay(data, warn, gameType), now);
    if (pick) return pick;
  }
  return null;
}

// ---- Steg 1: spelet -------------------------------------------------------------------

export type GameStepResult = {
  roundId: string;
  atgGameId: string;
  legs: { leg: number; raceId: string; starts: number }[];
  changes: FetchChanges;
  hasStreck: boolean;
  warnings: number;
};

async function upsertPerson(db: PrismaClient, p: ParsedPerson, now: Date): Promise<string> {
  const data = {
    firstName: p.firstName,
    lastName: p.lastName,
    shortName: p.shortName,
    location: p.location,
    ...(p.stats ? { statsJson: p.stats as Prisma.InputJsonValue, statsAt: now } : {}),
  };
  const row = await db.person.upsert({
    where: { atgPersonId: p.atgPersonId },
    create: { atgPersonId: p.atgPersonId, ...data },
    update: data,
    select: { id: true },
  });
  return row.id;
}

// "avd 2: 0 av 11 hästar" för avdelningar där starter föll bort i
// tolkningen, eller fel antal avdelningar. null = allt kom med.
export function incompleteLegs(parsed: ParsedGame): string | null {
  const parts = parsed.races.filter((r) => r.starts.length < r.atgStarts).map((r) => `avd ${r.leg}: ${r.starts.length} av ${r.atgStarts} hästar`);
  const legs = legsFor(gameTypeOfId(parsed.atgGameId) ?? DEFAULT_GAME_TYPE);
  if (parsed.races.length !== legs) parts.unshift(`${parsed.races.length} av ${legs} avdelningar`);
  return parts.length ? parts.join(", ") : null;
}

// skipRiktodds: räkna inte om riktoddset vid strykning här (Uppdatera streck
// räknar om efteråt i ett eget anrop).
export async function fetchGameStep(deps: FetchDeps, input: { gameId?: string | null; userId: string | null; gameType?: GameType; skipRiktodds?: boolean }): Promise<GameStepResult | null> {
  const { db, atg } = deps;
  const now = deps.now?.() ?? new Date();
  const warnings: string[] = [];
  const warn = (m: string) => {
    warnings.push(m);
    deps.warn?.(m);
  };
  const startedAt = now;

  let gameId = input.gameId ?? null;
  if (gameId && !GAME_ID_RE.test(gameId)) throw new FetchStepError("Ogiltigt spel-id.", 400);
  if (!gameId) {
    const next = await findNextGame(atg, now, input.gameType ?? DEFAULT_GAME_TYPE, warn);
    if (!next) return null;
    gameId = next.id;
  }

  const parsed = parseGame(await atg(atgPaths.game(gameId)), warn);
  if (!parsed) throw new FetchStepError("ATG svarade med ett spel som inte gick att läsa.");
  // En halv startlista får aldrig sparas i tysthet: stoppa innan något skrivs.
  const incomplete = incompleteLegs(parsed);
  if (incomplete) throw new FetchStepError(`ATG:s startlista gick inte att läsa helt (${incomplete}). Inget sparades.`, 502, { warnings: warnings.slice(0, 10) });

  const existing = await db.round.findUnique({
    where: { atgGameId: parsed.atgGameId },
    include: { races: { include: { starts: { include: { horse: true, driver: true } } } } },
  });

  const round = await db.round.upsert({
    where: { atgGameId: parsed.atgGameId },
    create: {
      atgGameId: parsed.atgGameId,
      gameType: parsed.gameType,
      date: dateOnly(parsed.date),
      trackId: parsed.trackId,
      trackName: parsed.trackName,
      firstStartAt: parsed.firstStartAt,
      atgStatus: parsed.status,
      fetchStatus: "PARTIAL",
    },
    update: {
      date: dateOnly(parsed.date),
      trackId: parsed.trackId,
      trackName: parsed.trackName,
      firstStartAt: parsed.firstStartAt,
      atgStatus: parsed.status,
      fetchStatus: "PARTIAL",
    },
  });

  // Personer och hästar (gemensamma, upsert på ATG:s id).
  const people = new Map<number, ParsedPerson>();
  for (const r of parsed.races) {
    for (const s of r.starts) {
      for (const p of [s.driver, s.trainer, s.originalDriver]) {
        if (!p) continue;
        // Behåll den med statistik om samma person förekommer flera gånger.
        if (!people.has(p.atgPersonId) || (!people.get(p.atgPersonId)!.stats && p.stats)) people.set(p.atgPersonId, p);
      }
    }
  }
  const personIds = new Map<number, string>();
  await mapLimit([...people.values()], 8, async (p) => personIds.set(p.atgPersonId, await upsertPerson(db, p, now)));

  const horses = new Map<number, (typeof parsed.races)[number]["starts"][number]["horse"]>();
  for (const r of parsed.races) for (const s of r.starts) horses.set(s.horse.atgHorseId, s.horse);
  const horseIds = new Map<number, string>();
  await mapLimit([...horses.values()], 8, async (h) => {
    const data = { name: h.name, sex: h.sex, birthYear: h.birthYear, country: h.country };
    const row = await db.horse.upsert({ where: { atgHorseId: h.atgHorseId }, create: { atgHorseId: h.atgHorseId, ...data }, update: data, select: { id: true } });
    horseIds.set(h.atgHorseId, row.id);
  });

  const changes: FetchChanges = { scratched: [], driverChanges: [], skipped: [] };
  const legs: GameStepResult["legs"] = [];
  const personName = (atgId: number | undefined) => {
    const p = atgId === undefined ? undefined : people.get(atgId);
    return p ? `${p.firstName} ${p.lastName}`.trim() : null;
  };

  for (const r of parsed.races) {
    const oldRace = existing?.races.find((x) => x.atgRaceId === r.atgRaceId);
    const cls = raceClass(r.name, r.terms);
    const raceData = {
      leg: r.leg,
      raceNumber: r.raceNumber,
      name: r.name,
      startAt: r.startAt,
      scheduledStartAt: r.scheduledStartAt,
      distance: r.distance,
      startMethod: r.startMethod,
      prize: r.prize,
      prizeText: r.prizeText,
      classLabel: cls.label,
      terms: r.terms,
      atgStatus: r.status,
      cancelled: r.cancelled,
      resultAt: r.hasResult ? (oldRace?.resultAt ?? now) : null,
    };
    const race = await db.race.upsert({
      where: { atgRaceId: r.atgRaceId },
      create: { roundId: round.id, atgRaceId: r.atgRaceId, ...raceData },
      update: raceData,
    });
    legs.push({ leg: r.leg, raceId: race.id, starts: r.starts.length });

    const oldStarts = oldRace?.starts ?? [];
    const takenNumbers = new Map(oldStarts.map((s) => [s.number, s.horseId]));
    let anyChanged = false;

    await mapLimit(r.starts, 8, async (s) => {
      const horseId = horseIds.get(s.horse.atgHorseId)!;
      const old = oldStarts.find((x) => x.horseId === horseId);
      const holder = takenNumbers.get(s.number);
      if (holder && holder !== horseId) {
        // Startnumret tillhör en annan häst i databasen (t.ex. reserv in).
        // Inget skrivs över, så att markeringar på den gamla starten finns kvar.
        warn(`avd ${r.leg} nr ${s.number}: numret har redan en annan häst, hoppar över`);
        changes.skipped.push({ leg: r.leg, number: s.number, horseName: s.horse.name });
        return;
      }
      const driverId = s.driver ? personIds.get(s.driver.atgPersonId) ?? null : null;
      const trainerId = s.trainer ? personIds.get(s.trainer.atgPersonId) ?? null : null;
      const originalId = s.originalDriver ? personIds.get(s.originalDriver.atgPersonId) ?? null : null;

      let prevDriverId = old?.prevDriverId ?? null;
      let changed = !old;
      // Kusk med ATG-id 0 (sparad före syntheticId) räknas inte som kuskbyte.
      if (old && old.driverId && driverId && old.driverId !== driverId && old.driver?.atgPersonId !== 0) {
        prevDriverId = old.driverId;
        changed = true;
        changes.driverChanges.push({
          startId: old.id,
          leg: r.leg,
          number: s.number,
          horseName: s.horse.name,
          newDriver: personName(s.driver?.atgPersonId) ?? "",
          oldDriver: old.driver ? `${old.driver.firstName} ${old.driver.lastName}`.trim() : null,
        });
      }
      if (!prevDriverId && originalId && originalId !== driverId) prevDriverId = originalId;
      if (prevDriverId === driverId) prevDriverId = null;

      let scratchedAt = old?.scratchedAt ?? null;
      if (s.scratched && !old?.scratched) {
        scratchedAt = now;
        changed = true;
        if (old) changes.scratched.push({ startId: old.id, leg: r.leg, number: s.number, horseName: s.horse.name });
      }
      if (!s.scratched) scratchedAt = null;
      if (changed) anyChanged = true;

      const res = s.result;
      const data = {
        number: s.number,
        postPosition: s.postPosition,
        distance: s.distance,
        driverId,
        trainerId,
        prevDriverId,
        scratched: s.scratched,
        scratchedAt,
        age: s.horse.age,
        record: s.record,
        earnings: s.earnings,
        horseStatsJson: json(s.horseStats),
        shoes: json(s.shoes),
        sulky: json(s.sulky),
        lastFetchedAt: now,
        ...(changed ? { recordsFetchedAt: null } : {}),
        place: res?.place ?? null,
        finishOrder: res?.finishOrder ?? null,
        disqualified: res?.disqualified ?? false,
        galloped: res?.galloped ?? false,
        kmTime: res?.kmTime ?? null,
        finalOdds: res?.finalOdds ?? null,
        placeOddsMin: res?.placeOddsMin ?? null,
        placeOddsMax: res?.placeOddsMax ?? null,
        resultAt: res ? (old?.resultAt ?? now) : null,
      };
      if (old) await db.start.update({ where: { id: old.id }, data });
      else await db.start.create({ data: { raceId: race.id, horseId, ...data } });
    });
    // Ny eller ändrad start: avdelningen ska hämtas om i steg 2–9.
    if (anyChanged && race.recordsFetchedAt) await db.race.update({ where: { id: race.id }, data: { recordsFetchedAt: null } });
  }

  if (parsed.hasStreck) {
    const starts = await db.start.findMany({ where: { race: { roundId: round.id } }, select: { id: true, number: true, race: { select: { leg: true } } } });
    const byKey = new Map(starts.map((s) => [`${s.race.leg}:${s.number}`, s.id]));
    const values = parsed.races.flatMap((r) =>
      r.starts.filter((s) => s.streck !== null && byKey.has(`${r.leg}:${s.number}`)).map((s) => ({ startId: byKey.get(`${r.leg}:${s.number}`)!, value: s.streck! })),
    );
    await db.roundSnapshot.create({ data: { roundId: round.id, kind: "FETCH", takenAt: now, values: { createMany: { data: values } } } });
  }

  // En strykning ändrar fältet (7.5): räkna om riktoddsen direkt, om omgången
  // redan har riktodds. Steg 11 i kedjan räknar ändå om allt efteråt, men så
  // blir det rätt även om kedjan stannar på vägen. Ett fel här stoppar inte steg 1.
  if (!input.skipRiktodds && changes.scratched.length && (await db.riktodds.count({ where: { start: { race: { roundId: round.id } } } }))) {
    await computeRoundRiktodds(db, round.id, { now }).catch((e) => console.error("riktodds efter strykning", e));
  }

  // Alla lopp har resultat (eller är inställda): omgången är klar. Cron-jobbet
  // för resultat (E4) gör samma sak när appen inte är öppen.
  const finished = parsed.races.length === legsFor(parsed.gameType) && parsed.races.every((r) => r.hasResult || r.cancelled) && parsed.races.some((r) => r.hasResult);
  await db.round.update({
    where: { id: round.id },
    data: { fetchedAt: now, rev: { increment: 1 }, finishedAt: finished ? (round.finishedAt ?? now) : null },
  });
  await db.fetchLog.create({
    data: {
      roundId: round.id,
      userId: input.userId,
      step: "GAME",
      startedAt,
      finishedAt: new Date(),
      ok: true,
      message: warnings.length ? `${warnings.length} varningar: ${warnings.slice(0, 5).join("; ")}` : null,
      changes: changes as unknown as Prisma.InputJsonValue,
    },
  });

  return { roundId: round.id, atgGameId: parsed.atgGameId, legs, changes, hasStreck: parsed.hasStreck, warnings: warnings.length };
}

// ---- Steg 2–9: tidigare starter per avdelning ---------------------------------------------

export type RaceStepResult = {
  leg: number;
  ok: boolean;
  fetched: number;
  skipped: number;
  failed: { startId: string; number: number; error: string }[];
};

export async function fetchRaceStep(deps: FetchDeps, input: { roundId: string; leg: number; userId: string | null }): Promise<RaceStepResult> {
  const { db, atg } = deps;
  const now = deps.now?.() ?? new Date();
  const race = await db.race.findUnique({
    where: { roundId_leg: { roundId: input.roundId, leg: input.leg } },
    include: { starts: { include: { horse: true } } },
  });
  if (!race) throw new FetchStepError("Avdelningen finns inte. Hämta omgången först.", 404);

  const fresh = (s: { recordsFetchedAt: Date | null; recordsError: string | null }) =>
    !!s.recordsFetchedAt && !s.recordsError && now.getTime() - s.recordsFetchedAt.getTime() < RECORDS_FRESH_MS;
  const targets = race.starts.filter((s) => !s.scratched && !fresh(s));
  const failed: RaceStepResult["failed"] = [];

  await mapLimit(targets, ATG_CONCURRENCY, async (s) => {
    try {
      const detail = parseStartDetail(await atg(atgPaths.start(race.atgRaceId, s.number)), deps.warn);
      if (!detail) throw new AtgError("ATG svarade med ogiltig data");
      if (detail.atgHorseId !== null && detail.atgHorseId !== s.horse.atgHorseId) throw new AtgError("ATG gav en annan häst för startnumret");
      if (detail.records.length) {
        await db.horseRecord.createMany({
          skipDuplicates: true,
          data: detail.records.map((r) => ({
            horseId: s.horseId,
            date: dateOnly(r.date),
            trackName: r.trackName,
            trackId: r.trackId,
            atgRaceRef: r.atgRaceRef,
            raceNumber: r.raceNumber,
            distance: r.distance,
            startMethod: r.startMethod,
            postPosition: r.postPosition,
            place: r.place,
            galloped: r.galloped,
            disqualified: r.disqualified,
            scratched: r.scratched,
            kmTime: r.kmTime,
            odds: r.odds,
            driverName: r.driverName,
            firstPrize: r.firstPrize,
          })),
        });
      }
      for (const p of [detail.driver, detail.trainer]) {
        if (p?.stats) await db.person.updateMany({ where: { atgPersonId: p.atgPersonId }, data: { statsJson: p.stats as Prisma.InputJsonValue, statsAt: now } });
      }
      await db.start.update({
        where: { id: s.id },
        data: { ...(detail.horseStats ? { horseStatsJson: detail.horseStats as Prisma.InputJsonValue } : {}), recordsFetchedAt: now, recordsError: null },
      });
    } catch (e) {
      const error = e instanceof AtgError ? e.message : "Kunde inte spara starterna";
      if (!(e instanceof AtgError)) console.error("fetchRaceStep", race.atgRaceId, s.number, e);
      failed.push({ startId: s.id, number: s.number, error });
      await db.start.update({ where: { id: s.id }, data: { recordsError: error } }).catch(() => {});
    }
  });

  const ok = failed.length === 0;
  if (ok) await db.race.update({ where: { id: race.id }, data: { recordsFetchedAt: now } });
  if (targets.length) await db.round.update({ where: { id: input.roundId }, data: { rev: { increment: 1 } } });
  await db.fetchLog.create({
    data: {
      roundId: input.roundId,
      userId: input.userId,
      step: `RACE_${input.leg}`,
      startedAt: now,
      finishedAt: new Date(),
      ok,
      message: ok ? `${targets.length} hämtade, ${race.starts.length - targets.length} hoppades över` : `${failed.length} av ${targets.length} misslyckades: ${failed[0].error}`,
    },
  });
  failed.sort((a, b) => a.number - b.number);
  return { leg: input.leg, ok, fetched: targets.length - failed.length, skipped: race.starts.length - targets.length, failed };
}

// ---- Steg 10: travstatistik.se -------------------------------------------------------------

export type StatsStepResult = {
  ok: boolean;
  pages: { key: string; ok: boolean; error: string | null }[];
  aliases: { linked: number; unlinked: number };
  fetchStatus: "COMPLETE" | "PARTIAL";
};

export async function fetchStatsStep(deps: FetchDeps, input: { roundId: string; userId: string | null }): Promise<StatsStepResult> {
  const { db, ts } = deps;
  const now = deps.now?.() ?? new Date();
  const round = await db.round.findUnique({
    where: { id: input.roundId },
    include: { races: { select: { recordsFetchedAt: true, starts: { select: { driver: true, trainer: true } } } } },
  });
  if (!round) throw new FetchStepError("Omgången finns inte.", 404);
  const info = { trackName: round.trackName, date: dateOnlyString(round.date) };

  const pages: StatsStepResult["pages"] = [];
  const leagues: { source: "driver" | "trainer"; data: LeagueData }[] = [];
  let networkFailures = 0;

  // Två sidor i taget: sidorna är stora och sajten är liten.
  await mapLimit(TS_PAGE_KEYS, 2, async (key) => {
    try {
      const html = await ts(TS_PAGES[key]);
      const res = interpretPage(key, html, info);
      await db.statsSnapshot.create({
        data: {
          roundId: round.id,
          source: key,
          fetchedAt: now,
          ok: res.ok,
          error: res.ok ? null : res.error,
          data: res.ok ? (res.data as unknown as Prisma.InputJsonValue) : res.header ? ({ header: res.header } as Prisma.InputJsonValue) : undefined,
        },
      });
      pages.push({ key, ok: res.ok, error: res.ok ? null : res.error });
      if (res.ok && (key === "kuskliga" || key === "form")) leagues.push({ source: "driver", data: res.data as LeagueData });
      if (res.ok && key === "tranarliga") leagues.push({ source: "trainer", data: res.data as LeagueData });
    } catch (e) {
      networkFailures++;
      const error = e instanceof Error && e.message.startsWith("travstatistik") ? e.message : "Kunde inte nå travstatistik.se";
      if (!(e instanceof Error && e.message.includes("travstatistik"))) console.error("fetchStatsStep", key, e);
      await db.statsSnapshot.create({ data: { roundId: round.id, source: key, fetchedAt: now, ok: false, error } });
      pages.push({ key, ok: false, error });
    }
  });
  pages.sort((a, b) => TS_PAGE_KEYS.indexOf(a.key as never) - TS_PAGE_KEYS.indexOf(b.key as never));

  // Koppla namnen mot omgångens kuskar och tränare (10.3, lib/names.ts).
  const people = new Map<string, { id: string; firstName: string; lastName: string }>();
  for (const r of round.races) for (const s of r.starts) for (const p of [s.driver, s.trainer]) if (p) people.set(p.id, p);
  const peopleList = [...people.values()];
  const lastNames = new Set(peopleList.map((p) => normalizeName(p.lastName)));
  const rawNames = new Set<string>();
  for (const l of leagues) for (const row of l.data.rows) rawNames.add(row.name);
  let linked = 0;
  let unlinked = 0;
  for (const rawName of rawNames) {
    const parsed = parseShortName(rawName);
    if (!parsed || !lastNames.has(parsed.lastName)) continue;
    const m = matchPerson(rawName, peopleList);
    if (m.personId) linked++;
    else unlinked++;
    await db.personAlias.upsert({
      where: { source_rawName: { source: "TRAVSTATISTIK", rawName } },
      create: { source: "TRAVSTATISTIK", rawName, personId: m.personId },
      // Ett namn som en gång har kopplats tappar inte kopplingen för att
      // personen inte startar i just den här omgången.
      update: m.personId ? { personId: m.personId } : {},
    });
  }

  const allRaces = round.races.length === legsFor(round.gameType) && round.races.every((r) => r.recordsFetchedAt);
  const ok = networkFailures === 0;
  const fetchStatus = ok && allRaces ? "COMPLETE" : "PARTIAL";
  await db.round.update({ where: { id: round.id }, data: { fetchStatus, rev: { increment: 1 } } });
  await db.fetchLog.create({
    data: {
      roundId: round.id,
      userId: input.userId,
      step: "STATS",
      startedAt: now,
      finishedAt: new Date(),
      ok,
      message: `${pages.filter((p) => p.ok).length} av ${pages.length} sidor tolkade`,
    },
  });
  return { ok, pages, aliases: { linked, unlinked }, fetchStatus };
}

// ---- Uppdatera streck och riktodds (knappen i omgången) ---------------------------------------

export type StreckRefreshResult = {
  roundId: string;
  hasStreck: boolean;
  streckAt: string | null;
  changes: FetchChanges;
  // Avdelningar som behöver hämtas om (ny häst eller kuskbyte): då står
  // omgången som ofullständig tills Slutför hämtningen körs.
  needsResume: boolean;
};

// Hämtar spelet på nytt (streck, strykningar, kuskbyten). Omgången behåller
// "komplett" om inget som kräver ny hämtning av tidigare starter har ändrats.
// Riktoddset räknas om i ett eget anrop efteråt (POST /api/rounds/[id]/riktodds),
// så att inget anrop närmar sig Vercels tidsgräns. Spelbar som användaren har
// satt eller tagit bort ändras inte (override i Mark); bara förslagen räknas om.
export async function refreshStreck(deps: FetchDeps, input: { roundId: string; userId: string | null }): Promise<StreckRefreshResult | null> {
  const { db } = deps;
  const round = await db.round.findUnique({ where: { id: input.roundId }, select: { id: true, atgGameId: true, fetchStatus: true, races: { select: { id: true, recordsFetchedAt: true } } } });
  if (!round) return null;
  const game = await fetchGameStep(deps, { gameId: round.atgGameId, userId: input.userId, skipRiktodds: true });
  if (!game) return null;
  // Bara avdelningar som uppdateringen själv gjorde ofullständiga räknas. En
  // avdelning med enbart strykningar behöver inga nya tidigare starter och får
  // tillbaka sin tid; kuskbyten (och nya hästar) kräver Slutför hämtningen.
  const had = new Map(round.races.filter((r) => r.recordsFetchedAt).map((r) => [r.id, r.recordsFetchedAt!]));
  const legsWithDriverChange = new Set(game.changes.driverChanges.map((c) => c.leg));
  const races = await db.race.findMany({ where: { roundId: round.id }, select: { id: true, leg: true, recordsFetchedAt: true, starts: { select: { scratched: true, recordsFetchedAt: true } } } });
  let needsResume = false;
  for (const r of races) {
    if (!had.has(r.id) || r.recordsFetchedAt) continue;
    const onlyScratches = !legsWithDriverChange.has(r.leg) && r.starts.every((s) => s.scratched || s.recordsFetchedAt);
    if (onlyScratches) await db.race.update({ where: { id: r.id }, data: { recordsFetchedAt: had.get(r.id)! } });
    else needsResume = true;
  }
  if (round.fetchStatus === "COMPLETE" && !needsResume) await db.round.update({ where: { id: round.id }, data: { fetchStatus: "COMPLETE" } });
  const snap = await db.roundSnapshot.findFirst({ where: { roundId: round.id }, orderBy: { takenAt: "desc" }, select: { takenAt: true } });
  return { roundId: round.id, hasStreck: game.hasStreck, streckAt: snap ? snap.takenAt.toISOString() : null, changes: game.changes, needsResume };
}

// ---- Resultathämtningen (E4a, specen e4a 6.10) -----------------------------------------------

// Claim på Round.liveSyncAt (9.2): ATG anropas högst var 50:e sekund oavsett
// antal flikar, var 15:e vid Hämta resultat (force) och alltid från cron.
export const RESULTS_CLAIM_MS = 50_000;
export const RESULTS_FORCE_CLAIM_MS = 15_000;

export type ResultsClaim = "normal" | "force" | "cron";

export type SyncResultsOutcome = {
  roundId: string;
  // Fick anropet claimet och hämtade från ATG?
  claimed: boolean;
  // Något i resultatet, strykningarna eller loppens status ändrades (rev +1).
  changed: boolean;
  finished: boolean;
};

const sameNum = (a: unknown, b: number | null) => (a === null || a === undefined ? null : Number(a)) === b;

// Läser games/<atgGameId> och skriver BARA resultatfälten på Start (som steg
// 1), strykning, loppens resultAt/cancelled/atgStatus och omgångens
// atgStatus, finishedAt, liveOkAt och rev. Ingen RoundSnapshot, ingen
// StreckValue, inga nya hästar eller starter och ingen omräkning av riktodds.
// Kastar AtgError när ATG inte svarar (claimet står kvar, så nästa försök
// får vänta claim-tiden). null = omgången finns inte.
export async function syncResults(deps: FetchDeps, input: { roundId: string; userId: string | null; claim?: ResultsClaim }): Promise<SyncResultsOutcome | null> {
  const { db, atg } = deps;
  const now = deps.now?.() ?? new Date();
  const round = await db.round.findUnique({ where: { id: input.roundId }, select: { id: true, atgGameId: true, gameType: true, atgStatus: true, finishedAt: true } });
  if (!round) return null;

  // Atomiskt claim: bara den som flyttar liveSyncAt hämtar.
  const claim = input.claim ?? "normal";
  if (claim !== "cron") {
    const ms = claim === "force" ? RESULTS_FORCE_CLAIM_MS : RESULTS_CLAIM_MS;
    const got = await db.round.updateMany({
      where: { id: round.id, OR: [{ liveSyncAt: null }, { liveSyncAt: { lte: new Date(now.getTime() - ms) } }, { liveSyncAt: { gt: now } }] },
      data: { liveSyncAt: now },
    });
    if (got.count === 0) return { roundId: round.id, claimed: false, changed: false, finished: !!round.finishedAt };
  } else {
    await db.round.update({ where: { id: round.id }, data: { liveSyncAt: now } });
  }

  const warnings: string[] = [];
  const warn = (m: string) => {
    warnings.push(m);
    deps.warn?.(m);
  };
  let parsed: ReturnType<typeof parseGame>;
  try {
    parsed = parseGame(await atg(atgPaths.game(round.atgGameId)), warn);
    if (!parsed || parsed.atgGameId !== round.atgGameId) throw new AtgError("ATG svarade med ett spel som inte gick att läsa");
  } catch (e) {
    await db.fetchLog.create({ data: { roundId: round.id, userId: input.userId, step: "RESULTS", startedAt: now, finishedAt: new Date(), ok: false, message: e instanceof AtgError ? e.message : "Okänt fel" } });
    throw e;
  }

  const races = await db.race.findMany({
    where: { roundId: round.id },
    select: { id: true, atgRaceId: true, resultAt: true, cancelled: true, atgStatus: true, starts: { include: { horse: { select: { atgHorseId: true } } } } },
  });
  const byAtgId = new Map(races.map((r) => [r.atgRaceId, r]));
  let changed = false;
  const scratched: { leg: number; number: number; horseName: string }[] = [];

  for (const r of parsed.races) {
    const race = byAtgId.get(r.atgRaceId);
    if (!race) {
      warn(`avd ${r.leg}: loppet finns inte i databasen, hoppar över`);
      continue;
    }
    const raceData = { atgStatus: r.status, cancelled: r.cancelled, resultAt: r.hasResult ? (race.resultAt ?? now) : null };
    if (race.atgStatus !== raceData.atgStatus || race.cancelled !== raceData.cancelled || (race.resultAt === null) !== (raceData.resultAt === null)) {
      await db.race.update({ where: { id: race.id }, data: raceData });
      changed = true;
    }
    for (const s of r.starts) {
      const old = race.starts.find((x) => x.number === s.number);
      if (!old || old.horse.atgHorseId !== s.horse.atgHorseId) {
        // Ny häst på numret (t.ex. reserv in): hör till Hämta omgång, inte hit.
        warn(`avd ${r.leg} nr ${s.number}: hästen finns inte i databasen, hoppar över`);
        continue;
      }
      const res = s.result;
      const data = {
        scratched: s.scratched,
        scratchedAt: s.scratched ? (old.scratchedAt ?? now) : null,
        place: res?.place ?? null,
        finishOrder: res?.finishOrder ?? null,
        disqualified: res?.disqualified ?? false,
        galloped: res?.galloped ?? false,
        kmTime: res?.kmTime ?? null,
        finalOdds: res?.finalOdds ?? null,
        placeOddsMin: res?.placeOddsMin ?? null,
        placeOddsMax: res?.placeOddsMax ?? null,
        resultAt: res ? (old.resultAt ?? now) : null,
      };
      const same =
        old.scratched === data.scratched &&
        old.place === data.place &&
        old.finishOrder === data.finishOrder &&
        old.disqualified === data.disqualified &&
        old.galloped === data.galloped &&
        old.kmTime === data.kmTime &&
        sameNum(old.finalOdds, data.finalOdds) &&
        sameNum(old.placeOddsMin, data.placeOddsMin) &&
        sameNum(old.placeOddsMax, data.placeOddsMax) &&
        (old.resultAt === null) === (data.resultAt === null);
      if (same) continue;
      if (s.scratched && !old.scratched) scratched.push({ leg: r.leg, number: s.number, horseName: s.horse.name });
      await db.start.update({ where: { id: old.id }, data });
      changed = true;
    }
  }

  const finished = parsed.races.length === legsFor(round.gameType) && parsed.races.every((r) => r.hasResult || r.cancelled) && parsed.races.some((r) => r.hasResult);
  const finishedAt = finished ? (round.finishedAt ?? now) : null;
  if (round.atgStatus !== parsed.status || (round.finishedAt === null) !== (finishedAt === null)) changed = true;
  await db.round.update({
    where: { id: round.id },
    data: { atgStatus: parsed.status, finishedAt, liveOkAt: now, ...(changed ? { rev: { increment: 1 } } : {}) },
  });
  await db.fetchLog.create({
    data: {
      roundId: round.id,
      userId: input.userId,
      step: "RESULTS",
      startedAt: now,
      finishedAt: new Date(),
      ok: true,
      message: [changed ? "ändrat" : "oförändrat", warnings.length ? `${warnings.length} varningar: ${warnings.slice(0, 3).join("; ")}` : ""].filter(Boolean).join(", "),
      ...(scratched.length ? { changes: { scratched } as unknown as Prisma.InputJsonValue } : {}),
    },
  });
  return { roundId: round.id, claimed: true, changed, finished };
}
