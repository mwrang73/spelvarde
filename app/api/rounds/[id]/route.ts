import { NextResponse } from "next/server";
import { getFetchDeps } from "@/lib/deps";
import { badRequest, isId, notFound } from "@/lib/http";
import { getNextAvailable } from "@/lib/next-available";
import { prisma } from "@/lib/prisma";
import { buildRoundResponse } from "@/lib/round-server";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";

// Hela omgången för klientens cache (9.1).
export const GET = withUser<{ id: string }>("rounds/[id]", async ({ params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig omgång.");
  const now = new Date();
  const res = await buildRoundResponse(prisma, params.id, user.id, now, (gameType) => getNextAvailable(prisma, getFetchDeps().atg, now, gameType));
  if (!res) return notFound("Omgången finns inte.");
  return NextResponse.json(res);
});
