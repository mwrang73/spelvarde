// Validering av kroppar till de skrivande rutterna. Rena funktioner: ger
// antingen { ok: true, value } eller { ok: false, error } med en svensk mening.
import { GAME_TYPE_ERROR, isGameType, type GameType } from "@/lib/game-type";
import type { ThemeSetting } from "@/lib/types";
import { parseFactor } from "@/lib/xfactor";
import { TOLERANCE_ERROR, TOLERANCE_MAX, TOLERANCE_MIN } from "@/lib/spelbar";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (x: unknown): x is string => typeof x === "string" && UUID_RE.test(x);

// PUT /api/marks/[startId]: se lib/marks.ts (parseMarkChange).

// PUT /api/races/[id]/review
export function parseReviewBody(body: Record<string, unknown>): Result<{ reviewed: boolean; noneInteresting: boolean }> {
  if (typeof body.reviewed !== "boolean") return fail("reviewed ska vara true eller false.");
  const none = body.noneInteresting ?? false;
  if (typeof none !== "boolean") return fail("noneInteresting ska vara true eller false.");
  return { ok: true, value: { reviewed: body.reviewed, noneInteresting: body.reviewed ? none : false } };
}

export const COMMENT_MAX_TEXT = 4000;
export const COMMENT_MAX_TAGS = 20;
export const COMMENT_MAX_TAG_LENGTH = 40;

export type CommentInput = { horseId: string; startId: string | null; roundId: string | null; kind: "NOTE" | "RACE"; tags: string[]; text: string };

const idLike = (x: unknown): x is string => typeof x === "string" && /^[a-z][a-z0-9]{19,32}$/.test(x);

// PUT /api/comments/[clientId]
export function parseCommentBody(body: Record<string, unknown>): Result<CommentInput> {
  if (!idLike(body.horseId)) return fail("horseId saknas eller är ogiltigt.");
  const startId = body.startId ?? null;
  if (startId !== null && !idLike(startId)) return fail("startId är ogiltigt.");
  const roundId = body.roundId ?? null;
  if (roundId !== null && !idLike(roundId)) return fail("roundId är ogiltigt.");
  const kind = body.kind ?? "NOTE";
  if (kind !== "NOTE" && kind !== "RACE") return fail("kind ska vara NOTE eller RACE.");
  if (kind === "RACE" && startId === null) return fail("En kommentar under loppet måste ha en start.");
  const tags = body.tags ?? [];
  if (!Array.isArray(tags) || tags.length > COMMENT_MAX_TAGS || !tags.every((t) => typeof t === "string" && t.trim() && t.length <= COMMENT_MAX_TAG_LENGTH)) {
    return fail(`Högst ${COMMENT_MAX_TAGS} taggar med högst ${COMMENT_MAX_TAG_LENGTH} tecken.`);
  }
  const text = body.text ?? "";
  if (typeof text !== "string") return fail("text ska vara en sträng.");
  if (text.length > COMMENT_MAX_TEXT) return fail(`Kommentaren får vara högst ${COMMENT_MAX_TEXT} tecken.`);
  return {
    ok: true,
    value: { horseId: body.horseId, startId: startId as string | null, roundId: roundId as string | null, kind, tags: [...new Set((tags as string[]).map((t) => t.trim()))], text },
  };
}

export type SettingsInput = { theme?: ThemeSetting; rowPrice?: number; spelbarGuideline?: number; xFactorTror?: number; xFactorStark?: number; gameType?: GameType; spelbarTolerance?: number };

const hundredths = (x: number) => Math.abs(x * 100 - Math.round(x * 100)) < 1e-6;

// PUT /api/settings: tema (E1), radpris och riktlinje (E2), X-faktorerna
// (E2.1), toleransen för Spelbar (E2.2). Larmgränsen kommer i E3. Bara fälten som skickas ändras. Att Stark
// känsla är större än Tror på kontrolleras mot det sparade värdet i
// saveSettings (lib/e2-server.ts) när bara den ena skickas.
export function parseSettingsBody(body: Record<string, unknown>): Result<SettingsInput> {
  if ("rushThresholdPe" in body) return fail("Den inställningen kommer i en senare version.");
  const unknown = Object.keys(body).filter((k) => !["theme", "rowPrice", "spelbarGuideline", "xFactorTror", "xFactorStark", "gameType", "spelbarTolerance"].includes(k));
  if (unknown.length) return fail("Okänd inställning.");
  const out: SettingsInput = {};
  if ("theme" in body) {
    if (body.theme !== "system" && body.theme !== "light" && body.theme !== "dark") return fail("Temat ska vara system, light eller dark.");
    out.theme = body.theme;
  }
  if ("rowPrice" in body) {
    const v = body.rowPrice;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0.01 || v > 100 || !hundredths(v)) return fail("Radpriset ska ligga mellan 0,01 och 100,00 kr.");
    out.rowPrice = Math.round(v * 100) / 100;
  }
  if ("spelbarGuideline" in body) {
    const v = body.spelbarGuideline;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 1.01 || v > 99.99 || !hundredths(v)) return fail("Riktlinjen ska ligga mellan 1,01 och 99,99.");
    out.spelbarGuideline = Math.round(v * 100) / 100;
  }
  if ("spelbarTolerance" in body) {
    // 0,00–0,50 med högst två decimaler. Databasen har samma villkor
    // (migreringen 20261023120000_e2_2_unibet).
    const v = body.spelbarTolerance;
    if (typeof v !== "number" || !Number.isFinite(v) || v < TOLERANCE_MIN - 1e-9 || v > TOLERANCE_MAX + 1e-9 || !hundredths(v)) return fail(TOLERANCE_ERROR);
    out.spelbarTolerance = Math.round(v * 100) / 100;
  }
  if ("gameType" in body) {
    if (!isGameType(body.gameType)) return fail(GAME_TYPE_ERROR);
    out.gameType = body.gameType;
  }
  for (const k of ["xFactorTror", "xFactorStark"] as const) {
    if (!(k in body)) continue;
    const f = parseFactor(body[k]);
    if (!f.ok) return f;
    out[k] = f.value;
  }
  if (!Object.keys(out).length) return fail("Inget att ändra.");
  return { ok: true, value: out };
}

export const SOURCE_URL_ERROR = "Det här ser inte ut som en webbadress. Den ska börja med https://.";
export const SOURCES_MAX = 20;

// Normaliserar en källadress. Bara https, ingen inloggning i adressen,
// inga interna adresser (servern ska läsa dem i E5).
export function normalizeSourceUrl(raw: unknown): Result<string> {
  if (typeof raw !== "string") return fail(SOURCE_URL_ERROR);
  const s = raw.trim();
  if (!/^https:\/\//i.test(s) || s.length > 2000) return fail(SOURCE_URL_ERROR);
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return fail(SOURCE_URL_ERROR);
  }
  if (u.protocol !== "https:" || !u.hostname.includes(".") || u.username || u.password) return fail(SOURCE_URL_ERROR);
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[")) {
    return fail(SOURCE_URL_ERROR);
  }
  u.hash = "";
  return { ok: true, value: u.toString() };
}

export function parseSourceName(raw: unknown, url: string): Result<string> {
  if (raw === undefined || raw === null || (typeof raw === "string" && !raw.trim())) {
    return { ok: true, value: new URL(url).hostname.replace(/^www\./, "") };
  }
  if (typeof raw !== "string" || raw.trim().length > 200) return fail("Namnet får vara högst 200 tecken.");
  return { ok: true, value: raw.trim() };
}

export type SourcePatch = { name?: string; enabled?: boolean; sortOrder?: number; url?: string };

export function parseSourcePatch(body: Record<string, unknown>): Result<SourcePatch> {
  const out: SourcePatch = {};
  if ("url" in body) {
    const u = normalizeSourceUrl(body.url);
    if (!u.ok) return u;
    out.url = u.value;
  }
  if ("name" in body) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 200) return fail("Namnet ska vara 1–200 tecken.");
    out.name = body.name.trim();
  }
  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") return fail("enabled ska vara true eller false.");
    out.enabled = body.enabled;
  }
  if ("sortOrder" in body) {
    if (typeof body.sortOrder !== "number" || !Number.isInteger(body.sortOrder) || Math.abs(body.sortOrder) > 10_000) return fail("sortOrder ska vara ett heltal.");
    out.sortOrder = body.sortOrder;
  }
  if (!Object.keys(out).length) return fail("Inget att ändra.");
  return { ok: true, value: out };
}
