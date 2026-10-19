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

import type { OutboxItem } from "@/lib/outbox";
import { nextStep, type NextStepRace } from "@/lib/phase";
import type { CommentDto, CommentKind, MarkDto, MarkResponse, RaceDto, ReviewResponse, RoundResponse, StartDto } from "@/lib/types";

// ---- Posternas meta ------------------------------------------------------------------

export type MarkMeta = { kind: "mark"; roundId: string; raceId: string; startId: string; horseName: string; interesting: boolean };
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
export type ItemMeta = MarkMeta | ReviewMeta | CommentMeta | CommentDeleteMeta;

export type CommentBody = { horseId: string; startId: string | null; roundId: string | null; kind: CommentKind; tags: string[]; text: string };

export function metaOf(item: OutboxItem): ItemMeta | null {
  const m = item.meta as Partial<ItemMeta> | undefined;
  if (!m || typeof m !== "object" || typeof m.kind !== "string") return null;
  return m as ItemMeta;
}

// Texten i toasten när ett försök misslyckas och posten ligger kvar i kön.
export function retryText(item: OutboxItem): string {
  const m = metaOf(item);
  if (!m) return "Kunde inte spara ändringen. Försöker igen.";
  if (m.kind === "mark") return `Kunde inte spara Intressant för ${m.horseName}. Försöker igen.`;
  if (m.kind === "review") return "Kunde inte spara granskningen. Försöker igen.";
  return `Kunde inte spara kommentaren om ${m.horseName}. Försöker igen.`;
}

// ---- Omgången --------------------------------------------------------------------------

const emptyMark = (startId: string): MarkDto => ({
  startId,
  interesting: false,
  interestingAt: null,
  spelbarOverride: "NONE",
  bet: false,
  betAt: null,
  betOdds: null,
  unibetOdds: null,
  unibetOddsAt: null,
  unibetOddsPrev: null,
  updatedAt: new Date(0).toISOString(),
  forslag: false,
  spelbar: false,
});

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

function withNextStep(data: RoundResponse, now: Date): RoundResponse {
  const races: NextStepRace[] = data.races.map((r) => ({
    leg: r.leg,
    name: r.name,
    startAt: new Date(r.startAt),
    hasResult: !!r.resultAt,
    cancelled: r.cancelled,
    reviewed: r.reviewed,
  }));
  // Nästa steg följer kortet direkt när en avdelning blir genomgången.
  // Kortet för hämtningen och senare etapper räknas på servern.
  if (data.nextStep.kind !== "ANALYZE_LEG" && data.nextStep.kind !== "ALL_REVIEWED") return data;
  const step = nextStep({ now, round: { id: data.round.id, date: data.round.date, fetchStatus: data.round.fetchStatus, races }, nextAvailable: null });
  return { ...data, nextStep: step };
}

function setMark(start: StartDto, interesting: boolean): StartDto {
  const mark = start.mark ?? emptyMark(start.id);
  return { ...start, mark: { ...mark, interesting, spelbarOverride: interesting ? mark.spelbarOverride : "NONE" } };
}

// Lägger utkorgens poster för omgången ovanpå cachen.
export function applyPending(data: RoundResponse, queue: OutboxItem[], now: Date = new Date()): RoundResponse {
  const marks = new Map<string, boolean>();
  const reviews = new Map<string, { reviewed: boolean; noneInteresting: boolean; at: number }>();
  for (const item of queue) {
    const m = metaOf(item);
    if (!m) continue;
    if (m.kind === "mark" && m.roundId === data.round.id) marks.set(m.startId, m.interesting);
    if (m.kind === "review" && m.roundId === data.round.id) reviews.set(m.raceId, { reviewed: m.reviewed, noneInteresting: m.noneInteresting, at: item.createdAt });
  }
  if (!marks.size && !reviews.size) return data;
  const races = data.races.map((race) => {
    const touched = race.starts.some((s) => marks.has(s.id)) || reviews.has(race.id);
    if (!touched) return race;
    const starts = race.starts.map((s) => (marks.has(s.id) ? setMark(s, marks.get(s.id)!) : s));
    const r = reviews.get(race.id);
    const review = r ? (r.reviewed ? { reviewedAt: new Date(r.at).toISOString(), noneInteresting: r.noneInteresting } : null) : race.review;
    return recountRace({ ...race, starts, review });
  });
  return withNextStep({ ...data, races }, now);
}

// Skriver in serverns bekräftade svar i cachen.
export function applyDone(data: RoundResponse, item: OutboxItem, response: unknown, now: Date = new Date()): RoundResponse {
  const m = metaOf(item);
  if (!m || (m.kind !== "mark" && m.kind !== "review") || m.roundId !== data.round.id) return data;
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
