// Hämta Unibets odds (specen e2.2, 6.9, 8.3, 10.5 och 12): kedjan som
// klienten kör (start → högst 4 avdelningar samtidigt → finish) och Ångra,
// plus läsningen för GET /api/rounds/[id] och GET /api/starts/[id].
// Rutterna i app/api/rounds/[id]/unibet/ är tunna omslag; reglerna ligger
// här, så att de testas mot en riktig Postgres (lib/unibet.db.test.ts).
//
// - OddsFetch och UnibetPrice är gemensam data som bara hämtningen skriver.
// - Mark skrivs för användaren som tryckte (beslut 9), för alla starter som
//   inte är strukna hos ATG, även omarkerade (interesting = false).
// - Bet-oddset (Mark.betOdds) rörs aldrig här.
// - Spärren: högst en OddsFetch per omgång och 2 minuter, räknat från
//   takenAt. En hämtning som inte sparar något (ingen bana, inga odds, Unibet
//   svarade inte) tas bort och räknas alltså inte. Att köra om en avdelning
//   räknas inte heller.

import { Prisma, type Mark, type PrismaClient } from "@prisma/client";
import { dateStr, dec, markDto, oddsSourceOf, settingsDto } from "@/lib/dto";
import { stockholmLocalToUtc } from "@/lib/stockholm-time";
import type { LatestOddsDto, MarkDto, RoundResponse, StartUnibetDto, UnibetFinishResponse, UnibetHistoryPoint, UnibetLegResponse, UnibetLockedError, UnibetStartResponse, UnibetUndoResponse } from "@/lib/types";
import {
  dayWindow,
  eventQuery,
  markOddsOf,
  meetingsQuery,
  normalizeHorse,
  ODDS_LOCK_MS,
  parseEvent,
  parseMeetings,
  pickTrackEvents,
  UnibetError,
  type UnibetEvent,
  type UnibetFetch,
  type Warn,
} from "@/lib/unibet";

type Db = PrismaClient;

export type UnibetDeps = { db: Db; unibet: UnibetFetch; now?: () => Date; warn?: Warn };
export type Reply<T> = { status: number; body: T | { error: string } };

const ok = <T>(body: T): Reply<T> => ({ status: 200, body });
const err = (status: number, error: string): Reply<never> => ({ status, body: { error } });

export const RACE_STARTED = "Loppet har startat";
export const NEWER_FETCH = "Ångra gäller bara den senaste hämtningen.";
export const FETCH_NOT_FOUND = "Hämtningen finns inte.";
const UNIBET_DOWN = "Unibet svarade inte. Försök igen om en stund.";

// FetchLog.step (10.5). Meddelandet börjar med en kod som läses av lastOddsAttempt.
export const STEP_MEETINGS = "UNIBET_MEETINGS";
export const STEP_FINISH = "UNIBET_FINISH";
export const stepLeg = (leg: number) => `UNIBET_LEG_${leg}`;

// "Nyss hämtat. Försök igen om 1 min 42 s."
export function lockMessage(retryAfterSec: number): string {
  const m = Math.floor(retryAfterSec / 60);
  const s = retryAfterSec % 60;
  const parts = [m ? `${m} min` : "", s || !m ? `${s} s` : ""].filter(Boolean).join(" ");
  return `Nyss hämtat. Försök igen om ${parts}.`;
}

// Sekunder kvar av spärren, 0 = fri. En takenAt i framtiden (klockfel) ger hela spärren.
export function lockRemainingSec(lastTakenAt: Date | null, now: Date): number {
  if (!lastTakenAt) return 0;
  const left = ODDS_LOCK_MS - (now.getTime() - lastTakenAt.getTime());
  if (left <= 0) return 0;
  return Math.min(Math.ceil(left / 1000), ODDS_LOCK_MS / 1000);
}

const started = (startAt: Date, now: Date) => startAt.getTime() <= now.getTime();
const errorText = (e: unknown) => (e instanceof UnibetError ? e.message : "Okänt fel");

function latestDto(f: { id: string; takenAt: Date; finishedAt: Date | null; legsOk: number[]; legsFailed: number[]; legsSkipped: number[] }): LatestOddsDto {
  const sort = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);
  return { fetchId: f.id, takenAt: f.takenAt.toISOString(), finishedAt: f.finishedAt ? f.finishedAt.toISOString() : null, legsOk: sort(f.legsOk), legsFailed: sort(f.legsFailed), legsSkipped: sort(f.legsSkipped) };
}

async function log(db: Db, data: { roundId: string; userId: string | null; step: string; startedAt: Date; ok: boolean; message: string; changes?: Prisma.InputJsonValue }) {
  await db.fetchLog.create({ data: { ...data, finishedAt: new Date() } });
}

// Banans lopp hos Unibet (1 anrop). null = banan finns inte hos Unibet.
async function lookupEvents(deps: UnibetDeps, round: { date: Date; trackName: string }): Promise<Map<number, UnibetEvent> | null> {
  const json = await deps.unibet(meetingsQuery(dayWindow(dateStr(round.date), stockholmLocalToUtc)));
  return pickTrackEvents(parseMeetings(json, deps.warn), round.trackName);
}

// Lägger till avdelningen i en av listorna och tar bort den ur de andra.
async function setLegState(db: Db | Prisma.TransactionClient, fetchId: string, leg: number, state: "ok" | "failed" | "skipped") {
  // leg skrivs in i SQL:en som tal; bara 1–8 (rutten och databasen kontrollerar också).
  if (!Number.isInteger(leg) || leg < 1 || leg > 8) throw new Error("Ogiltig avdelning.");
  const add = (col: string) => Prisma.raw(`"${col}" = array_append(array_remove("${col}", ${leg}), ${leg})`);
  const remove = (col: string) => Prisma.raw(`"${col}" = array_remove("${col}", ${leg})`);
  const cols = { ok: "legsOk", failed: "legsFailed", skipped: "legsSkipped" } as const;
  const sets = (Object.keys(cols) as (keyof typeof cols)[]).map((k) => (k === state ? add(cols[k]) : remove(cols[k])));
  await db.$executeRaw`UPDATE "spelvarde"."OddsFetch" SET ${Prisma.join(sets, ", ")} WHERE "id" = ${fetchId}`;
}

// ---- POST /api/rounds/[id]/unibet ----------------------------------------------------------

export async function startOddsFetch(deps: UnibetDeps, input: { roundId: string; userId: string }): Promise<Reply<UnibetStartResponse> | { status: 429; body: UnibetLockedError }> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const round = await db.round.findUnique({
    where: { id: input.roundId },
    select: { id: true, date: true, trackName: true, races: { orderBy: { leg: "asc" }, select: { id: true, leg: true, raceNumber: true, startAt: true, cancelled: true, unibetEventKey: true } } },
  });
  if (!round) return err(404, "Omgången finns inte.");
  const startedLegs = round.races.filter((r) => started(r.startAt, now)).map((r) => r.leg);

  // Spärren och den nya hämtningen i samma transaktion, med omgångens rad
  // låst: två tryck samtidigt kan inte båda komma förbi.
  const claim = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "spelvarde"."Round" WHERE "id" = ${round.id} FOR UPDATE`;
    const last = await tx.oddsFetch.findFirst({ where: { roundId: round.id }, orderBy: { takenAt: "desc" }, select: { takenAt: true } });
    const wait = lockRemainingSec(last?.takenAt ?? null, now);
    if (wait > 0) return { wait };
    const fetch = await tx.oddsFetch.create({ data: { roundId: round.id, userId: input.userId, takenAt: now, legsOk: [], legsFailed: [], legsSkipped: startedLegs } });
    return { fetch };
  });
  if ("wait" in claim) return { status: 429, body: { error: lockMessage(claim.wait!), retryAfterSec: claim.wait! } };
  const fetch = claim.fetch!;

  const t0 = new Date();
  let events: Map<number, UnibetEvent> | null;
  try {
    events = await lookupEvents(deps, round);
  } catch (e) {
    await db.oddsFetch.delete({ where: { id: fetch.id } });
    await log(db, { roundId: round.id, userId: input.userId, step: STEP_MEETINGS, startedAt: t0, ok: false, message: `failed: ${errorText(e)}` });
    if (e instanceof UnibetError) return err(502, UNIBET_DOWN);
    throw e;
  }
  if (!events) {
    await db.oddsFetch.delete({ where: { id: fetch.id } });
    await log(db, { roundId: round.id, userId: input.userId, step: STEP_MEETINGS, startedAt: t0, ok: true, message: `no-meeting: ${round.trackName} fanns inte hos Unibet` });
    return ok({ fetchId: null, noMeeting: true, legs: [] });
  }

  const legs: { leg: number; eventKey: string | null; skipped: "started" | "no-event" | null }[] = [];
  const noEvent: number[] = [];
  const keyUpdates: { id: string; key: string | null }[] = [];
  for (const r of round.races) {
    if (started(r.startAt, now)) {
      legs.push({ leg: r.leg, eventKey: null, skipped: "started" });
      continue;
    }
    const ev = r.cancelled ? undefined : events.get(r.raceNumber);
    const key = ev?.eventKey ?? null;
    if (key !== r.unibetEventKey) keyUpdates.push({ id: r.id, key });
    if (!key) noEvent.push(r.leg);
    legs.push({ leg: r.leg, eventKey: key, skipped: key ? null : "no-event" });
  }
  if (keyUpdates.length) await db.$transaction(keyUpdates.map((u) => db.race.update({ where: { id: u.id }, data: { unibetEventKey: u.key } })));
  // Lopp som saknas hos Unibet räknas som misslyckade avdelningar (de fick inga odds).
  for (const leg of noEvent) await setLegState(db, fetch.id, leg, "failed");
  const found = legs.filter((l) => l.eventKey).length;
  await log(db, { roundId: round.id, userId: input.userId, step: STEP_MEETINGS, startedAt: t0, ok: true, message: `ok: ${found} av ${legs.length} avdelningar hittade hos Unibet` });
  return ok({ fetchId: fetch.id, takenAt: fetch.takenAt.toISOString(), legs });
}

// ---- POST /api/rounds/[id]/unibet/[fetchId]/legs/[leg] --------------------------------------------

const legReply = (leg: number, part: Partial<UnibetLegResponse>): UnibetLegResponse => ({ leg, ok: false, noPrices: false, withOdds: 0, missing: [], scratchedAtUnibet: [], replaced: [], ...part });

export async function fetchOddsLeg(deps: UnibetDeps, input: { roundId: string; fetchId: string; leg: number; userId: string }): Promise<Reply<UnibetLegResponse>> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const { roundId, fetchId, leg, userId } = input;
  const fetch = await db.oddsFetch.findFirst({ where: { id: fetchId, roundId } });
  if (!fetch) return err(404, FETCH_NOT_FOUND);
  // En gammal hämtning får inte skriva över en nyare.
  if (await db.oddsFetch.findFirst({ where: { roundId, takenAt: { gt: fetch.takenAt } }, select: { id: true } })) return err(409, "En nyare hämtning finns.");
  const race = await db.race.findUnique({
    where: { roundId_leg: { roundId, leg } },
    select: { id: true, raceNumber: true, startAt: true, cancelled: true, unibetEventKey: true, round: { select: { date: true, trackName: true } }, starts: { select: { id: true, number: true, scratched: true, horse: { select: { name: true } } } } },
  });
  if (!race) return err(404, "Avdelningen finns inte.");
  if (started(race.startAt, now)) {
    await setLegState(db, fetchId, leg, "skipped");
    return err(409, RACE_STARTED);
  }

  const t0 = new Date();
  const fail = async (message: string, status = 502) => {
    await setLegState(db, fetchId, leg, "failed");
    await log(db, { roundId, userId, step: stepLeg(leg), startedAt: t0, ok: false, message: `failed: ${message}` });
    return { status, body: legReply(leg, { error: message }) };
  };

  let parsed: ReturnType<typeof parseEvent>;
  try {
    // Saknas nyckeln (loppet fanns inte vid start) slås banan upp igen, så att
    // "Hämta avd 6 och 8" fungerar utan en ny hämtning.
    let key = race.cancelled ? null : race.unibetEventKey;
    if (!key && !race.cancelled) {
      key = (await lookupEvents(deps, race.round))?.get(race.raceNumber)?.eventKey ?? null;
      if (key) await db.race.update({ where: { id: race.id }, data: { unibetEventKey: key } });
    }
    if (!key) return await fail(`Avd ${leg} finns inte hos Unibet.`);
    parsed = parseEvent(await deps.unibet(eventQuery(key)), deps.warn);
  } catch (e) {
    if (e instanceof UnibetError) return await fail(`Unibet svarade inte för avd ${leg}.`);
    throw e;
  }
  if (!parsed) return await fail(`Unibet svarade med ogiltig data för avd ${leg}.`);

  if (parsed.noPrices) {
    await setLegState(db, fetchId, leg, "ok");
    await log(db, { roundId, userId, step: stepLeg(leg), startedAt: t0, ok: true, message: "no-odds: Unibet har inga odds för loppet än" });
    return ok(legReply(leg, { ok: true, noPrices: true }));
  }

  // Para på startnummer. Strukna hos ATG hoppas över. Namnet är bara en kontroll.
  const byNumber = new Map(parsed.competitors.map((c) => [c.number, c]));
  const missing: number[] = [];
  const scratchedAtUnibet: number[] = [];
  const rows: { startId: string; number: number; place: number | null; win: number | null; status: string; markOdds: number | null; writeMark: boolean }[] = [];
  const runners = race.starts.filter((x) => !x.scratched).sort((a, b) => a.number - b.number);
  // Skydd mot fel lopp (t.ex. en omgång på två banor, där Round.trackName
  // bara är den ena): heter mer än hälften av hästarna något annat hos
  // Unibet skrivs ingenting för avdelningen.
  const named = runners.filter((s) => byNumber.get(s.number)?.name);
  const wrong = named.filter((s) => normalizeHorse(byNumber.get(s.number)!.name!) !== normalizeHorse(s.horse.name));
  if (named.length && wrong.length * 2 > named.length) return await fail(`Hästarna hos Unibet stämmer inte med avd ${leg}.`);
  for (const s of runners) {
    const c = byNumber.get(s.number);
    if (!c) {
      missing.push(s.number);
      continue;
    }
    if (c.name && normalizeHorse(c.name) !== normalizeHorse(s.horse.name)) deps.warn?.(`Unibet: avd ${leg} nr ${s.number} heter ${c.name} hos Unibet och ${s.horse.name} hos ATG`);
    if (!c.starter) {
      scratchedAtUnibet.push(s.number);
      rows.push({ startId: s.id, number: s.number, place: null, win: null, status: c.status, markOdds: null, writeMark: true });
      continue;
    }
    if (c.place === null) {
      // Startar men saknar platsodds: räknas som saknad, oddset ändras inte.
      missing.push(s.number);
      continue;
    }
    const markOdds = markOddsOf(c.place);
    rows.push({ startId: s.id, number: s.number, place: c.place, win: c.win, status: c.status, markOdds, writeMark: markOdds !== null });
  }

  const existing = new Map((await db.mark.findMany({ where: { userId, startId: { in: rows.map((r) => r.startId) } } })).map((m) => [m.startId, m]));
  const replaced: UnibetLegResponse["replaced"] = [];
  await db.$transaction(async (tx) => {
    // Idempotent: en omkörning av avdelningen i samma hämtning ersätter raderna.
    await tx.unibetPrice.deleteMany({ where: { fetchId, startId: { in: rows.map((r) => r.startId) } } });
    if (rows.length) await tx.unibetPrice.createMany({ data: rows.map((r) => ({ fetchId, startId: r.startId, placeOdds: r.place, winOdds: r.win, status: r.status })) });
    for (const r of rows.filter((x) => x.writeMark)) {
      const prev = existing.get(r.startId);
      const data = markWrite(prev ?? null, r.markOdds, fetchId, fetch.takenAt);
      await tx.mark.upsert({ where: { userId_startId: { userId, startId: r.startId } }, create: { userId, startId: r.startId, interesting: false, ...data }, update: data });
      if (data.replacedByFetchId === fetchId && data.replacedOdds !== null) replaced.push({ startId: r.startId, from: data.replacedOdds, to: r.markOdds });
    }
    await setLegState(tx, fetchId, leg, "ok");
  });
  const withOdds = rows.filter((r) => r.markOdds !== null).length;
  await log(db, {
    roundId,
    userId,
    step: stepLeg(leg),
    startedAt: t0,
    ok: true,
    message: `ok: ${withOdds} fick odds, ${missing.length} saknas, ${scratchedAtUnibet.length} strukna hos Unibet`,
    changes: { missing, scratchedAtUnibet, replaced: replaced.length },
  });
  return ok(legReply(leg, { ok: true, withOdds, missing, scratchedAtUnibet, replaced }));
}

// Det som hämtningen skriver på en Mark (8.3). Ett eget odds med ett annat
// värde sparas för Ångra. En omkörning av samma hämtning behåller det som
// redan sparats. betOdds rörs inte.
export function markWrite(prev: Pick<Mark, "unibetOdds" | "unibetOddsSource" | "replacedOdds" | "replacedByFetchId"> | null, odds: number | null, fetchId: string, takenAt: Date) {
  const prevOdds = prev ? dec(prev.unibetOdds) : null;
  const prevSource = prev ? oddsSourceOf(prev.unibetOddsSource, prevOdds) : null;
  let replacedOdds: number | null = null;
  let replacedByFetchId: string | null = null;
  if (prev && prev.replacedByFetchId === fetchId && prev.replacedOdds !== null) {
    replacedOdds = dec(prev.replacedOdds);
    replacedByFetchId = fetchId;
  } else if (prevSource === "MANUAL" && prevOdds !== null && prevOdds !== odds) {
    replacedOdds = prevOdds;
    replacedByFetchId = fetchId;
  }
  return { unibetOdds: odds, unibetOddsSource: "UNIBET" as const, unibetOddsAt: takenAt, unibetOddsPrev: null, replacedOdds, replacedByFetchId };
}

// ---- POST /api/rounds/[id]/unibet/[fetchId]/finish ---------------------------------------------------

export async function finishOddsFetch(deps: UnibetDeps, input: { roundId: string; fetchId: string; userId: string }): Promise<Reply<UnibetFinishResponse>> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const { roundId, fetchId, userId } = input;
  const fetch = await db.oddsFetch.findFirst({ where: { id: fetchId, roundId } });
  if (!fetch) return err(404, FETCH_NOT_FOUND);
  const t0 = new Date();
  const [rows, withOdds] = await Promise.all([db.unibetPrice.count({ where: { fetchId } }), db.unibetPrice.count({ where: { fetchId, placeOdds: { not: null } } })]);
  if (rows === 0) {
    // Ingen ögonblicksbild utan odds (6.9): inga Mark har ändrats.
    await db.oddsFetch.delete({ where: { id: fetchId } });
    const failed = fetch.legsFailed.length > 0 && fetch.legsOk.length === 0;
    await log(db, { roundId, userId, step: STEP_FINISH, startedAt: t0, ok: true, message: failed ? "failed: Unibet svarade inte för någon avdelning" : "no-odds: Unibet har inga odds än" });
    return ok({ saved: false });
  }
  const finishedAt = new Date(Math.max(now.getTime(), fetch.takenAt.getTime()));
  const [updated] = await db.$transaction([
    db.oddsFetch.update({ where: { id: fetchId }, data: { finishedAt } }),
    // Ångra gäller bara den senaste hämtningen: äldre ersatta odds glöms.
    db.mark.updateMany({
      where: { userId, replacedOdds: { not: null }, OR: [{ replacedByFetchId: null }, { replacedByFetchId: { not: fetchId } }], start: { race: { roundId } } },
      data: { replacedOdds: null, replacedByFetchId: null },
    }),
    // Gemensam data har ändrats: klienten läser om omgången.
    db.round.update({ where: { id: roundId }, data: { rev: { increment: 1 } } }),
  ]);
  await log(db, { roundId, userId, step: STEP_FINISH, startedAt: t0, ok: true, message: `saved: ${withOdds} hästar fick odds` });
  return ok({ saved: true, withOdds, ...latestDto(updated) });
}

// ---- POST /api/rounds/[id]/unibet/[fetchId]/undo -------------------------------------------------------

export function parseUndoBody(body: Record<string, unknown>): { ok: true; startId: string | null } | { ok: false; error: string } {
  if (Object.keys(body).some((k) => k !== "startId")) return { ok: false, error: "Okänt fält." };
  const s = body.startId ?? null;
  if (s !== null && !(typeof s === "string" && /^[a-z][a-z0-9]{19,32}$/.test(s))) return { ok: false, error: "Ogiltig start." };
  return { ok: true, startId: s };
}

export async function undoOddsFetch(deps: UnibetDeps, input: { roundId: string; fetchId: string; userId: string; startId: string | null }): Promise<Reply<UnibetUndoResponse>> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const { roundId, fetchId, userId, startId } = input;
  const fetch = await db.oddsFetch.findFirst({ where: { id: fetchId, roundId }, select: { takenAt: true } });
  if (!fetch) return err(404, FETCH_NOT_FOUND);
  if (await db.oddsFetch.findFirst({ where: { roundId, takenAt: { gt: fetch.takenAt } }, select: { id: true } })) return err(409, NEWER_FETCH);
  const marks = await db.mark.findMany({
    where: { userId, replacedByFetchId: fetchId, replacedOdds: { not: null }, start: { race: { roundId } }, ...(startId ? { startId } : {}) },
    include: { start: { select: { race: { select: { startAt: true } } } } },
  });
  if (startId && !marks.length) return err(404, "Det finns inget ersatt odds att ångra för hästen.");
  const open = marks.filter((m) => !started(m.start.race.startAt, now));
  if (marks.length && !open.length) return err(409, RACE_STARTED);
  if (!open.length) return ok({ restored: [], marks: [] });

  const updated = await db.$transaction(
    open.map((m) =>
      db.mark.update({
        where: { id: m.id },
        // Källan blir eget igen. "Ändrat från" gäller inte ett återställt odds.
        data: { unibetOdds: m.replacedOdds, unibetOddsSource: "MANUAL", unibetOddsAt: now, unibetOddsPrev: null, replacedOdds: null, replacedByFetchId: null },
      }),
    ),
  );
  const [model, settingsRow] = await Promise.all([db.modelVersion.findFirst({ where: { active: true }, select: { id: true } }), db.userSettings.findUnique({ where: { userId } })]);
  const rikt = model ? await db.riktodds.findMany({ where: { modelVersionId: model.id, startId: { in: updated.map((m) => m.startId) } }, select: { startId: true, odds: true } }) : [];
  const riktBy = new Map(rikt.map((r) => [r.startId, Number(r.odds)]));
  const st = settingsDto(settingsRow);
  const dtos: MarkDto[] = updated.map((m) => markDto(m, riktBy.get(m.startId) ?? null, st.spelbarGuideline, st, st.spelbarTolerance));
  return ok({ restored: updated.map((m) => ({ startId: m.startId, odds: Number(m.unibetOdds) })), marks: dtos });
}

// ---- Läsning --------------------------------------------------------------------------------

type PriceRow = { startId: string; placeOdds: Prisma.Decimal | null; winOdds: Prisma.Decimal | null; status: string; takenAt: Date };

// Senaste och första platsodds per start i omgången, i två frågor (ingen N+1).
export async function unibetByStart(db: Db, roundId: string): Promise<Map<string, StartUnibetDto>> {
  const [latest, first] = await Promise.all([
    db.$queryRaw<PriceRow[]>`
      SELECT DISTINCT ON (p."startId") p."startId", p."placeOdds", p."winOdds", p."status", f."takenAt"
      FROM "spelvarde"."UnibetPrice" p JOIN "spelvarde"."OddsFetch" f ON f."id" = p."fetchId"
      WHERE f."roundId" = ${roundId}
      ORDER BY p."startId", f."takenAt" DESC`,
    db.$queryRaw<PriceRow[]>`
      SELECT DISTINCT ON (p."startId") p."startId", p."placeOdds", p."winOdds", p."status", f."takenAt"
      FROM "spelvarde"."UnibetPrice" p JOIN "spelvarde"."OddsFetch" f ON f."id" = p."fetchId"
      WHERE f."roundId" = ${roundId} AND p."placeOdds" IS NOT NULL
      ORDER BY p."startId", f."takenAt" ASC`,
  ]);
  const firstBy = new Map(first.map((r) => [r.startId, r]));
  const out = new Map<string, StartUnibetDto>();
  for (const r of latest) {
    const f = firstBy.get(r.startId);
    out.set(r.startId, { place: dec(r.placeOdds), win: dec(r.winOdds), status: r.status, at: r.takenAt.toISOString(), first: f ? dec(f.placeOdds) : null, firstAt: f ? f.takenAt.toISOString() : null });
  }
  return out;
}

// Hästkortet: alla ögonblicksbilder där starten fanns, äldst först.
export async function unibetHistoryOf(db: Db, startId: string): Promise<UnibetHistoryPoint[]> {
  const rows = await db.unibetPrice.findMany({ where: { startId }, select: { fetchId: true, placeOdds: true, winOdds: true, status: true, fetch: { select: { takenAt: true } } } });
  return rows
    .map((r) => ({ fetchId: r.fetchId, at: r.fetch.takenAt.toISOString(), place: dec(r.placeOdds), win: dec(r.winOdds), status: r.status }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

// StartUnibetDto ur historiken (samma regler som unibetByStart).
export function unibetSummary(history: UnibetHistoryPoint[]): StartUnibetDto | null {
  const last = history[history.length - 1];
  if (!last) return null;
  const first = history.find((h) => h.place !== null) ?? null;
  return { place: last.place, win: last.win, status: last.status, at: last.at, first: first?.place ?? null, firstAt: first?.at ?? null };
}

export async function latestOddsOf(db: Db, roundId: string): Promise<LatestOddsDto | null> {
  const f = await db.oddsFetch.findFirst({ where: { roundId }, orderBy: { takenAt: "desc" } });
  return f ? latestDto(f) : null;
}

// Senaste avslutade försöket, även när inget sparades.
export async function lastOddsAttemptOf(db: Db, roundId: string): Promise<RoundResponse["lastOddsAttempt"]> {
  const l = await db.fetchLog.findFirst({
    where: { roundId, OR: [{ step: STEP_FINISH }, { step: STEP_MEETINGS, ok: false }, { step: STEP_MEETINGS, message: { startsWith: "no-meeting" } }] },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true, ok: true, message: true },
  });
  if (!l) return null;
  const code = (l.message ?? "").split(":")[0];
  const outcome = !l.ok || code === "failed" ? "failed" : code === "saved" ? "saved" : code === "no-meeting" ? "noMeeting" : "noOdds";
  return { at: l.startedAt.toISOString(), outcome };
}
