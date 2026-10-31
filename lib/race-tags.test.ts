// Regressionstester för taggningen (E8 12 och 17.5). Lagret körs på riktigt, med
// riktig enqueue från utkorgen. Bara nätet är utbytt.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enqueue, type OutboxItem } from "@/lib/outbox";
import { applyPendingRaceTags, mergeRaceTags, roundCommentPosts } from "@/lib/race-tags";
import { liveStatusText } from "@/lib/live-view";
import { retryText, rejectedText, type ItemMeta } from "@/lib/round-overlay";
import { mkRace, mkStart } from "@/lib/test-round";
import type { CommentDto } from "@/lib/types";

const box = vi.hoisted(() => ({ queue: [] as unknown[], inFlight: null as string | null, n: 0, rejected: [] as ((i: unknown) => void)[], responses: [] as unknown[] }));

vi.mock("@/components/outbox/outbox-client", () => ({
  addToOutbox: (input: { method: "PUT" | "DELETE"; url: string; body?: unknown; meta: ItemMeta }) => {
    const item: OutboxItem = { id: `p${++box.n}`, method: input.method, url: input.url, body: input.body, meta: input.meta as unknown as Record<string, unknown>, createdAt: box.n, tries: 0 };
    box.queue = enqueue(box.queue as OutboxItem[], item, box.inFlight);
  },
  getOutboxSnapshot: () => ({ queue: box.queue, status: { kind: "saved", count: 0, text: "" } }),
  onOutboxRejected: (fn: (i: unknown) => void) => {
    box.rejected.push(fn);
    return () => {};
  },
}));
vi.mock("@/components/api", () => ({
  apiGet: () => {
    const r = box.responses.shift();
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  },
}));

const { getRaceTags, loadRaceTags, resetTagStore, setRaceText, toggleRaceTag, undoRaceTag } = await import("@/components/round/tagStore");

const A = mkStart("a", 1);
const B = mkStart("b", 2);
const race = mkRace(4, [A, B]);
const ctx = { roundId: "r1", roundDate: "2026-10-31", trackName: "Solvalla", gameType: "V85", race };

const comment = (startId: string, clientId: string, tags: string[], text = ""): CommentDto => ({
  id: `c-${clientId}`,
  clientId,
  horseId: `h${startId}`,
  startId,
  roundId: "r1",
  kind: "RACE",
  tags,
  text,
  createdAt: "2026-10-31T16:00:00.000Z",
  updatedAt: "2026-10-31T16:00:00.000Z",
  round: { id: "r1", date: "2026-10-31", trackName: "Solvalla", gameType: "V85" },
  leg: 4,
  result: null,
});

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const load = async (comments: CommentDto[] = [], force = false) => {
  box.responses.push({ comments });
  loadRaceTags("r1", 4, force);
  await flush();
};
const queue = () => box.queue as OutboxItem[];
const tagsOf = (id: string) => getRaceTags("r1", 4).byStart[id]?.tags ?? [];
const lastBody = () => queue()[queue().length - 1].body as { tags: string[]; text: string };
const put = (startId: string, clientId: string, tags: string[], leg = 4): OutboxItem => ({
  id: `q-${clientId}`,
  method: "PUT",
  url: `/api/comments/${clientId}`,
  body: { horseId: `h${startId}`, startId, roundId: "r1", kind: "RACE", tags, text: "" },
  meta: { kind: "comment", horseId: `h${startId}`, horseName: startId, clientId, round: { id: "r1", date: "2026-10-31", trackName: "Solvalla", gameType: "V85" }, leg },
  createdAt: 1,
  tries: 0,
});
const del = (clientId: string): OutboxItem => ({ id: `d-${clientId}`, method: "DELETE", url: `/api/comments/${clientId}`, meta: { kind: "comment-delete", horseId: "h", horseName: "h", clientId, roundId: "r1" }, createdAt: 2, tries: 0 });

beforeEach(() => {
  resetTagStore();
  box.queue = [];
  box.inFlight = null;
  box.n = 0;
  box.responses = [];
});

describe("snabba klick (E8 12.2)", () => {
  it("1. två klick utan ritning emellan, olika taggar: båda kvar, sista posten har båda", async () => {
    await load();
    toggleRaceTag(ctx, A, "Galopp");
    toggleRaceTag(ctx, A, "Dödens");
    expect(tagsOf("a")).toEqual(["Galopp", "Dödens"]);
    expect(lastBody().tags).toEqual(["Galopp", "Dödens"]);
    expect(queue()).toHaveLength(1);
  });

  it("2. tre klick på samma tagg: taggen på, och sista posten har den", async () => {
    await load();
    toggleRaceTag(ctx, A, "Galopp");
    toggleRaceTag(ctx, A, "Galopp");
    toggleRaceTag(ctx, A, "Galopp");
    expect(tagsOf("a")).toEqual(["Galopp"]);
    expect(queue().map((q) => q.method)).toEqual(["PUT", "DELETE", "PUT"]);
    expect(lastBody().tags).toEqual(["Galopp"]);
  });

  it("2b. tre klick när hästen har text: posterna slås ihop till en", async () => {
    await load([comment("a", "ca", [], "Stark")]);
    for (let i = 0; i < 3; i++) toggleRaceTag(ctx, A, "Galopp");
    expect(queue()).toHaveLength(1);
    expect(lastBody()).toMatchObject({ tags: ["Galopp"], text: "Stark" });
  });

  it("3. klick på A, B, A: A med båda, B med sin, egna adresser", async () => {
    await load();
    toggleRaceTag(ctx, A, "Galopp");
    toggleRaceTag(ctx, B, "Tröttnade");
    toggleRaceTag(ctx, A, "Dödens");
    expect(tagsOf("a")).toEqual(["Galopp", "Dödens"]);
    expect(tagsOf("b")).toEqual(["Tröttnade"]);
    expect(new Set(queue().map((q) => q.url)).size).toBe(2);
    expect(queue().find((q) => (q.body as { startId: string }).startId === "a")?.body).toMatchObject({ tags: ["Galopp", "Dödens"] });
  });

  it("4. posten för A skickas, nytt klick på A: ny post, den skickade ändras inte", async () => {
    await load();
    toggleRaceTag(ctx, A, "Galopp");
    box.inFlight = queue()[0].id;
    toggleRaceTag(ctx, A, "Dödens");
    expect(queue()).toHaveLength(2);
    expect((queue()[0].body as { tags: string[] }).tags).toEqual(["Galopp"]);
    expect((queue()[1].body as { tags: string[] }).tags).toEqual(["Galopp", "Dödens"]);
  });

  it("5. sista taggen bort ger DELETE, ny tagg ger PUT med samma clientId", async () => {
    await load([comment("a", "ca", ["Galopp"])]);
    toggleRaceTag(ctx, A, "Galopp");
    expect(queue()[0]).toMatchObject({ method: "DELETE", url: "/api/comments/ca" });
    toggleRaceTag(ctx, A, "Dödens");
    expect(queue()[1]).toMatchObject({ method: "PUT", url: "/api/comments/ca" });
  });

  it("8. klick innan taggarna är lästa ger ingen post", () => {
    expect(toggleRaceTag(ctx, A, "Galopp")).toBeNull();
    expect(setRaceText(ctx, A, "text")).toBeNull();
    expect(queue()).toHaveLength(0);
  });

  it("egna taggar utanför snabbvalen behålls", async () => {
    await load([comment("a", "ca", ["Egen tagg"])]);
    toggleRaceTag(ctx, A, "Galopp");
    expect(lastBody().tags).toEqual(["Galopp", "Egen tagg"]);
  });

  it("11. setRaceText efter tagg: kroppen har taggen och texten", async () => {
    await load();
    toggleRaceTag(ctx, A, "Galopp");
    setRaceText(ctx, A, "Satt fast");
    expect(lastBody()).toMatchObject({ tags: ["Galopp"], text: "Satt fast" });
    const n = queue().length;
    expect(setRaceText(ctx, A, "Satt fast")).toBeNull();
    expect(queue()).toHaveLength(n);
  });

  it("12. Ångra på annan häst återställer rätt häst", async () => {
    await load([comment("a", "ca", ["Galopp"])]);
    toggleRaceTag(ctx, A, "Dödens");
    toggleRaceTag(ctx, B, "Tröttnade");
    expect(undoRaceTag()).toBe(true);
    expect(tagsOf("b")).toEqual([]);
    expect(tagsOf("a")).toEqual(["Galopp", "Dödens"]);
    expect(undoRaceTag()).toBe(false);
  });
});

describe("lagret efter omladdning och i kö (E8 12.3)", () => {
  it("6. läsning med köad PUT för ny häst: köns clientId och taggar i lagret", async () => {
    box.queue = [put("a", "ny", ["Galopp"])];
    await load();
    expect(getRaceTags("r1", 4).byStart.a).toEqual({ clientId: "ny", tags: ["Galopp"], text: "" });
    // Nästa klick skriver inte över det köade, och samma clientId återanvänds.
    toggleRaceTag(ctx, A, "Dödens");
    expect(queue()).toHaveLength(1);
    expect(queue()[0].url).toBe("/api/comments/ny");
    expect((queue()[0].body as { tags: string[] }).tags).toEqual(["Galopp", "Dödens"]);
  });

  it("7. läsning med köad DELETE: tomma taggar, samma clientId", async () => {
    box.queue = [del("ca")];
    await load([comment("a", "ca", ["Galopp"])]);
    expect(getRaceTags("r1", 4).byStart.a).toEqual({ clientId: "ca", tags: [], text: "" });
  });

  it("applyPendingRaceTags: bara loppets poster med avgränsning, och sista posten gäller", () => {
    const q = [put("a", "x", ["Galopp"]), put("z", "y", ["Dödens"], 5), del("x"), put("a", "x", ["Tröttnade"])];
    const out = applyPendingRaceTags([], q, { roundId: "r1", leg: 4 });
    expect(out).toEqual({ a: { clientId: "x", tags: ["Tröttnade"], text: "" } });
  });

  it("kommentarer av annan typ än RACE påverkar inte lagret", () => {
    const note = put("a", "x", ["Galopp"]);
    (note.body as { kind: string }).kind = "PRE";
    expect(applyPendingRaceTags([], [note])).toEqual({});
  });
});

describe("läsning och flera enheter (E8 12.4)", () => {
  it("9. force, annan enhet har ändrat, ingen post i kö: serverns värde", async () => {
    await load([comment("a", "ca", ["Galopp"])]);
    await load([comment("a", "ca", ["Dödens"])], true);
    expect(tagsOf("a")).toEqual(["Dödens"]);
  });

  it("10. force med post i kö: köns värde", async () => {
    await load([comment("a", "ca", ["Galopp"])]);
    toggleRaceTag(ctx, A, "Tröttnade");
    await load([comment("a", "ca", ["Galopp"])], true);
    expect(tagsOf("a")).toEqual(["Galopp", "Tröttnade"]);
  });

  it("sparade taggar försvinner inte när omläsningen misslyckas", async () => {
    await load([comment("a", "ca", ["Galopp"])]);
    box.responses.push(new Error("Nätet"));
    loadRaceTags("r1", 4, true);
    await flush();
    expect(tagsOf("a")).toEqual(["Galopp"]);
    expect(getRaceTags("r1", 4).loaded).toBe(true);
  });

  it("gammalt svar: hästen som ändrades under läsningen behåller sitt läge när posten redan är klar", () => {
    const local = { a: { clientId: "ca", tags: ["Galopp", "Dödens"], text: "" } };
    const merged = mergeRaceTags([comment("a", "ca", ["Galopp"])], [], local, new Set(["a"]));
    expect(merged.a.tags).toEqual(["Galopp", "Dödens"]);
  });

  it("en oförändrad häst behåller samma objekt, så att bara den ändrade kolumnen ritas om", () => {
    const local = { a: { clientId: "ca", tags: ["Galopp"], text: "" } };
    const merged = mergeRaceTags([comment("a", "ca", ["Galopp"])], [], local, new Set());
    expect(merged.a).toBe(local.a);
  });

  it("avvisad tagg läser om loppet (422 från unika indexet)", async () => {
    await load();
    toggleRaceTag(ctx, A, "Galopp");
    const sent = queue()[0];
    box.queue = [];
    box.responses.push({ comments: [comment("a", "server", ["Dödens"])] });
    box.rejected.forEach((fn) => fn(sent));
    await flush();
    expect(getRaceTags("r1", 4).byStart.a).toEqual({ clientId: "server", tags: ["Dödens"], text: "" });
  });
});

describe("status: paused betyder utloggad, inte offline (E8 6.3)", () => {
  const base = { read: "loaded", paused: false, online: true, pending: 0, recent: null, undone: false } as const;
  it("utloggad med kö säger Logga in, inte I kö", () => {
    expect(liveStatusText({ ...base, paused: true, pending: 2 })).toBe("Logga in igen för att spara taggarna.");
  });
  it("offline läses från useOnline, och kön räknas", () => {
    expect(liveStatusText({ ...base, online: false, pending: 2 })).toBe("I kö (2) · skickas när nätet är tillbaka");
    expect(liveStatusText({ ...base, online: false })).toBe("Ingen uppkoppling · taggar sparas i kön");
  });
  it("uppkopplad med poster: Sparas, inte I kö", () => {
    expect(liveStatusText({ ...base, pending: 3 })).toBe("Sparas …");
  });
  it("övriga rader i ordning", () => {
    expect(liveStatusText({ ...base, read: "loading", paused: true })).toBe("Läser taggarna …");
    expect(liveStatusText({ ...base, read: "failed" })).toBeNull();
    expect(liveStatusText({ ...base, recent: "Galopp på 5 Ble Du Rask" })).toBe("Sparat · Galopp på 5 Ble Du Rask");
    expect(liveStatusText({ ...base, undone: true })).toBe("Sparat · Ångrade senaste ändringen");
    expect(liveStatusText(base)).toBe("Sparas direkt · följer hästen");
  });
  it("posterna räknas per omgång, också borttagningar", () => {
    const other = put("a", "o", ["Galopp"]);
    (other.meta as { round: { id: string } }).round.id = "r2";
    expect(roundCommentPosts([put("a", "x", ["Galopp"]), del("y"), other], "r1")).toHaveLength(2);
  });
});

describe("toasterna (E8 12.5)", () => {
  it("retryText med tagg, och köad post utan fältet får dagens text", () => {
    const withWhat = put("a", "x", ["Galopp"]);
    (withWhat.meta as { what?: string; horseName: string }).what = "Galopp";
    (withWhat.meta as { horseName: string }).horseName = "Ble Du Rask";
    expect(retryText(withWhat)).toBe("Kunde inte spara Galopp för Ble Du Rask. Försöker igen.");
    const old = put("a", "x", ["Galopp"]);
    (old.meta as { horseName: string }).horseName = "Ble Du Rask";
    expect(retryText(old)).toBe("Kunde inte spara kommentaren om Ble Du Rask. Försöker igen.");
    expect(rejectedText(old, "Serverns mening.")).toBe("Serverns mening.");
  });
});
