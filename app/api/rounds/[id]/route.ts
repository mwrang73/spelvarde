import { NextResponse } from "next/server";
import { badRequest, isId, notFound } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { buildRoundResponse } from "@/lib/round-server";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";

// Hela omgången för klientens cache (9.1).
export const GET = withUser<{ id: string }>("rounds/[id]", async ({ params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig omgång.");
  const res = await buildRoundResponse(prisma, params.id, user.id, new Date());
  if (!res) return notFound("Omgången finns inte.");
  return NextResponse.json(res);
});
