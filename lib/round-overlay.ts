// Klientens optimistiska läge (specen 9.1 och 9.3). Rena funktioner utan
// React och DOM, testade i lib/round-overlay.test.ts.
//
// Cachen (RoundResponse från GET /api/rounds/[id]) är serverns bekräftade
// läge. Det som ligger i utkorgen läggs ovanpå vid varje ritning, så att
// - en ändring syns direkt (optimistiskt),
// - den överlever omladdning och offline (utkorgen ligger i localStorage),
// - en avvisad ändring (409, 4xx) rullas tillbaka av sig själv när posten
//   tas bort ur kön, och
// - en ny hämtning av omgången inte skriver över det som inte är skickat.
// När servern har bekräftat en post (2xx) skrivs svaret in i cachen med
// applyDone(), så att läget inte blinkar tillbaka.
//
// Mark-poster (E2) läggs på med samma regler som servern (applyMarkChange i
// lib/marks.ts), så att Spelbar, Bet och "Ändrat från" stämmer direkt. Från
// E2.1 räknas förslaget mot riktoddset med X-faktor med användarens faktorer
// ur data.settings (lib/xfactor.ts), precis som på servern. Från E2.2 med
// användarens tolerans (data.settings.spelbarTolerance, toleranceOf()).

import { couponCost, rowCount, type Selections } from "@/lib/coupon";
import { applyMarkChange, EMPTY_MARK, parseMarkChange, type MarkChange, type MarkState } from "@/lib/marks";
import type { OutboxItem } from "@/lib/outbox";
import { nextStep, type NextStepRace } from "@/lib/phase";
import { belowGuideline, DEFAULT_TOLERANCE, forslag, oddsClass, spelbar } from "@/lib/spelbar";
import type { AllgMode, CommentDto, CommentKind, CouponDto, LegRolesDto, CouponResponse, MarkDto, MarkResponse, RaceDto, ReviewResponse, RoundResponse, RoundSettings, SettingsDto, StartDto } from "@/lib/types";
import { DEFAULT_X_FACTORS, factorFor, riktoddsX, type XFactorSettings } from "@/lib/xfactor";
import { legsFor } from "@/lib/game-type";

// ---- Posternas meta ------------------------------------------------------------------

// Kroppen i posten är ändringen (MarkChange, lib/marks.ts). `interesting`
// finns kvar för poster som lades i kön av E1 (kroppen { interesting }).
export type MarkMeta = { kind: "mark"; roundId: string; raceId: string; startId: string; horseName: string; interesting?: boolean };
export type ReviewMeta = { kind: "review"; roundId: string; raceId: string; reviewed: boolean; noneInteresting: boolean };
export type CommentMeta = {
  kind: "comment";
  horseId: string;
  horseName: string;
  clientId: string;
  // Sammanhang för listan i hästkortet innan servern har svarat.
  round: CommentDto["round"];
  leg: number | null;
};
export type CommentDeleteMeta = { kind: "comment-delete"; horseId: string; horseName: string; clientId: string };
// Kroppen är hela kupongen (CouponBody).
export type CouponMeta = { kind: "coupon"; roundId: string };
export type ItemMeta = MarkMeta | ReviewMeta | CommentMeta | CommentDeleteMeta | CouponMeta;

export type CommentBody = { horseId: string; startId: string | null; roundId: string | null; kind: CommentKind; tags: string[]; text: string };
export type CouponBody = { budget: number; rowPrice: number | null; selections: Record<string, number[]>; lockedLegs: number[] } & CouponBodyE6;
// E6-fälten (frivilliga, så att äldre köade kroppar fungerar).
export type CouponBodyE6 = {
  spikCount?: number | null;
  allgMode?: AllgMode | null;
  allgLeg?: number | null;
  // E6b: Max hästar per lopp, null = Alla.
  maxPerLeg?: number | null;
  legRoles?: LegRolesDto | null;
  copiedAt?: string | null;
  copiedSelections?: Record<string, number[]> | null;
};

export function metaOf(item: OutboxItem): ItemMeta | null {
  const m = item.meta as Partial<ItemMeta> | undefined;
  if (!m || typeof m !== "object" || typeof m.kind !== "string") return null;
  return m as ItemMeta;
}

// Ändringen i en Mark-post. Kroppen tolkas med samma regler som servern.
export function markChangeOf(item: OutboxItem): MarkChange | null {
  const m = metaOf(item);
  if (!m || m.kind !== "mark") return null;
  if (item.body && typeof item.body === "object" && !Array.isArray(item.body)) {
    const parsed = parseMarkChange(item.body as Record<string, unknown>);
    if (parsed.ok) return parsed.value;
  }
  return typeof m.interesting === "boolean" ? { interesting: m.interesting } : null;
}

// Vad en Mark-post ändrar, för toasterna ("Kunde inte spara Bet för …").
export function markWhat(item: OutboxItem): string {
  const c = markChangeOf(item);
  if (!c) return "ändringen";
  if (c.unibetOdds !== undefined || c.betOdds !== undefined) return "oddset";
  if (c.bet !== undefined) return "Bet";
  if (c.spelbar !== undefined) return "Spelbar";
  if (c.xFactor !== undefined && c.interesting === undefined) return "X-faktor";
  if (c.sourceSupport !== undefined && c.interesting === undefined) return "källstödet";
  return "Intressant";
}

// Texten i toasten när ett försök misslyckas och posten ligger kvar i kön.
export function retryText(item: OutboxItem): string {
  const m = metaOf(item);
  if (!m) return "Kunde inte spara ändringen. Försöker igen.";
  if (m.kind === "mark") return `Kunde inte spara ${markWhat(item)} för ${m.horseName}. Försöker igen.`;
  if (m.kind === "review") return "Kunde inte spara granskningen. Försöker igen.";
  if (m.kind === "coupon") return "Kunde inte spara raden. Försöker igen.";
  return `Kunde inte spara kommentaren om ${m.horseName}. Försöker igen.`;
}

// Toasten när servern avvisar en post (övriga 4xx). `error` är serverns mening.
export function rejectedText(item: OutboxItem, error: string): string {
  const m = metaOf(item);
  if (m?.kind === "mark") return `Kunde inte spara ${markWhat(item)} för ${m.horseName}: ${error}`;
  if (m?.kind === "coupon") return `Kunde inte spara raden: ${error}`;
  return error;
}

// Toasten vid 409 (loppet hade redan startat).
export function conflictText(item: OutboxItem): string {
  const m = metaOf(item);
  if (m?.kind === "coupon") return "Raden: en avdelning hade redan startat, ändringen sparades inte.";
  const horse = m && "horseName" in m ? m.horseName : "Hästen";
  return `${horse}: loppet hade redan startat, ändringen sparades inte.`;
}

// ---- Omgången --------------------------------------------------------------------------

// Räknare och "genomgången" räknas om från starterna (samma regel som servern).
export function recountRace(race: RaceDto): RaceDto {
  const s = race.starts;
  const interesting = s.filter((x) => x.mark?.interesting).length;
  return {
    ...race,
    reviewed: interesting > 0 || race.review !== null,
    counts: {
      starters: s.filter((x) => !x.scratched).length,
      scratched: s.filter((x) => x.scratched).length,
      interesting,
      spelbar: s.filter((x) => x.mark?.spelbar).length,
      bet: s.filter((x) => x.mark?.bet).length,
    },
  };
}

const RECOUNT_STEPS = new Set<RoundResponse["nextStep"]["kind"]>(["ANALYZE_LEG", "ALL_REVIEWED", "ODDS_FILL", "MARK_BET", "BUILD_COUPON"]);

function withNextStep(data: RoundResponse, now: Date): RoundResponse {
  // Nästa steg följer kortet direkt när en avdelning blir genomgången, när
  // odds fylls i, Bet sätts och V85-raden sparas. Kortet för hämtningen och
  // senare etapper räknas på servern.
  if (!RECOUNT_STEPS.has(data.nextStep.kind)) return data;
  const races: NextStepRace[] = data.races.map((r) => ({
    leg: r.leg,
    name: r.name,
    startAt: new Date(r.startAt),
    hasResult: !!r.resultAt,
    cancelled: r.cancelled,
    reviewed: r.reviewed,
  }));
  // Samma räknare som servern (lib/round-server.ts): lopp som inte har startat, strukna inte med.
  const open = data.races.filter((r) => !r.started).flatMap((r) => r.starts).filter((s) => !s.scratched);
  const step = nextStep({
    now,
    round: { id: data.round.id, date: data.round.date, fetchStatus: data.round.fetchStatus, races },
    nextAvailable: null,
    interestingWithoutOdds: open.filter((s) => s.mark?.interesting && s.mark.unibetOdds === null).length,
    spelbarWithoutBet: open.filter((s) => s.mark?.spelbar && !s.mark.bet).length,
    hasCoupon: !!data.coupon,
  });
  return { ...data, nextStep: step };
}

const time = (iso: string | null) => (iso ? new Date(iso) : null);
const isoOf = (d: Date | null) => (d ? d.toISOString() : null);

export function markStateOf(m: MarkDto | null): MarkState {
  if (!m) return EMPTY_MARK;
  return {
    interesting: m.interesting,
    interestingAt: time(m.interestingAt),
    spelbarOverride: m.spelbarOverride,
    bet: m.bet,
    betAt: time(m.betAt),
    betOdds: m.betOdds,
    unibetOdds: m.unibetOdds,
    unibetOddsAt: time(m.unibetOddsAt),
    unibetOddsPrev: m.unibetOddsPrev,
    // Cachade svar från före E2.1 saknar fälten.
    xFactor: m.xFactor ?? "NONE",
    xFactorAt: time(m.xFactorAt ?? null),
    sourceSupport: m.sourceSupport ?? null,
    // Cachade svar från före E2.2 saknar fälten. Ett odds utan källa var inskrivet.
    unibetOddsSource: m.unibetOddsSource ?? (m.unibetOdds !== null ? "MANUAL" : null),
    replacedOdds: m.replacedOdds ?? null,
    replacedByFetchId: m.replacedByFetchId ?? null,
  };
}

// Användarens tolerans för Spelbar (E2.2), 0,10 om den saknas (cachat svar
// från före E2.2).
export function toleranceOf(settings: Partial<RoundSettings> | null | undefined): number {
  return settings?.spelbarTolerance ?? DEFAULT_TOLERANCE;
}

// Användarens X-faktorer ur omgångens inställningar (standard om de saknas,
// som i ett cachat svar från före E2.1).
export function xFactorsOf(settings: Partial<RoundSettings> | null | undefined): XFactorSettings {
  return {
    xFactorTror: settings?.xFactorTror ?? DEFAULT_X_FACTORS.xFactorTror,
    xFactorStark: settings?.xFactorStark ?? DEFAULT_X_FACTORS.xFactorStark,
  };
}

// MarkState (optimistiskt läge) till MarkDto med beräknad Spelbar (6.1),
// räknad mot riktoddset med X-faktor (6.8). Samma som markDto i lib/dto.ts.
export function markDtoOf(startId: string, s: MarkState, riktodds: number | null, guideline: number, updatedAt: string, factors: XFactorSettings = DEFAULT_X_FACTORS, tolerance: number = DEFAULT_TOLERANCE): MarkDto {
  const rx = riktoddsX(riktodds, s.xFactor, factors);
  const base = { interesting: s.interesting, unibetOdds: s.unibetOdds, riktodds: rx, override: s.spelbarOverride };
  return {
    startId,
    interesting: s.interesting,
    interestingAt: isoOf(s.interestingAt),
    spelbarOverride: s.spelbarOverride,
    bet: s.bet,
    betAt: isoOf(s.betAt),
    betOdds: s.betOdds,
    unibetOdds: s.unibetOdds,
    unibetOddsAt: isoOf(s.unibetOddsAt),
    unibetOddsPrev: s.unibetOddsPrev,
    updatedAt,
    xFactor: s.xFactor,
    xFactorAt: isoOf(s.xFactorAt),
    xFactorValue: factorFor(s.xFactor, factors),
    sourceSupport: s.sourceSupport,
    forslag: forslag(base, tolerance),
    spelbar: spelbar(base, tolerance),
    riktodds,
    riktoddsX: rx,
    belowGuideline: belowGuideline(s.unibetOdds, guideline),
    unibetOddsSource: s.unibetOddsSource === "MANUAL" && s.unibetOdds === null ? null : s.unibetOddsSource,
    replacedOdds: s.replacedByFetchId !== null ? s.replacedOdds : null,
    replacedByFetchId: s.replacedOdds !== null ? s.replacedByFetchId : null,
    oddsClass: oddsClass(s.unibetOdds, rx, tolerance),
  };
}

// Lägger ändringarna (i köns ordning) på hästens Mark. Tiden för varje
// ändring är när den lades i kön, så att "Ändrat från … kl …" står still.
function setMark(start: StartDto, changes: { change: MarkChange; at: number }[], guideline: number, factors: XFactorSettings, tolerance: number = DEFAULT_TOLERANCE): StartDto {
  let state = markStateOf(start.mark ?? null);
  for (const c of changes) state = applyMarkChange(state, c.change, { now: new Date(c.at), riktodds: start.riktodds, factors, tolerance });
  const updatedAt = new Date(changes[changes.length - 1]?.at ?? 0).toISOString();
  return { ...start, mark: markDtoOf(start.id, state, start.riktodds, guideline, updatedAt, factors, tolerance) };
}

// Nya inställningar (S10: riktlinje, radpris, X-faktorer) in i cachen. Alla
// hästars beräknade fält (forslag, spelbar, riktoddsX, xFactorValue,
// belowGuideline) räknas om med samma regler som servern, så att förslagen
// ändras direkt utan att omgången hämtas igen.
// spelbarTolerance (E2.2) behålls från cachen om den inte skickas.
export function applySettings(data: RoundResponse, s: Pick<SettingsDto, "spelbarGuideline" | "rowPrice" | "xFactorTror" | "xFactorStark"> & Partial<Pick<SettingsDto, "spelbarTolerance">>, now: Date = new Date()): RoundResponse {
  const tolerance = s.spelbarTolerance ?? toleranceOf(data.settings);
  const settings: RoundSettings = { spelbarGuideline: s.spelbarGuideline, rowPrice: s.rowPrice, xFactorTror: s.xFactorTror, xFactorStark: s.xFactorStark, spelbarTolerance: tolerance };
  const races = data.races.map((race) =>
    recountRace({
      ...race,
      starts: race.starts.map((st) => (st.mark ? { ...st, mark: markDtoOf(st.id, markStateOf(st.mark), st.riktodds, s.spelbarGuideline, st.mark.updatedAt, s, tolerance) } : st)),
    }),
  );
  return withNextStep({ ...data, settings, races }, now);
}

// Kupongen i kön som CouponDto (rader och kostnad räknas här, som på servern).
// E6-fälten tas ur kroppen och faller tillbaka på den cachade kupongen (prev)
// när de saknas, som på servern.
export function couponDtoOf(roundId: string, body: CouponBody, fallbackRowPrice: number, at: number, legs = 8, prev: CouponDto | null = null): CouponDto {
  const sel: Selections = {};
  for (const [k, v] of Object.entries(body.selections)) sel[Number(k)] = v;
  const rowPrice = body.rowPrice ?? fallbackRowPrice;
  const rows = rowCount(sel, legs);
  const pick = <K extends keyof CouponBodyE6>(k: K): NonNullable<CouponDto[K]> | null => ((body[k] !== undefined ? body[k] : (prev?.[k] ?? null)) ?? null) as NonNullable<CouponDto[K]> | null;
  return {
    roundId,
    budget: body.budget,
    rowPrice,
    selections: body.selections,
    lockedLegs: body.lockedLegs,
    rows,
    cost: couponCost(rows, rowPrice),
    updatedAt: new Date(at).toISOString(),
    spikCount: pick("spikCount"),
    allgMode: pick("allgMode"),
    allgLeg: pick("allgLeg"),
    maxPerLeg: pick("maxPerLeg"),
    legRoles: pick("legRoles"),
    copiedAt: pick("copiedAt"),
    copiedSelections: pick("copiedSelections"),
  };
}

// Lägger utkorgens poster för omgången ovanpå cachen.
export function applyPending(data: RoundResponse, queue: OutboxItem[], now: Date = new Date()): RoundResponse {
  const marks = new Map<string, { change: MarkChange; at: number }[]>();
  const reviews = new Map<string, { reviewed: boolean; noneInteresting: boolean; at: number }>();
  let coupon: { body: CouponBody; at: number } | null = null;
  for (const item of queue) {
    const m = metaOf(item);
    if (!m || !("roundId" in m) || m.roundId !== data.round.id) continue;
    if (m.kind === "mark") {
      const change = markChangeOf(item);
      if (change) marks.set(m.startId, [...(marks.get(m.startId) ?? []), { change, at: item.createdAt }]);
    } else if (m.kind === "review") {
      reviews.set(m.raceId, { reviewed: m.reviewed, noneInteresting: m.noneInteresting, at: item.createdAt });
    } else if (m.kind === "coupon" && item.body && typeof item.body === "object") {
      coupon = { body: item.body as CouponBody, at: item.createdAt };
    }
  }
  if (!marks.size && !reviews.size && !coupon) return data;
  const guideline = data.settings?.spelbarGuideline ?? 2;
  const factors = xFactorsOf(data.settings);
  const tolerance = toleranceOf(data.settings);
  const races = data.races.map((race) => {
    const touched = race.starts.some((s) => marks.has(s.id)) || reviews.has(race.id);
    if (!touched) return race;
    const starts = race.starts.map((s) => (marks.has(s.id) ? setMark(s, marks.get(s.id)!, guideline, factors, tolerance) : s));
    const r = reviews.get(race.id);
    const review = r ? (r.reviewed ? { reviewedAt: new Date(r.at).toISOString(), noneInteresting: r.noneInteresting } : null) : race.review;
    return recountRace({ ...race, starts, review });
  });
  const pendingCoupon = coupon as { body: CouponBody; at: number } | null;
  const nextCoupon = pendingCoupon ? couponDtoOf(data.round.id, pendingCoupon.body, data.coupon?.rowPrice ?? data.settings?.rowPrice ?? 0.5, pendingCoupon.at, legsFor(data.round.gameType), data.coupon) : data.coupon;
  return withNextStep({ ...data, races, coupon: nextCoupon }, now);
}

// Skriver in serverns bekräftade svar i cachen.
export function applyDone(data: RoundResponse, item: OutboxItem, response: unknown, now: Date = new Date()): RoundResponse {
  const m = metaOf(item);
  if (!m || (m.kind !== "mark" && m.kind !== "review" && m.kind !== "coupon") || m.roundId !== data.round.id) return data;
  if (m.kind === "coupon") {
    const c = (response as Partial<CouponResponse> | null)?.coupon;
    if (!c || c.roundId !== m.roundId) return data;
    return withNextStep({ ...data, coupon: c }, now);
  }
  if (m.kind === "mark") {
    const mark = (response as Partial<MarkResponse> | null)?.mark;
    if (!mark || mark.startId !== m.startId) return data;
    const races = data.races.map((race) =>
      race.id === m.raceId ? recountRace({ ...race, starts: race.starts.map((s) => (s.id === m.startId ? { ...s, mark } : s)) }) : race,
    );
    return withNextStep({ ...data, races }, now);
  }
  const res = response as Partial<ReviewResponse> | null;
  if (!res || res.raceId !== m.raceId) return data;
  const races = data.races.map((race) => (race.id === m.raceId ? recountRace({ ...race, review: res.review ?? null }) : race));
  return withNextStep({ ...data, races }, now);
}

// ---- Kommentarer --------------------------------------------------------------------------

export type PendingComment = CommentDto & { pending: boolean };

// Hästens kommentarer med utkorgens ändringar ovanpå, nyast först.
export function applyPendingComments(comments: CommentDto[], queue: OutboxItem[], horseId: string): PendingComment[] {
  const byClient = new Map<string, PendingComment>(comments.map((c) => [c.clientId, { ...c, pending: false }]));
  for (const item of queue) {
    const m = metaOf(item);
    if (!m || (m.kind !== "comment" && m.kind !== "comment-delete") || m.horseId !== horseId) continue;
    if (m.kind === "comment-delete") {
      byClient.delete(m.clientId);
      continue;
    }
    const body = item.body as CommentBody;
    const prev = byClient.get(m.clientId);
    const at = new Date(item.createdAt).toISOString();
    byClient.set(m.clientId, {
      id: prev?.id ?? `local-${m.clientId}`,
      clientId: m.clientId,
      horseId,
      startId: body.startId,
      roundId: body.roundId,
      kind: body.kind,
      tags: body.tags,
      text: body.text,
      createdAt: prev?.createdAt ?? at,
      updatedAt: at,
      round: prev?.round ?? m.round,
      leg: prev?.leg ?? m.leg,
      result: prev?.result ?? null,
      pending: true,
    });
  }
  return [...byClient.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

// Bekräftad kommentar (PUT) eller borttagning (DELETE) in i hästens lista.
export function applyCommentDone(comments: CommentDto[], item: OutboxItem, response: unknown): CommentDto[] {
  const m = metaOf(item);
  if (!m) return comments;
  if (m.kind === "comment-delete") return comments.filter((c) => c.clientId !== m.clientId);
  if (m.kind !== "comment") return comments;
  const c = (response as { comment?: CommentDto } | null)?.comment;
  if (!c || c.clientId !== m.clientId) return comments;
  const rest = comments.filter((x) => x.clientId !== c.clientId);
  return [c, ...rest].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}
