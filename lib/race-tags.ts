// Taggningen i Live (E8, docs/specs/e8-live.md 12): rena funktioner för lagret i
// components/round/tagStore.ts. Testade i lib/race-tags.test.ts.
//
// Taggarna är en kommentar av typen RACE per start. Utkorgen är sanningen för
// det som inte är skickat, så att en omladdning aldrig tappar köade ändringar
// och nästa klick återanvänder samma clientId.

import type { OutboxItem } from "@/lib/outbox";
import { metaOf, type CommentBody } from "@/lib/round-overlay";
import type { CommentDto } from "@/lib/types";

export type RaceTag = { clientId: string; tags: string[]; text: string };
export type RaceTagMap = Record<string, RaceTag>;

export function newClientId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function raceTagsOf(comments: readonly CommentDto[]): RaceTagMap {
  const out: RaceTagMap = {};
  for (const c of comments) if (c.startId) out[c.startId] = { clientId: c.clientId, tags: c.tags, text: c.text };
  return out;
}

// Vilka poster som hör till loppet. Utan avgränsning gäller alla RACE-poster.
export type RaceTagScope = { roundId: string; leg: number };

// Serverns kommentarer med köns poster ovanpå (12.3). PUT med body.kind "RACE"
// ger hästens läge med postens clientId. DELETE matchas på clientId och ger
// tomma taggar med samma clientId, så att nästa klick blir PUT på samma adress.
export function applyPendingRaceTags(comments: readonly CommentDto[], queue: readonly OutboxItem[], scope?: RaceTagScope): RaceTagMap {
  const byStart = raceTagsOf(comments);
  for (const item of queue) {
    const m = metaOf(item);
    if (m?.kind === "comment" && item.method === "PUT") {
      const body = item.body as Partial<CommentBody> | undefined;
      if (body?.kind !== "RACE" || !body.startId) continue;
      if (scope && (m.round?.id !== scope.roundId || m.leg !== scope.leg)) continue;
      byStart[body.startId] = { clientId: m.clientId, tags: body.tags ?? [], text: body.text ?? "" };
    } else if (m?.kind === "comment-delete") {
      const hit = Object.entries(byStart).find(([, t]) => t.clientId === m.clientId);
      if (hit) byStart[hit[0]] = { clientId: m.clientId, tags: [], text: "" };
    }
  }
  return byStart;
}

// Hästar med en post i kön för loppet (12.4).
export function pendingStartIds(queue: readonly OutboxItem[], known: RaceTagMap, scope?: RaceTagScope): Set<string> {
  const pending = applyPendingRaceTags([], queue, scope);
  const out = new Set(Object.keys(pending));
  for (const item of queue) {
    const m = metaOf(item);
    if (m?.kind !== "comment-delete") continue;
    const hit = Object.entries(known).find(([, t]) => t.clientId === m.clientId);
    if (hit) out.add(hit[0]);
  }
  return out;
}

const sameTag = (a: RaceTag | undefined, b: RaceTag | undefined) =>
  !!a && !!b && a.clientId === b.clientId && a.text === b.text && a.tags.length === b.tags.length && a.tags.every((t, i) => t === b.tags[i]);

// Läsning med force (12.4): servern vinner för hästar utan post i kön, kön vinner
// för övriga. `touched` = hästar som ändrats medan svaret var på väg. Deras post
// kan redan vara bekräftad och borta ur kön, och svaret kan vara äldre än posten,
// så de behåller sitt lokala läge. En oförändrad häst behåller samma objekt, så
// att bara den ändrade kolumnen ritas om.
export function mergeRaceTags(comments: readonly CommentDto[], queue: readonly OutboxItem[], local: RaceTagMap, touched: ReadonlySet<string>, scope?: RaceTagScope): RaceTagMap {
  const merged = applyPendingRaceTags(comments, queue, scope);
  for (const id of touched) {
    if (local[id] && !pendingStartIds(queue, local, scope).has(id)) merged[id] = local[id];
  }
  for (const [id, tag] of Object.entries(merged)) if (sameTag(tag, local[id])) merged[id] = local[id];
  return merged;
}

// Utkorgens poster för taggar och kommentarer i omgången (6.3).
export function roundCommentPosts(queue: readonly OutboxItem[], roundId: string): OutboxItem[] {
  return queue.filter((item) => {
    const m = metaOf(item);
    return (m?.kind === "comment" && m.round?.id === roundId) || (m?.kind === "comment-delete" && m.roundId === roundId);
  });
}
