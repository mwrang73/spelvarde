// GET /api/rounds/next-available: nästa spel av användarens spelform i ATG:s
// kalender, cachad i 10 min per serverinstans och spelform (specen 10.1). Fel hos ATG ger ok = false, aldrig ett
// kastat fel, eftersom Nästa steg ska fungera ändå.
import type { PrismaClient } from "@prisma/client";
import type { AtgFetch } from "@/lib/atg";
import { findNextGame } from "@/lib/fetch-round";
import { DEFAULT_GAME_TYPE, type GameType } from "@/lib/game-type";
import { stockholmDateString } from "@/lib/stockholm-time";
import type { NextAvailableResponse } from "@/lib/types";

export const NEXT_AVAILABLE_TTL_MS = 10 * 60_000;

type Entry = { at: number; game: NextAvailableResponse["game"]; ok: boolean };
const caches = new Map<GameType, Entry>();

export function clearNextAvailableCache() {
  caches.clear();
}

export async function getNextAvailable(db: PrismaClient, atg: AtgFetch, now = new Date(), gameType: GameType = DEFAULT_GAME_TYPE): Promise<NextAvailableResponse> {
  let cache = caches.get(gameType);
  if (!cache || now.getTime() - cache.at > NEXT_AVAILABLE_TTL_MS) {
    try {
      const g = await findNextGame(atg, now, gameType);
      cache = {
        at: now.getTime(),
        ok: true,
        game: g ? { gameId: g.id, gameType, trackName: g.trackName, date: stockholmDateString(g.startTime), firstStartAt: g.startTime.toISOString(), status: g.status } : null,
      };
      caches.set(gameType, cache);
    } catch (e) {
      console.warn("next-available: ATG svarade inte", e instanceof Error ? e.message : e);
      // Misslyckade uppslag cachas inte.
      return { game: null, fetched: false, roundId: null, checkedAt: now.toISOString(), ok: false };
    }
  }
  const round = cache.game ? await db.round.findUnique({ where: { atgGameId: cache.game.gameId }, select: { id: true } }) : null;
  return { game: cache.game, fetched: !!round, roundId: round?.id ?? null, checkedAt: new Date(cache.at).toISOString(), ok: cache.ok };
}
