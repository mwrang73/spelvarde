// Validering av kroppar till de skrivande rutterna. Rena funktioner: ger
// antingen { ok: true, value } eller { ok: false, error } med en svensk mening.
import type { ThemeSetting } from "@/lib/types";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (x: unknown): x is string => typeof x === "string" && UUID_RE.test(x);

// PUT /api/marks/[startId]. I E1 får bara `interesting` sparas.
export function parseMarkBody(body: Record<string, unknown>): Result<{ interesting: boolean }> {
  const later = ["spelbar", "bet", "unibetOdds", "betOdds"].filter((k) => k in body);
  if (later.length) return fail("Bara Intressant kan sparas i den här versionen.");
  const unknown = Object.keys(body).filter((k) => k !== "interesting");
  if (unknown.length) return fail("Okänt fält i ändringen.");
  if (typeof body.interesting !== "boolean") return fail("interesting ska vara true eller false.");
  return { ok: true, value: { interesting: body.interesting } };
}

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

// PUT /api/settings. I E1 bara temat.
export function parseSettingsBody(body: Record<string, unknown>): Result<{ theme: ThemeSetting }> {
  const later = ["rushThresholdPe", "rowPrice", "spelbarGuideline"].filter((k) => k in body);
  if (later.length) return fail("Den inställningen kommer i en senare version.");
  if (body.theme !== "system" && body.theme !== "light" && body.theme !== "dark") return fail("Temat ska vara system, light eller dark.");
  return { ok: true, value: { theme: body.theme } };
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
