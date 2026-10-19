import { describe, expect, it } from "vitest";
import type { OutboxItem } from "@/lib/outbox";
import { applyCommentDone, applyDone, applyPending, applyPendingComments, retryText } from "@/lib/round-overlay";
import type { CommentDto, RaceDto, RoundResponse, StartDto } from "@/lib/types";

const NOW = new Date("2026-10-19T12:00:00Z");

function start(id: string, number: number, interesting = false): StartDto {
  return {
    id,
    number,
    postPosition: number,
    distance: 2140,
    scratched: false,
    scratchedAt: null,
    horse: { id: `h${id}`, name: `Häst ${number}`, sex: "mare", age: 5, record: null, earnings: null },
    driver: null,
    trainer: null,
    prevDriver: null,
    form: { boxes: [], ariaLabel: "", gallop: null, warning: null, fewStarts: true, debut: true },
    streck: null,
    riktodds: null,
    uncertain: true,
    mark: interesting
      ? { startId: id, interesting: true, interestingAt: null, spelbarOverride: "NONE", bet: false, betAt: null, betOdds: null, unibetOdds: null, unibetOddsAt: null, unibetOddsPrev: null, updatedAt: "", forslag: false, spelbar: false }
      : null,
    result: null,
    quick: { winPct: null, placePct: null, postPct: null },
  };
}

function race(leg: number, starts: StartDto[]): RaceDto {
  const interesting = starts.filter((s) => s.mark?.interesting).length;
  return {
    id: `r${leg}`,
    leg,
    raceNumber: leg + 4,
    name: `Lopp ${leg}`,
    startAt: `2026-10-24T${String(12 + leg).padStart(2, "0")}:00:00.000Z`,
    distance: 2140,
    startMethod: "AUTO",
    prize: null,
    classLabel: null,
    terms: [],
    cancelled: false,
    resultAt: null,
    started: false,
    reviewed: interesting > 0,
    review: null,
    counts: { starters: starts.length, scratched: 0, interesting, spelbar: 0, bet: 0 },
    statsLine: { ok: false, fetchedAt: null, bestNumber: null, number1Pct: null, favoriteWinPct: null },
    starts,
  };
}

function round(): RoundResponse {
  return {
    serverTime: NOW.toISOString(),
    rev: 1,
    round: { id: "R", atgGameId: "V85_2026-10-24_7_5", date: "2026-10-24", trackId: 7, trackName: "Jägersro", firstStartAt: "", atgStatus: null, fetchedAt: null, fetchStatus: "COMPLETE", finishedAt: null, rev: 1 },
    isCurrent: true,
    currentRoundId: "R",
    phase: "ANALYS",
    phaseRail: [],
    nextStep: { kind: "ANALYZE_LEG", title: "Analysera avd 1 – Lopp 1", text: "", action: null },
    fetch: { status: "COMPLETE", fetchedAt: null, lastChanges: null, resumeFrom: null, lastError: null },
    races: [race(1, [start("a", 1), start("b", 2)]), race(2, [start("c", 1, true)])],
    latestStreck: null,
    coupon: null,
  };
}

const item = (meta: Record<string, unknown>, extra: Partial<OutboxItem> = {}): OutboxItem => ({ id: Math.random().toString(36), method: "PUT", url: "/api/x", createdAt: NOW.getTime(), tries: 0, meta, ...extra });
const markItem = (startId: string, interesting: boolean) => item({ kind: "mark", roundId: "R", raceId: "r1", startId, horseName: "Häst", interesting });

describe("applyPending", () => {
  it("lägger Intressant ovanpå cachen och räknar om avdelningen", () => {
    const out = applyPending(round(), [markItem("a", true)], NOW);
    const r1 = out.races[0];
    expect(r1.starts[0].mark?.interesting).toBe(true);
    expect(r1.counts.interesting).toBe(1);
    expect(r1.reviewed).toBe(true);
    // Nästa steg går vidare till avd 2? Nej: avd 2 är redan genomgången, så allt är klart.
    expect(out.nextStep.kind).toBe("ALL_REVIEWED");
  });

  it("senaste posten för samma start gäller", () => {
    const out = applyPending(round(), [markItem("a", true), markItem("a", false)], NOW);
    expect(out.races[0].starts[0].mark?.interesting).toBe(false);
    expect(out.races[0].reviewed).toBe(false);
  });

  it("Inga intressanta här markerar avdelningen som genomgången, och Ångra tar bort det", () => {
    const review = (reviewed: boolean) => item({ kind: "review", roundId: "R", raceId: "r1", reviewed, noneInteresting: reviewed });
    expect(applyPending(round(), [review(true)], NOW).races[0].review?.noneInteresting).toBe(true);
    expect(applyPending(round(), [review(true), review(false)], NOW).races[0].reviewed).toBe(false);
  });

  it("rör inte andra omgångar och ger samma objekt utan poster", () => {
    const data = round();
    expect(applyPending(data, [], NOW)).toBe(data);
    expect(applyPending(data, [item({ kind: "mark", roundId: "X", raceId: "r1", startId: "a", horseName: "", interesting: true })], NOW)).toBe(data);
  });
});

describe("applyDone", () => {
  it("skriver in serverns Mark så att läget finns kvar när posten är borta", () => {
    const it1 = markItem("a", true);
    const mark = { ...round().races[1].starts[0].mark!, startId: "a" };
    const out = applyDone(round(), it1, { mark }, NOW);
    expect(out.races[0].starts[0].mark?.interesting).toBe(true);
    expect(out.races[0].counts.interesting).toBe(1);
  });
});

describe("kommentarer", () => {
  const base: CommentDto = {
    id: "c1",
    clientId: "u1",
    horseId: "H",
    startId: null,
    roundId: null,
    kind: "NOTE",
    tags: [],
    text: "Gammal",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    round: null,
    leg: null,
    result: null,
  };
  const put = (clientId: string, text: string) =>
    item({ kind: "comment", horseId: "H", horseName: "Häst", clientId, round: null, leg: 7 }, { body: { horseId: "H", startId: null, roundId: null, kind: "NOTE", tags: [], text } });

  it("ny kommentar syns överst direkt", () => {
    const out = applyPendingComments([base], [put("u2", "Ny")], "H");
    expect(out.map((c) => c.text)).toEqual(["Ny", "Gammal"]);
    expect(out[0].pending).toBe(true);
  });
  it("ändring behåller datumet och borttagning döljer", () => {
    expect(applyPendingComments([base], [put("u1", "Ändrad")], "H")[0]).toMatchObject({ text: "Ändrad", createdAt: base.createdAt });
    const del = item({ kind: "comment-delete", horseId: "H", horseName: "Häst", clientId: "u1" }, { method: "DELETE" });
    expect(applyPendingComments([base], [del], "H")).toEqual([]);
    expect(applyCommentDone([base], del, { ok: true })).toEqual([]);
  });
  it("toasttext vid nytt försök", () => {
    expect(retryText(markItem("a", true))).toBe("Kunde inte spara Intressant för Häst. Försöker igen.");
  });
});
