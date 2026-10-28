// Samlingssidor och artiklarnas relevans (E5 10.6). Ren modul.
//
// Verifierat mot test/fixtures/travstugan/v85.html (hämtad 27 okt 2026):
// - Samlingssidan visar artikellänkarna i ren HTML utan JavaScript. Veckans
//   artikel ligger i ett <article>-kort med flera länkar till samma adress
//   (bild, rubrik "TIDIGA V85: Baronen är Guldet!?", "Läs travtips"). Äldre
//   artiklar ligger i en lista med <h4>-rubriker.
// - V85 står i både länktexten och sökvägen ("/tidiga-v85-baronen-ar-guldet").
// - Menyn länkar till /v85 själv och till /v86, /v75 osv. De filtreras bort
//   (samlingssidan själv, och ingen V85 i texten).
// - robots.txt tillåter allt utom /cpresources/, /vendor/, /.env, /hamta/,
//   /besok/ och /affiliate-link-check.
import { parse } from "node-html-parser";
import { normalizeTrack } from "@/lib/unibet";
import { bareHost, normalizeUrl } from "@/lib/tips/text";
import { normHorse } from "@/lib/tips/match";

export const MAX_CANDIDATES = 8;
export const MIN_HORSES = 3;
export const MAX_AGE_DAYS = 7;

export type SourceKindValue = "COLLECTION" | "PAGE";
const COLLECTION_HOSTS = ["travstugan.se", "travcash.se"];

// Tagg-, kategori- och ämnessidor ("/tagg/v85" på Aftonbladet).
const LISTING_PATH = /\/(tag|tagg|taggar|kategori|category|amne|ämne|topic|topics|sektion)\//i;

// Läsaren: Source.kind om den är satt (överstyrning), annars efter adressen.
// POST /api/sources sparar null, så att nya regler här gäller även gamla
// källor. Samlingssida för de kända sajterna, för tagg- och kategorisidor och
// för korta adresser med spelformen, som "/v85" eller "/v85-tips" (artiklar
// har längre namn).
export function readerFor(source: { url: string; kind?: SourceKindValue | null }): SourceKindValue {
  if (source.kind) return source.kind;
  try {
    const u = new URL(source.url);
    if (COLLECTION_HOSTS.includes(bareHost(u.hostname))) return "COLLECTION";
    const path = decodeURIComponent(u.pathname);
    if (LISTING_PATH.test(path)) return "COLLECTION";
    const last = path.split("/").filter(Boolean).pop() ?? "";
    return /^(v|gs)\d{2}$/i.test(last.split("-")[0]) && last.split("-").filter(Boolean).length <= 2 ? "COLLECTION" : "PAGE";
  } catch {
    return "PAGE";
  }
}

// "V85", "v85", "V 85", "v-85" för V85 (och motsvarande för V75, V86 och GS75).
export function gameTypeRegex(gameType: string): RegExp {
  const m = /^([A-Za-z]+)(\d+)$/.exec(gameType);
  if (!m) return /$^/;
  return new RegExp(`(^|[^a-z0-9])${m[1]}[\\s-]?${m[2]}($|[^0-9])`, "i");
}

const MONTHS_LONG = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const MONTHS_SHORT = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const WEEKDAYS = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];

// Datumformer för omgångens datum ("YYYY-MM-DD"): "31 oktober", "31 okt",
// "31/10", "31.10", "2026-10-31" och veckodagen ("lördag").
export function dateTokens(date: string): string[] {
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return [`${d} ${MONTHS_LONG[m - 1]}`, `${d} ${MONTHS_SHORT[m - 1]}`, `${d}/${m}`, `${d}.${m}`, date, WEEKDAYS[wd]];
}

const EXCLUDED_PATH = /\/(tag|tagg|kategori|category|author|forfattare|page|sida)\//i;

export type RoundRef = { gameType: string; trackName: string; date: string };
export type ArticleLink = { url: string; title: string };

// Länkar på samlingssidan som kan vara artiklar om omgången (högst 8, i sidans ordning).
export function findArticleLinks(html: string, pageUrl: string, round: RoundRef): ArticleLink[] {
  const root = parse(html, { comment: false });
  const page = new URL(pageUrl);
  const self = normalizeUrl(pageUrl);
  const byUrl = new Map<string, { url: string; texts: string[]; path: string }>();
  for (const a of root.querySelectorAll("a[href]")) {
    const href = (a.getAttribute("href") ?? "").trim();
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    let u: URL;
    try {
      u = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || bareHost(u.hostname) !== bareHost(page.hostname)) continue;
    if (EXCLUDED_PATH.test(u.pathname + "/")) continue;
    const url = normalizeUrl(u.toString());
    if (url === self) continue;
    const text = a.text.replace(/\s+/g, " ").trim();
    const hit = byUrl.get(url);
    if (hit) {
      if (text) hit.texts.push(text);
    } else {
      byUrl.set(url, { url, texts: text ? [text] : [], path: u.pathname });
    }
  }
  const links = [...byUrl.values()];
  const lastSegment = (p: string) => decodeURIComponent(p.replace(/\/+$/, "").split("/").pop() ?? "");
  const gt = gameTypeRegex(round.gameType);
  let picked = links.filter((l) => gt.test(lastSegment(l.path)) || l.texts.some((t) => gt.test(t)));
  if (!picked.length) {
    const track = normalizeTrack(round.trackName);
    const tokens = dateTokens(round.date).map((t) => t.toLowerCase());
    const has = (s: string) => (track && normalizeTrack(s).includes(track)) || tokens.some((t) => s.toLowerCase().includes(t));
    picked = links.filter((l) => has(lastSegment(l.path)) || l.texts.some(has));
  }
  return picked.slice(0, MAX_CANDIDATES).map((l) => ({ url: l.url, title: l.texts.sort((a, b) => b.length - a.length)[0] ?? lastSegment(l.path) }));
}

export type RelevanceRound = RoundRef & { horses: string[] };
export type Relevance = { relevant: boolean; reason: string | null; horses: number };

// Gäller artikeln omgången? Minst 3 av omgångens hästar (hela ord), bana,
// datum eller spelform, och publicerad högst 7 dagar före omgången.
export function isRelevant(article: { title: string; text: string; publishedAt: Date | null }, round: RelevanceRound, now: Date): Relevance {
  const all = `${article.title}\n${article.text}`;
  const hay = ` ${normHorse(all.replace(/[^\p{L}\p{N}'’.*()\s-]/gu, " "))} `;
  const names = new Set(round.horses.map(normHorse).filter((n) => n.length >= 2));
  let horses = 0;
  for (const n of names) if (hay.includes(` ${n} `)) horses++;
  if (horses < MIN_HORSES) return { relevant: false, reason: `nämner ${horses} av omgångens hästar`, horses };
  const track = normalizeTrack(round.trackName);
  const lower = all.toLowerCase();
  const mentions = (track && normalizeTrack(all).includes(track)) || dateTokens(round.date).some((t) => lower.includes(t.toLowerCase())) || gameTypeRegex(round.gameType).test(all);
  if (!mentions) return { relevant: false, reason: `nämner inte bana, datum eller ${round.gameType}`, horses };
  if (article.publishedAt) {
    const [y, m, d] = round.date.split("-").map(Number);
    // Omgångens datum − 7 dagar (00:00 UTC, en marginal på någon timme mot svensk tid).
    const from = Date.UTC(y, m - 1, d - MAX_AGE_DAYS) - 2 * 3600_000;
    const t = article.publishedAt.getTime();
    if (t < from) return { relevant: false, reason: `publicerad för mer än ${MAX_AGE_DAYS} dagar sedan`, horses };
    if (t > now.getTime() + 3600_000) return { relevant: false, reason: "publiceringstiden ligger i framtiden", horses };
  }
  return { relevant: true, reason: null, horses };
}
