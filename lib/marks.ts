// PUT /api/marks/[startId] (specen 12, 6.1 och S6a): tolkning av kroppen och
// hur en ändring läggs på en Mark. Rena funktioner, så att servern och
// klientens optimistiska läge kan använda samma regler. Testade i
// lib/marks.test.ts.
//
// Kroppen är hela tillståndet för fälten som skickas (idempotent: samma kropp
// två gånger ger samma Mark). Utkorgen slår ihop två PUT mot samma start
// genom att lägga den senare kroppen över den tidigare, därför tillämpas
// fälten i en fast ordning: unibetOdds, interesting, spelbar, bet, betOdds.

import { isValidOdds, ODDS_RANGE_ERROR } from "@/lib/odds-input";
import { applyInteresting, applySpelbar, type Override, type SpelbarInput } from "@/lib/spelbar";
import type { Result } from "@/lib/validate";

export type MarkChange = {
  interesting?: boolean;
  spelbar?: SpelbarInput;
  bet?: boolean;
  unibetOdds?: number | null;
  betOdds?: number | null;
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
};

const KEYS = ["interesting", "spelbar", "bet", "unibetOdds", "betOdds"] as const;
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
  if (!Object.keys(out).length) return fail("Inget att ändra.");
  return { ok: true, value: out };
}

// Sätter det här ändringen något "på" (Intressant, Spelbar, Bet)? Avvisas för strukna hästar.
export function turnsSomethingOn(c: MarkChange): boolean {
  return c.interesting === true || c.spelbar === "on" || c.bet === true;
}

export function applyMarkChange(prev: MarkState, c: MarkChange, ctx: { now: Date; riktodds: number | null }): MarkState {
  const now = ctx.now;
  const next: MarkState = { ...prev };

  // 1. Unibet-odds. Ett nytt värde sparar det gamla för "Ändrat från … kl …".
  if (c.unibetOdds !== undefined && c.unibetOdds !== prev.unibetOdds) {
    next.unibetOdds = c.unibetOdds;
    next.unibetOddsAt = now;
    next.unibetOddsPrev = c.unibetOdds === null ? null : prev.unibetOdds;
  }

  // 2. Intressant. Tas den bort nollställs override.
  if (c.interesting !== undefined) {
    next.interesting = c.interesting;
    next.interestingAt = c.interesting ? (prev.interesting ? prev.interestingAt ?? now : now) : null;
    next.spelbarOverride = applyInteresting(next.spelbarOverride, c.interesting);
  }

  // 3. Spelbar. "on" gör hästen Intressant. Kommer Intressant = false i samma
  // kropp vinner den (Spelbar kräver Intressant).
  if (c.spelbar !== undefined && !(c.interesting === false && c.spelbar === "on")) {
    const s = applySpelbar({ interesting: next.interesting, unibetOdds: next.unibetOdds, riktodds: ctx.riktodds }, c.spelbar);
    if (s.interesting && !next.interesting) next.interestingAt = now;
    next.interesting = s.interesting;
    next.spelbarOverride = next.interesting ? s.override : "NONE";
  }

  // 4. Bet. Bet-tangenten sätter betOdds = aktuellt Unibet-odds. Rättas
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

  // 5. Uttryckligt bet-odds (bara när hästen har Bet).
  if (c.betOdds !== undefined && next.bet) next.betOdds = c.betOdds;
  return next;
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
    a.unibetOddsPrev === b.unibetOddsPrev
  );
}
