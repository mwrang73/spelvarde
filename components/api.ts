// Anrop mot appens API från klienten. Felsvar har formen { error, code? }
// (lib/types.ts ApiError). 401 skickar till inloggningen.

import type { ApiError } from "@/lib/types";

export class ApiFailure extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null) {
    super(message);
    this.name = "ApiFailure";
  }
}

export const OFFLINE_MESSAGE = "Ingen uppkoppling. Försök igen när du är uppkopplad.";

export function toLogin() {
  if (typeof window === "undefined") return;
  const next = window.location.pathname + window.location.search;
  window.location.assign(`/login${next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`);
}

async function parse(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function apiRequest<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiFailure(OFFLINE_MESSAGE, 0);
  }
  const data = await parse(res);
  if (res.status === 401 && url !== "/api/auth/login" && url !== "/api/auth/password") {
    toLogin();
    throw new ApiFailure("Logga in igen.", 401);
  }
  if (!res.ok) {
    const err = data as Partial<ApiError> | null;
    throw new ApiFailure(typeof err?.error === "string" ? err.error : "Något gick fel. Försök igen.", res.status, typeof err?.code === "string" ? err.code : null);
  }
  return data as T;
}

export const apiGet = <T,>(url: string) => apiRequest<T>("GET", url);

// För hämtningskedjan: status och kropp utan undantag för felsvar.
export async function rawPost(url: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}), cache: "no-store" });
  if (res.status === 401) toLogin();
  return { status: res.status, data: await parse(res) };
}
