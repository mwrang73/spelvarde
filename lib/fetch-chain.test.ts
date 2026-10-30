import { describe, expect, it } from "vitest";
import { ATG_UNREACHABLE, resumeMessage, runFetchChain, STOPPED_AT_RIKTODDS, stoppedAtRace, type ChainPost } from "@/lib/fetch-chain";

function fakePost(fail: (url: string) => number | "throw" | null): { post: ChainPost; calls: string[] } {
  const calls: string[] = [];
  const post: ChainPost = async (url) => {
    calls.push(url);
    const f = fail(url);
    if (f === "throw") throw new Error("nät");
    if (f) return { status: f, data: { error: "fel", code: f === 404 ? "NO_GAME" : undefined } };
    return { status: 200, data: url === "/api/rounds/fetch" ? { roundId: "R1" } : {} };
  };
  return { post, calls };
}

describe("runFetchChain", () => {
  it("kör spelet, alla 8 lopp, statistiken och riktoddsen i ordning", async () => {
    const { post, calls } = fakePost(() => null);
    const steps: string[] = [];
    const res = await runFetchChain(post, { from: { step: "GAME" }, gameId: null, roundId: null }, (p) => steps.push(`${p.step}${p.leg ?? ""}`));
    expect(res).toEqual({ ok: true, roundId: "R1" });
    expect(calls).toEqual(["/api/rounds/fetch", ...[1, 2, 3, 4, 5, 6, 7, 8].map((l) => `/api/rounds/R1/fetch/races/${l}`), "/api/rounds/R1/fetch/stats", "/api/rounds/R1/riktodds"]);
    expect(steps[0]).toBe("GAME");
    expect(steps).toContain("RIKTODDS");
    expect(steps).toContain("RACE5");
  });

  it("stannar vid V85-5 och fortsätter därifrån", async () => {
    const first = fakePost((u) => (u.endsWith("/races/5") ? 502 : null));
    const res = await runFetchChain(first.post, { from: { step: "GAME" }, gameId: "V85_2026-10-24_7_5", roundId: null });
    expect(res).toMatchObject({ ok: false, kind: "PARTIAL", message: stoppedAtRace(5), resumeFrom: { step: "RACE", leg: 5 } });
    const again = fakePost(() => null);
    const res2 = await runFetchChain(again.post, { from: { step: "RACE", leg: 5 }, gameId: null, roundId: "R1" });
    expect(res2.ok).toBe(true);
    expect(again.calls[0]).toBe("/api/rounds/R1/fetch/races/5");
    expect(again.calls).toHaveLength(6);
  });

  it("ingen V85 och nätverksfel", async () => {
    expect((await runFetchChain(fakePost(() => 404).post, { from: { step: "GAME" }, gameId: null, roundId: null })).ok).toBe(false);
    const res = await runFetchChain(fakePost(() => 404).post, { from: { step: "GAME" }, gameId: null, roundId: null });
    expect(res).toMatchObject({ kind: "NO_GAME" });
    const net = await runFetchChain(fakePost(() => "throw").post, { from: { step: "GAME" }, gameId: null, roundId: null });
    expect(net).toMatchObject({ kind: "FAILED", message: ATG_UNREACHABLE });
  });

  it("fortsätter med bara statistiken", async () => {
    const { post, calls } = fakePost(() => null);
    expect((await runFetchChain(post, { from: { step: "STATS" }, gameId: null, roundId: "R1" })).ok).toBe(true);
    expect(calls).toEqual(["/api/rounds/R1/fetch/stats", "/api/rounds/R1/riktodds"]);
  });

  it("steg 11: riktoddsen stannar kedjan och Försök igen tar bara om dem", async () => {
    const first = fakePost((u) => (u.endsWith("/riktodds") ? 500 : null));
    const res = await runFetchChain(first.post, { from: { step: "STATS" }, gameId: null, roundId: "R1" });
    expect(res).toMatchObject({ ok: false, kind: "PARTIAL", message: STOPPED_AT_RIKTODDS, resumeFrom: { step: "RIKTODDS" } });
    const again = fakePost(() => null);
    const progress: boolean[] = [];
    expect((await runFetchChain(again.post, { from: { step: "RIKTODDS" }, gameId: null, roundId: "R1" }, (p) => progress.push(p.riktoddsDone))).ok).toBe(true);
    expect(again.calls).toEqual(["/api/rounds/R1/riktodds"]);
    expect(progress.at(-1)).toBe(true);
    expect(resumeMessage({ step: "RIKTODDS" })).toBe(STOPPED_AT_RIKTODDS);
  });
});
