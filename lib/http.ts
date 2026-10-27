import { NextResponse } from "next/server";

// Gemensamma svar för API-rutterna. Felsvar har alltid formen
// { error: "<svensk mening>" } (specen 12). Interna fel loggas på servern men
// lämnas aldrig ut till klienten.

export function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export const unauthorized = () => jsonError(401, "Ej inloggad.");
export const notFound = (what = "Hittades inte.") => jsonError(404, what);
export const badRequest = (error: string) => jsonError(400, error);
export const raceStarted = () => jsonError(409, "Loppet har startat");

export function serverError(context: string, error: unknown) {
  console.error(context, error);
  return jsonError(500, "Något gick fel på servern. Försök igen.");
}

// Läser JSON-kroppen. Ogiltig eller för stor kropp ger null (rutten svarar 400).
export async function readJson(request: Request, maxBytes = 64_000): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (text.length > maxBytes) return null;
    if (!text.trim()) return {};
    const data = JSON.parse(text);
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// cuid från Prisma: en bokstav följd av 20–32 tecken a–z/0–9. Används för att
// avvisa skräp i rutternas [id] innan databasen frågas.
export function isId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9]{19,32}$/.test(value);
}

// Svar från lib/*-server.ts ({ status, body }). 429 med retryAfterSec får
// också Retry-After.
export function replyJson(res: { status: number; body: unknown }) {
  const retry = (res.body as { retryAfterSec?: unknown } | null)?.retryAfterSec;
  const headers = res.status === 429 && typeof retry === "number" ? { "Retry-After": String(retry) } : undefined;
  return NextResponse.json(res.body, { status: res.status, headers });
}
