// Visning av Hämta tips i klienten (E5, docs/specs/e5-hamta-tips.md S8, S1–S3).
// Rena funktioner utan DOM, testas i lib/tips-ui.test.ts.

import { plural } from "@/lib/format";
import { stockholmParts } from "@/lib/stockholm-time";
import { ROLE_LABEL } from "@/lib/tips/roles";
import type { QuotaDto, RoundTipsDto, TipDto, TipRole, TipStage } from "@/lib/types";
import { legName } from "@/lib/game-type";

const pad = (n: number) => String(n).padStart(2, "0");

// "tis 27 okt 08:30"
export function dayTimeAbs(iso: string): string {
  const p = stockholmParts(new Date(iso));
  return `${p.weekdayShort} ${p.day} ${p.monthShort} ${pad(p.hour)}:${pad(p.minute)}`;
}

// "tis 27 okt"
export function dayAbs(iso: string): string {
  const p = stockholmParts(new Date(iso));
  return `${p.weekdayShort} ${p.day} ${p.monthShort}`;
}

export const stageLabel = (stage: TipStage) => (stage === "EARLY" ? "tidiga tips" : "slutliga tips");

// Klassen på rolltaggen (.role.spik osv.).
export const ROLE_CLASS: Record<TipRole, string> = { SPIK: "spik", FAVORIT: "fav", SKRALL: "skr", AVRADAN: "avr", NAMND: "nmd" };
export const roleLabel = (role: TipRole) => ROLE_LABEL[role];

// Rollordet i citatet (skiftlägesokänsligt, första förekomsten) för <mark>.
export function markWord(quote: string, word: string | null): [string, string, string] | null {
  if (!word) return null;
  const w = word.trim();
  if (!w) return null;
  const i = quote.toLocaleLowerCase("sv").indexOf(w.toLocaleLowerCase("sv"));
  if (i < 0) return null;
  return [quote.slice(0, i), quote.slice(i, i + w.length), quote.slice(i + w.length)];
}

// Säkert tips: kopplat utan flaggor (kan godkännas med Godkänn alla).
export const isSure = (t: TipDto) => t.match === "SURE" && !!t.startId && t.flags.length === 0;
// Väntar på granskning och räknas i "att granska".
export const isPending = (t: TipDto) => t.review === "PENDING" && !t.superseded && !t.locked;
// Godkänt och gällande.
export const isCurrentApproved = (t: TipDto) => t.review === "APPROVED" && !t.superseded;

// Hästens namn i texter och aria-label: startens namn, annars artikelns stavning.
export const tipHorse = (t: TipDto) => t.horseName ?? t.rawHorseName;

export type TipCounts = { pending: number; pendingSure: number; pendingUnsure: number; approved: number; approvedHorses: number };

export function countTips(tips: TipDto[]): TipCounts {
  const pending = tips.filter(isPending);
  const approved = tips.filter(isCurrentApproved);
  const sure = pending.filter(isSure).length;
  return {
    pending: pending.length,
    pendingSure: sure,
    pendingUnsure: pending.length - sure,
    approved: approved.length,
    approvedHorses: new Set(approved.map((t) => t.startId).filter(Boolean)).size,
  };
}

// Avdelning och nummer för sortering: kopplad start, annars AI:ns. Ej kopplade sist.
export function tipOrder(a: TipDto, b: TipDto): number {
  const na = !a.startId ? 1 : 0;
  const nb = !b.startId ? 1 : 0;
  if (na !== nb) return na - nb;
  const la = a.startLeg ?? a.leg ?? 99;
  const lb = b.startLeg ?? b.leg ?? 99;
  if (la !== lb) return la - lb;
  return (a.startNumber ?? a.number ?? 99) - (b.startNumber ?? b.number ?? 99);
}

// "1 osäkert tips väntar: Fly Express i avd 1" / "2 osäkra tips väntar."
export function unsureLine(unsure: TipDto[], gameType: string): string | null {
  if (!unsure.length) return null;
  if (unsure.length === 1) {
    const t = unsure[0];
    const leg = t.startLeg ?? t.leg;
    return `1 osäkert tips väntar: ${tipHorse(t)}${leg ? ` i ${legName(gameType, leg)}` : ""}`;
  }
  return `${unsure.length} osäkra tips väntar.`;
}

// "AI-läsningar i dag 2 av 20". full = gränsen nådd.
export const quotaFull = (q: QuotaDto | null | undefined) => !!q && q.used >= q.limit;

// "1 påslagen källa · tips för V85 Bjerke lör 31 okt"
export function sourcesSub(enabled: number, roundLabel: string | null): string {
  const head = `${enabled} ${enabled === 1 ? "påslagen källa" : "påslagna källor"}`;
  return roundLabel ? `${head} · tips för ${roundLabel}` : head;
}

// Spärren per källa: sekunder kvar tills alla påslagna källor kan läsas igen
// (0 = ingen spärr). Spärren gäller bara när alla påslagna är lästa nyss.
export function scanLockLeft(lastReads: (string | null)[], now: number, lockMs = 60_000): number {
  if (!lastReads.length) return 0;
  let min = Infinity;
  for (const r of lastReads) {
    if (!r) return 0;
    const left = Date.parse(r) + lockMs - now;
    if (left <= 0) return 0;
    min = Math.min(min, left);
  }
  return Math.ceil(min / 1000);
}

// "0:45"
export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${pad(sec % 60)}`;

// ---- Tipsraden i S1 ----------------------------------------------------------------------

export type TipsLineLink = { kind: "review" | "fetch"; label: string; ariaLabel?: string };
export type TipsLine = { lead: string; strong: string | null; rest: string; links: TipsLineLink[] };

// Texterna i S1 (tabellen i specen). when = relTime(lastReadAt). null = raden visas inte.
export function tipsLine(t: RoundTipsDto | null | undefined, sourcesEnabled: number, done: boolean, when: string | null): TipsLine | null {
  const approved = t?.approved ?? 0;
  const pending = t?.pending ?? 0;
  const who = t ? (t.sourcesRead > 1 ? `${t.sourcesRead} källor` : t.lastSourceName) : null;
  const from = who && when ? ` · ${who} ${when}` : who ? ` · ${who}` : "";
  if (done) {
    if (!approved) return null;
    return { lead: "Tips: ", strong: null, rest: `${approved} på ${plural(t!.horses, "häst", "hästar")}${from}`, links: [] };
  }
  if (approved) {
    const links: TipsLineLink[] = [];
    if (pending) links.push({ kind: "review", label: `${pending} att granska` });
    links.push({ kind: "fetch", label: "Hämta igen", ariaLabel: "Hämta tips igen i Källor" });
    return { lead: "Tips: ", strong: String(approved), rest: ` på ${plural(t!.horses, "häst", "hästar")}${from}`, links };
  }
  if (pending) return { lead: "Tips: ", strong: String(pending), rest: ` att granska${from}`, links: [{ kind: "review", label: "Granska" }] };
  if (sourcesEnabled > 0) return { lead: "Tips: inga hämtade än", strong: null, rest: "", links: [{ kind: "fetch", label: "Hämta tips", ariaLabel: "Hämta tips i Källor" }] };
  return null;
}

// ---- Banderollen efter Hämta tips ------------------------------------------------------

export type ChainSourceResult = { sourceId: string; name: string; status: "ok" | "noArticle" | "error" | "locked" | "skipped"; error?: string };
export type ChainArticleResult =
  | { articleId: string; title: string; kind: "ok"; created: number; horses: string[]; unlinked: number; discardedQuote: number; truncated: boolean; cutOff: boolean }
  | { articleId: string; title: string; kind: "failed"; error: string }
  | { articleId: string; title: string; kind: "skipped" };

export type ChainOutcome = {
  sources: ChainSourceResult[];
  // Artiklar som fanns men inte behövde läsas (oförändrade eller dubbletter).
  unchanged: number;
  articles: ChainArticleResult[];
  // Artiklar som inte lästes eftersom dygnsgränsen nåddes.
  waiting: number;
  notConfigured: boolean;
  roundClosed: boolean;
  // Senaste tolkningen före körningen ("Inget nytt sedan i dag 21:14").
  since: string | null;
  roundLabel: string;
};

export type BannerSpec = { tone: "ok" | "info" | "warn" | "err"; strong: string; text: string; retryArticleId?: string };

export function chainBanners(o: ChainOutcome): BannerSpec[] {
  if (o.notConfigured) return [{ tone: "err", strong: "Hämta tips är inte inställt.", text: "ANTHROPIC_API_KEY saknas i Vercel. Inget skickades." }];
  if (o.roundClosed) return [{ tone: "info", strong: "Alla lopp har startat.", text: "Tips kan inte längre hämtas för omgången." }];
  const out: BannerSpec[] = [];
  const read = o.sources.filter((s) => s.status === "ok" || s.status === "noArticle");
  const failedSources = o.sources.filter((s) => s.status === "error");
  if (o.sources.length && failedSources.length === o.sources.length) out.push({ tone: "err", strong: "Ingen källa gick att läsa.", text: "Se felet vid varje källa." });

  const ok = o.articles.filter((a): a is Extract<ChainArticleResult, { kind: "ok" }> => a.kind === "ok");
  const withTips = ok.filter((a) => a.created > 0);
  const failed = o.articles.filter((a): a is Extract<ChainArticleResult, { kind: "failed" }> => a.kind === "failed");
  if (withTips.length) {
    const created = withTips.reduce((s, a) => s + a.created, 0);
    const horses = new Set(withTips.flatMap((a) => a.horses)).size;
    const extra: string[] = [];
    const unlinked = withTips.reduce((s, a) => s + a.unlinked, 0);
    const quote = ok.reduce((s, a) => s + a.discardedQuote, 0);
    if (unlinked) extra.push(unlinked === 1 ? "1 tips gäller en häst som inte kunde kopplas." : `${unlinked} tips gäller hästar som inte kunde kopplas.`);
    if (quote) extra.push(`${quote} tips kastades eftersom citatet inte fanns i texten.`);
    if (ok.some((a) => a.truncated)) extra.push(ok.length === 1 ? "Artikeln var lång, och bara början lästes." : "En artikel var lång, och bara början lästes.");
    if (ok.some((a) => a.cutOff)) extra.push("Svaret blev för långt, och bara en del av tipsen lästes.");
    out.push({
      tone: "ok",
      strong: `${plural(created, "tips", "tips")} på ${plural(horses || created, "häst", "hästar")}`,
      text: ` från ${plural(withTips.length, "artikel", "artiklar")}. Granska dem innan de räknas.${extra.length ? ` ${extra.join(" ")}` : ""}`,
    });
  }
  for (const a of ok.filter((x) => x.created === 0))
    out.push({ tone: "info", strong: `"${a.title}" innehöll inga tips om hästar i omgången.`, text: " Artikeln är läst och läses inte igen förrän den ändras." });
  for (const a of failed) {
    // Serverns text: 'AI:n kunde inte tolka "…". <orsak> Försök igen räknas som en ny läsning.'
    const m = /^(AI:n kunde inte tolka ".*?"\.)([\s\S]*)$/.exec(a.error);
    out.push({ tone: "err", strong: m ? m[1] : "", text: m ? m[2] : a.error, retryArticleId: a.articleId });
  }
  if (o.waiting > 0)
    out.push({ tone: "warn", strong: "Dagens gräns för AI-läsning är nådd.", text: ` ${o.waiting === 1 ? "1 artikel väntar och läses" : `${o.waiting} artiklar väntar och läses`} när du trycker Hämta tips i morgon.` });

  if (!out.length && read.length) {
    if (o.unchanged > 0)
      out.push({
        tone: "info",
        strong: o.since ? `Inget nytt sedan ${o.since}.` : "Inget nytt.",
        text: o.unchanged === 1 ? " Artikeln är oförändrad, så den lästes inte igen. Det kostade ingenting." : " Artiklarna är oförändrade, så de lästes inte igen. Det kostade ingenting.",
      });
    else {
      const who = read.length === 1 ? `${read[0].name} har` : "Källorna har";
      out.push({ tone: "info", strong: `${who} ingen artikel om ${o.roundLabel} än.`, text: " Tidiga tips brukar komma måndag eller tisdag. Inget skickades till AI:n." });
    }
  }
  if (!out.length && o.sources.some((s) => s.status === "locked"))
    out.push({ tone: "info", strong: "Nyss hämtat.", text: " Källorna lästes för mindre än en minut sedan. Inget skickades till AI:n." });
  return out;
}

// Stegraden: "Travstugan: 1 ny artikel" / "inget nytt" / "ingen artikel om omgången".
export function scanStepText(name: string, status: "ok" | "noArticle", needsAi: number, articles: number): string {
  if (status === "noArticle" || articles === 0) return `${name}: ingen artikel om omgången`;
  if (needsAi === 0) return `${name}: inget nytt`;
  return `${name}: ${needsAi} ${needsAi === 1 ? "ny artikel" : "nya artiklar"}`;
}
