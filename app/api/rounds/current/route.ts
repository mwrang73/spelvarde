import { NextResponse } from "next/server";
import { getFetchDeps } from "@/lib/deps";
import { getNextAvailable } from "@/lib/next-available";
import { prisma } from "@/lib/prisma";
import { buildCurrentResponse } from "@/lib/round-server";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";

// Aktuell omgång med fas, avdelningar och Nästa steg (S1).
export const GET = withUser("rounds/current", async ({ user }) => {
  const now = new Date();
  const res = await buildCurrentResponse(prisma, user.id, now, (gameType) => getNextAvailable(prisma, getFetchDeps().atg, now, gameType));
  return NextResponse.json(res);
});
