// PUT /api/marks/[startId] (specen 12, 6.1, 6.8 och S6a): tolkning av kroppen och
// hur en ändring läggs på en Mark. Rena funktioner, så att servern och
// klientens optimistiska läge kan använda samma regler. Testade i
// lib/marks.test.ts.
//
// Kroppen är hela tillståndet för fälten som skickas (idempotent: samma kropp
// två gånger ger samma Mark). Utkorgen slår ihop två PUT mot samma start
// genom att lägga den senare kroppen över den tidigare, därför tillämpas
// fälten i en fast ordning: unibetOdds, interesting, xFactor, spelbar, bet,
// betOdds, sourceSupport. (xFactor före spelbar, så att ett tryck på Spelbar
// jämförs med förslaget mot riktoddset med den nya X-faktorn.) Se också
// mergeMarkBodies för hur utkorgen slår ihop två kroppar.

import { isValidOdds, ODDS_RANGE_ERROR } from "@/lib/odds-input";
import { applyInteresting, applySpelbar, DEFAULT_TOLERANCE, type Override, type SpelbarInput } from "@/lib/spelbar";
import type { OddsSource } from "@/lib/types";
import type { Result } from "@/lib/validate";
import { DEFAULT_X_FACTORS, isXFactor, parseSourceSupport, riktoddsX, X_FACTOR_ERROR, X_NEEDS_INTERESTING, xTurnsOnInteresting, type XFactor, type XFactorSettings } from "@/lib/xfactor";

export type MarkChange = {
  interesting?: boolean;
  spelbar?: SpelbarInput;
  bet?: boolean;
  unibetOdds?: number | null;
  betOdds?: number | null;
  // E2.1 (6.8)
  xFactor?: XFactor;
  sourceSupport?: number | null;
};

export type MarkState = {
  interesting: boolean;
  interestingAt: Date | null;
  spelbarOverride: Override;
  bet: boolean;
  betAt: Date | null;
  betOdds: number | null;
  unibetOdds: number | null;
  unibetOddsAt: Date | null;
  unibetOddsPrev: number | null;
  xFactor: XFactor;
  xFactorAt: Date | null;
  sourceSupport: number | null;
  // E2.2: källan till unibetOdds och det ersatta egna oddset för Ångra.
  unibetOddsSource: OddsSource | null;
  replacedOdds: number | null;
  replacedByFetchId: string | null;
};

export const EMPTY_MARK: MarkState = {
  interesting: false,
  interestingAt: null,
  spelbarOverride: "NONE",
  bet: false,
  betAt: null,
  betOdds: null,
  unibetOdds: null,
  unibetOddsAt: null,
  unibetOddsPrev: null,
  xFactor: "NONE",
  xFactorAt: null,
  sourceSupport: null,
  unibetOddsSource: null,
  replacedOdds: null,
  replacedByFetchId: null,
};

const KEYS = ["interesting", "spelbar", "bet", "unibetOdds", "betOdds", "xFactor", "sourceSupport"] as const;
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const r2 = (x: number) => Math.round(x * 100) / 100;

export function parseMarkChange(body: Record<string, unknown>): Result<MarkChange> {
  const unknown = Object.keys(body).filter((k) => !(KEYS as readonly string[]).includes(k));
  if (unknown.length) return fail("Okänt fält i ändringen.");
  const out: MarkChange = {};
  if ("interesting" in body) {
    if (typeof body.interesting !== "boolean") return fail("interesting ska vara true eller false.");
    out.interesting = body.interesting;
  }
  if ("spelbar" in body) {
    if (body.spelbar !== "on" && body.spelbar !== "off" && body.spelbar !== "auto") return fail("spelbar ska vara on, off eller auto.");
    out.spelbar = body.spelbar;
  }
  if ("bet" in body) {
    if (typeof body.bet !== "boolean") return fail("bet ska vara true eller false.");
    out.bet = body.bet;
  }
  for (const k of ["unibetOdds", "betOdds"] as const) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v === null) out[k] = null;
    else if (isValidOdds(v)) out[k] = r2(v);
    else return fail(ODDS_RANGE_ERROR);
  }
  if ("xFactor" in body) {
    if (!isXFactor(body.xFactor)) return fail(X_FACTOR_ERROR);
    out.xFactor = body.xFactor;
  }
  if ("sourceSupport" in body) {
    const p = parseSourceSupport(body.sourceSupport);
    if (!p.ok) return p;
    out.sourceSupport = p.value;
  }
  // X-faktorn är en delmängd av Intressant: båda i samma kropp går inte ihop.
  if (out.interesting === false && out.xFactor !== undefined && out.xFactor !== "NONE") return fail(X_NEEDS_INTERESTING);
  if (!Object.keys(out).length) return fail("Inget att ändra.");
  return { ok: true, value: out };
}

// Sätter det här ändringen något "på" (Intressant, Spelbar, Bet, X-faktor
// eller ett källstöd)? Avvisas för strukna hästar. Att släcka eller rensa går.
export function turnsSomethingOn(c: MarkChange): boolean {
  return c.interesting === true || c.spelbar === "on" || c.bet === true || (c.xFactor !== undefined && c.xFactor !== "NONE") || (c.sourceSupport !== undefined && c.sourceSupport !== null);
}

// tolerance = användarens tolerans för Spelbar (E2.2, standard 0,10).
export type MarkCtx = { now: Date; riktodds: number | null; factors?: XFactorSettings; tolerance?: number };

export function applyMarkChange(prev: MarkState, c: MarkChange, ctx: MarkCtx): MarkState {
  const now = ctx.now;
  const factors = ctx.factors ?? DEFAULT_X_FACTORS;
  const next: MarkState = { ...prev };

  // 1. Unibet-odds. Ett nytt värde sparar det gamla för "Ändrat från … kl …".
  // Ett inskrivet odds får källan eget (E2.2, även samma värde som det
  // hämtade), och ett tomt fält ingen källa. Ångra för den senaste hämtningen
  // gäller inte längre för hästen.
  if (c.unibetOdds !== undefined) {
    if (c.unibetOdds !== prev.unibetOdds) {
      next.unibetOdds = c.unibetOdds;
      next.unibetOddsAt = now;
      next.unibetOddsPrev = c.unibetOdds === null ? null : prev.unibetOdds;
    }
    next.unibetOddsSource = c.unibetOdds === null ? null : "MANUAL";
    next.replacedOdds = null;
    next.replacedByFetchId = null;
  }

  // 2. Intressant. Tas den bort nollställs override och X-faktorn (6.1, 6.8).
  // Källstödet ligger kvar.
  if (c.interesting !== undefined) {
    next.interesting = c.interesting;
    next.interestingAt = c.interesting ? (prev.interesting ? prev.interestingAt ?? now : now) : null;
    next.spelbarOverride = applyInteresting(next.spelbarOverride, c.interesting);
    if (!c.interesting) {
      next.xFactor = "NONE";
      next.xFactorAt = null;
    }
  }

  // 3. X-faktor. Tror på och Stark känsla tänder Intressant. Ingen släcker
  // aldrig Intressant. override står kvar (förslaget räknas om vid läsning).
  // interesting: false + X ≠ Ingen i samma kropp avvisas redan i parseMarkChange.
  if (c.xFactor !== undefined && !(c.interesting === false && c.xFactor !== "NONE")) {
    if (xTurnsOnInteresting(c.xFactor) && !next.interesting) {
      next.interesting = true;
      next.interestingAt = now;
    }
    if (c.xFactor !== next.xFactor) {
      next.xFactor = c.xFactor;
      next.xFactorAt = c.xFactor === "NONE" ? null : now;
    }
  }

  // 4. Spelbar. "on" gör hästen Intressant. Kommer Intressant = false i samma
  // kropp vinner den (Spelbar kräver Intressant). Förslaget räknas mot
  // riktoddset med X-faktor.
  if (c.spelbar !== undefined && !(c.interesting === false && c.spelbar === "on")) {
    const rx = riktoddsX(ctx.riktodds, next.xFactor, factors);
    const s = applySpelbar({ interesting: next.interesting, unibetOdds: next.unibetOdds, riktodds: rx }, c.spelbar, ctx.tolerance ?? DEFAULT_TOLERANCE);
    if (s.interesting && !next.interesting) next.interestingAt = now;
    next.interesting = s.interesting;
    next.spelbarOverride = next.interesting ? s.override : "NONE";
  }

  // 5. Bet. Bet-tangenten sätter betOdds = aktuellt Unibet-odds. Rättas
  // oddset efter Bet följer betOdds med, om de inte har satts olika.
  const followed = prev.betOdds === null || prev.betOdds === prev.unibetOdds;
  if (c.bet !== undefined) {
    if (c.bet && !prev.bet) {
      next.bet = true;
      next.betAt = now;
      next.betOdds = next.unibetOdds;
    } else if (!c.bet) {
      next.bet = false;
      next.betAt = null;
      next.betOdds = null;
    }
  }
  if (next.bet && prev.bet && c.unibetOdds !== undefined && next.unibetOdds !== prev.unibetOdds && followed && next.unibetOdds !== null) {
    next.betOdds = next.unibetOdds;
  }

  // 6. Uttryckligt bet-odds (bara när hästen har Bet).
  if (c.betOdds !== undefined && next.bet) next.betOdds = c.betOdds;

  // 7. Källstöd (0–20 eller null). Påverkas inte av Intressant.
  if (c.sourceSupport !== undefined) next.sourceSupport = c.sourceSupport;
  return next;
}

// Utkorgen slår ihop två PUT mot samma start (lib/outbox.ts, enqueue). En ren
// överläggning ({ ...a, ...b }) ger fel när den senare kroppen tänder eller
// släcker Intressant i förhållande till den tidigare:
// - a släcker Intressant och b tänder den igen (X-faktor eller Spelbar på):
//   kombinationen { interesting: false, xFactor: "TROR" } vore 400, och
//   { interesting: false, spelbar: "on" } skulle tappa Spelbar. I stället
//   skickas det som släckningen gjorde (override och X nollställda) plus b.
// - b släcker Intressant: X-faktorn från a gäller inte längre.
export function mergeMarkBodies(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...a, ...b };
  const bTurnsOn = !("interesting" in b) && ((b.xFactor !== undefined && b.xFactor !== "NONE") || b.spelbar === "on");
  if (a.interesting === false && bTurnsOn) {
    delete merged.interesting;
    if (!("spelbar" in b)) merged.spelbar = "auto";
    if (!("xFactor" in b)) merged.xFactor = "NONE";
  }
  if (b.interesting === false && !("xFactor" in b)) delete merged.xFactor;
  return merged;
}

export function sameMark(a: MarkState, b: MarkState): boolean {
  const t = (d: Date | null) => (d ? d.getTime() : null);
  return (
    a.interesting === b.interesting &&
    t(a.interestingAt) === t(b.interestingAt) &&
    a.spelbarOverride === b.spelbarOverride &&
    a.bet === b.bet &&
    t(a.betAt) === t(b.betAt) &&
    a.betOdds === b.betOdds &&
    a.unibetOdds === b.unibetOdds &&
    t(a.unibetOddsAt) === t(b.unibetOddsAt) &&
    a.unibetOddsPrev === b.unibetOddsPrev &&
    a.xFactor === b.xFactor &&
    t(a.xFactorAt) === t(b.xFactorAt) &&
    a.sourceSupport === b.sourceSupport &&
    a.unibetOddsSource === b.unibetOddsSource &&
    a.replacedOdds === b.replacedOdds &&
    a.replacedByFetchId === b.replacedByFetchId
  );
}
