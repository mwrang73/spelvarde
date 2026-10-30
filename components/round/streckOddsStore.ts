"use client";

// Hämta streck och odds (specen e2.2 6.9) från klienten: en körning i taget
// per omgång, delad av tavelknappen (S1–S4), raden i S6 och Nästa steg i S1,
// så att lamporna och banderollen följer med om Mikael byter vy under
// hämtningen. Kedjan, jämförelsen och texterna är lib/streck-odds.ts.
//
// Banderollen visas i vyn där Mikael tryckte (origin) och tas bort när han
// lämnar den (StreckOddsRouteWatch i AppShell) eller stänger den.

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { rawPost } from "@/components/api";
import { useNow, useOnline } from "@/components/hooks";
import { useToast } from "@/components/ui/Toast";
import { odds } from "@/lib/format";
import { crossedUnderMax, unmarkedItems } from "@/lib/odds-ui";
import { recountRace, toleranceOf } from "@/lib/round-overlay";
import { bannerFor, boardView, idleOdds, idleStreck, runOdds, runStreck, summarize, type BannerModel, type BoardView, type OddsPart, type RunMode, type RunSummary, type StreckPart } from "@/lib/streck-odds";
import type { RoundResponse, UnibetUndoResponse } from "@/lib/types";
import { clearDetails, getRound, loadRound, patchRound } from "./roundStore";

export type StreckOddsRun = {
  roundId: string;
  origin: string;
  running: boolean;
  streck: StreckPart;
  odds: OddsPart;
  summary: RunSummary | null;
  banner: BannerModel | null;
  bannerOpen: boolean;
  finishedAt: number | null;
  // Starter som blev Spelbara vid hämtningen: taggen "Ny" i S4 tills vyn lämnas.
  newIds: string[];
};

// Starter som kom in under riktodds 5 vid den senaste hämtningen: taggen
// "Ny under 5" tills nästa hämtning. Sparas i webbläsaren per omgång.
const UNDER_KEY = (roundId: string) => `sv-under5-${roundId}`;
const underCache = new Map<string, string[]>();
const EMPTY_IDS: string[] = [];
function readUnder(roundId: string): string[] {
  if (!underCache.has(roundId)) {
    let ids: string[] = [];
    try {
      const raw = localStorage.getItem(UNDER_KEY(roundId));
      const v: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(v)) ids = v.filter((x): x is string => typeof x === "string");
    } catch {
      // ingen lagring
    }
    underCache.set(roundId, ids);
  }
  return underCache.get(roundId)!;
}
function writeUnder(roundId: string, ids: string[]) {
  underCache.set(roundId, ids);
  try {
    localStorage.setItem(UNDER_KEY(roundId), JSON.stringify(ids));
  } catch {
    // ingen lagring
  }
}
export function useUnderMaxIds(roundId: string): ReadonlySet<string> {
  const ids = useSyncExternalStore(
    subscribe,
    () => readUnder(roundId),
    () => EMPTY_IDS,
  );
  return new Set(ids);
}

const runs = new Map<string, StreckOddsRun>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
function set(roundId: string, patch: Partial<StreckOddsRun> | ((r: StreckOddsRun) => StreckOddsRun)) {
  const cur = runs.get(roundId);
  if (!cur) return;
  runs.set(roundId, typeof patch === "function" ? patch(cur) : { ...cur, ...patch });
  emit();
}

export function getRun(roundId: string): StreckOddsRun | null {
  return runs.get(roundId) ?? null;
}

export function useStreckOddsRun(roundId: string): StreckOddsRun | null {
  return useSyncExternalStore(
    subscribe,
    () => getRun(roundId),
    () => null,
  );
}

// Banderollen tas bort när Mikael lämnar vyn där han tryckte.
export function dismissOutside(pathname: string) {
  let changed = false;
  runs.forEach((r, id) => {
    if (r.bannerOpen && r.origin !== pathname) {
      runs.set(id, { ...r, bannerOpen: false });
      changed = true;
    }
  });
  if (changed) emit();
}

export function dismissBanner(roundId: string) {
  set(roundId, { bannerOpen: false });
}

// S4 lämnas: taggen "Ny" försvinner.
export function clearNew(roundId: string) {
  const r = runs.get(roundId);
  if (r?.newIds.length) set(roundId, { newIds: [] });
}

// En körning (eller omkörning av en del). Returnerar när allt är klart.
export async function runStreckOdds(roundId: string, mode: RunMode, origin: string): Promise<void> {
  const prev = runs.get(roundId);
  if (prev?.running) return;
  const before = getRound(roundId);
  if (!before) return;
  const legCount = before.races.length;
  const doStreck = mode.kind === "all" || mode.kind === "streck";
  const doOdds = mode.kind !== "streck";
  runs.set(roundId, {
    roundId,
    origin,
    running: true,
    streck: doStreck ? { ...idleStreck(), state: "running" } : prev?.streck ?? idleStreck(),
    odds: doOdds ? (mode.kind === "legs" && prev ? { ...prev.odds, state: "running" } : { ...idleOdds(legCount), state: "running" }) : prev?.odds ?? idleOdds(legCount),
    summary: null,
    banner: null,
    bannerOpen: false,
    finishedAt: null,
    newIds: [],
  });
  emit();

  const streckP = doStreck
    ? runStreck(rawPost, roundId).then((s) => {
        set(roundId, { streck: s });
        return s;
      })
    : Promise.resolve(prev?.streck ?? idleStreck());
  const oddsP = doOdds
    ? runOdds(rawPost, roundId, legCount, mode.kind === "legs" ? mode : { kind: "odds" }, (p) => set(roundId, { odds: p }), prev?.odds).then((o) => {
        set(roundId, { odds: o });
        return o;
      })
    : Promise.resolve(prev?.odds ?? idleOdds(legCount));
  const [streck, oddsPart] = await Promise.all([streckP, oddsP]);

  // Läs om omgången och jämför före och efter.
  let after: RoundResponse = before;
  try {
    after = await loadRound(roundId);
  } catch {
    // Offline eller fel: banderollen bygger på det som finns.
  }
  clearDetails();
  const legsThisRun = doOdds ? oddsPart.legs : [];
  const summary = summarize(before, after, legsThisRun);
  if (doStreck && streck.state === "ok") writeUnder(roundId, crossedUnderMax(before.races, after.races));
  const tolerance = toleranceOf(after.settings);
  const unmarked = unmarkedItems(after.races, Date.now(), tolerance).length;
  const shown = { streck: doStreck ? streck : { ...streck, state: streck.state === "ok" ? ("idle" as const) : streck.state }, odds: doOdds ? oddsPart : { ...oddsPart, state: "idle" as const }, summary };
  const banner = bannerFor(shown, { before, after, now: new Date(), unmarked, legCount });
  set(roundId, { running: false, streck, odds: oddsPart, summary, banner, bannerOpen: !!banner, finishedAt: Date.now(), newIds: summary.newIds });
}

// Ångra (6.9): återställer de egna odds som den senaste hämtningen ersatte.
export async function undoReplaced(roundId: string, fetchId: string, startId: string | null): Promise<{ ok: true; text: string } | { ok: false; text: string }> {
  let res: { status: number; data: unknown };
  try {
    res = await rawPost(`/api/rounds/${roundId}/unibet/${fetchId}/undo`, startId ? { startId } : {});
  } catch {
    return { ok: false, text: "Ingen uppkoppling. Försök igen när du är uppkopplad." };
  }
  const err = (res.data as { error?: string } | null)?.error;
  if (res.status === 404) return { ok: false, text: err ?? "Det finns inget att ångra." };
  if (res.status < 200 || res.status >= 300) return { ok: false, text: err ?? "Kunde inte ångra. Försök igen." };
  const body = res.data as UnibetUndoResponse;
  const marks = new Map(body.marks.map((m) => [m.startId, m]));
  let names: string[] = [];
  patchRound(roundId, (r) => {
    names = [];
    const races = r.races.map((race) => {
      if (!race.starts.some((s) => marks.has(s.id))) return race;
      return recountRace({
        ...race,
        starts: race.starts.map((s) => {
          const m = marks.get(s.id);
          if (!m) return s;
          names.push(s.horse.name);
          return { ...s, mark: m };
        }),
      });
    });
    return { ...r, races };
  });
  // Ångra-länkarna i banderollen försvinner för det som är återställt.
  const restored = new Set(body.restored.map((x) => x.startId));
  set(roundId, (cur) => {
    if (!cur.summary || !cur.banner) return cur;
    const replaced = cur.summary.replaced.filter((x) => !restored.has(x.startId));
    const undo = replaced.length === 1 ? { label: `Ångra för ${replaced[0].name}`, startId: replaced[0].startId } : replaced.length > 1 ? { label: `Ångra för alla (${replaced.length})`, startId: null } : null;
    return { ...cur, summary: { ...cur.summary, replaced }, banner: { ...cur.banner, undo } };
  });
  loadRound(roundId).catch(() => {});
  if (body.restored.length === 1) return { ok: true, text: `Ditt odds ${odds(body.restored[0].odds)} är tillbaka för ${names[0] ?? "hästen"}.` };
  if (body.restored.length > 1) return { ok: true, text: `Dina ${body.restored.length} odds är tillbaka.` };
  return { ok: false, text: "Det finns inget att ångra." };
}

// Ångra från en rad i S4 ("Ersatte ditt 3,10 · Ångra"), med toasten.
export function useUndoReplaced(roundId: string): (fetchId: string, startId: string | null) => void {
  const toast = useToast();
  return useCallback((fetchId: string, startId: string | null) => void undoReplaced(roundId, fetchId, startId).then((r) => toast({ text: r.text })), [roundId, toast]);
}

// Avdelningar klara i den pågående körningen (tavelknappens "3/8").
function progressOf(r: StreckOddsRun | null): { done: number; total: number } | null {
  if (!r?.running) return null;
  const total = r.odds.lamps.length;
  return { done: r.odds.lamps.filter((l) => l === "on" || l === "bad" || l === "started").length, total };
}

export type StreckOddsApi = {
  run: StreckOddsRun | null;
  view: BoardView;
  start: (mode?: RunMode) => void;
  undo: (startId: string | null, fetchId?: string | null) => void;
  dismiss: () => void;
  now: Date;
};

// Delad hämtningslogik för knappen, raden och Nästa steg.
export function useStreckOddsRefresh(data: RoundResponse): StreckOddsApi {
  const roundId = data.round.id;
  const run = useStreckOddsRun(roundId);
  const online = useOnline();
  const pathname = usePathname() ?? "/";
  const toast = useToast();
  // Varje sekund: nedräkningen i spärren och bocken i 10 s.
  const now = useNow(1000);
  const view = boardView({ gameType: data.round.gameType, online, now, latestStreckAt: data.latestStreck?.takenAt ?? null, latestOdds: data.latestOdds ?? null, lastOddsAttempt: data.lastOddsAttempt ?? null, run, progress: progressOf(run) });
  const start = useCallback(
    (mode?: RunMode) => {
      void runStreckOdds(roundId, mode ?? view.mode, pathname);
    },
    [roundId, view.mode, pathname],
  );
  const latestFetchId = data.latestOdds?.fetchId ?? null;
  const undo = useCallback(
    (startId: string | null, fetchId?: string | null) => {
      const fid = fetchId ?? latestFetchId;
      if (!fid) return;
      void undoReplaced(roundId, fid, startId).then((r) => toast({ text: r.text }));
    },
    [roundId, latestFetchId, toast],
  );
  const dismiss = useCallback(() => dismissBanner(roundId), [roundId]);
  return { run, view, start, undo, dismiss, now };
}

// I AppShell: banderollen försvinner när vyn byts.
export function StreckOddsRouteWatch() {
  const pathname = usePathname() ?? "/";
  useEffect(() => {
    dismissOutside(pathname);
  }, [pathname]);
  return null;
}
