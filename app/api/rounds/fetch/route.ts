import { NextResponse } from "next/server";
import { getFetchDeps } from "@/lib/deps";
import { settingsDto } from "@/lib/dto";
import { fetchGameStep, GAME_ID_RE } from "@/lib/fetch-round";
import { badRequest, readJson } from "@/lib/http";
import { clearNextAvailableCache } from "@/lib/next-available";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Steg 1 i 10.1. Body { gameId? }. Utan gameId hämtas nästa spel av
// användarens spelform (S10).
export const POST = withUser("rounds/fetch", async ({ req, user }) => {
  const body = await readJson(req, 1_000);
  if (!body) return badRequest("Ogiltig begäran.");
  const gameId = body.gameId ?? null;
  if (gameId !== null && (typeof gameId !== "string" || !GAME_ID_RE.test(gameId))) return badRequest("Ogiltigt spel-id.");
  const { gameType } = settingsDto(await prisma.userSettings.findUnique({ where: { userId: user.id } }));
  const res = await fetchGameStep(getFetchDeps(), { gameId, userId: user.id, gameType });
  if (!res) return NextResponse.json({ error: `ATG har ingen ${gameType} de närmaste 7 dagarna än. Försök igen senare.`, code: "NO_GAME" }, { status: 404 });
  clearNextAvailableCache();
  return NextResponse.json(res);
});
