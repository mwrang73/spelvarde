// Hämtning av en källa över nätet (E5 10.6). Bara på servern.
//
// - User-Agent "Spelvärde (privat bruk)", 10 s timeout, högst 2 MB, högst 3
//   omdirigeringar och bara till https på samma domän (utan www.).
// - content-type måste innehålla html. Avkodning med decodeHtml (UTF-8,
//   annars windows-1252).
// - Fel blir TipFetchError med felorsakerna i lib/tips/errors.ts.
// - robots.txt hämtas med 5 s timeout. Saknas den eller svarar den inte
//   räknas allt som tillåtet (null).
import { decodeHtml, TS_USER_AGENT } from "@/lib/travstatistik";
import { FETCH_ERR, TipFetchError } from "@/lib/tips/errors";
import { bareHost } from "@/lib/tips/text";

export const PAGE_TIMEOUT_MS = 10_000;
export const ROBOTS_TIMEOUT_MS = 5_000;
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 3;

export type FetchedPage = { url: string; html: string };
export type FetchPage = (url: string) => Promise<FetchedPage>;
export type FetchRobots = (origin: string) => Promise<string | null>;

const HEADERS = { "User-Agent": TS_USER_AGENT, Accept: "text/html,application/xhtml+xml", "Accept-Language": "sv-SE,sv;q=0.9" };

const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

async function readLimited(res: Response, max: number): Promise<Uint8Array> {
  const len = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(len) && len > max) throw new TipFetchError(FETCH_ERR.tooLarge);
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new TipFetchError(FETCH_ERR.tooLarge);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export const fetchPage: FetchPage = async (startUrl) => {
  const signal = AbortSignal.timeout(PAGE_TIMEOUT_MS);
  const origin = new URL(startUrl);
  if (origin.protocol !== "https:") throw new TipFetchError(FETCH_ERR.redirect);
  let url = origin.toString();
  try {
    for (let hop = 0; ; hop++) {
      const res = await fetch(url, { headers: HEADERS, redirect: "manual", signal, cache: "no-store" });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        await res.body?.cancel().catch(() => {});
        const next = new URL(res.headers.get("location")!, url);
        if (hop >= MAX_REDIRECTS || next.protocol !== "https:" || bareHost(next.hostname) !== bareHost(origin.hostname)) throw new TipFetchError(FETCH_ERR.redirect);
        url = next.toString();
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new TipFetchError(FETCH_ERR.forbidden);
      if (res.status === 404 || res.status === 410) throw new TipFetchError(FETCH_ERR.notFound);
      if (!res.ok) throw new TipFetchError(FETCH_ERR.status(res.status));
      if (!/html/i.test(res.headers.get("content-type") ?? "")) {
        await res.body?.cancel().catch(() => {});
        throw new TipFetchError(FETCH_ERR.notHtml);
      }
      return { url, html: decodeHtml(await readLimited(res, MAX_PAGE_BYTES)) };
    }
  } catch (e) {
    if (e instanceof TipFetchError) throw e;
    if (isTimeout(e)) throw new TipFetchError(FETCH_ERR.timeout);
    throw new TipFetchError(FETCH_ERR.unreachable);
  }
};

export const fetchRobots: FetchRobots = async (originUrl) => {
  try {
    const u = new URL("/robots.txt", originUrl);
    const res = await fetch(u, { headers: { "User-Agent": TS_USER_AGENT }, signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return null;
    return decodeHtml(await readLimited(res, 512 * 1024));
  } catch {
    return null;
  }
};
