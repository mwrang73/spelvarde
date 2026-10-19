import { NextResponse } from "next/server";
import { badRequest, isId, notFound } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { buildRaceStats } from "@/lib/round-server";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";

// Loppstatistik S2b.
export const GET = withUser<{ id: string; leg: string }>("rounds/races/stats", async ({ params }) => {
  const leg = Number(params.leg);
  if (!isId(params.id) || !Number.isInteger(leg) || leg < 1 || leg > 8) return badRequest("Ogiltig avdelning.");
  const res = await buildRaceStats(prisma, params.id, leg, new Date());
  if (!res) return notFound("Avdelningen finns inte.");
  return NextResponse.json(res);
});
