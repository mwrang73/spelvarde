// Omvandling från Prisma-rader till API-typerna i lib/types.ts.
import type { HorseComment, Mark, Person, Prisma, Round, Source, UserSettings } from "@prisma/client";
import type { HorseStats, PersonStats, YearStats } from "@/lib/atg";
import { forslag, spelbar } from "@/lib/spelbar";
import type { CommentDto, MarkDto, PersonDto, RoundDto, SettingsDto, SourceDto, ThemeSetting, YearStatsDto } from "@/lib/types";

export const dec = (d: Prisma.Decimal | null | undefined): number | null => (d === null || d === undefined ? null : Number(d));
export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
export const dateStr = (d: Date) => d.toISOString().slice(0, 10);

export function roundDto(r: Round): RoundDto {
  return {
    id: r.id,
    atgGameId: r.atgGameId,
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

export function markDto(m: Mark, riktodds: number | null = null): MarkDto {
  const unibetOdds = dec(m.unibetOdds);
  const base = { interesting: m.interesting, unibetOdds, riktodds, override: m.spelbarOverride };
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
    forslag: forslag(base),
    spelbar: spelbar(base),
  };
}

// Det som commentDto behöver för sammanhanget (omgång, avdelning, resultat).
export const COMMENT_INCLUDE = {
  round: { select: { id: true, date: true, trackName: true } },
  start: { select: { place: true, disqualified: true, resultAt: true, race: { select: { leg: true } } } },
} as const;

export function commentDto(
  c: HorseComment & {
    round?: { id: string; date: Date; trackName: string } | null;
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
    round: c.round ? { id: c.round.id, date: dateStr(c.round.date), trackName: c.round.trackName } : null,
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
  };
}

// JSON-fälten från databasen (skrivna av lib/atg.ts) läses försiktigt.
export function asPersonStats(x: Prisma.JsonValue | null): PersonStats | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as unknown as PersonStats) : null;
}
export function asHorseStats(x: Prisma.JsonValue | null): HorseStats | null {
  return x && typeof x === "object" && !Array.isArray(x) && "years" in x ? (x as unknown as HorseStats) : null;
}
