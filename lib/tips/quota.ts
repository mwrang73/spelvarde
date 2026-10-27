// Dygnsgränsen och kostnaden för AI-läsningar (E5 6.11 och 10.7). Ren modul.
// Dygnet är 00:00–24:00 i Europe/Stockholm, också över sommartidsbytet.
import { addDaysToDateString, stockholmDateString, stockholmLocalToUtc } from "@/lib/stockholm-time";

export const AI_DAILY_LIMIT = 20;
export const PRICE_IN_PER_MTOK = 3;
export const PRICE_OUT_PER_MTOK = 15;

export function dayStart(now: Date): Date {
  return stockholmLocalToUtc(`${stockholmDateString(now)}T00:00`);
}

export function nextDayStart(now: Date): Date {
  return stockholmLocalToUtc(`${addDaysToDateString(stockholmDateString(now), 1)}T00:00`);
}

// USD, sex decimaler (AiUsage.costUsd är Decimal(10,6)).
export function costUsd(inputTokens: number, outputTokens: number, priceIn: number, priceOut: number): number {
  return Math.round(((inputTokens * priceIn + outputTokens * priceOut) / 1_000_000) * 1e6) / 1e6;
}

const positive = (raw: string | undefined, fallback: number) => {
  const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// Gränsen och priserna ur miljön (SPELVARDE_AI_DAILY_LIMIT, ANTHROPIC_PRICE_*).
export function aiSettings(env: Record<string, string | undefined> = process.env) {
  return {
    limit: Math.floor(positive(env.SPELVARDE_AI_DAILY_LIMIT, AI_DAILY_LIMIT)),
    priceIn: positive(env.ANTHROPIC_PRICE_IN_PER_MTOK, PRICE_IN_PER_MTOK),
    priceOut: positive(env.ANTHROPIC_PRICE_OUT_PER_MTOK, PRICE_OUT_PER_MTOK),
  };
}
