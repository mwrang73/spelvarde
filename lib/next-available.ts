// GET /api/rounds/next-available: nästa V85 i ATG:s kalender, cachad i 10 min
// per serverinstans (specen 10.1). Fel hos ATG ger ok = false, aldrig ett
// kastat fel, eftersom Nästa steg ska fungera ändå.
import type { PrismaClient } from "@prisma/client";
import type { AtgFetch } from "@/lib/atg";
import { findNextV85 } from "@/lib/fetch-round";
import { stockholmDateString } from "@/lib/stockholm-time";
import type { NextAvailableResponse } from "@/lib/types";

export const NEXT_AVAILABLE_TTL_MS = 10 * 60_000;

let cache: { at: number; game: NextAvailableResponse["game"]; ok: boolean } | null = null;

export function clearNextAvailableCache() {
  cache = null;
}

export async function getNextAvailable(db: PrismaClient, atg: AtgFetch, now = new Date()): Promise<NextAvailableResponse> {
  if (!cache || now.getTime() - cache.at > NEXT_AVAILABLE_TTL_MS) {
    try {
      const g = await findNextV85(atg, now);
      cache = {
        at: now.getTime(),
        ok: true,
        game: g ? { gameId: g.id, trackName: g.trackName, date: stockholmDateString(g.startTime), firstStartAt: g.startTime.toISOString(), status: g.status } : null,
      };
    } catch (e) {
      console.warn("next-available: ATG svarade inte", e instanceof Error ? e.message : e);
      // Misslyckade uppslag cachas inte.
      return { game: null, fetched: false, roundId: null, checkedAt: now.toISOString(), ok: false };
    }
  }
  const round = cache.game ? await db.round.findUnique({ where: { atgGameId: cache.game.gameId }, select: { id: true } }) : null;
  return { game: cache.game, fetched: !!round, roundId: round?.id ?? null, checkedAt: new Date(cache.at).toISOString(), ok: cache.ok };
}
