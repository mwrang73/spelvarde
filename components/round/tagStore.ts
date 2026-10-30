// Tagga loppet (mockupen markeringar-live, del 2): snabbvalen per häst för ett
// lopp som har startat, även långt i efterhand. Taggarna är en kommentar av
// typen RACE per start (GET /api/rounds/[id]/races/[leg]/tags). Ändringar
// läggs i minnet direkt och skickas via utkorgen (PUT /api/comments/[clientId]),
// så att byte av häst aldrig väntar på nätet.

import { useSyncExternalStore } from "react";
import { apiGet } from "@/components/api";
import { addToOutbox } from "@/components/outbox/outbox-client";
import type { CommentBody } from "@/lib/round-overlay";
import type { CommentDto, RaceDto, StartDto } from "@/lib/types";
import { newClientId } from "./HorseCard";

export type RaceTag = { clientId: string; tags: string[]; text: string };
export type RaceTags = { byStart: Record<string, RaceTag>; loading: boolean; error: string | null; loaded: boolean };
export type TagCtx = { roundId: string; roundDate: string; trackName: string; gameType: string; race: RaceDto };

const cache = new Map<string, RaceTags>();
const listeners = new Set<() => void>();
const EMPTY: RaceTags = { byStart: {}, loading: false, error: null, loaded: false };
const key = (roundId: string, leg: number) => `${roundId}:${leg}`;

// Öppen taggning: loppets id och vald start.
let open: { raceId: string; startId: string | null } | null = null;

function emit() {
  listeners.forEach((fn) => fn());
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function loadRaceTags(roundId: string, leg: number, force = false) {
  const k = key(roundId, leg);
  const cur = cache.get(k) ?? EMPTY;
  if (cur.loading || (cur.loaded && !force)) return;
  cache.set(k, { ...cur, loading: true, error: null });
  emit();
  apiGet<{ comments: CommentDto[] }>(`/api/rounds/${roundId}/races/${leg}/tags`)
    .then(({ comments }) => {
      const byStart: Record<string, RaceTag> = {};
      for (const c of comments) if (c.startId) byStart[c.startId] = { clientId: c.clientId, tags: c.tags, text: c.text };
      // Ändringar gjorda medan svaret var på väg vinner.
      const now = cache.get(k) ?? EMPTY;
      cache.set(k, { byStart: { ...byStart, ...now.byStart }, loading: false, error: null, loaded: true });
      emit();
    })
    .catch((e: unknown) => {
      cache.set(k, { ...(cache.get(k) ?? EMPTY), loading: false, error: e instanceof Error ? e.message : "Kunde inte hämta taggarna." });
      emit();
    });
}

export function useRaceTags(roundId: string, leg: number): RaceTags {
  return useSyncExternalStore(
    subscribe,
    () => cache.get(key(roundId, leg)) ?? EMPTY,
    () => EMPTY,
  );
}

// Sparar taggar och text för en start. Kräver att loppets taggar är lästa, så
// att en befintlig RACE-kommentar återanvänds (en per start).
export function saveRaceTag(ctx: TagCtx, start: StartDto, next: { tags: string[]; text: string }) {
  const k = key(ctx.roundId, ctx.race.leg);
  const cur = cache.get(k) ?? EMPTY;
  const clientId = cur.byStart[start.id]?.clientId ?? newClientId();
  cache.set(k, { ...cur, byStart: { ...cur.byStart, [start.id]: { clientId, ...next } } });
  emit();
  // Inga taggar och ingen text: ta bort kommentaren (en PUT tar fram den igen).
  if (!next.tags.length && !next.text) {
    addToOutbox({ method: "DELETE", url: `/api/comments/${clientId}`, meta: { kind: "comment-delete", horseId: start.horse.id, horseName: start.horse.name, clientId } });
    return;
  }
  const body: CommentBody = { horseId: start.horse.id, startId: start.id, roundId: ctx.roundId, kind: "RACE", tags: next.tags, text: next.text };
  addToOutbox({
    method: "PUT",
    url: `/api/comments/${clientId}`,
    body,
    meta: { kind: "comment", horseId: start.horse.id, horseName: start.horse.name, clientId, round: { id: ctx.roundId, date: ctx.roundDate, trackName: ctx.trackName, gameType: ctx.gameType }, leg: ctx.race.leg },
  });
}

export function openTagging(raceId: string, startId: string | null = null) {
  open = { raceId, startId };
  emit();
}
export function selectTagStart(startId: string) {
  if (open) open = { ...open, startId };
  emit();
}
export function closeTagging() {
  open = null;
  emit();
}
export function useTaggingOpen() {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => null,
  );
}
