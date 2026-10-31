// Taggningen i Live (E8, docs/specs/e8-live.md 12): snabbvalen per häst för ett
// lopp som har startat, även långt i efterhand. Taggarna är en kommentar av
// typen RACE per start (GET /api/rounds/[id]/races/[leg]/tags). Ändringar läggs
// i lagret synkront och skickas via utkorgen (PUT /api/comments/[clientId]), så
// att ett klick aldrig väntar på nätet.
//
// Komponenter skickar aldrig in en färdig lista: toggleRaceTag och setRaceText
// läser hästens aktuella värde ur lagret i samma stund, så att två klick innan
// React hunnit rita inte kan tappa en tagg.

import { useSyncExternalStore } from "react";
import { apiGet } from "@/components/api";
import { addToOutbox, getOutboxSnapshot, onOutboxRejected } from "@/components/outbox/outbox-client";
import type { OutboxItem } from "@/lib/outbox";
import { toggleTag } from "@/lib/quick-tags";
import { mergeRaceTags, newClientId, type RaceTag, type RaceTagMap } from "@/lib/race-tags";
import { metaOf, type CommentBody } from "@/lib/round-overlay";
import type { CommentDto, RaceDto, StartDto } from "@/lib/types";

export type { RaceTag };
export type RaceTags = { byStart: RaceTagMap; loading: boolean; error: string | null; loaded: boolean };
export type TagCtx = { roundId: string; roundDate: string; trackName: string; gameType: string; race: RaceDto };
export type TagState = { tags: string[]; text: string };
// Senaste ändringen (12.5): djup 1, i vilket lopp och på vilken häst den än var.
export type LastTagChange = { ctx: TagCtx; start: StartDto; before: TagState; what: string; removed: boolean; at: number };

const cache = new Map<string, RaceTags>();
const listeners = new Set<() => void>();
const EMPTY: RaceTags = { byStart: {}, loading: false, error: null, loaded: false };
const key = (roundId: string, leg: number) => `${roundId}:${leg}`;
// Hästar som ändrats medan ett svar var på väg, och lopp som ska läsas om när svaret har kommit.
const touched = new Map<string, Set<string>>();
const reloadAfter = new Set<string>();
let version = 0;
let last: LastTagChange | null = null;
let undoneAt = 0;

function emit() {
  version++;
  listeners.forEach((fn) => fn());
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function legOfItem(item: OutboxItem): { roundId: string; leg: number } | null {
  const m = metaOf(item);
  if (m?.kind === "comment" && m.round && m.leg !== null) return { roundId: m.round.id, leg: m.leg };
  if (m?.kind === "comment-delete") {
    for (const [k, v] of cache) {
      if (!Object.values(v.byStart).some((t) => t.clientId === m.clientId)) continue;
      const i = k.lastIndexOf(":");
      return { roundId: k.slice(0, i), leg: Number(k.slice(i + 1)) };
    }
  }
  return null;
}

// force: servern vinner för hästar utan post i kön, kön vinner för övriga (12.4).
// Knapparna ligger kvar aktiva under en omläsning, och ett fel rör inte det som är läst.
export function loadRaceTags(roundId: string, leg: number, force = false) {
  const k = key(roundId, leg);
  const cur = cache.get(k) ?? EMPTY;
  if (cur.loading) {
    if (force) reloadAfter.add(k);
    return;
  }
  if (cur.loaded && !force) return;
  cache.set(k, { ...cur, loading: true, error: null });
  touched.set(k, new Set());
  emit();
  const scope = { roundId, leg };
  apiGet<{ comments: CommentDto[] }>(`/api/rounds/${roundId}/races/${leg}/tags`)
    .then(({ comments }) => {
      const now = cache.get(k) ?? EMPTY;
      const byStart = mergeRaceTags(comments, getOutboxSnapshot().queue, now.byStart, touched.get(k) ?? new Set(), scope);
      cache.set(k, { byStart, loading: false, error: null, loaded: true });
    })
    .catch((e: unknown) => {
      cache.set(k, { ...(cache.get(k) ?? EMPTY), loading: false, error: e instanceof Error ? e.message : "Kunde inte hämta taggarna." });
    })
    .finally(() => {
      emit();
      if (reloadAfter.delete(k)) loadRaceTags(roundId, leg, true);
    });
}

export const getRaceTags = (roundId: string, leg: number): RaceTags => cache.get(key(roundId, leg)) ?? EMPTY;

export function useRaceTags(roundId: string, leg: number): RaceTags {
  return useSyncExternalStore(
    subscribe,
    () => cache.get(key(roundId, leg)) ?? EMPTY,
    () => EMPTY,
  );
}

// Räknas upp vid varje ändring: för vyer som läser flera lopp med getRaceTags.
export function useTagVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
}

export function useLastTagChange(): { last: LastTagChange | null; undoneAt: number } {
  useTagVersion();
  return { last, undoneAt };
}

const sameTags = (a: string[], b: string[]) => a.length === b.length && a.every((t, i) => t === b[i]);

// Skriver hästens läge i lagret och lägger en post i utkorgen. Kräver att loppets
// taggar är lästa, så att en befintlig RACE-kommentar återanvänds (en per start).
function saveRaceTag(ctx: TagCtx, start: StartDto, next: TagState, what?: string) {
  const k = key(ctx.roundId, ctx.race.leg);
  const cur = cache.get(k) ?? EMPTY;
  const clientId = cur.byStart[start.id]?.clientId ?? newClientId();
  cache.set(k, { ...cur, byStart: { ...cur.byStart, [start.id]: { clientId, ...next } } });
  touched.get(k)?.add(start.id);
  // Inga taggar och ingen text: ta bort kommentaren (en PUT tar fram den igen).
  if (!next.tags.length && !next.text) {
    addToOutbox({ method: "DELETE", url: `/api/comments/${clientId}`, meta: { kind: "comment-delete", horseId: start.horse.id, horseName: start.horse.name, clientId, roundId: ctx.roundId, what } });
  } else {
    const body: CommentBody = { horseId: start.horse.id, startId: start.id, roundId: ctx.roundId, kind: "RACE", tags: next.tags, text: next.text };
    addToOutbox({
      method: "PUT",
      url: `/api/comments/${clientId}`,
      body,
      meta: { kind: "comment", horseId: start.horse.id, horseName: start.horse.name, clientId, round: { id: ctx.roundId, date: ctx.roundDate, trackName: ctx.trackName, gameType: ctx.gameType }, leg: ctx.race.leg, what },
    });
  }
  emit();
}

const readState = (ctx: TagCtx, startId: string): { loaded: boolean; state: TagState } => {
  const cur = cache.get(key(ctx.roundId, ctx.race.leg)) ?? EMPTY;
  const mine = cur.byStart[startId];
  return { loaded: cur.loaded, state: { tags: mine?.tags ?? [], text: mine?.text ?? "" } };
};

// Växlar en tagg utifrån hästens aktuella värde. Returnerar läget före, för
// Ångra, eller null om loppets taggar inte är lästa (inget händer då).
export function toggleRaceTag(ctx: TagCtx, start: StartDto, tag: string): TagState | null {
  const { loaded, state } = readState(ctx, start.id);
  if (!loaded) return null;
  const tags = toggleTag(state.tags, tag);
  last = { ctx, start, before: state, what: tag, removed: !tags.includes(tag), at: Date.now() };
  undoneAt = 0;
  saveRaceTag(ctx, start, { tags, text: state.text }, tag);
  return state;
}

// Sparar fritexten med hästens aktuella taggar. Inget händer om texten är oförändrad.
export function setRaceText(ctx: TagCtx, start: StartDto, text: string): TagState | null {
  const { loaded, state } = readState(ctx, start.id);
  if (!loaded || state.text === text) return null;
  last = { ctx, start, before: state, what: "Fritext", removed: !text, at: Date.now() };
  undoneAt = 0;
  saveRaceTag(ctx, start, { tags: state.tags, text }, "Fritext");
  return state;
}

// Ångra senaste ändringen, i vilket lopp och på vilken häst den än var.
export function undoRaceTag(): boolean {
  if (!last) return false;
  const { ctx, start, before, what } = last;
  last = null;
  undoneAt = Date.now();
  const { state } = readState(ctx, start.id);
  if (state.text !== before.text || !sameTags(state.tags, before.tags)) saveRaceTag(ctx, start, before, what);
  else emit();
  return true;
}

export function clearLastTagChange() {
  if (!last && !undoneAt) return;
  last = null;
  undoneAt = 0;
  emit();
}

// Servern avvisade en tagg (t.ex. 422 från det unika indexet): visa serverns läge.
onOutboxRejected((item) => {
  const where = legOfItem(item);
  if (where) loadRaceTags(where.roundId, where.leg, true);
});

// Bara för testerna: tomt lager mellan fallen.
export function resetTagStore() {
  cache.clear();
  touched.clear();
  reloadAfter.clear();
  last = null;
  undoneAt = 0;
}
