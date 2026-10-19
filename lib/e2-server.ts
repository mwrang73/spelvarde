// Skrivande serverlogik för E2 och E2.1: PUT /api/marks/[startId], GET/PUT
// /api/rounds/[id]/coupon, GET/PUT /api/admin/model och PUT /api/settings. Rutterna är tunna
// omslag; här ligger reglerna, så att de testas mot en riktig Postgres i
// lib/e2.db.test.ts. Allt användarägt skrivs och läses med userId från
// sessionen, aldrig från kroppen.

import type { Prisma, PrismaClient, Role } from "@prisma/client";
import { asSelections, DEFAULT_BUDGET, parseCouponBody, sameNumbers } from "@/lib/coupon";
import { couponDto, dec, markDto, modelDto, settingsDto, THEME_FROM_API } from "@/lib/dto";
import { applyMarkChange, EMPTY_MARK, parseMarkChange, sameMark, turnsSomethingOn, type MarkState } from "@/lib/marks";
import { INPUT_KEYS, nextModelKey, parseParams, parseWeights, type ModelParams, type Weights } from "@/lib/riktodds";
import { riktoddsStep } from "@/lib/riktodds-server";
import { currentRoundId } from "@/lib/round-server";
import type { CouponResponse, MarkResponse, ModelResponse, SettingsDto } from "@/lib/types";
import { parseSettingsBody, type Result } from "@/lib/validate";
import { checkFactors } from "@/lib/xfactor";

type Db = PrismaClient;
export type Reply<T = unknown> = { status: number; body: T | { error: string } };

const ok = <T>(body: T): Reply<T> => ({ status: 200, body });
const err = (status: number, error: string): Reply<never> => ({ status, body: { error } });
export const RACE_STARTED = "Loppet har startat";
const isId = (v: unknown): v is string => typeof v === "string" && /^[a-z][a-z0-9]{19,32}$/.test(v);

// ---- Mark -------------------------------------------------------------------------------

export async function saveMark(db: Db, userId: string, startId: string, body: Record<string, unknown>, now: Date): Promise<Reply<MarkResponse>> {
  const parsed = parseMarkChange(body);
  if (!parsed.ok) return err(400, parsed.error);
  const change = parsed.value;

  const start = await db.start.findUnique({ where: { id: startId }, select: { id: true, scratched: true, race: { select: { startAt: true } } } });
  if (!start) return err(404, "Starten finns inte.");
  // Allt som rör en start låses vid loppets starttid (3.1, 6.4), även X-faktor och källstöd.
  if (start.race.startAt.getTime() <= now.getTime()) return err(409, RACE_STARTED);
  // Struken: inget får sättas på (I, S, B, X-faktor, källstöd). Släcka och rensa går.
  if (start.scratched && turnsSomethingOn(change)) return err(422, "Hästen är struken.");

  const [existing, model, settings] = await Promise.all([
    db.mark.findUnique({ where: { userId_startId: { userId, startId } } }),
    db.modelVersion.findFirst({ where: { active: true }, select: { id: true } }),
    db.userSettings.findUnique({ where: { userId } }),
  ]);
  const rikt = model ? await db.riktodds.findUnique({ where: { startId_modelVersionId: { startId, modelVersionId: model.id } }, select: { odds: true } }) : null;
  const riktodds = rikt ? Number(rikt.odds) : null;
  const st = settingsDto(settings);
  const guideline = st.spelbarGuideline;

  const prev: MarkState = existing
    ? {
        interesting: existing.interesting,
        interestingAt: existing.interestingAt,
        spelbarOverride: existing.spelbarOverride,
        bet: existing.bet,
        betAt: existing.betAt,
        betOdds: dec(existing.betOdds),
        unibetOdds: dec(existing.unibetOdds),
        unibetOddsAt: existing.unibetOddsAt,
        unibetOddsPrev: dec(existing.unibetOddsPrev),
        xFactor: existing.xFactor,
        xFactorAt: existing.xFactorAt,
        sourceSupport: existing.sourceSupport,
      }
    : EMPTY_MARK;
  const next = applyMarkChange(prev, change, { now, riktodds, factors: st });
  // Samma kropp en gång till (utkorgen skickar om): ingen skrivning.
  if (existing && sameMark(prev, next)) return ok({ mark: markDto(existing, riktodds, guideline, st) });

  const mark = await db.mark.upsert({
    where: { userId_startId: { userId, startId } },
    create: { userId, startId, ...next },
    update: next,
  });
  return ok({ mark: markDto(mark, riktodds, guideline, st) });
}

// ---- Inställningar (PUT /api/settings) ---------------------------------------------------------

// Bara fälten som skickas ändras. X-faktorerna kontrolleras tillsammans med
// det sparade värdet för den som inte skickas (Stark känsla > Tror på).
// Databasen har samma villkor (migreringen 20261021120000_xfactor).
export async function saveSettings(db: Db, userId: string, body: Record<string, unknown>): Promise<Reply<SettingsDto>> {
  const parsed = parseSettingsBody(body);
  if (!parsed.ok) return err(400, parsed.error);
  const { theme, rowPrice, spelbarGuideline, xFactorTror, xFactorStark } = parsed.value;
  const cur = settingsDto(await db.userSettings.findUnique({ where: { userId } }));
  const factors = { xFactorTror: xFactorTror ?? cur.xFactorTror, xFactorStark: xFactorStark ?? cur.xFactorStark };
  if (xFactorTror !== undefined || xFactorStark !== undefined) {
    const f = checkFactors(factors);
    if (!f.ok) return err(400, f.error);
  }
  const data = {
    ...(theme ? { theme: THEME_FROM_API[theme] } : {}),
    ...(rowPrice !== undefined ? { rowPrice } : {}),
    ...(spelbarGuideline !== undefined ? { spelbarGuideline } : {}),
    ...(xFactorTror !== undefined ? { xFactorTror } : {}),
    ...(xFactorStark !== undefined ? { xFactorStark } : {}),
  };
  // create får alltid båda faktorerna: upsert blir INSERT … ON CONFLICT, och
  // Postgres prövar villkoret Stark > Tror på INSERT-raden (med standardvärdet
  // för den faktor som inte skickas) innan konflikten avgörs.
  const s = await db.userSettings.upsert({ where: { userId }, create: { userId, ...data, ...factors }, update: data });
  return ok(settingsDto(s));
}

// ---- Kupong --------------------------------------------------------------------------------

export async function getCoupon(db: Db, userId: string, roundId: string): Promise<Reply<CouponResponse>> {
  const round = await db.round.findUnique({ where: { id: roundId }, select: { id: true } });
  if (!round) return err(404, "Omgången finns inte.");
  const [coupon, settings] = await Promise.all([
    db.coupon.findUnique({ where: { userId_roundId: { userId, roundId } } }),
    db.userSettings.findUnique({ where: { userId } }),
  ]);
  return ok({ coupon: coupon ? couponDto(coupon) : null, defaults: { budget: DEFAULT_BUDGET, rowPrice: settingsDto(settings).rowPrice } });
}

// Hela kupongen (idempotent). Valet i en avdelning som har startat kan inte ändras (409).
export async function saveCoupon(db: Db, userId: string, roundId: string, body: Record<string, unknown>, now: Date): Promise<Reply<CouponResponse>> {
  const parsed = parseCouponBody(body);
  if (!parsed.ok) return err(400, parsed.error);
  const input = parsed.value;
  const round = await db.round.findUnique({
    where: { id: roundId },
    select: { id: true, races: { select: { leg: true, startAt: true, starts: { select: { number: true } } } } },
  });
  if (!round) return err(404, "Omgången finns inte.");
  for (const [leg, nums] of Object.entries(input.selections)) {
    const race = round.races.find((r) => r.leg === Number(leg));
    if (!race) return err(400, `Avd ${leg} finns inte i omgången.`);
    const have = new Set(race.starts.map((s) => s.number));
    const bad = nums.find((n) => !have.has(n));
    if (bad !== undefined) return err(400, `Startnummer ${bad} finns inte i avd ${leg}.`);
  }
  const [existing, settings] = await Promise.all([
    db.coupon.findUnique({ where: { userId_roundId: { userId, roundId } } }),
    db.userSettings.findUnique({ where: { userId } }),
  ]);
  const old = asSelections(existing?.selections ?? {});
  for (const race of round.races) {
    if (race.startAt.getTime() <= now.getTime() && !sameNumbers(old[race.leg], input.selections[race.leg])) return err(409, RACE_STARTED);
  }
  const rowPrice = input.rowPrice ?? (existing ? Number(existing.rowPrice) : settingsDto(settings).rowPrice);
  const selections = Object.fromEntries(Object.entries(input.selections).map(([k, v]) => [k, v])) as Prisma.InputJsonValue;
  const data = { budget: input.budget, rowPrice, selections, lockedLegs: input.lockedLegs };
  const coupon = await db.coupon.upsert({ where: { userId_roundId: { userId, roundId } }, create: { userId, roundId, ...data }, update: data });
  return ok({ coupon: couponDto(coupon), defaults: { budget: DEFAULT_BUDGET, rowPrice: settingsDto(settings).rowPrice } });
}

// ---- Modell (bara ADMIN) ---------------------------------------------------------------------

export const ADMIN_ONLY = "Bara administratören kan se och ändra riktoddsmodellen.";

async function modelList(db: Db): Promise<ModelResponse> {
  const versions = await db.modelVersion.findMany({ orderBy: { createdAt: "desc" } });
  const active = versions.find((v) => v.active) ?? null;
  return { active: active ? modelDto(active) : null, versions: versions.map(modelDto) };
}

export async function getModel(db: Db, user: { role: Role }): Promise<Reply<ModelResponse>> {
  if (user.role !== "ADMIN") return err(403, ADMIN_ONLY);
  return ok(await modelList(db));
}

const PARAM_LIMITS: Record<keyof ModelParams, [number, number]> = {
  beta: [0.01, 10],
  marginal: [0, 1],
  kPlats: [0, 1000],
  kVinst: [0, 1000],
  kKusk: [0, 1000],
  kTranare: [0, 1000],
};

export type ModelInput = { weights: Partial<Weights>; params: Partial<ModelParams>; roundId: string | null };

export function parseModelBody(body: Record<string, unknown>): Result<ModelInput> {
  const unknown = Object.keys(body).filter((k) => !["weights", "params", "roundId"].includes(k));
  if (unknown.length) return { ok: false, error: "Okänt fält." };
  const obj = (x: unknown) => (x === undefined ? {} : x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
  const w = obj(body.weights);
  const p = obj(body.params);
  if (!w || !p) return { ok: false, error: "weights och params ska vara objekt." };
  const weights: Partial<Weights> = {};
  for (const [k, v] of Object.entries(w)) {
    if (!(INPUT_KEYS as readonly string[]).includes(k)) return { ok: false, error: `Okänd vikt: ${k}.` };
    if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 10) return { ok: false, error: `Vikten ${k} ska vara ett tal mellan −10 och 10.` };
    weights[k as keyof Weights] = v;
  }
  const params: Partial<ModelParams> = {};
  for (const [k, v] of Object.entries(p)) {
    const lim = PARAM_LIMITS[k as keyof ModelParams];
    if (!lim) return { ok: false, error: `Okänd parameter: ${k}.` };
    if (typeof v !== "number" || !Number.isFinite(v) || v < lim[0] || v > lim[1]) return { ok: false, error: `${k} ska ligga mellan ${lim[0]} och ${lim[1]}.` };
    params[k as keyof ModelParams] = v;
  }
  const roundId = body.roundId ?? null;
  if (roundId !== null && !isId(roundId)) return { ok: false, error: "Ogiltig omgång." };
  return { ok: true, value: { weights, params, roundId: roundId as string | null } };
}

// Sparar vikterna som en NY modellversion (v1.1, v1.2 …) som blir aktiv. De
// gamla finns kvar. Är vikterna och parametrarna oförändrade skapas ingen ny
// version. Räknar sedan om omgången (angiven eller aktuell).
export async function saveModel(db: Db, user: { id: string; role: Role }, body: Record<string, unknown>, now: Date): Promise<Reply<ModelResponse>> {
  if (user.role !== "ADMIN") return err(403, ADMIN_ONLY);
  const parsed = parseModelBody(body);
  if (!parsed.ok) return err(400, parsed.error);
  if (parsed.value.roundId && !(await db.round.findUnique({ where: { id: parsed.value.roundId }, select: { id: true } }))) return err(404, "Omgången finns inte.");
  const active = await db.modelVersion.findFirst({ where: { active: true } });
  const weights = { ...parseWeights(active?.weights ?? null), ...parsed.value.weights };
  const params = { ...parseParams(active?.params ?? null), ...parsed.value.params };
  const same = active && JSON.stringify(parseWeights(active.weights)) === JSON.stringify(weights) && JSON.stringify(parseParams(active.params)) === JSON.stringify(params);
  if (!same) {
    const keys = (await db.modelVersion.findMany({ select: { key: true } })).map((m) => m.key);
    const key = nextModelKey(keys);
    // Det unika indexet tillåter bara en aktiv: stäng av först, i samma transaktion.
    await db.$transaction([
      db.modelVersion.updateMany({ where: { active: true }, data: { active: false } }),
      db.modelVersion.create({ data: { key, weights, params, active: true, createdById: user.id, createdAt: now } }),
    ]);
  }
  const roundId = parsed.value.roundId ?? (await currentRoundId(db));
  const recomputed = roundId ? await riktoddsStep(db, { roundId, userId: user.id, now }) : null;
  return ok({ ...(await modelList(db)), recomputed });
}
