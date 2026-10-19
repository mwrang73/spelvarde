import { NextResponse } from "next/server";
import { badRequest, isId, notFound, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route";
import { parseReviewBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

// "Inga intressanta här" och Ångra. Body { reviewed, noneInteresting }.
// Idempotent. Gäller även efter start (påverkar inte statistiken).
export const PUT = withUser<{ id: string }>("races/review", async ({ req, params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltigt lopp.");
  const body = await readJson(req, 1_000);
  if (!body) return badRequest("Ogiltig begäran.");
  const parsed = parseReviewBody(body);
  if (!parsed.ok) return badRequest(parsed.error);
  const race = await prisma.race.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!race) return notFound("Loppet finns inte.");

  let review = null;
  if (parsed.value.reviewed) {
    review = await prisma.raceReview.upsert({
      where: { userId_raceId: { userId: user.id, raceId: race.id } },
      create: { userId: user.id, raceId: race.id, noneInteresting: parsed.value.noneInteresting },
      update: { noneInteresting: parsed.value.noneInteresting },
    });
  } else {
    await prisma.raceReview.deleteMany({ where: { userId: user.id, raceId: race.id } });
  }
  const interesting = await prisma.mark.count({ where: { userId: user.id, interesting: true, start: { raceId: race.id } } });
  return NextResponse.json({
    raceId: race.id,
    reviewed: !!review || interesting > 0,
    review: review ? { reviewedAt: review.reviewedAt.toISOString(), noneInteresting: review.noneInteresting } : null,
  });
});
