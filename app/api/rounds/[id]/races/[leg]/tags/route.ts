import { NextResponse } from "next/server";
import { COMMENT_INCLUDE, commentDto } from "@/lib/dto";
import { badRequest, isId, notFound } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";

// Tagga loppet: användarens kommentarer av typen RACE för loppets starter
// (högst en per start). Sparas med PUT /api/comments/[clientId].
export const GET = withUser<{ id: string; leg: string }>("rounds/races/tags", async ({ params, user }) => {
  const leg = Number(params.leg);
  if (!isId(params.id) || !Number.isInteger(leg) || leg < 1 || leg > 8) return badRequest("Ogiltig avdelning.");
  const race = await prisma.race.findUnique({ where: { roundId_leg: { roundId: params.id, leg } }, select: { id: true } });
  if (!race) return notFound("Loppet finns inte.");
  const rows = await prisma.horseComment.findMany({
    where: { userId: user.id, kind: "RACE", deletedAt: null, start: { raceId: race.id } },
    include: COMMENT_INCLUDE,
  });
  return NextResponse.json({ comments: rows.map((c) => commentDto(c)) });
});
