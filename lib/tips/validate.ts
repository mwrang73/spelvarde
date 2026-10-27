// Validering av AI:ns svar (E5 6.11 "Validering"). Ren modul.
//
// Varje post prövas i ordning: form, citatet ordagrant i texten, rollordet,
// att citatet nämner hästen, kopplingen, dubbletter, taket på 60 och lopp som
// har startat. Inget AI:n hittar på kan sparas: ett citat som inte finns i
// artikeln kastas alltid.
import { linkTip, normHorse, sortFlags, type StartRef, type TipFlag } from "@/lib/tips/match";
import { isTipRole, normWord, roleOfWord, roleStrength, type TipRole } from "@/lib/tips/roles";
import { normQuote } from "@/lib/tips/text";

export const MAX_TIPS = 60;

export type ValidTip = {
  leg: number | null;
  number: number | null;
  rawHorseName: string;
  role: TipRole;
  roleWord: string | null;
  quote: string;
  startId: string | null;
  match: "SURE" | "UNSURE" | "NONE";
  flags: TipFlag[];
  suggestedStartId: string | null;
};

export type Discarded = { shape: number; quote: number; duplicate: number; overflow: number };
export type ValidateResult = { tips: ValidTip[]; discarded: Discarded; skippedStarted: number };

type Shaped = { leg: number | null; number: number | null; horseName: string; role: TipRole; roleWord: string | null; quote: string };

const intOrNull = (v: unknown, min: number, max: number): number | null | undefined => {
  if (v === null || v === undefined) return null;
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
};

function shape(x: unknown): Shaped | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const horseName = typeof o.horseName === "string" ? o.horseName.replace(/\s+/g, " ").trim() : "";
  const quote = typeof o.quote === "string" ? o.quote.trim() : "";
  const leg = intOrNull(o.leg, 1, 8);
  const number = intOrNull(o.number, 1, 20);
  const roleWord = o.roleWord === null || o.roleWord === undefined ? null : typeof o.roleWord === "string" && o.roleWord.trim().length <= 40 ? o.roleWord.trim() || null : undefined;
  if (horseName.length < 1 || horseName.length > 60) return null;
  if (!isTipRole(o.role)) return null;
  if (quote.length < 8 || quote.length > 400) return null;
  if (leg === undefined || number === undefined || roleWord === undefined) return null;
  return { leg, number, horseName, role: o.role, roleWord, quote };
}

// Rollordets flagga (punkt 3). Nämnd kräver inget ord.
export function roleFlag(role: TipRole, roleWord: string | null, quote: string): TipFlag | null {
  if (role === "NAMND") return null;
  if (!roleWord || !normWord(normQuote(quote)).includes(normWord(normQuote(roleWord)))) return "ROLE_WORD_MISSING";
  const r = roleOfWord(roleWord);
  if (r === null) return "ROLE_WORD_UNKNOWN";
  if (r !== role) return "ROLE_CONFLICT";
  return null;
}

// Nämner citatet hästen (namnet eller namnets längsta ord med minst 4 tecken)?
export function quoteNamesHorse(quote: string, names: string[]): boolean {
  const q = ` ${normHorse(normQuote(quote).replace(/[^\p{L}\p{N}'’.*\s-]/gu, " "))} `;
  for (const raw of names) {
    const n = normHorse(raw);
    if (!n) continue;
    if (q.includes(` ${n} `)) return true;
    const longest = n.split(" ").sort((a, b) => b.length - a.length)[0] ?? "";
    if (longest.length >= 4 && q.includes(` ${longest} `)) return true;
  }
  return false;
}

// raw = verktygets input ({ tips: [...] }) eller listan direkt.
export function validateTips(raw: unknown, articleText: string, starts: StartRef[], startedLegs: Iterable<number>): ValidateResult {
  const list: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { tips?: unknown }).tips) ? (raw as { tips: unknown[] }).tips : [];
  const discarded: Discarded = { shape: 0, quote: 0, duplicate: 0, overflow: 0 };
  const text = normQuote(articleText);
  const byId = new Map(starts.map((s) => [s.startId, s]));

  const candidates: ValidTip[] = [];
  for (const item of list) {
    const s = shape(item);
    if (!s) {
      discarded.shape++;
      continue;
    }
    if (!text.includes(normQuote(s.quote))) {
      discarded.quote++;
      continue;
    }
    const link = linkTip({ leg: s.leg, number: s.number, horseName: s.horseName }, starts);
    const flags: TipFlag[] = [...link.flags];
    const rf = roleFlag(s.role, s.roleWord, s.quote);
    if (rf) flags.push(rf);
    if (!quoteNamesHorse(s.quote, [s.horseName, ...(link.start ? [link.start.name] : [])])) flags.push("QUOTE_NO_NAME");
    const match = link.match === "NONE" ? "NONE" : link.match === "SURE" && flags.length === 0 ? "SURE" : "UNSURE";
    candidates.push({
      leg: s.leg,
      number: s.number,
      rawHorseName: s.horseName,
      role: s.role,
      roleWord: s.roleWord,
      quote: s.quote,
      startId: link.start?.startId ?? null,
      match,
      flags: sortFlags(flags),
      suggestedStartId: link.suggestion?.startId ?? null,
    });
  }

  // Dubbletter: samma start (eller samma namn när den inte är kopplad). Den starkaste rollen behålls.
  const keyOf = (t: ValidTip) => (t.startId ? `s:${t.startId}` : `n:${normHorse(t.rawHorseName)}`);
  const best = new Map<string, ValidTip>();
  for (const t of candidates) {
    const k = keyOf(t);
    const cur = best.get(k);
    if (!cur || roleStrength(t.role) < roleStrength(cur.role)) best.set(k, t);
  }
  const unique = candidates.filter((t) => best.get(keyOf(t)) === t);
  discarded.duplicate = candidates.length - unique.length;

  const capped = unique.slice(0, MAX_TIPS);
  discarded.overflow = unique.length - capped.length;

  const started = new Set(startedLegs);
  const allStarted = starts.length > 0 && [...new Set(starts.map((s) => s.leg))].every((l) => started.has(l));
  let skippedStarted = 0;
  const tips = capped.filter((t) => {
    const leg = t.startId ? byId.get(t.startId)?.leg ?? null : t.leg;
    const locked = leg !== null ? started.has(leg) : allStarted;
    if (locked) skippedStarted++;
    return !locked;
  });
  return { tips, discarded, skippedStarted };
}
