import { describe, expect, it } from "vitest";
import {
  agoText,
  bannerFor,
  boardTime,
  boardView,
  countdownClock,
  countdownShort,
  countdownSpoken,
  idleOdds,
  idleStreck,
  legsText,
  lockLeftSec,
  needsOddsFetch,
  runOdds,
  runStreck,
  summarize,
  type BoardInput,
  type OddsPart,
  type Post,
  type RunState,
} from "@/lib/streck-odds";
import { mkMark, mkRace, mkRound, mkStart } from "@/lib/test-round";
import type { UnibetLegResponse } from "@/lib/types";

const NOW = new Date("2026-10-22T19:05:00.000Z"); // tors 21:05 i Stockholm

const leg = (n: number, p: Partial<UnibetLegResponse> = {}): UnibetLegResponse => ({ leg: n, ok: true, noPrices: false, withOdds: 10, missing: [], scratchedAtUnibet: [], replaced: [], ...p });

// Falsk server: svaren per adress, och högsta antal anrop samtidigt.
function fakeServer(routes: (url: string) => { status: number; data: unknown } | "throw") {
  const calls: string[] = [];
  let active = 0;
  let maxActive = 0;
  const post: Post = async (url) => {
    calls.push(url);
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 2));
    active--;
    const r = routes(url);
    if (r === "throw") throw new Error("nät");
    return r;
  };
  return { post, calls, max: () => maxActive };
}

const startOk = (legs: { leg: number; eventKey: string | null; skipped: "started" | "no-event" | null }[]) => ({ status: 200, data: { fetchId: "f1", takenAt: NOW.toISOString(), legs } });
const allLegs = (n = 8) => Array.from({ length: n }, (_, i) => ({ leg: i + 1, eventKey: `e${i + 1}`, skipped: null }));

describe("oddskedjan", () => {
  it("start, högst 4 lopp samtidigt, finish", async () => {
    const s = fakeServer((url) => {
      if (url.endsWith("/unibet")) return startOk(allLegs());
      const m = /legs\/(\d)$/.exec(url);
      if (m) return { status: 200, data: leg(Number(m[1])) };
      if (url.endsWith("/finish")) return { status: 200, data: { saved: true, withOdds: 98, fetchId: "f1", takenAt: NOW.toISOString(), finishedAt: NOW.toISOString(), legsOk: [1, 2, 3, 4, 5, 6, 7, 8], legsFailed: [], legsSkipped: [] } };
      return { status: 404, data: null };
    });
    const progress: OddsPart[] = [];
    const o = await runOdds(s.post, "R", 8, { kind: "odds" }, (p) => progress.push(p));
    expect(o.state).toBe("ok");
    expect(o.withOdds).toBe(98);
    expect(o.lamps).toEqual(Array(8).fill("on"));
    expect(s.calls[0]).toBe("/api/rounds/R/unibet");
    expect(s.calls[s.calls.length - 1]).toBe("/api/rounds/R/unibet/f1/finish");
    expect(s.calls.filter((c) => c.includes("/legs/"))).toHaveLength(8);
    expect(s.max()).toBeLessThanOrEqual(4);
    // Lamporna tänds efter hand.
    expect(progress.some((p) => p.lamps.includes("cur"))).toBe(true);
  });

  it("spärren (429) ger låst med retryAfterSec", async () => {
    const s = fakeServer(() => ({ status: 429, data: { error: "Nyss hämtat. Försök igen om 1 min 42 s.", retryAfterSec: 102 } }));
    const o = await runOdds(s.post, "R", 8, { kind: "odds" });
    expect(o.state).toBe("locked");
    expect(o.retryAfterSec).toBe(102);
    expect(s.calls).toHaveLength(1);
  });

  it("Unibet svarar inte (502 eller nätfel) ger misslyckad del", async () => {
    expect((await runOdds(fakeServer(() => ({ status: 502, data: { error: "Unibet svarade inte." } })).post, "R", 8, { kind: "odds" })).state).toBe("failed");
    const o = await runOdds(fakeServer(() => "throw").post, "R", 8, { kind: "odds" });
    expect(o.state).toBe("failed");
    expect(o.lamps).toEqual(Array(8).fill("bad"));
  });

  it("ingen bana hos Unibet: inga odds än", async () => {
    const o = await runOdds(fakeServer(() => ({ status: 200, data: { fetchId: null, noMeeting: true, legs: [] } })).post, "R", 8, { kind: "odds" });
    expect(o.state).toBe("noOdds");
  });

  it("inga odds i något lopp: finish sparar inget", async () => {
    const s = fakeServer((url) => (url.endsWith("/unibet") ? startOk(allLegs()) : url.endsWith("/finish") ? { status: 200, data: { saved: false } } : { status: 200, data: leg(1, { noPrices: true, withOdds: 0 }) }));
    const o = await runOdds(s.post, "R", 8, { kind: "odds" });
    expect(o.state).toBe("noOdds");
    expect(o.fetchId).toBeNull();
  });

  it("delvis: V85-6 och V85-8 svarar inte, startade lopp blir randiga", async () => {
    const legs = allLegs().map((l) => (l.leg <= 2 ? { ...l, eventKey: null, skipped: "started" as const } : l));
    const s = fakeServer((url) => {
      if (url.endsWith("/unibet")) return startOk(legs);
      const m = /legs\/(\d)$/.exec(url);
      if (m) return Number(m[1]) === 6 || Number(m[1]) === 8 ? { status: 502, data: leg(Number(m[1]), { ok: false, error: "x" }) } : { status: 200, data: leg(Number(m[1])) };
      return { status: 200, data: { saved: true, withOdds: 40, fetchId: "f1", takenAt: NOW.toISOString(), finishedAt: NOW.toISOString(), legsOk: [], legsFailed: [6, 8], legsSkipped: [1, 2] } };
    });
    const o = await runOdds(s.post, "R", 8, { kind: "odds" });
    expect(o.state).toBe("partial");
    expect(o.failedLegs).toEqual([6, 8]);
    expect(o.startedLegs).toEqual([1, 2]);
    expect(o.lamps).toEqual(["started", "started", "on", "on", "on", "bad", "on", "bad"]);

    // Omkörning av bara de två: ingen ny start (räknas inte mot spärren).
    const r = fakeServer((url) => (/legs\/\d$/.test(url) ? { status: 200, data: leg(Number(url.slice(-1))) } : { status: 200, data: { saved: true, withOdds: 60, fetchId: "f1", takenAt: NOW.toISOString(), finishedAt: NOW.toISOString(), legsOk: [], legsFailed: [], legsSkipped: [1, 2] } }));
    const again = await runOdds(r.post, "R", 8, { kind: "legs", fetchId: "f1", legs: [6, 8] }, () => {}, o);
    expect(r.calls).toEqual(["/api/rounds/R/unibet/f1/legs/6", "/api/rounds/R/unibet/f1/legs/8", "/api/rounds/R/unibet/f1/finish"]);
    expect(again.state).toBe("ok");
    expect(again.failedLegs).toEqual([]);
    expect(again.lamps).toEqual(["started", "started", "on", "on", "on", "on", "on", "on"]);
  });

  it("409 Loppet har startat under hämtningen ger randig ruta", async () => {
    const s = fakeServer((url) => {
      if (url.endsWith("/unibet")) return startOk(allLegs(2));
      if (url.endsWith("/legs/1")) return { status: 409, data: { error: "Loppet har startat" } };
      if (url.endsWith("/legs/2")) return { status: 200, data: leg(2) };
      return { status: 200, data: { saved: true, withOdds: 10, fetchId: "f1", takenAt: NOW.toISOString(), finishedAt: null, legsOk: [2], legsFailed: [], legsSkipped: [1] } };
    });
    const o = await runOdds(s.post, "R", 2, { kind: "odds" });
    expect(o.state).toBe("ok");
    expect(o.startedLegs).toEqual([1]);
    expect(o.lamps).toEqual(["started", "on"]);
  });
});

describe("strecket", () => {
  it("refresh och sedan riktodds", async () => {
    const s = fakeServer((url) => ({ status: 200, data: url.endsWith("/refresh") ? { roundId: "R", hasStreck: true, streckAt: NOW.toISOString(), changes: { scratched: [], driverChanges: [], skipped: [] }, needsResume: false } : {} }));
    const r = await runStreck(s.post, "R");
    expect(r.state).toBe("ok");
    expect(s.calls).toEqual(["/api/rounds/R/refresh", "/api/rounds/R/riktodds"]);
  });
  it("ATG svarar inte", async () => {
    expect((await runStreck(fakeServer(() => ({ status: 502, data: {} })).post, "R")).state).toBe("failed");
    expect((await runStreck(fakeServer(() => "throw").post, "R")).state).toBe("failed");
  });
});

// Före: Kaley (eget 3,10, Spelbar) och Polly (inte Spelbar). Efter: Polly Spelbar, Kaley inte.
function beforeAfter() {
  const kaley = (spelbar: boolean, odds: number) => mkStart("k", 5, { horse: { id: "hk", name: "Kaley D.C.", sex: null, age: null, record: null, earnings: null }, mark: mkMark("k", { interesting: true, spelbar, unibetOdds: odds }) });
  const polly = (spelbar: boolean) => mkStart("p", 2, { horse: { id: "hp", name: "Polly Vici", sex: null, age: null, record: null, earnings: null }, mark: mkMark("p", { interesting: true, spelbar }) });
  const mondavi = mkStart("m", 13, { horse: { id: "hm", name: "Mondavi", sex: null, age: null, record: null, earnings: null } });
  const before = mkRound([mkRace(1, [kaley(true, 3.1)]), mkRace(2, [polly(false)]), mkRace(5, [mondavi])], { latestOdds: { fetchId: "f0", takenAt: "2026-10-22T16:02:00.000Z", finishedAt: null, legsOk: [], legsFailed: [], legsSkipped: [] }, latestStreck: { kind: "FETCH", takenAt: "2026-10-22T15:55:00.000Z" } });
  const after = mkRound([mkRace(1, [kaley(false, 2.75)]), mkRace(2, [polly(true)]), mkRace(5, [mondavi])]);
  return { before, after };
}

describe("jämförelsen före och efter", () => {
  it("nya och förlorade Spelbara, ersatta odds och hästar som saknas", () => {
    const { before, after } = beforeAfter();
    const s = summarize(before, after, [leg(1, { replaced: [{ startId: "k", from: 3.1, to: 2.75 }] }), leg(5, { missing: [13] })]);
    expect(s.newSpelbar.map((c) => c.text)).toEqual(["V85-2 · 2 Polly Vici: nu Spelbar"]);
    expect(s.lostSpelbar.map((c) => c.text)).toEqual(["V85-1 · 5 Kaley D.C.: inte längre Spelbar"]);
    expect(s.newIds).toEqual(["p"]);
    expect(s.replaced).toEqual([{ startId: "k", leg: 1, number: 5, name: "Kaley D.C.", from: 3.1, to: 2.75 }]);
    expect(s.missing.map((m) => m.name)).toEqual(["Mondavi"]);
  });
});

const ok = (o: Partial<OddsPart> = {}): OddsPart => ({ ...idleOdds(8), state: "ok", fetchId: "f1", takenAt: NOW.toISOString(), lamps: Array(8).fill("on"), withOdds: 98, ...o });
const streckOk = { ...idleStreck(), state: "ok" as const, result: { roundId: "R", hasStreck: true, streckAt: null, changes: { scratched: [], driverChanges: [], skipped: [] }, needsResume: false } };

describe("banderollen", () => {
  const { before, after } = beforeAfter();
  const ctx = { before, after, now: NOW, unmarked: 4, legCount: 8 };
  const sum = summarize(before, after, [leg(1, { replaced: [{ startId: "k", from: 3.1, to: 2.75 }] })]);

  it("båda klara, med ett ersatt odds", () => {
    const b = bannerFor({ streck: streckOk, odds: ok(), summary: sum }, ctx)!;
    expect(b.tone).toBe("ok");
    expect(b.head).toBe("Streck och odds hämtade.");
    expect(b.text).toBe("98 hästar fick odds, 1 ny Spelbar. 1 odds du skrev in ersattes: Kaley D.C. 3,10 blev 2,75.");
    expect(b.undo).toEqual({ label: "Ångra för Kaley D.C.", startId: "k" });
    expect(b.unmarked).toBe(4);
    expect(b.changes.length).toBeGreaterThan(0);
  });
  it("inga nya Spelbara", () => {
    const b = bannerFor({ streck: streckOk, odds: ok(), summary: { ...sum, newSpelbar: [], replaced: [] } }, ctx)!;
    expect(b.text).toBe("98 hästar fick odds. Inga nya Spelbara.");
  });
  it("strecket gick, Unibet inte: Hämta oddsen igen", () => {
    const b = bannerFor({ streck: streckOk, odds: { ...idleOdds(8), state: "failed" }, summary: sum }, ctx)!;
    expect(b.tone).toBe("warn");
    expect(b.head).toBe("Strecket är uppdaterat, men Unibet svarade inte.");
    expect(b.text).toBe("Oddsen är från i dag 18:02.");
    expect(b.retry?.mode).toEqual({ kind: "odds" });
  });
  it("Unibet gick, strecket inte: Hämta strecket igen", () => {
    const b = bannerFor({ streck: { ...idleStreck(), state: "failed" }, odds: ok(), summary: { ...sum, replaced: [] } }, ctx)!;
    expect(b.head).toBe("Oddsen är hämtade, men ATG svarade inte.");
    expect(b.text).toBe("98 hästar fick odds, 1 ny Spelbar. Strecket och riktoddset är från i dag 17:55.");
    expect(b.retry?.mode).toEqual({ kind: "streck" });
  });
  it("inga odds än", () => {
    const b = bannerFor({ streck: streckOk, odds: { ...idleOdds(8), state: "noOdds" }, summary: sum }, ctx)!;
    expect(b.tone).toBe("info");
    expect(`${b.head} ${b.text}`).toBe("Strecket är uppdaterat. Unibet har inga odds för V85 än, de brukar komma på torsdagen. Inga odds sparades.");
  });
  it("delvis: Hämta V85-6 och V85-8", () => {
    const b = bannerFor({ streck: streckOk, odds: ok({ state: "partial", failedLegs: [6, 8] }), summary: { ...sum, replaced: [], newSpelbar: [] } }, ctx)!;
    expect(b.head).toBe("Strecket är uppdaterat. Unibet: 6 av 8 lopp.");
    expect(b.text.startsWith("V85-6 och V85-8 svarade inte. Det som hämtades är sparat.")).toBe(true);
    expect(b.retry).toEqual({ label: "Hämta V85-6 och V85-8", mode: { kind: "legs", fetchId: "f1", legs: [6, 8] }, icon: "dl" });
  });
  it("båda misslyckades", () => {
    const b = bannerFor({ streck: { ...idleStreck(), state: "failed" }, odds: { ...idleOdds(8), state: "failed" }, summary: sum }, ctx)!;
    expect(b.tone).toBe("err");
    expect(`${b.head} ${b.text}`).toBe("Varken ATG eller Unibet svarade. Inget ändrades. Försök igen om en stund.");
    expect(b.retry?.mode).toEqual({ kind: "all" });
  });
  it("hästar saknas hos Unibet", () => {
    const miss = { ...sum, replaced: [], newSpelbar: [], missing: [{ startId: "a", leg: 5, number: 13, name: "Mondavi" }, { startId: "b", leg: 5, number: 14, name: "X" }], scratchedAtUnibet: [{ startId: "c", leg: 3, number: 7, name: "Y" }] };
    const b = bannerFor({ streck: streckOk, odds: ok({ withOdds: 96 }), summary: miss }, ctx)!;
    expect(b.tone).toBe("warn");
    expect(b.head).toBe("96 hästar fick odds.");
    expect(b.text.startsWith("2 hästar fanns inte hos Unibet och har kvar sina tidigare odds. 1 är struken hos Unibet.")).toBe(true);
  });
  it("lopp har startat", () => {
    const b = bannerFor({ streck: streckOk, odds: ok({ startedLegs: [1, 2, 3] }), summary: { ...sum, replaced: [] } }, ctx)!;
    expect(b.text).toContain("V85-1–3 har startat och hämtades inte. Deras odds är från i dag 18:02.");
  });
});

describe("tavelknappen", () => {
  const base: BoardInput = { gameType: "V85", online: true, now: NOW, latestStreckAt: "2026-10-22T19:00:00.000Z", latestOdds: { fetchId: "f1", takenAt: "2026-10-22T19:00:00.000Z", finishedAt: null, legsOk: [], legsFailed: [], legsSkipped: [] }, lastOddsAttempt: null, run: null, progress: null };
  const run = (p: Partial<RunState> & { finishedAt?: number | null; running?: boolean }) => ({ streck: streckOk, odds: ok(), summary: null, running: false, finishedAt: null, ...p });

  it("viloläge: tiden för den äldsta delen", () => {
    const v = boardView(base);
    expect(v.kind).toBe("idle");
    expect(v.value).toBe("21:00");
    expect(v.expl).toBe("för 5 min sedan");
    expect(v.aria).toBe("Hämta streck och odds. Senast i dag 21:00");
  });
  it("inte hämtat än", () => {
    expect(boardView({ ...base, latestStreckAt: null, latestOdds: null }).aria).toBe("Hämta streck och odds. Inte hämtat än");
  });
  it("spärr: avstängd med nedräkning", () => {
    const v = boardView({ ...base, latestOdds: { ...base.latestOdds!, takenAt: new Date(NOW.getTime() - 18_000).toISOString() } });
    expect(v.kind).toBe("wait");
    expect(v.value).toBe("om 1:42");
    expect(v.disabled).toBe(true);
    expect(v.aria).toBe("Nyss hämtat. Nästa hämtning om 1 minut 42 sekunder");
  });
  it("hämtar: avdelning n av 8", () => {
    const v = boardView({ ...base, run: run({ running: true, odds: { ...idleOdds(8), state: "running" } }), progress: { done: 2, total: 8 } });
    expect(v.kind).toBe("busy");
    expect(v.value).toBe("2/8");
    expect(v.aria).toBe("Hämtar streck och odds, lopp 3 av 8");
    expect(v.disabled).toBe(true);
  });
  it("klart i 10 s, sedan spärr", () => {
    const at = NOW.getTime() - 3000;
    const latest = { ...base.latestOdds!, takenAt: new Date(at - 5000).toISOString() };
    expect(boardView({ ...base, latestOdds: latest, run: run({ finishedAt: at }) }).kind).toBe("done");
    expect(boardView({ ...base, latestOdds: latest, run: run({ finishedAt: at - 20_000 }) }).kind).toBe("wait");
  });
  it("misslyckade delar: tryck gör om bara dem, även under spärren", () => {
    const sOnly = boardView({ ...base, run: run({ odds: { ...idleOdds(8), state: "failed" } }) });
    expect(sOnly.kind).toBe("sOnly");
    expect(sOnly.dot).toBe(true);
    expect(sOnly.mode).toEqual({ kind: "odds" });
    const uOnly = boardView({ ...base, run: run({ streck: { ...idleStreck(), state: "failed" } }) });
    expect(uOnly.kind).toBe("uOnly");
    expect(uOnly.mode).toEqual({ kind: "streck" });
    expect(uOnly.aria).toBe("Oddsen hämtades, strecket misslyckades. Tryck för att försöka igen");
    const part = boardView({ ...base, latestOdds: { ...base.latestOdds!, takenAt: NOW.toISOString() }, run: run({ odds: ok({ state: "partial", failedLegs: [6, 8] }) }) });
    expect(part.kind).toBe("part");
    expect(part.disabled).toBe(false);
    expect(part.mode).toEqual({ kind: "legs", fetchId: "f1", legs: [6, 8] });
    const err = boardView({ ...base, run: run({ streck: { ...idleStreck(), state: "failed" }, odds: { ...idleOdds(8), state: "failed" } }) });
    expect(err.kind).toBe("err");
    expect(err.tone).toBe("err");
  });
  it("Unibet har inga odds än (senaste försöket)", () => {
    const v = boardView({ ...base, latestOdds: null, lastOddsAttempt: { at: NOW.toISOString(), outcome: "noOdds" } });
    expect(v.kind).toBe("none");
    expect(v.aria).toBe("Strecket hämtat. Unibet har inga odds än");
  });
  it("äldre än 12 timmar", () => {
    const old = "2026-10-22T05:05:00.000Z";
    const v = boardView({ ...base, now: new Date("2026-10-22T19:05:00.000Z"), latestStreckAt: old, latestOdds: { ...base.latestOdds!, takenAt: old } });
    expect(v.kind).toBe("old");
    expect(v.expl).toBe("14 tim");
    expect(v.dot).toBe(true);
  });
  it("offline", () => {
    const v = boardView({ ...base, online: false });
    expect(v.kind).toBe("off");
    expect(v.disabled).toBe(true);
    expect(v.aria).toBe("Ingen uppkoppling");
  });
});

describe("texter och tider", () => {
  it("lopp", () => {
    expect(legsText([6, 8], "V85")).toBe("V85-6 och V85-8");
    expect(legsText([1, 2, 3], "V85")).toBe("V85-1–3");
    expect(legsText([2, 4, 7], "V85")).toBe("V85-2, V85-4 och V85-7");
    expect(legsText([1, 2, 3, 5], "V85")).toBe("V85-1–3 och V85-5");
    expect(legsText([1, 2], "V85")).toBe("V85-1 och V85-2");
  });
  it("nedräkningen", () => {
    expect(countdownClock(102)).toBe("1:42");
    expect(countdownClock(9)).toBe("0:09");
    expect(countdownShort(102)).toBe("1 min 42 s");
    expect(countdownShort(60)).toBe("1 min");
    expect(countdownShort(5)).toBe("5 s");
    expect(countdownSpoken(102)).toBe("1 minut 42 sekunder");
    expect(countdownSpoken(121)).toBe("2 minuter 1 sekund");
    expect(lockLeftSec(new Date(NOW.getTime() - 18_000).toISOString(), NOW.getTime())).toBe(102);
    expect(lockLeftSec(new Date(NOW.getTime() - 130_000).toISOString(), NOW.getTime())).toBe(0);
    expect(lockLeftSec(null, NOW.getTime())).toBe(0);
  });
  it("ålder och tid", () => {
    expect(agoText(30_000)).toBe("nyss");
    expect(agoText(5 * 60_000)).toBe("för 5 min sedan");
    expect(agoText(14 * 3600_000)).toBe("för 14 timmar sedan");
    expect(boardTime("2026-10-22T19:05:00.000Z", NOW)).toBe("21:05");
    expect(boardTime("2026-10-22T19:05:00.000Z", new Date("2026-10-24T09:00:00.000Z"))).toBe("tors 21:05");
  });
  it("Nästa steg: odds saknas eller är äldre än 12 timmar", () => {
    expect(needsOddsFetch(null, NOW.getTime())).toBe(true);
    expect(needsOddsFetch({ fetchId: "f", takenAt: "2026-10-22T18:00:00.000Z", finishedAt: null, legsOk: [], legsFailed: [], legsSkipped: [] }, NOW.getTime())).toBe(false);
    expect(needsOddsFetch({ fetchId: "f", takenAt: "2026-10-22T06:00:00.000Z", finishedAt: null, legsOk: [], legsFailed: [], legsSkipped: [] }, NOW.getTime())).toBe(true);
  });
});
