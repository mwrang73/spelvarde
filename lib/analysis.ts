// Efteranalys (mockupen efteranalys-tips, del 1 alternativ A): vad en omgång
// gav, varför, och samma sak över tid. Rena funktioner över de frysta värdena i
// Outcome och taggarna från Tagga loppet. Slutsatserna räknas med regler, inte
// med AI. Enhet = 1 insats per spel: träff ger Bet-oddset − 1, miss −1.
// Kronor = enheter × 100 kr (Mikael 2026-10-27). Jämförelsen singlar mot
// dubbelsystem väntar tills det finns mer data.

import { ordinal } from "@/lib/format";

export const UNIT_KR = 100;
// Riktlinjen för Bra spel: Bet-oddset över riktoddset med X och minst 2,00.
export const GOOD_MIN_ODDS = 2.0;

export type AnalysisRow = {
  startId: string;
  leg: number;
  number: number;
  horseName: string;
  driverName: string | null;
  interesting: boolean;
  spelbar: boolean;
  bet: boolean;
  betOdds: number | null;
  unibetOdds: number | null;
  riktodds: number | null;
  riktoddsX: number | null;
  xFactor: "NONE" | "TROR" | "STARK";
  trollspotRank: number | null;
  place: number | null;
  disqualified: boolean;
  galloped: boolean;
  // null = inget resultat (inte kört än, eller inställt lopp).
  hit: boolean | null;
  tags: string[];
};

export type Tone = "good" | "warn" | "info";
// Underlaget: för lite (bara fakta), tunt (slutsats med taggen) eller räcker.
export type Support = "few" | "thin" | "ok";
export type Conclusion = { tone: Tone; title: string; text: string; thin: boolean };

export type Board = {
  bets: number;
  hits: number;
  // Bet med odds och resultat (räknas i enheter).
  counted: number;
  units: number;
  kr: number;
  avgOdds: number | null;
  // Träffprocent som går jämnt med snittoddset (1 / snittodds).
  breakEven: number | null;
  noOdds: number;
};

export type Group = { key: "spelbar" | "interesting" | "trollspot" | "x"; label: string; n: number; hits: number; expected: number; verdict: "better" | "worse" | "inline"; support: Support };
export type Play = AnalysisRow & { quality: "good" | "bad" | null; reason: string; units: number | null };
export type Missed = AnalysisRow & { units: number };
export type TagCount = { tag: string; count: number };

export type RoundAnalysis = {
  board: Board;
  conclusions: Conclusion[];
  groups: Group[];
  plays: Play[];
  missed: Missed[];
  missedUnits: number;
  tags: { placed: TagCount[]; unplaced: TagCount[]; horses: number; tagged: number };
  pending: number;
};

const round2 = (x: number) => Math.round(x * 100) / 100;
const fmt = (x: number, d = 2) => x.toFixed(d).replace(".", ",");
const signed = (x: number) => `${x > 0.004 ? "+" : x < -0.004 ? "−" : "±"}${fmt(Math.abs(x))}`;
const pctTxt = (x: number) => `${Math.round(x * 100)} %`;

export function unitsOf(r: Pick<AnalysisRow, "hit" | "betOdds">): number | null {
  if (r.hit === null || r.betOdds === null) return null;
  return r.hit ? round2(r.betOdds - 1) : -1;
}

export function board(rows: AnalysisRow[]): Board {
  const bets = rows.filter((r) => r.bet && r.hit !== null);
  const counted = bets.filter((r) => r.betOdds !== null);
  const units = round2(counted.reduce((s, r) => s + (unitsOf(r) ?? 0), 0));
  const avgOdds = counted.length ? counted.reduce((s, r) => s + (r.betOdds ?? 0), 0) / counted.length : null;
  return {
    bets: bets.length,
    hits: bets.filter((r) => r.hit).length,
    counted: counted.length,
    units,
    kr: Math.round(units * UNIT_KR),
    avgOdds: avgOdds === null ? null : round2(avgOdds),
    breakEven: avgOdds ? 1 / avgOdds : null,
    noOdds: bets.length - counted.length,
  };
}

// Bra eller svagt spel bedöms på beslutet, inte på utfallet.
export function playQuality(r: AnalysisRow): { quality: Play["quality"]; reason: string } {
  const rx = r.riktoddsX ?? r.riktodds;
  if (r.betOdds === null) return { quality: null, reason: "Bet-oddset fylldes aldrig i" };
  if (rx === null) return { quality: null, reason: "Riktodds saknades" };
  const parts: string[] = [];
  if (r.betOdds <= rx) parts.push("under riktoddset");
  if (r.betOdds < GOOD_MIN_ODDS) parts.push(`under ${fmt(GOOD_MIN_ODDS)}`);
  if (parts.length) return { quality: "bad", reason: `Spelad ${parts.join(" och ")}` };
  return { quality: "good", reason: `Spelad över riktoddset ${fmt(rx)}` };
}

function support(n: number, few: number, ok: number): Support {
  return n < few ? "few" : n < ok ? "thin" : "ok";
}

// Mot väntat: faktiskt antal topp 3 mot Σ 1/riktoddsX. Bättre eller sämre bara
// om skillnaden är minst en standardavvikelse √Σp(1−p).
export function groupOf(key: Group["key"], label: string, rows: AnalysisRow[], few = 3, ok = 5): Group {
  const done = rows.filter((r) => r.hit !== null);
  const ps = done.map((r) => r.riktoddsX ?? r.riktodds).filter((x): x is number => x !== null && x > 0).map((x) => Math.min(1, 1 / x));
  const expected = ps.reduce((s, p) => s + p, 0);
  const sd = Math.sqrt(ps.reduce((s, p) => s + p * (1 - p), 0));
  const hits = done.filter((r) => r.hit).length;
  const diff = hits - expected;
  const verdict = sd > 0 && diff >= sd ? "better" : sd > 0 && diff <= -sd ? "worse" : "inline";
  return { key, label, n: done.length, hits, expected: round2(expected), verdict, support: support(done.length, few, ok) };
}

export function groupsOf(rows: AnalysisRow[], few = 3, ok = 5): Group[] {
  return [
    groupOf("spelbar", "Spelbar", rows.filter((r) => r.spelbar), few, ok),
    groupOf("interesting", "Intressant", rows.filter((r) => r.interesting), few, ok),
    groupOf("trollspot", "Trollspöt", rows.filter((r) => r.trollspotRank !== null), few, ok),
    groupOf("x", "X-faktor", rows.filter((r) => r.xFactor !== "NONE"), few, ok),
  ].filter((g) => g.n > 0);
}

export function tagCounts(rows: AnalysisRow[]): RoundAnalysis["tags"] {
  const done = rows.filter((r) => r.hit !== null);
  const count = (list: AnalysisRow[]) => {
    const m = new Map<string, number>();
    for (const r of list) for (const t of r.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m].map(([tag, c]) => ({ tag, count: c })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "sv"));
  };
  return { placed: count(done.filter((r) => r.hit)), unplaced: count(done.filter((r) => !r.hit)), horses: done.length, tagged: done.filter((r) => r.tags.length > 0).length };
}

export function roundAnalysis(rows: AnalysisRow[]): RoundAnalysis {
  const b = board(rows);
  const plays: Play[] = rows
    .filter((r) => r.bet)
    .sort((a, c) => a.leg - c.leg || a.number - c.number)
    .map((r) => ({ ...r, ...playQuality(r), units: unitsOf(r) }));
  const missed: Missed[] = rows
    .filter((r) => r.spelbar && !r.bet && r.hit !== null && r.unibetOdds !== null)
    .sort((a, c) => a.leg - c.leg)
    .map((r) => ({ ...r, units: r.hit ? round2(r.unibetOdds! - 1) : -1 }));
  const groups = groupsOf(rows);
  const tags = tagCounts(rows);
  const conclusions: Conclusion[] = [];

  if (b.counted > 0) {
    const be = b.breakEven !== null ? ` Med snittodds ${fmt(b.avgOdds!)} räckte ${pctTxt(b.breakEven)} träff för att gå jämnt.` : "";
    conclusions.push({
      tone: b.units >= 0 ? "good" : "warn",
      title: `Du träffade ${b.hits} av ${b.bets} Bet och gick ${b.units >= 0 ? "plus" : "minus"} ${fmt(Math.abs(b.units))} enheter.`,
      text: `${signed(b.units)} enheter är ${b.kr >= 0 ? "+" : "−"}${Math.abs(b.kr)} kr med ${UNIT_KR} kr per spel. Målet är 50 % träff.${be}`,
      thin: false,
    });
  } else if (b.bets === 0) {
    const sp = rows.filter((r) => r.spelbar && r.hit !== null);
    if (sp.length) conclusions.push({ tone: "info", title: `Du spelade inga av dina ${sp.length} Spelbara.`, text: `${sp.filter((r) => r.hit).length} av dem gick topp 3.`, thin: false });
  }
  const bad = plays.filter((p) => p.quality === "bad");
  if (bad.length) {
    const names = bad.map((p) => p.horseName).join(", ");
    const hit = bad.filter((p) => p.hit).length;
    conclusions.push({
      tone: "warn",
      title: `${bad.length === 1 ? `${names} var veckans enda spel utan värde` : `${bad.length} spel var utan värde: ${names}`}, och ${hit === bad.length ? (bad.length === 1 ? "det satt" : "alla satt") : hit === 0 ? (bad.length === 1 ? "det missade" : "alla missade") : `${hit} satt`}.`,
      text: `Utan värde = Bet-oddset under riktoddset med X eller under ${fmt(GOOD_MIN_ODDS)}.`,
      thin: false,
    });
  }
  const missedHit = missed.filter((m) => m.hit);
  // Utan Bet säger den första slutsatsen redan hur det gick för Spelbara.
  if (missedHit.length && b.bets > 0) {
    const m = missedHit[0];
    conclusions.push({
      tone: "info",
      title: missedHit.length === 1 ? `Du spelade inte ${m.horseName}, som kom ${m.place ? ordinal(m.place) : "topp 3"}.` : `${missedHit.length} Spelbara du lät bli gick topp 3.`,
      text: `Alla Spelbara du inte spelade hade gett ${signed(missed.reduce((s, x) => s + x.units, 0))} enheter till Unibet-oddset vid start.`,
      thin: false,
    });
  }
  for (const g of groups) {
    if (g.support === "few") continue;
    if (g.verdict === "inline" && g.key !== "x") continue;
    conclusions.push({
      tone: g.verdict === "worse" ? "warn" : g.verdict === "better" ? "good" : "info",
      title: `${g.label}: ${g.hits} av ${g.n} topp 3${g.verdict === "better" ? ", bättre än väntat" : g.verdict === "worse" ? ", sämre än väntat" : ", i linje med riktoddset"}.`,
      text: `Riktoddset väntade ${fmt(g.expected, 1)}.`,
      thin: g.support === "thin",
    });
  }
  const topUnplaced = tags.unplaced.find((t) => t.count >= 2);
  if (topUnplaced) {
    conclusions.push({ tone: "info", title: `"${topUnplaced.tag}" fanns på ${topUnplaced.count} av dina hästar som inte kom topp 3.`, text: "Taggarna kommer från Tagga loppet.", thin: true });
  }
  return { board: b, conclusions, groups, plays, missed, missedUnits: round2(missed.reduce((s, x) => s + x.units, 0)), tags, pending: rows.filter((r) => r.hit === null).length };
}

// ---- Över tid ------------------------------------------------------------------------

export type RoundRows = { roundId: string; date: string; trackName: string; gameType: string; rows: AnalysisRow[] };
export type RoundLine = { roundId: string; date: string; trackName: string; gameType: string; bets: number; hits: number; units: number };
export type OverTime = {
  rounds: RoundLine[];
  board: Board;
  // Visas från 4 klara omgångar eller 20 Bet.
  enough: boolean;
  conclusions: Conclusion[];
  groups: Group[];
  trend: { recent: { hitPct: number | null; units: number }; before: { hitPct: number | null; units: number } } | null;
};

export const OVER_TIME_MIN_ROUNDS = 4;
export const OVER_TIME_MIN_BETS = 20;

export function overTime(rounds: RoundRows[]): OverTime {
  const all = rounds.flatMap((r) => r.rows);
  const b = board(all);
  const lines = rounds.map((r) => {
    const rb = board(r.rows);
    return { roundId: r.roundId, date: r.date, trackName: r.trackName, gameType: r.gameType, bets: rb.bets, hits: rb.hits, units: rb.units };
  });
  const enough = rounds.length >= OVER_TIME_MIN_ROUNDS || b.bets >= OVER_TIME_MIN_BETS;
  const groups = groupsOf(all, 6, 20);
  const conclusions: Conclusion[] = [];
  const betSupport = support(b.counted, 10, 40);
  if (b.counted > 0 && betSupport !== "few") {
    const hitPct = b.hits / b.bets;
    conclusions.push({
      tone: hitPct >= 0.5 && b.units >= 0 ? "good" : b.units < 0 ? "warn" : "info",
      title: `Bet träffar ${pctTxt(hitPct)} (${b.hits} av ${b.bets}), ${hitPct >= 0.5 ? "över" : "under"} målet 50 %.`,
      text: `Med snittodds ${fmt(b.avgOdds!)} går du jämnt vid ${pctTxt(b.breakEven!)}. Netto ${signed(b.units)} enheter, ${b.kr >= 0 ? "+" : "−"}${Math.abs(b.kr)} kr.`,
      thin: betSupport === "thin",
    });
  }
  // Spel under 2,00 mot från 2,00.
  const bets = all.filter((r) => r.bet && r.hit !== null && r.betOdds !== null);
  const low = bets.filter((r) => r.betOdds! < GOOD_MIN_ODDS);
  const high = bets.filter((r) => r.betOdds! >= GOOD_MIN_ODDS);
  const lowS = support(low.length, 6, 20);
  if (lowS !== "few") {
    const lu = board(low).units;
    const hu = board(high).units;
    conclusions.push({
      tone: lu < hu ? "warn" : "info",
      title: `Spel under 2,00: ${low.filter((r) => r.hit).length} av ${low.length} träff, ${signed(lu)} enheter.`,
      text: `Från 2,00: ${high.filter((r) => r.hit).length} av ${high.length} och ${signed(hu)}.`,
      thin: lowS === "thin",
    });
  }
  for (const g of groups) {
    if (g.support === "few") continue;
    conclusions.push({
      tone: g.verdict === "worse" ? "warn" : g.verdict === "better" ? "good" : "info",
      title: `${g.label} gav ${g.hits} av ${g.n} topp 3, ${g.verdict === "better" ? "bättre än" : g.verdict === "worse" ? "sämre än" : "i linje med"} riktoddset.`,
      text: `Väntat ${fmt(g.expected, 1)}.`,
      thin: g.support === "thin",
    });
  }
  const tc = tagCounts(all);
  const rate = (tag: string) => {
    const p = tc.placed.find((t) => t.tag === tag)?.count ?? 0;
    const u = tc.unplaced.find((t) => t.tag === tag)?.count ?? 0;
    return { p, n: p + u };
  };
  const base = tc.horses ? all.filter((r) => r.hit).length / tc.horses : 0;
  const tagLines = [...new Set([...tc.placed, ...tc.unplaced].map((t) => t.tag))]
    .map((tag) => ({ tag, ...rate(tag) }))
    .filter((t) => t.n >= 6)
    .sort((a, b2) => Math.abs(b2.p / b2.n - base) - Math.abs(a.p / a.n - base));
  if (tagLines[0]) {
    const t = tagLines[0];
    conclusions.push({
      tone: t.p / t.n < base ? "warn" : "info",
      title: `${t.tag}: ${t.p} av ${t.n} av dina hästar gick topp 3.`,
      text: `Alla dina hästar: ${pctTxt(base)} topp 3.`,
      thin: t.n < 15,
    });
  }
  // Trend: de 4 senaste mot de 4 före, från 8 omgångar och minst 10 Bet per halva.
  let trend: OverTime["trend"] = null;
  if (rounds.length >= 8) {
    const half = (rs: RoundRows[]) => {
      const bb = board(rs.flatMap((r) => r.rows));
      return { hitPct: bb.bets ? bb.hits / bb.bets : null, units: bb.units, bets: bb.bets };
    };
    const recent = half(rounds.slice(0, 4));
    const before = half(rounds.slice(4, 8));
    if (recent.bets >= 10 && before.bets >= 10) trend = { recent: { hitPct: recent.hitPct, units: recent.units }, before: { hitPct: before.hitPct, units: before.units } };
  }
  return { rounds: lines, board: b, enough, conclusions, groups, trend };
}

export const supportLabel = (s: Support) => (s === "thin" ? "Tunt underlag" : s === "few" ? "För lite underlag" : null);
