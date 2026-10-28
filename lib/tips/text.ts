// Artikeltexten (E5 10.6): titel, publiceringstid, kanonisk adress och
// brödtext ur en HTML-sida, plus normaliseringen som citaten jämförs med och
// hashen som hindrar att samma text skickas till AI:n två gånger.
// Ren modul (node:crypto för sha256).
//
// Avvikelser mot specen, verifierade mot test/fixtures/travstugan (27 okt 2026):
// - Travstugans artikelsidor saknar både <article>, <main>, itemprop och
//   .entry-content. Brödtexten ligger i ett eller flera ".prose"-element
//   (ingressen och texten). Därför prövas alla ".prose" (de yttersta, i sidans
//   ordning) efter specens väljare och före <body>.
// - og:title är "TIDIGA V85: Baronen är Guldet!? » 31 okt. | Gratis V85 tips".
//   Utöver sajtnamnet efter " | " och " – " tas därför också allt efter " » "
//   bort, så att titeln blir rubriken ("TIDIGA V85: Baronen är Guldet!?").
// - Publiceringstiden finns bara som datePublished i JSON-LD (@graph).
// - "ad-" matchas bara i början av ett klass- eller id-ord ("ad-banner",
//   "x-ad-slot"), inte inne i ord som "lead-in" eller "read-more".
import { createHash } from "node:crypto";
import { parse, type HTMLElement, type Node } from "node-html-parser";
import { FETCH_ERR } from "@/lib/tips/errors";

export const MIN_TEXT = 400;
export const AI_TEXT_MAX = 40_000;
export const STORED_TEXT_MAX = 60_000;

// ---- Normalisering och hash ---------------------------------------------------------

// Unicode NFC, hårt mellanslag och alla blanksteg till ett mellanslag,
// typografiska citattecken till raka, tankstreck till bindestreck, ellips
// till tre punkter, trimma.
export function normQuote(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[“”„«»″]/g, '"')
    .replace(/[’‘‚′]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[\s  -​  　]+/g, " ")
    .trim();
}

// sha256 (hex) av den normaliserade texten.
export function textHash(text: string): string {
  return createHash("sha256").update(normQuote(text), "utf8").digest("hex");
}

// https, utan #, utan utm_*-parametrar, utan / sist. Övriga parametrar behålls.
export function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  const params = [...u.searchParams.entries()].filter(([k]) => !/^utm_/i.test(k));
  const search = params.length ? "?" + new URLSearchParams(params).toString() : "";
  const path = u.pathname.replace(/\/+$/, "");
  return `https://${u.host}${path}${search}`;
}

// Värden utan "www.", för att jämföra domäner.
export const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");

// Kortar texten vid närmaste styckegräns före max (tom rad, annars radbrytning).
export function truncateAtParagraph(text: string, max = AI_TEXT_MAX): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  let cut = text.lastIndexOf("\n\n", max);
  if (cut < max / 2) cut = text.lastIndexOf("\n", max);
  if (cut < max / 2) cut = max;
  return { text: text.slice(0, cut).trimEnd(), truncated: true };
}

// ---- Artikeln --------------------------------------------------------------------------

export type ExtractedArticle = {
  title: string;
  publishedAt: Date | null;
  url: string;
  text: string;
  truncated: boolean;
};

const REMOVE_TAGS = "script,style,noscript,nav,header,footer,aside,form,iframe,svg,figcaption,button,template";
const NOISE = /share|related|comment|newsletter|cookie|(^|[\s_-])ad-/i;
const BLOCK = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "br", "div", "tr", "ul", "ol", "table", "section", "blockquote", "article", "main"]);
// Travcash: ".post-single__body" (där är <article> bara länkkort till andra inlägg).
const CONTAINERS = ["article", '[itemprop="articleBody"]', ".entry-content", ".post-content", ".post-single__body", "main"];

function cleanTitle(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim();
  for (const sep of [" | ", " – ", " » "]) {
    const i = t.indexOf(sep);
    if (i > 0) t = t.slice(0, i).trim();
  }
  return t;
}

function validDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v.trim());
  return isNaN(d.getTime()) ? null : d;
}

function findDatePublished(v: unknown, depth = 0): string | null {
  if (!v || typeof v !== "object" || depth > 6) return null;
  if (Array.isArray(v)) {
    for (const x of v) {
      const d = findDatePublished(x, depth + 1);
      if (d) return d;
    }
    return null;
  }
  const o = v as Record<string, unknown>;
  if (typeof o.datePublished === "string") return o.datePublished;
  for (const k of Object.keys(o)) {
    const d = findDatePublished(o[k], depth + 1);
    if (d) return d;
  }
  return null;
}

function isElement(n: Node): n is HTMLElement {
  return n.nodeType === 1;
}

function toText(el: HTMLElement): string {
  const out: string[] = [];
  const walk = (n: Node) => {
    if (isElement(n)) {
      const tag = (n.rawTagName ?? "").toLowerCase();
      const block = BLOCK.has(tag);
      if (block) out.push("\n");
      for (const c of n.childNodes) walk(c);
      if (block) out.push("\n");
    } else if (n.nodeType === 3) {
      out.push(n.text);
    }
  };
  walk(el);
  const lines = out
    .join("")
    .split("\n")
    .map((l) => l.replace(/[\s ]+/g, " ").trim());
  const kept: string[] = [];
  for (const l of lines) {
    if (!l && (!kept.length || kept[kept.length - 1] === "")) continue;
    kept.push(l);
  }
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  return kept.join("\n");
}

function stripNoise(el: HTMLElement) {
  for (const n of el.querySelectorAll(REMOVE_TAGS)) n.remove();
  for (const n of el.querySelectorAll("[class],[id]")) {
    const v = `${n.getAttribute("class") ?? ""} ${n.getAttribute("id") ?? ""}`;
    if (NOISE.test(v)) n.remove();
  }
}

// Brödtextens behållare: specens väljare, sedan Travstugans ".prose", sist body.
// Per väljare vinner träffen med mest text; har ingen träff tillräckligt med
// text (t.ex. små <article>-kort) prövas nästa väljare.
function bodyContainers(root: HTMLElement): HTMLElement[] {
  for (const sel of CONTAINERS) {
    let best: HTMLElement | null = null;
    let bestLen = 0;
    for (const el of root.querySelectorAll(sel)) {
      const len = el.text.replace(/\s+/g, " ").trim().length;
      if (len > bestLen) [best, bestLen] = [el, len];
    }
    if (best && bestLen >= MIN_TEXT) return [best];
  }
  const prose = root.querySelectorAll(".prose").filter((el) => {
    for (let p = el.parentNode; p; p = p.parentNode) if (p.classList?.contains("prose")) return false;
    return true;
  });
  if (prose.length) return prose;
  const body = root.querySelector("body");
  return [body ?? root];
}

export type ExtractResult = { ok: true; article: ExtractedArticle } | { ok: false; error: string };

export function extractArticle(html: string, pageUrl: string): ExtractResult {
  const root = parse(html, { comment: false });
  const page = new URL(pageUrl);

  const og = root.querySelector('meta[property="og:title"]')?.getAttribute("content");
  const h1 = root.querySelector("h1")?.text;
  const titleTag = root.querySelector("title")?.text;
  const title = cleanTitle(og || h1 || titleTag || "").slice(0, 500) || page.pathname.split("/").filter(Boolean).pop() || page.host;

  let publishedAt = validDate(root.querySelector('meta[property="article:published_time"]')?.getAttribute("content"));
  if (!publishedAt) {
    for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        publishedAt = validDate(findDatePublished(JSON.parse(s.rawText)));
      } catch {
        // trasig JSON-LD: nästa
      }
      if (publishedAt) break;
    }
  }

  let url = pageUrl;
  const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute("href");
  if (canonical) {
    try {
      const c = new URL(canonical, pageUrl);
      if (c.protocol === "https:" && bareHost(c.host) === bareHost(page.host)) url = c.toString();
    } catch {
      // ogiltig: sidans adress
    }
  }

  const containers = bodyContainers(root);
  if (!publishedAt) {
    for (const c of containers) {
      publishedAt = validDate(c.querySelector("time[datetime]")?.getAttribute("datetime"));
      if (publishedAt) break;
    }
  }
  const parts = containers.map((c) => {
    stripNoise(c);
    return toText(c);
  });
  const full = parts.filter(Boolean).join("\n\n");
  if (full.length < MIN_TEXT) return { ok: false, error: FETCH_ERR.tooShort };
  const cut = truncateAtParagraph(full, AI_TEXT_MAX);
  return { ok: true, article: { title, publishedAt, url: normalizeUrl(url), text: cut.text.slice(0, STORED_TEXT_MAX), truncated: cut.truncated } };
}

// Tidiga eller slutliga tips (6.11): "tidig" i titeln.
export const stageOf = (title: string): "EARLY" | "FINAL" => (/tidig/i.test(title) ? "EARLY" : "FINAL");
