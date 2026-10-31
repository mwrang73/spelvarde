// Omvandling från Prisma-rader till API-typerna i lib/types.ts.
import type { Coupon, HorseComment, Mark, ModelVersion, Person, Prisma, Riktodds, Round, Source, SubmittedRow, UserSettings } from "@prisma/client";
import type { HorseStats, PersonStats, YearStats } from "@/lib/atg";
import { asLegRoles, asSelections, couponCost, rowCount } from "@/lib/coupon";
import { DEFAULT_GAME_TYPE, isGameType } from "@/lib/game-type";
import { explain, parseParams, parseWeights, type InputKey, type StoredInputs } from "@/lib/riktodds";
import { belowGuideline, DEFAULT_GUIDELINE, DEFAULT_TOLERANCE, forslag, oddsClass, spelbar } from "@/lib/spelbar";
import { DEFAULT_X_FACTORS, factorFor, riktoddsX, type XFactorSettings } from "@/lib/xfactor";
import type { CommentDto, CouponDto, MarkDto, ModelDto, OddsSource, PersonDto, RiktoddsDetailDto, RoundDto, SettingsDto, SourceDto, SubmittedRowDto, ThemeSetting, YearStatsDto } from "@/lib/types";

export const dec = (d: Prisma.Decimal | null | undefined): number | null => (d === null || d === undefined ? null : Number(d));
export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
export const dateStr = (d: Date) => d.toISOString().slice(0, 10);

export function roundDto(r: Round): RoundDto {
  return {
    id: r.id,
    atgGameId: r.atgGameId,
    gameType: isGameType(r.gameType) ? r.gameType : DEFAULT_GAME_TYPE,
    date: dateStr(r.date),
    trackId: r.trackId,
    trackName: r.trackName,
    firstStartAt: r.firstStartAt.toISOString(),
    atgStatus: r.atgStatus,
    fetchedAt: iso(r.fetchedAt),
    fetchStatus: r.fetchStatus,
    finishedAt: iso(r.finishedAt),
    rev: r.rev,
  };
}

export function personDto(p: Person | null | undefined): PersonDto | null {
  if (!p) return null;
  return { id: p.id, name: `${p.firstName} ${p.lastName}`.trim(), firstName: p.firstName, lastName: p.lastName, shortName: p.shortName };
}

// Källan som klienten ser. Migreringen E2.2 gav alla befintliga rader
// MANUAL, även de utan odds; utan odds finns ingen källa. UNIBET utan odds
// betyder struken hos Unibet och står kvar.
export function oddsSourceOf(source: OddsSource | null, unibetOdds: number | null): OddsSource | null {
  if (source === "MANUAL" && unibetOdds === null) return null;
  return source;
}

// riktodds = aktivt riktodds för starten, guideline = användarens riktlinje,
// factors = användarens X-faktorer, tolerance = toleransen för Spelbar (E2.2).
// Förslaget räknas mot riktoddset med X-faktor (6.1).
export function markDto(m: Mark, riktodds: number | null = null, guideline: number = DEFAULT_GUIDELINE, factors: XFactorSettings = DEFAULT_X_FACTORS, tolerance: number = DEFAULT_TOLERANCE): MarkDto {
  const unibetOdds = dec(m.unibetOdds);
  const rx = riktoddsX(riktodds, m.xFactor, factors);
  const base = { interesting: m.interesting, unibetOdds, riktodds: rx, override: m.spelbarOverride };
  const replaced = m.replacedOdds !== null && m.replacedByFetchId !== null;
  return {
    startId: m.startId,
    interesting: m.interesting,
    interestingAt: iso(m.interestingAt),
    spelbarOverride: m.spelbarOverride,
    bet: m.bet,
    betAt: iso(m.betAt),
    betOdds: dec(m.betOdds),
    unibetOdds,
    unibetOddsAt: iso(m.unibetOddsAt),
    unibetOddsPrev: dec(m.unibetOddsPrev),
    updatedAt: m.updatedAt.toISOString(),
    xFactor: m.xFactor,
    xFactorAt: iso(m.xFactorAt),
    xFactorValue: factorFor(m.xFactor, factors),
    sourceSupport: m.sourceSupport,
    forslag: forslag(base, tolerance),
    spelbar: spelbar(base, tolerance),
    riktodds,
    riktoddsX: rx,
    belowGuideline: belowGuideline(unibetOdds, guideline),
    unibetOddsSource: oddsSourceOf(m.unibetOddsSource, unibetOdds),
    replacedOdds: replaced ? dec(m.replacedOdds) : null,
    replacedByFetchId: replaced ? m.replacedByFetchId : null,
    oddsClass: oddsClass(unibetOdds, rx, tolerance),
  };
}

// legs = spelets antal avdelningar (legsFor(round.gameType)).
export function couponDto(c: Coupon, legs = 8): CouponDto {
  const sel = asSelections(c.selections);
  const rowPrice = Number(c.rowPrice);
  const rows = rowCount(sel, legs);
  return {
    roundId: c.roundId,
    budget: c.budget,
    rowPrice,
    selections: Object.fromEntries(Object.entries(sel).map(([k, v]) => [k, v])),
    lockedLegs: c.lockedLegs,
    rows,
    cost: couponCost(rows, rowPrice),
    updatedAt: c.updatedAt.toISOString(),
    spikCount: c.spikCount,
    allgMode: c.allgMode,
    allgLeg: c.allgLeg,
    maxPerLeg: c.maxPerLeg,
    legRoles: asLegRoles(c.legRoles),
    copiedAt: c.copiedAt ? c.copiedAt.toISOString() : null,
    copiedSelections: c.copiedSelections === null ? null : Object.fromEntries(Object.entries(asSelections(c.copiedSelections)).map(([k, v]) => [k, v])),
  };
}

// E8: kopian som den sparades. Rader och kostnad räknas inte om.
export function submittedRowDto(r: SubmittedRow): SubmittedRowDto {
  return {
    roundId: r.roundId,
    selections: Object.fromEntries(Object.entries(asSelections(r.selections)).map(([k, v]) => [k, v])),
    rows: r.rows,
    cost: Number(r.cost),
    rowPrice: Number(r.rowPrice),
    markedAt: r.markedAt.toISOString(),
    markedLate: r.markedLate,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function modelDto(m: ModelVersion): ModelDto {
  return { id: m.id, key: m.key, weights: parseWeights(m.weights), params: parseParams(m.params), active: m.active, createdAt: m.createdAt.toISOString() };
}

// Riktodds med förklaring för hästkortet (7.4).
export function riktoddsDetailDto(r: Riktodds, model: ModelVersion): RiktoddsDetailDto {
  const odds = Number(r.odds);
  const probTop3 = Number(r.probTop3);
  const contributions = r.contributions as unknown as Record<InputKey, number>;
  const e = explain({ probTop3, odds, uncertain: r.uncertain, inputs: r.inputs as unknown as StoredInputs, contributions }, parseParams(model.params).marginal);
  return {
    modelKey: model.key,
    computedAt: r.computedAt.toISOString(),
    odds,
    probTop3,
    uncertain: r.uncertain,
    uncertainLine: e.uncertainLine,
    noteLine: e.noteLine,
    pros: e.pros.map(({ key, text, contribution }) => ({ key, text, contribution })),
    cons: e.cons.map(({ key, text, contribution }) => ({ key, text, contribution })),
    calcLine: e.calcLine,
    contributions,
  };
}

// Det som commentDto behöver för sammanhanget (omgång, avdelning, resultat).
export const COMMENT_INCLUDE = {
  round: { select: { id: true, date: true, trackName: true, gameType: true } },
  start: { select: { place: true, disqualified: true, resultAt: true, race: { select: { leg: true } } } },
} as const;

export function commentDto(
  c: HorseComment & {
    round?: { id: string; date: Date; trackName: string; gameType: string } | null;
    start?: { place: number | null; disqualified: boolean; resultAt: Date | null; race: { leg: number } } | null;
  },
): CommentDto {
  return {
    id: c.id,
    clientId: c.clientId,
    horseId: c.horseId,
    startId: c.startId,
    roundId: c.roundId,
    kind: c.kind,
    tags: c.tags,
    text: c.text,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    round: c.round ? { id: c.round.id, date: dateStr(c.round.date), trackName: c.round.trackName, gameType: c.round.gameType } : null,
    leg: c.start?.race.leg ?? null,
    result: c.start?.resultAt ? { place: c.start.place, disqualified: c.start.disqualified } : null,
  };
}

const THEME_TO_API: Record<UserSettings["theme"], ThemeSetting> = { SYSTEM: "system", LIGHT: "light", DARK: "dark" };
export const THEME_FROM_API: Record<ThemeSetting, UserSettings["theme"]> = { system: "SYSTEM", light: "LIGHT", dark: "DARK" };

export function settingsDto(s: UserSettings | null): SettingsDto {
  return {
    theme: s ? THEME_TO_API[s.theme] : "system",
    rushThresholdPe: s ? Number(s.rushThresholdPe) : 10,
    rowPrice: s ? Number(s.rowPrice) : 0.5,
    spelbarGuideline: s ? Number(s.spelbarGuideline) : 2,
    xFactorTror: s ? Number(s.xFactorTror) : DEFAULT_X_FACTORS.xFactorTror,
    xFactorStark: s ? Number(s.xFactorStark) : DEFAULT_X_FACTORS.xFactorStark,
    gameType: s && isGameType(s.gameType) ? s.gameType : DEFAULT_GAME_TYPE,
    spelbarTolerance: s ? Number(s.spelbarTolerance) : DEFAULT_TOLERANCE,
  };
}

export function sourceDto(s: Source): SourceDto {
  return {
    id: s.id,
    name: s.name,
    url: s.url,
    enabled: s.enabled,
    sortOrder: s.sortOrder,
    lastReadAt: iso(s.lastReadAt),
    lastStatus: s.lastStatus,
    lastError: s.lastError,
    lastFactCount: s.lastFactCount,
    createdAt: s.createdAt.toISOString(),
    kind: s.kind ?? null,
    lastArticleCount: s.lastArticleCount ?? null,
  };
}

export function yearStatsDto(year: string, y: YearStats | null | undefined): YearStatsDto | null {
  if (!y) return null;
  const placed = y.wins + y.seconds + y.thirds;
  return {
    year,
    starts: y.starts,
    wins: y.wins,
    seconds: y.seconds,
    thirds: y.thirds,
    winPct: y.starts ? Math.round((1000 * y.wins) / y.starts) / 10 : null,
    placePct: y.starts ? Math.round((1000 * placed) / y.starts) / 10 : null,
    earnings: y.earnings,
  };
}

// JSON-fälten från databasen (skrivna av lib/atg.ts) läses försiktigt.
export function asPersonStats(x: Prisma.JsonValue | null): PersonStats | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as unknown as PersonStats) : null;
}
export function asHorseStats(x: Prisma.JsonValue | null): HorseStats | null {
  return x && typeof x === "object" && !Array.isArray(x) && "years" in x ? (x as unknown as HorseStats) : null;
}
