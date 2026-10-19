import { describe, expect, it } from "vitest";
import {
  OUTBOX_STORAGE_KEY,
  OutboxRunner,
  applyOutcome,
  classifyStatus,
  conflictMessage,
  enqueue,
  isStale,
  nextReady,
  outboxStatus,
  parseStored,
  retryDelayMs,
  type OutboxItem,
} from "@/lib/outbox";

const item = (id: string, url: string, body: unknown = {}, method: OutboxItem["method"] = "PUT"): OutboxItem => ({ id, method, url, body, createdAt: 0, tries: 0 });

describe("utkorgens rena logik (9.3)", () => {
  it("klassar svar", () => {
    expect([200, 204, 409, 401, 400, 404, 422, 500, 503, null].map(classifyStatus)).toEqual(["done", "done", "conflict", "auth", "rejected", "rejected", "rejected", "retry", "retry", "retry"]);
  });
  it("väntetid 2, 5, 10 och sedan 30 s", () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([2000, 5000, 10000, 30000, 30000, 30000]);
  });
  it("slår ihop PUT mot samma adress (idempotent), men inte den som skickas", () => {
    let q = enqueue([], item("a", "/api/marks/s1", { interesting: true }));
    q = enqueue(q, item("b", "/api/comments/c1", { text: "x" }));
    q = enqueue(q, item("c", "/api/marks/s1", { interesting: false }));
    expect(q.map((x) => x.id)).toEqual(["a", "b"]);
    expect(q[0].body).toEqual({ interesting: false });
    const inFlight = enqueue(q, item("d", "/api/marks/s1", { interesting: true }), "a");
    expect(inFlight.map((x) => x.id)).toEqual(["a", "b", "d"]);
  });
  it("slår inte ihop förbi en DELETE mot samma adress", () => {
    let q = enqueue([], item("a", "/api/comments/c1", { text: "x" }));
    q = enqueue(q, item("b", "/api/comments/c1", undefined, "DELETE"));
    q = enqueue(q, item("c", "/api/comments/c1", { text: "y" }));
    expect(q.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("skickar i ordning: väntar på första posten", () => {
    const q = [{ ...item("a", "/api/x"), notBefore: 5000 }, item("b", "/api/y")];
    expect(nextReady(q, 1000)).toBeNull();
    expect(nextReady(q, 5000)?.id).toBe("a");
  });
  it("tillämpar utfall", () => {
    const q = [item("a", "/api/x"), item("b", "/api/y")];
    expect(applyOutcome(q, "a", "done", 0).map((x) => x.id)).toEqual(["b"]);
    expect(applyOutcome(q, "a", "conflict", 0).map((x) => x.id)).toEqual(["b"]);
    expect(applyOutcome(q, "a", "rejected", 0).map((x) => x.id)).toEqual(["b"]);
    expect(applyOutcome(q, "a", "auth", 0)).toEqual(q);
    const r = applyOutcome(q, "a", "retry", 1000);
    expect(r[0]).toMatchObject({ tries: 1, notBefore: 3000 });
  });
  it("status och global prick", () => {
    expect(outboxStatus([], false).text).toBe("Sparat");
    expect(outboxStatus([item("a", "/api/x")], true).text).toBe("Sparas …");
    expect(outboxStatus([item("a", "/api/x"), item("b", "/api/y")], true).text).toBe("I kö (2)");
    expect(outboxStatus([item("a", "/api/x")], false, true).text).toBe("Logga in igen");
    expect(isStale([{ ...item("a", "/api/x"), createdAt: 0 }], 30_001)).toBe(true);
    expect(isStale([{ ...item("a", "/api/x"), createdAt: 0 }], 29_000)).toBe(false);
  });
  it("läser lagringen försiktigt", () => {
    expect(parseStored(null)).toEqual([]);
    expect(parseStored("{trasig")).toEqual([]);
    expect(parseStored(JSON.stringify([item("a", "/api/x"), { id: 1 }, item("b", "https://evil.example/api")]))).toHaveLength(1);
  });
  it("toasttext vid 409", () => {
    expect(conflictMessage({ ...item("a", "/api/x"), meta: { horseName: "Diva Ek" } })).toBe("Diva Ek: loppet hade redan startat, ändringen sparades inte.");
  });
});

describe("OutboxRunner", () => {
  function setup(responses: (number | null)[]) {
    const store = new Map<string, string>();
    const calls: { url: string; method: string; body?: string }[] = [];
    let t = 0;
    const timers: { fn: () => void; at: number }[] = [];
    const events = { conflicts: 0, auth: 0, rejected: [] as string[], done: 0 };
    const runner = new OutboxRunner(
      {
        storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
        fetch: async (url, init) => {
          calls.push({ url, method: init.method, body: init.body });
          const status = responses.shift();
          if (status === null || status === undefined) throw new Error("offline");
          return { status, json: async () => (status >= 400 ? { error: "Fel från servern." } : { ok: true }) };
        },
        now: () => t,
        setTimer: (fn, ms) => {
          timers.push({ fn, at: t + ms });
          return timers.length;
        },
        clearTimer: () => {},
        uuid: (() => {
          let n = 0;
          return () => `id-${++n}`;
        })(),
      },
      {
        onConflict: () => events.conflicts++,
        onAuthRequired: () => events.auth++,
        onRejected: (_i, e) => events.rejected.push(e),
        onDone: () => events.done++,
      },
    );
    const advance = async (ms: number) => {
      t += ms;
      const due = timers.splice(0).filter((x) => x.at <= t);
      for (const x of due) x.fn();
      await new Promise((r) => setTimeout(r, 0));
    };
    return { runner, store, calls, events, advance, flushMicro: () => new Promise((r) => setTimeout(r, 0)) };
  }

  it("skickar direkt och tömmer kön vid 2xx, och sparar i sv-outbox", async () => {
    const s = setup([200]);
    s.runner.add({ method: "PUT", url: "/api/marks/s1", body: { interesting: true } });
    await s.flushMicro();
    expect(s.calls).toEqual([{ url: "/api/marks/s1", method: "PUT", body: '{"interesting":true}' }]);
    expect(s.runner.items).toEqual([]);
    expect(s.store.get(OUTBOX_STORAGE_KEY)).toBe("[]");
    expect(s.runner.status.text).toBe("Sparat");
  });
  it("retryNow (online, sidan syns): skickar direkt utan att vänta ut väntetiden", async () => {
    const s = setup([null, 200]);
    s.runner.add({ method: "PUT", url: "/api/marks/s1", body: { interesting: true } });
    await s.flushMicro();
    expect(s.runner.items[0].notBefore).toBeGreaterThan(0);
    s.runner.retryNow();
    await s.flushMicro();
    expect(s.calls).toHaveLength(2);
    expect(s.runner.items).toEqual([]);
  });
  it("nätverksfel: ligger kvar och skickas igen efter väntetiden, utan dubbletter", async () => {
    const s = setup([null, 200]);
    s.runner.add({ method: "PUT", url: "/api/comments/c1", body: { text: "a" } });
    await s.flushMicro();
    expect(s.runner.items).toHaveLength(1);
    expect(s.runner.status.text).toBe("I kö (1)");
    await s.advance(2000);
    expect(s.calls).toHaveLength(2);
    expect(s.runner.items).toEqual([]);
  });
  it("409 rullar tillbaka, 401 pausar, 4xx visar felet", async () => {
    const s = setup([409, 401, 200, 422]);
    s.runner.add({ method: "PUT", url: "/api/marks/s1", body: { interesting: true } });
    await s.flushMicro();
    expect(s.events.conflicts).toBe(1);
    s.runner.add({ method: "PUT", url: "/api/marks/s2", body: { interesting: true } });
    await s.flushMicro();
    expect(s.events.auth).toBe(1);
    expect(s.runner.status.text).toBe("Logga in igen");
    s.runner.resume();
    await s.flushMicro();
    expect(s.runner.items).toEqual([]);
    s.runner.add({ method: "PUT", url: "/api/marks/s3", body: { interesting: true } });
    await s.flushMicro();
    expect(s.events.rejected).toEqual(["Fel från servern."]);
  });
  it("läser in en kö från förra sessionen", async () => {
    const store = new Map([[OUTBOX_STORAGE_KEY, JSON.stringify([item("old", "/api/marks/s9", { interesting: true })])]]);
    const calls: string[] = [];
    const r = new OutboxRunner({ storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) }, fetch: async (u) => (calls.push(u), { status: 200, json: async () => ({}) }) });
    expect(r.items).toHaveLength(1);
    await r.flush();
    expect(calls).toEqual(["/api/marks/s9"]);
  });
});
