// Klientcachen för omgångar (specen 9.1). Ett modulglobalt lager som
// överlever sidbyten i appen, med kopia i localStorage ("sv-round-<id>") så
// att appen startar direkt och fungerar offline. Komponenterna läser med
// useSyncExternalStore (useRoundData i RoundProvider), och utkorgen skriver
// in bekräftade ändringar här även när omgången inte visas.
//
// Hästkortets tunga delar (GET /api/starts/[id]) ligger i ett eget lager
// i minnet: en hämtning per start, förhandsladdning för grannhästarna.

import { apiGet } from "@/components/api";
import type { CommentDto, CurrentRoundResponse, RoundResponse, StartDetailResponse } from "@/lib/types";

type Listener = () => void;

const ROUND_KEY = (id: string) => `sv-round-${id}`;
const INDEX_KEY = "sv-round-index";
const CURRENT_KEY = "sv-current";
const KEEP_ROUNDS = 3;

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Full eller blockerad lagring: cachen finns kvar i minnet.
  }
}
function storageRemove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignoreras
  }
}

// ---- Omgångar -------------------------------------------------------------------------

const rounds = new Map<string, RoundResponse | null>();
const roundListeners = new Set<Listener>();

function isRound(x: unknown): x is RoundResponse {
  return !!x && typeof x === "object" && Array.isArray((x as RoundResponse).races) && typeof (x as RoundResponse).round?.id === "string";
}

export function subscribeRounds(fn: Listener): () => void {
  roundListeners.add(fn);
  return () => roundListeners.delete(fn);
}
const emitRounds = () => roundListeners.forEach((fn) => fn());

export function getRound(id: string): RoundResponse | null {
  if (rounds.has(id)) return rounds.get(id) ?? null;
  if (typeof window === "undefined") return null;
  let data: RoundResponse | null = null;
  const raw = storageGet(ROUND_KEY(id));
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      data = isRound(parsed) ? parsed : null;
    } catch {
      data = null;
    }
  }
  rounds.set(id, data);
  return data;
}

export function setRound(id: string, data: RoundResponse) {
  rounds.set(id, data);
  storageSet(ROUND_KEY(id), JSON.stringify(data));
  // Behåll bara de senaste omgångarna i lagringen.
  let index: string[] = [];
  try {
    const parsed: unknown = JSON.parse(storageGet(INDEX_KEY) ?? "[]");
    index = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    index = [];
  }
  index = [id, ...index.filter((x) => x !== id)];
  for (const old of index.slice(KEEP_ROUNDS)) storageRemove(ROUND_KEY(old));
  storageSet(INDEX_KEY, JSON.stringify(index.slice(0, KEEP_ROUNDS)));
  emitRounds();
}

export function patchRound(id: string, fn: (data: RoundResponse) => RoundResponse) {
  const data = getRound(id);
  if (!data) return;
  const next = fn(data);
  if (next !== data) setRound(id, next);
}

const inflight = new Map<string, Promise<RoundResponse>>();

// Hämtar hela omgången från servern och lägger den i cachen.
export function loadRound(id: string): Promise<RoundResponse> {
  const running = inflight.get(id);
  if (running) return running;
  const p = apiGet<RoundResponse>(`/api/rounds/${id}`)
    .then((data) => {
      setRound(id, data);
      if (data.isCurrent) setCurrentId(id);
      return data;
    })
    .finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

// ---- Aktuell omgång (S1 på "/") -----------------------------------------------------

export function getCurrentId(): string | null {
  return typeof window === "undefined" ? null : storageGet(CURRENT_KEY);
}
export function setCurrentId(id: string | null) {
  if (id) storageSet(CURRENT_KEY, id);
  else storageRemove(CURRENT_KEY);
}

let current: CurrentRoundResponse | null = null;

// Senaste svaret från /api/rounds/current i den här sidladdningen.
export const getCurrent = () => current;

export async function loadCurrent(): Promise<CurrentRoundResponse> {
  const res = await apiGet<CurrentRoundResponse>("/api/rounds/current");
  setCurrentId(res.round?.id ?? null);
  current = res;
  emitRounds();
  return res;
}

// ---- Hästkortet ------------------------------------------------------------------------

export type DetailEntry = { data: StartDetailResponse | null; error: string | null; loading: boolean };

const details = new Map<string, DetailEntry>();
const detailListeners = new Set<Listener>();
const EMPTY_DETAIL: DetailEntry = { data: null, error: null, loading: false };

export function subscribeDetails(fn: Listener): () => void {
  detailListeners.add(fn);
  return () => detailListeners.delete(fn);
}
const emitDetails = () => detailListeners.forEach((fn) => fn());

export function getDetail(startId: string): DetailEntry {
  return details.get(startId) ?? EMPTY_DETAIL;
}

function setDetail(startId: string, entry: DetailEntry) {
  details.set(startId, entry);
  emitDetails();
}

// Hämtar hästkortet om det inte redan finns (force = hämta om).
export function loadDetail(startId: string, force = false): void {
  const cur = details.get(startId);
  if (cur?.loading || (cur?.data && !force)) return;
  setDetail(startId, { data: cur?.data ?? null, error: null, loading: true });
  apiGet<StartDetailResponse>(`/api/starts/${startId}`)
    .then((data) => setDetail(startId, { data, error: null, loading: false }))
    .catch((e: unknown) => setDetail(startId, { data: cur?.data ?? null, error: e instanceof Error ? e.message : "Kunde inte hämta hästkortet.", loading: false }));
}

// Förhandsladdar grannhästarna när webbläsaren har tid över.
export function prefetchDetails(startIds: string[]) {
  if (typeof window === "undefined") return;
  const todo = startIds.filter((id) => !details.has(id));
  if (!todo.length) return;
  const run = () => todo.forEach((id) => loadDetail(id));
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(run, { timeout: 3000 });
  else window.setTimeout(run, 400);
}

// Efter Hämta igen kan tidigare starter ha ändrats.
export function clearDetails() {
  if (!details.size) return;
  details.clear();
  emitDetails();
}

// Kommentarerna följer hästen: en bekräftad ändring skrivs in i alla
// hästkort i cachen för samma häst.
export function patchHorseComments(horseId: string, fn: (comments: CommentDto[]) => CommentDto[]) {
  let changed = false;
  details.forEach((entry, startId) => {
    if (entry.data?.start.horse.id !== horseId) return;
    const comments = fn(entry.data.comments);
    if (comments === entry.data.comments) return;
    details.set(startId, { ...entry, data: { ...entry.data, comments } });
    changed = true;
  });
  if (changed) emitDetails();
}
