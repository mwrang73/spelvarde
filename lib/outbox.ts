// Utkorgen (specen 9.3): optimistisk sparning med kö i localStorage.
//
// Den här filen har ingen React och ingen DOM. Den består av
//   1. rena funktioner för kön (lägg till, välj nästa, tolka svar, väntetid,
//      status och läsning/skrivning av det sparade), och
//   2. OutboxRunner, en liten drivare där lagring, fetch, klocka och timer
//      skickas in. Klienten (frontend) skapar en runner och kopplar
//      `online`, `visibilitychange` och sina toaster till den.
//
// Regler:
// - Posterna skickas i ordning, en i taget. Är första posten inte redo
//   (väntetid efter fel) väntar hela kön.
// - Idempotens: allt som läggs i kön är PUT/DELETE mot rutter som tål att
//   få samma anrop flera gånger (PUT /api/marks/[startId],
//   PUT/DELETE /api/comments/[clientId], PUT /api/races/[id]/review,
//   PUT …/coupon). Två PUT mot samma adress slås ihop till en (den senare
//   kroppen läggs över den tidigare), så länge den tidigare inte skickas just
//   nu och ingen annan metod mot samma adress ligger emellan.
// - Svar: 2xx tar bort posten. 409 tar bort, rullar tillbaka och visar
//   "<häst>: loppet hade redan startat, ändringen sparades inte." 401 pausar
//   kön ("Logga in igen"). Övriga 4xx tar bort och visar felet. 5xx och
//   nätverksfel försöker igen efter 2, 5, 10 och sedan 30 s.

export const OUTBOX_STORAGE_KEY = "sv-outbox";
export const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000];
export const POLL_INTERVAL_MS = 10_000;
// Den globala pricken på Omgång-fliken visas när kön inte har tömts på så här länge.
export const STALE_AFTER_MS = 30_000;

export type OutboxMethod = "PUT" | "POST" | "PATCH" | "DELETE";

export type OutboxItem = {
  id: string;
  method: OutboxMethod;
  url: string;
  body?: unknown;
  createdAt: number;
  tries: number;
  // Tidigast när posten får skickas igen (ms sedan epok). 0 = direkt.
  notBefore?: number;
  // Fritt för klienten: t.ex. { horseName, rollback } för toasten och återställningen.
  meta?: Record<string, unknown>;
};

export type ResponseOutcome = "done" | "conflict" | "auth" | "rejected" | "retry";

export function classifyStatus(status: number | null): ResponseOutcome {
  if (status === null) return "retry"; // nätverksfel
  if (status >= 200 && status < 300) return "done";
  if (status === 409) return "conflict";
  if (status === 401) return "auth";
  if (status >= 400 && status < 500) return "rejected";
  return "retry";
}

// Väntetid efter `tries` misslyckade försök (1 → 2 s, 2 → 5 s, 3 → 10 s, därefter 30 s).
export function retryDelayMs(tries: number): number {
  if (tries <= 0) return 0;
  return RETRY_DELAYS_MS[Math.min(tries, RETRY_DELAYS_MS.length) - 1];
}

const isPlainObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

// Lägger till en post. `inFlightId` är posten som skickas just nu (den får
// inte ändras). Returnerar en ny kö.
export function enqueue(queue: OutboxItem[], item: OutboxItem, inFlightId: string | null = null): OutboxItem[] {
  if (item.method === "PUT") {
    for (let i = queue.length - 1; i >= 0; i--) {
      const q = queue[i];
      if (q.url !== item.url) continue;
      if (q.method !== "PUT" || q.id === inFlightId) break;
      const body = isPlainObject(q.body) && isPlainObject(item.body) ? { ...q.body, ...item.body } : item.body;
      const merged: OutboxItem = { ...q, body, meta: { ...(q.meta ?? {}), ...(item.meta ?? {}) } };
      return queue.map((x, j) => (j === i ? merged : x));
    }
  }
  return [...queue, item];
}

// Första posten om den är redo att skickas, annars null.
export function nextReady(queue: OutboxItem[], now: number): OutboxItem | null {
  const head = queue[0];
  if (!head) return null;
  return (head.notBefore ?? 0) <= now ? head : null;
}

// Hur länge till första posten är redo (0 = nu, null = tom kö).
export function msUntilReady(queue: OutboxItem[], now: number): number | null {
  const head = queue[0];
  if (!head) return null;
  return Math.max(0, (head.notBefore ?? 0) - now);
}

export function applyOutcome(queue: OutboxItem[], id: string, outcome: ResponseOutcome, now: number): OutboxItem[] {
  if (outcome === "auth") return queue; // posten ligger kvar, kön pausas
  if (outcome === "retry") {
    return queue.map((q) => (q.id === id ? { ...q, tries: q.tries + 1, notBefore: now + retryDelayMs(q.tries + 1) } : q));
  }
  return queue.filter((q) => q.id !== id);
}

export type OutboxStatus = { kind: "saved" | "saving" | "queued" | "paused"; count: number; text: string };

export function outboxStatus(queue: OutboxItem[], sending: boolean, paused = false): OutboxStatus {
  const count = queue.length;
  if (paused && count) return { kind: "paused", count, text: "Logga in igen" };
  if (!count) return { kind: "saved", count, text: "Sparat" };
  if (sending && count === 1) return { kind: "saving", count, text: "Sparas …" };
  return { kind: "queued", count, text: `I kö (${count})` };
}

// Ska den globala pricken visas? Sant när den äldsta posten är äldre än 30 s.
export function isStale(queue: OutboxItem[], now: number): boolean {
  return queue.length > 0 && now - Math.min(...queue.map((q) => q.createdAt)) > STALE_AFTER_MS;
}

const METHODS: OutboxMethod[] = ["PUT", "POST", "PATCH", "DELETE"];

// Läser kön ur lagringen. Allt som inte ser ut som en post kastas, så att en
// skadad lagring aldrig stoppar appen.
export function parseStored(raw: string | null): OutboxItem[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (x): x is OutboxItem =>
        isPlainObject(x) &&
        typeof x.id === "string" &&
        typeof x.url === "string" &&
        x.url.startsWith("/api/") &&
        METHODS.includes(x.method as OutboxMethod) &&
        typeof x.createdAt === "number" &&
        typeof x.tries === "number",
    );
  } catch {
    return [];
  }
}

export const serializeQueue = (queue: OutboxItem[]) => JSON.stringify(queue);

export function conflictMessage(item: OutboxItem): string {
  const horse = typeof item.meta?.horseName === "string" ? item.meta.horseName : "Hästen";
  return `${horse}: loppet hade redan startat, ändringen sparades inte.`;
}

// ---- Drivaren ----------------------------------------------------------------------

export type OutboxStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export type OutboxEvents = {
  // Kön eller statusen har ändrats (rita om statusraden).
  onChange?: (status: OutboxStatus, queue: OutboxItem[]) => void;
  // 409: rulla tillbaka i cachen och visa conflictMessage(item).
  onConflict?: (item: OutboxItem) => void;
  // 401: kön är pausad tills resume() anropas efter ny inloggning.
  onAuthRequired?: () => void;
  // Övriga 4xx: posten är borttagen. `error` är serverns svenska mening.
  onRejected?: (item: OutboxItem, error: string) => void;
  // 2xx: serverns svar, för att uppdatera cachen med det bekräftade läget.
  onDone?: (item: OutboxItem, response: unknown) => void;
};

export type OutboxDeps = {
  storage: OutboxStorage | null;
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json(): Promise<unknown> }>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  uuid?: () => string;
};

export class OutboxRunner {
  private queue: OutboxItem[];
  private sending: OutboxItem | null = null;
  private paused = false;
  private timer: unknown = null;
  private readonly now: () => number;

  constructor(private readonly deps: OutboxDeps, private readonly events: OutboxEvents = {}) {
    this.now = deps.now ?? Date.now;
    let raw: string | null = null;
    try {
      raw = deps.storage?.getItem(OUTBOX_STORAGE_KEY) ?? null;
    } catch {
      raw = null;
    }
    this.queue = parseStored(raw);
  }

  get items(): OutboxItem[] {
    return this.queue;
  }

  get status(): OutboxStatus {
    return outboxStatus(this.queue, this.sending !== null, this.paused);
  }

  // Lägger en ändring i kön och försöker skicka direkt.
  add(input: { method: OutboxMethod; url: string; body?: unknown; meta?: Record<string, unknown> }): OutboxItem {
    const item: OutboxItem = {
      id: this.deps.uuid?.() ?? (globalThis.crypto?.randomUUID?.() ?? `${this.now()}-${Math.random().toString(36).slice(2)}`),
      method: input.method,
      url: input.url,
      body: input.body,
      meta: input.meta,
      createdAt: this.now(),
      tries: 0,
    };
    this.queue = enqueue(this.queue, item, this.sending?.id ?? null);
    this.persist();
    void this.flush();
    return item;
  }

  // Efter ny inloggning.
  resume() {
    this.paused = false;
    this.persist();
    void this.flush();
  }

  // Nätet är tillbaka eller sidan syns igen: skicka direkt utan att vänta
  // ut väntetiden efter tidigare fel (tries räknas inte om).
  retryNow() {
    if (this.queue.some((q) => q.notBefore)) {
      this.queue = this.queue.map((q) => (q.id === this.sending?.id ? q : { ...q, notBefore: 0 }));
      this.persist();
    }
    void this.flush();
  }

  // Anropas vid start, `online`, `visibilitychange` och av timern.
  async flush(): Promise<void> {
    if (this.sending || this.paused) return;
    const item = nextReady(this.queue, this.now());
    if (!item) return this.schedule();
    this.sending = item;
    this.emit();
    let status: number | null = null;
    let data: unknown = null;
    try {
      const res = await this.deps.fetch(item.url, {
        method: item.method,
        headers: { "Content-Type": "application/json" },
        body: item.body === undefined ? undefined : JSON.stringify(item.body),
      });
      status = res.status;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
    } catch {
      status = null;
    }
    const outcome = classifyStatus(status);
    // Posten kan ha slagits ihop med en senare ändring medan den skickades –
    // det sker inte (inFlightId skyddar), så den skickade posten är den som gäller.
    this.queue = applyOutcome(this.queue, item.id, outcome, this.now());
    this.sending = null;
    if (outcome === "done") this.events.onDone?.(item, data);
    if (outcome === "conflict") this.events.onConflict?.(item);
    if (outcome === "rejected") {
      const err = data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : "Ändringen kunde inte sparas.";
      this.events.onRejected?.(item, err);
    }
    if (outcome === "auth") {
      this.paused = true;
      this.events.onAuthRequired?.();
    }
    this.persist();
    if (outcome === "done" || outcome === "conflict" || outcome === "rejected") return this.flush();
    this.schedule();
  }

  private schedule() {
    if (this.timer !== null) {
      this.deps.clearTimer?.(this.timer);
      this.timer = null;
    }
    if (this.paused || !this.queue.length || !this.deps.setTimer) return;
    const wait = Math.min(msUntilReady(this.queue, this.now()) ?? POLL_INTERVAL_MS, POLL_INTERVAL_MS);
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, Math.max(wait, 50));
  }

  private persist() {
    try {
      this.deps.storage?.setItem(OUTBOX_STORAGE_KEY, serializeQueue(this.queue));
    } catch {
      // Lagringen är full eller blockerad: kön finns kvar i minnet.
    }
    this.emit();
  }

  private emit() {
    this.events.onChange?.(this.status, this.queue);
  }
}
