// Utkorgen i webbläsaren (specen 9.3). En enda OutboxRunner per sidladdning,
// skapad första gången den behövs. Den skickas om vid `online`,
// `visibilitychange` (när sidan syns) och av runnerns egen timer.
//
// Bekräftade svar skrivs in i cacherna här (även när vyn inte visas).
// Toaster visas av OutboxProvider via setOutboxNotifier().

import { patchHorseComments, patchRound } from "@/components/round/roundStore";
import { OutboxRunner, conflictMessage, type OutboxItem, type OutboxMethod, type OutboxStatus } from "@/lib/outbox";
import { applyCommentDone, applyDone, metaOf, retryText, type ItemMeta } from "@/lib/round-overlay";

export type OutboxSnapshot = { queue: OutboxItem[]; status: OutboxStatus };

export type OutboxNotifier = {
  conflict: (text: string) => void;
  rejected: (text: string) => void;
  auth: () => void;
  retry: (text: string) => void;
};

let runner: OutboxRunner | null = null;
let snapshot: OutboxSnapshot = { queue: [], status: { kind: "saved", count: 0, text: "Sparat" } };
const listeners = new Set<() => void>();
let notifier: OutboxNotifier | null = null;
const retried = new Set<string>();

export function setOutboxNotifier(n: OutboxNotifier | null) {
  notifier = n;
}

function onChange(status: OutboxStatus, queue: OutboxItem[]) {
  snapshot = { queue, status };
  // Första misslyckade försöket för en post: säg till en gång.
  for (const item of queue) {
    if (item.tries > 0 && !retried.has(item.id)) {
      retried.add(item.id);
      if (typeof navigator === "undefined" || navigator.onLine) notifier?.retry(retryText(item));
    }
  }
  listeners.forEach((fn) => fn());
}

function onDone(item: OutboxItem, response: unknown) {
  const m = metaOf(item);
  if (!m) return;
  if (m.kind === "mark" || m.kind === "review") patchRound(m.roundId, (data) => applyDone(data, item, response));
  if (m.kind === "comment" || m.kind === "comment-delete") patchHorseComments(m.horseId, (comments) => applyCommentDone(comments, item, response));
}

function getRunner(): OutboxRunner | null {
  if (typeof window === "undefined") return null;
  if (runner) return runner;
  runner = new OutboxRunner(
    {
      storage: (() => {
        try {
          return window.localStorage;
        } catch {
          return null;
        }
      })(),
      fetch: (url, init) => window.fetch(url, { ...init, cache: "no-store" }),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (h) => window.clearTimeout(h as number),
    },
    {
      onChange,
      onDone,
      onConflict: (item) => notifier?.conflict(conflictMessage(item)),
      onRejected: (item, error) => {
        const m = metaOf(item);
        notifier?.rejected(m?.kind === "mark" ? `Kunde inte spara Intressant för ${m.horseName}: ${error}` : error);
      },
      onAuthRequired: () => notifier?.auth(),
    },
  );
  snapshot = { queue: runner.items, status: runner.status };
  const kick = () => void runner?.flush();
  const retry = () => runner?.retryNow();
  window.addEventListener("online", retry);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") retry();
  });
  // Inte direkt: getRunner() kan anropas under en ritning (getSnapshot).
  window.setTimeout(kick, 0);
  return runner;
}

export function subscribeOutbox(fn: () => void): () => void {
  getRunner();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getOutboxSnapshot(): OutboxSnapshot {
  getRunner();
  return snapshot;
}

const SERVER_SNAPSHOT: OutboxSnapshot = { queue: [], status: { kind: "saved", count: 0, text: "Sparat" } };
export const getOutboxServerSnapshot = () => SERVER_SNAPSHOT;

export function addToOutbox(input: { method: OutboxMethod; url: string; body?: unknown; meta: ItemMeta }): void {
  getRunner()?.add({ ...input, meta: input.meta as unknown as Record<string, unknown> });
}

export function resumeOutbox() {
  getRunner()?.resume();
}
