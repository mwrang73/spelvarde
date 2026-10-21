// Hämta streck och odds (specen e2.2 6.9, Knappen, S6 och 12): två delar
// som körs parallellt från klienten.
//   - Strecket: POST /api/rounds/[id]/refresh och sedan …/riktodds.
//   - Unibets odds: POST …/unibet, högst 4 avdelningar samtidigt och sist …/finish.
// Varje del lyckas eller misslyckas för sig, och "Försök igen" gör bara om den
// del som misslyckades (för oddsen: bara de avdelningar som inte svarade).
//
// Ren logik utan React och DOM: anropen skickas in (som lib/fetch-chain.ts),
// så att kedjan, jämförelsen före och efter, banderollen, tavelknappens lägen
// och nedräkningen testas i lib/streck-odds.test.ts.

import type { StreckRefreshResult } from "@/lib/fetch-round";
import { odds, plural, relTime } from "@/lib/format";
import { stockholmDateString, stockholmParts } from "@/lib/stockholm-time";
import type { RoundResponse, UnibetFinishResponse, UnibetLegResponse, UnibetStartResponse } from "@/lib/types";
import { ODDS_LOCK_MS, ODDS_STALE_MS } from "@/lib/unibet";

export type Post = (url: string, body?: unknown) => Promise<{ status: number; data: unknown }>;

// Samma gräns för strecket som för oddsen (6.9).
export const STRECK_STALE_MS = ODDS_STALE_MS;
export const ODDS_PARALLEL = 4;
// Bocken i tavelknappen efter en lyckad hämtning.
export const DONE_MS = 10_000;
// Serverns text vid 409 när loppet har startat (lib/unibet-server.ts).
const RACE_STARTED = "Loppet har startat";

export type LegLamp = "off" | "cur" | "on" | "bad" | "started";

export type StreckPart = {
  state: "idle" | "running" | "ok" | "failed";
  result: StreckRefreshResult | null;
  error: string | null;
};

export type OddsPart = {
  // ok = sparad och alla avdelningar som kunde hämtas svarade. partial = sparad
  // men några avdelningar svarade inte. noOdds = Unibet hade inga odds (eller
  // banan fanns inte), inget sparades. locked = spärren (429).
  state: "idle" | "running" | "ok" | "partial" | "failed" | "noOdds" | "locked";
  fetchId: string | null;
  takenAt: string | null;
  // En lampa per avdelning (index = avd − 1).
  lamps: LegLamp[];
  legs: UnibetLegResponse[];
  failedLegs: number[];
  startedLegs: number[];
  withOdds: number;
  retryAfterSec: number | null;
  error: string | null;
};

export const idleStreck = (): StreckPart => ({ state: "idle", result: null, error: null });
export const idleOdds = (legCount: number): OddsPart => ({ state: "idle", fetchId: null, takenAt: null, lamps: Array(legCount).fill("off"), legs: [], failedLegs: [], startedLegs: [], withOdds: 0, retryAfterSec: null, error: null });

// Vad ett tryck gör: allt, en del, eller bara avdelningarna som inte svarade.
export type RunMode = { kind: "all" } | { kind: "streck" } | { kind: "odds" } | { kind: "legs"; fetchId: string; legs: number[] };

const errorOf = (data: unknown): string | null =>
  data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : null;
const ok2xx = (s: number) => s >= 200 && s < 300;

async function safePost(post: Post, url: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  try {
    return await post(url, body);
  } catch {
    return { status: 0, data: null };
  }
}

export const ATG_DOWN = "ATG svarade inte.";
export const UNIBET_DOWN = "Unibet svarade inte.";

// ---- Strecket ---------------------------------------------------------------------------

export async function runStreck(post: Post, roundId: string): Promise<StreckPart> {
  const r = await safePost(post, `/api/rounds/${roundId}/refresh`);
  if (!ok2xx(r.status)) return { state: "failed", result: null, error: r.status === 0 || r.status >= 500 ? ATG_DOWN : errorOf(r.data) ?? ATG_DOWN };
  const result = r.data as StreckRefreshResult;
  const k = await safePost(post, `/api/rounds/${roundId}/riktodds`);
  if (!ok2xx(k.status)) return { state: "failed", result, error: "Riktoddset kunde inte räknas om." };
  return { state: "ok", result, error: null };
}

// ---- Unibets odds -----------------------------------------------------------------------

// Kör avdelningarna med högst `limit` samtidigt.
async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const x = items[i++];
      await fn(x);
    }
  });
  await Promise.all(workers);
}

// prev = förra körningen av oddsdelen (vid omkörning av avdelningar).
export async function runOdds(post: Post, roundId: string, legCount: number, mode: { kind: "odds" } | { kind: "legs"; fetchId: string; legs: number[] }, onProgress: (p: OddsPart) => void = () => {}, prev?: OddsPart): Promise<OddsPart> {
  const p: OddsPart = mode.kind === "legs" && prev ? { ...prev, lamps: [...prev.lamps], legs: [...prev.legs], failedLegs: [...prev.failedLegs], state: "running", error: null } : { ...idleOdds(legCount), state: "running" };
  const emit = () => onProgress({ ...p, lamps: [...p.lamps] });
  let todo: number[];
  if (mode.kind === "legs") {
    p.fetchId = mode.fetchId;
    todo = mode.legs;
    for (const l of todo) p.lamps[l - 1] = "off";
  } else {
    emit();
    const r = await safePost(post, `/api/rounds/${roundId}/unibet`);
    if (r.status === 429) {
      const sec = Number((r.data as { retryAfterSec?: unknown } | null)?.retryAfterSec);
      return { ...p, state: "locked", retryAfterSec: Number.isFinite(sec) ? sec : Math.round(ODDS_LOCK_MS / 1000), error: errorOf(r.data) };
    }
    if (!ok2xx(r.status)) return { ...p, state: "failed", lamps: p.lamps.map(() => "bad"), failedLegs: Array.from({ length: legCount }, (_, i) => i + 1), error: errorOf(r.data) ?? UNIBET_DOWN };
    const start = r.data as UnibetStartResponse;
    if (start.fetchId === null) return { ...p, state: "noOdds" };
    p.fetchId = start.fetchId;
    p.takenAt = start.takenAt;
    todo = [];
    for (const l of start.legs) {
      if (l.skipped === "started") {
        p.lamps[l.leg - 1] = "started";
        p.startedLegs.push(l.leg);
      } else if (!l.eventKey) {
        // Loppet finns inte hos Unibet: räknas som en avdelning som inte svarade.
        p.lamps[l.leg - 1] = "bad";
        p.failedLegs.push(l.leg);
      } else todo.push(l.leg);
    }
  }
  emit();

  await pool(todo, ODDS_PARALLEL, async (leg) => {
    p.lamps[leg - 1] = "cur";
    emit();
    const r = await safePost(post, `/api/rounds/${roundId}/unibet/${p.fetchId}/legs/${leg}`);
    const res = r.data as UnibetLegResponse | null;
    p.legs = p.legs.filter((x) => x.leg !== leg);
    p.failedLegs = p.failedLegs.filter((x) => x !== leg);
    if (ok2xx(r.status) && res) {
      p.lamps[leg - 1] = "on";
      p.legs.push(res);
    } else if (r.status === 409 && errorOf(r.data) === RACE_STARTED) {
      p.lamps[leg - 1] = "started";
      if (!p.startedLegs.includes(leg)) p.startedLegs.push(leg);
    } else {
      p.lamps[leg - 1] = "bad";
      p.failedLegs.push(leg);
    }
    emit();
  });
  p.failedLegs.sort((a, b) => a - b);
  p.startedLegs.sort((a, b) => a - b);

  const f = await safePost(post, `/api/rounds/${roundId}/unibet/${p.fetchId}/finish`);
  const fin = f.data as UnibetFinishResponse | null;
  const anyOk = p.legs.some((l) => l.ok);
  if (!ok2xx(f.status) || !fin) return { ...p, state: anyOk ? "partial" : "failed", error: errorOf(f.data) ?? UNIBET_DOWN };
  if (!fin.saved) {
    // Inget sparades: hämtningen är borttagen på servern och räknas inte mot spärren.
    const failed = p.failedLegs.length > 0 && !anyOk;
    return { ...p, fetchId: null, state: failed ? "failed" : "noOdds", error: failed ? UNIBET_DOWN : null };
  }
  return { ...p, takenAt: fin.takenAt, withOdds: fin.withOdds, state: p.failedLegs.length ? "partial" : "ok" };
}

// ---- Jämförelsen före och efter ---------------------------------------------------------

export type Change = { key: string; text: string };
export type HorseRef = { startId: string; leg: number; number: number; name: string };

export type RunSummary = {
  newSpelbar: Change[];
  lostSpelbar: Change[];
  replaced: (HorseRef & { from: number; to: number | null })[];
  missing: HorseRef[];
  scratchedAtUnibet: HorseRef[];
  // Starter som blev Spelbara vid hämtningen (taggen "Ny" i S4).
  newIds: string[];
};

const label = (leg: number, number: number, name: string) => `Avd ${leg} · ${number} ${name}`;

// Spelbar per häst före och efter (som diff i den tidigare StreckRefresh), och
// det som Unibets avdelningar rapporterade.
export function summarize(before: RoundResponse, after: RoundResponse, legs: UnibetLegResponse[]): RunSummary {
  const old = new Map(before.races.flatMap((r) => r.starts.map((s) => [s.id, s] as const)));
  const byId = new Map<string, HorseRef>();
  const byNumber = new Map<string, HorseRef>();
  const newSpelbar: Change[] = [];
  const lostSpelbar: Change[] = [];
  const newIds: string[] = [];
  for (const race of after.races)
    for (const s of race.starts) {
      const ref = { startId: s.id, leg: race.leg, number: s.number, name: s.horse.name };
      byId.set(s.id, ref);
      byNumber.set(`${race.leg}:${s.number}`, ref);
      const o = old.get(s.id);
      if (!o) continue;
      const was = !!o.mark?.spelbar;
      const now = !!s.mark?.spelbar;
      if (!was && now) {
        newSpelbar.push({ key: `n-${s.id}`, text: `${label(race.leg, s.number, s.horse.name)}: nu Spelbar` });
        newIds.push(s.id);
      } else if (was && !now) lostSpelbar.push({ key: `l-${s.id}`, text: `${label(race.leg, s.number, s.horse.name)}: inte längre Spelbar` });
    }
  const refOf = (leg: number, n: number): HorseRef => byNumber.get(`${leg}:${n}`) ?? { startId: `${leg}:${n}`, leg, number: n, name: `nr ${n}` };
  const sorted = [...legs].sort((a, b) => a.leg - b.leg);
  return {
    newSpelbar,
    lostSpelbar,
    newIds,
    replaced: sorted.flatMap((l) => l.replaced.map((r) => ({ ...(byId.get(r.startId) ?? { startId: r.startId, leg: l.leg, number: 0, name: "häst" }), from: r.from, to: r.to }))),
    missing: sorted.flatMap((l) => l.missing.map((n) => refOf(l.leg, n))),
    scratchedAtUnibet: sorted.flatMap((l) => l.scratchedAtUnibet.map((n) => refOf(l.leg, n))),
  };
}

// Listan i "Visa vilka".
export function changeList(s: RunSummary): Change[] {
  return [
    ...s.newSpelbar,
    ...s.lostSpelbar,
    ...s.replaced.map((r) => ({ key: `r-${r.startId}`, text: `${label(r.leg, r.number, r.name)}: ditt ${odds(r.from)} ersattes av ${r.to === null ? "inget odds" : odds(r.to)}` })),
    ...s.missing.map((r) => ({ key: `m-${r.startId}`, text: `${label(r.leg, r.number, r.name)}: fanns inte hos Unibet` })),
    ...s.scratchedAtUnibet.map((r) => ({ key: `s-${r.startId}`, text: `${label(r.leg, r.number, r.name)}: struken hos Unibet` })),
  ];
}

// ---- Texter ---------------------------------------------------------------------------------

// "Avd 6 och 8", "Avd 1–3", "Avd 2, 4 och 7". lower = "avd …".
export function legsText(legs: number[], lower = false): string {
  const xs = [...new Set(legs)].sort((a, b) => a - b);
  if (!xs.length) return "";
  // Tre eller fler i följd skrivs som ett spann ("1–3").
  const parts: string[] = [];
  for (let i = 0; i < xs.length; ) {
    let j = i;
    while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
    if (j - i >= 2) parts.push(`${xs[i]}–${xs[j]}`);
    else for (let k = i; k <= j; k++) parts.push(String(xs[k]));
    i = j + 1;
  }
  const body = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} och ${parts[parts.length - 1]}`;
  return `${lower ? "avd" : "Avd"} ${body}`;
}

// Nedräkningen i bild: "1:42".
export function countdownClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
// "1 min 42 s" (hjälptexten i S6).
export function countdownShort(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return [m ? `${m} min` : "", r || !m ? `${r} s` : ""].filter(Boolean).join(" ");
}
// "1 minut 42 sekunder" (aria-label).
export function countdownSpoken(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return [m ? `${m} ${m === 1 ? "minut" : "minuter"}` : "", r || !m ? `${r} ${r === 1 ? "sekund" : "sekunder"}` : ""].filter(Boolean).join(" ");
}

// Sekunder kvar av spärren (2 min från senaste sparade ögonblicksbild).
export function lockLeftSec(takenAt: string | null | undefined, now: number): number {
  if (!takenAt) return 0;
  const left = ODDS_LOCK_MS - (now - Date.parse(takenAt));
  return left > 0 ? Math.min(Math.ceil(left / 1000), ODDS_LOCK_MS / 1000) : 0;
}

// "för 5 min sedan", "för 14 timmar sedan", "nyss".
export function agoText(ms: number): string {
  if (ms < 60_000) return "nyss";
  if (ms < 3600_000) return `för ${Math.round(ms / 60_000)} min sedan`;
  const h = Math.round(ms / 3600_000);
  return `för ${h} ${h === 1 ? "timme" : "timmar"} sedan`;
}

// Värdet i tavelknappen: "21:05" i dag, annars "tors 21:05".
export function boardTime(iso: string, now: Date): string {
  const p = stockholmParts(new Date(iso));
  const t = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  return stockholmDateString(new Date(iso)) === stockholmDateString(now) ? t : `${p.weekdayShort} ${t}`;
}

// "tors 18:02" (listan i hästkortet och kurvans rubrik).
export function weekdayTime(iso: string): string {
  const p = stockholmParts(new Date(iso));
  return `${p.weekdayShort} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

// ---- Banderollen ---------------------------------------------------------------------------

export type BannerModel = {
  tone: "ok" | "info" | "warn" | "err";
  head: string;
  text: string;
  retry: { label: string; mode: RunMode; icon: "dl" | "refresh" } | null;
  // Ångra för ett ersatt odds (startId) eller alla (startId null).
  undo: { label: string; startId: string | null } | null;
  unmarked: number;
  changes: Change[];
};

export type RunState = { streck: StreckPart; odds: OddsPart; summary: RunSummary | null };

// before = omgången före trycket (för "Oddsen är från tors 18:02").
export function bannerFor(run: RunState, ctx: { before: RoundResponse; after: RoundResponse; now: Date; unmarked: number; legCount: number }): BannerModel | null {
  const { streck: s, odds: o, summary } = run;
  const sum = summary ?? { newSpelbar: [], lostSpelbar: [], replaced: [], missing: [], scratchedAtUnibet: [], newIds: [] };
  const gameType = ctx.after.round.gameType;
  const sOk = s.state === "ok";
  const sFail = s.state === "failed";
  const oSaved = o.state === "ok" || o.state === "partial";
  const oFail = o.state === "failed";
  const prevOdds = ctx.before.latestOdds?.takenAt ?? null;
  const prevStreck = ctx.before.latestStreck?.takenAt ?? null;
  const changes = changeList(sum);

  const nNew = sum.newSpelbar.length;
  const newText = nNew ? `${plural(nNew, "ny Spelbar", "nya Spelbara")}.` : "Inga nya Spelbara.";
  const withOdds = `${o.withOdds} hästar fick odds`;
  const r = sum.replaced;
  const replacedText = r.length === 1 ? `1 odds du skrev in ersattes: ${r[0].name} ${odds(r[0].from)} blev ${r[0].to === null ? "inget odds" : odds(r[0].to)}.` : r.length > 1 ? `${r.length} odds du skrev in ersattes.` : "";
  const ch = s.result?.changes;
  const atg = ch ? [ch.scratched.length ? plural(ch.scratched.length, "struken", "strukna") : "", ch.driverChanges.length ? plural(ch.driverChanges.length, "kuskbyte", "kuskbyten") : ""].filter(Boolean).join(", ") : "";
  const resume = s.result?.needsResume ? "Några avdelningar behöver hämtas om: tryck Slutför hämtningen." : "";
  const startedLine = o.startedLegs.length ? `${legsText(o.startedLegs)} har startat och hämtades inte.${prevOdds ? ` Deras odds är från ${relTime(prevOdds, ctx.now)}.` : ""}` : "";
  const undo = r.length === 1 ? { label: `Ångra för ${r[0].name}`, startId: r[0].startId } : r.length > 1 ? { label: `Ångra för alla (${r.length})`, startId: null } : null;
  const join = (...xs: string[]) => xs.filter(Boolean).join(" ");
  const extras = { undo: oSaved ? undo : null, unmarked: oSaved ? ctx.unmarked : 0, changes: oSaved || sOk ? changes : [] };

  if (sFail && oFail)
    return { tone: "err", head: `Varken ATG eller Unibet svarade.`, text: "Inget ändrades. Försök igen om en stund.", retry: { label: "Försök igen", mode: { kind: "all" }, icon: "dl" }, undo: null, unmarked: 0, changes: [] };

  if (sFail && oSaved)
    return {
      tone: "warn",
      head: "Oddsen är hämtade, men ATG svarade inte.",
      text: join(`${withOdds}, ${nNew ? plural(nNew, "ny Spelbar", "nya Spelbara") : "inga nya Spelbara"}.`, replacedText, prevStreck ? `Strecket och riktoddset är från ${relTime(prevStreck, ctx.now)}.` : "Strecket finns inte än.", o.state === "partial" ? `Unibet: ${legsText(o.failedLegs)} svarade inte.` : "", startedLine),
      retry: { label: "Hämta strecket igen", mode: { kind: "streck" }, icon: "refresh" },
      ...extras,
    };

  if (sFail)
    return {
      tone: "warn",
      head: "ATG svarade inte.",
      text: join(o.state === "noOdds" ? `Unibet har inga odds för ${gameType} än, de brukar komma på torsdagen.` : "", prevStreck ? `Strecket och riktoddset är från ${relTime(prevStreck, ctx.now)}.` : ""),
      retry: { label: "Hämta strecket igen", mode: { kind: "streck" }, icon: "refresh" },
      undo: null,
      unmarked: 0,
      changes: [],
    };

  // Strecket gick (eller kördes inte den här gången).
  const streckHead = sOk ? "Strecket är uppdaterat." : "";
  if (oFail)
    return {
      tone: "warn",
      head: sOk ? "Strecket är uppdaterat, men Unibet svarade inte." : "Unibet svarade inte.",
      text: join(prevOdds ? `Oddsen är från ${relTime(prevOdds, ctx.now)}.` : "Inga odds är hämtade än.", atg ? `${atg}.` : "", resume),
      retry: { label: "Hämta oddsen igen", mode: { kind: "odds" }, icon: "dl" },
      undo: null,
      unmarked: 0,
      changes: sOk ? changes : [],
    };
  if (o.state === "locked")
    return { tone: "info", head: streckHead || "Nyss hämtat.", text: join(o.error ?? "Nyss hämtat. Försök igen om en stund.", atg ? `${atg}.` : ""), retry: null, undo: null, unmarked: 0, changes: sOk ? changes : [] };
  if (o.state === "noOdds")
    return { tone: "info", head: streckHead || "Unibet har inga odds än.", text: join(`Unibet har inga odds för ${gameType} än, de brukar komma på torsdagen. Inga odds sparades.`, atg ? `${atg}.` : "", resume), retry: null, undo: null, unmarked: 0, changes: sOk ? changes : [] };
  if (o.state === "partial") {
    const total = ctx.legCount - o.startedLegs.length;
    const got = total - o.failedLegs.length;
    return {
      tone: "warn",
      head: join(streckHead, `Unibet: ${got} av ${total} avdelningar.`),
      text: join(`${legsText(o.failedLegs)} svarade inte. Det som hämtades är sparat.`, `${withOdds}${nNew ? `, ${plural(nNew, "ny Spelbar", "nya Spelbara")}.` : ". Inga nya Spelbara."}`, replacedText, startedLine),
      retry: o.fetchId ? { label: `Hämta ${legsText(o.failedLegs, true)}`, mode: { kind: "legs", fetchId: o.fetchId, legs: o.failedLegs }, icon: "dl" } : { label: "Hämta oddsen igen", mode: { kind: "odds" }, icon: "dl" },
      ...extras,
    };
  }
  if (o.state === "ok") {
    const miss = sum.missing.length;
    const scr = sum.scratchedAtUnibet.length;
    if (miss || scr) {
      const parts = [miss ? `${plural(miss, "häst", "hästar")} fanns inte hos Unibet och har kvar sina tidigare odds.` : "", scr ? `${scr} ${scr === 1 ? "är struken" : "är strukna"} hos Unibet.` : ""];
      return { tone: "warn", head: `${withOdds}.`, text: join(...parts, newText, replacedText, atg ? `${atg}.` : "", resume, startedLine), retry: null, ...extras };
    }
    return { tone: "ok", head: sOk ? "Streck och odds hämtade." : "Oddsen är hämtade.", text: join(`${withOdds}${nNew ? `, ${plural(nNew, "ny Spelbar", "nya Spelbara")}.` : ". Inga nya Spelbara."}`, replacedText, atg ? `${atg}.` : "", resume, startedLine), retry: null, ...extras };
  }
  // Bara strecket kördes (omkörning).
  if (sOk)
    return { tone: "ok", head: "Strecket är uppdaterat.", text: join(nNew ? `${plural(nNew, "ny Spelbar", "nya Spelbara")}.` : "", atg ? `${atg}.` : "", resume), retry: null, undo: null, unmarked: 0, changes };
  return null;
}

// ---- Tavelknappen ---------------------------------------------------------------------------

export type BoardKind = "never" | "idle" | "busy" | "done" | "wait" | "sOnly" | "uOnly" | "part" | "none" | "err" | "old" | "off";

export type BoardView = {
  kind: BoardKind;
  value: string;
  expl: string;
  aria: string;
  // Klass på knappen: none/wt = dämpat värde, old = gul, err = röd.
  tone: "" | "none" | "wt" | "old" | "err";
  dot: boolean;
  disabled: boolean;
  icon: "dl" | "spin" | "clock";
  check: boolean;
  // Vad ett tryck gör.
  mode: RunMode;
  lockSec: number;
};

export type BoardInput = {
  online: boolean;
  now: Date;
  latestStreckAt: string | null;
  latestOdds: RoundResponse["latestOdds"];
  lastOddsAttempt: RoundResponse["lastOddsAttempt"];
  run: (RunState & { running: boolean; finishedAt: number | null }) | null;
  // Avdelningar klara/totalt under en körning.
  progress: { done: number; total: number } | null;
};

// Läget i tavelknappen enligt tabellen i specen (Knappen). Ordning: offline,
// hämtar, misslyckade delar (gör om bara dem), klart, spärr, inga odds än,
// äldre än 12 timmar, inte hämtat än, viloläge.
export function boardView(i: BoardInput): BoardView {
  const now = i.now.getTime();
  const oddsAt = i.latestOdds?.takenAt ?? null;
  const times = [i.latestStreckAt, oddsAt].filter((x): x is string => !!x);
  const oldest = times.length ? times.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b)) : null;
  const value = oldest ? boardTime(oldest, i.now) : "Hämta";
  const age = oldest ? now - Date.parse(oldest) : null;
  const rel = oldest ? relTime(oldest, i.now) : "";
  const lockSec = lockLeftSec(oddsAt, now);
  const base = { value, dot: false, disabled: false, icon: "dl" as const, check: false, mode: { kind: "all" } as RunMode, lockSec, tone: "" as BoardView["tone"] };
  const r = i.run;

  if (!i.online) return { ...base, kind: "off", expl: "offline", aria: "Ingen uppkoppling", disabled: true };
  if (r?.running) {
    const p = i.progress;
    return { ...base, kind: "busy", value: p ? `${p.done}/${p.total}` : "…", expl: r.odds.state === "running" ? "hämtar odds" : "hämtar streck", aria: p ? `Hämtar streck och odds, avdelning ${Math.min(p.done + 1, p.total)} av ${p.total}` : "Hämtar streck och odds", disabled: true, icon: "spin" };
  }
  if (r) {
    const sFail = r.streck.state === "failed";
    const oFail = r.odds.state === "failed";
    if (sFail && oFail) return { ...base, kind: "err", expl: "försök igen", aria: "Hämtningen misslyckades. Försök igen", tone: "err", dot: true };
    if (oFail && r.streck.state !== "idle") return { ...base, kind: "sOnly", expl: "oddsen misslyckades", aria: "Strecket hämtades, Unibets odds misslyckades. Tryck för att försöka igen", tone: "old", dot: true, mode: { kind: "odds" } };
    if (oFail) return { ...base, kind: "sOnly", expl: "oddsen misslyckades", aria: "Unibets odds misslyckades. Tryck för att försöka igen", tone: "old", dot: true, mode: { kind: "odds" } };
    if (sFail) return { ...base, kind: "uOnly", expl: "strecket misslyckades", aria: r.odds.state === "ok" || r.odds.state === "partial" ? "Oddsen hämtades, strecket misslyckades. Tryck för att försöka igen" : "Strecket misslyckades. Tryck för att försöka igen", tone: "old", dot: true, mode: { kind: "streck" } };
    if (r.odds.state === "partial" && r.odds.fetchId)
      return { ...base, kind: "part", expl: "odds delvis", aria: `Strecket hämtades, Unibets odds för ${legsText(r.odds.failedLegs, true)} misslyckades. Tryck för att försöka igen`, tone: "old", dot: true, mode: { kind: "legs", fetchId: r.odds.fetchId, legs: r.odds.failedLegs } };
    if (r.finishedAt !== null && now - r.finishedAt < DONE_MS && (r.odds.state === "ok" || (r.odds.state === "idle" && r.streck.state === "ok")))
      return { ...base, kind: "done", expl: "nyss", aria: `Streck och odds hämtade ${rel}`, check: true, disabled: lockSec > 0 };
  }
  if (lockSec > 0) return { ...base, kind: "wait", value: `om ${countdownClock(lockSec)}`, expl: "nyss hämtat", aria: `Nyss hämtat. Nästa hämtning om ${countdownSpoken(lockSec)}`, tone: "wt", disabled: true, icon: "clock" };
  const att = i.lastOddsAttempt;
  const noOddsYet = (r?.odds.state === "noOdds") || (!!att && (att.outcome === "noOdds" || att.outcome === "noMeeting") && (!oddsAt || Date.parse(att.at) > Date.parse(oddsAt)));
  const stale = age !== null && age > STRECK_STALE_MS;
  if (stale) {
    const h = Math.round(age! / 3600_000);
    return { ...base, kind: "old", expl: `${h} tim`, aria: `Streck och odds från ${rel}, äldre än 12 timmar. Hämta igen`, tone: "old", dot: true };
  }
  if (noOddsYet) return { ...base, kind: "none", expl: "inga odds än", aria: "Strecket hämtat. Unibet har inga odds än", tone: "none" };
  if (!oldest) return { ...base, kind: "never", expl: "inte hämtat än", aria: "Hämta streck och odds. Inte hämtat än", tone: "none" };
  return { ...base, kind: "idle", expl: agoText(age!), aria: `Hämta streck och odds. Senast ${rel}` };
}

// Odds från den senaste ögonblicksbilden är äldre än 12 timmar, eller saknas (Nästa steg i S1).
export function needsOddsFetch(latestOdds: RoundResponse["latestOdds"], now: number): boolean {
  return !latestOdds || now - Date.parse(latestOdds.takenAt) > ODDS_STALE_MS;
}
