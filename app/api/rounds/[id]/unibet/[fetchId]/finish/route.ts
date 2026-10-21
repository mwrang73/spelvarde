import { NextResponse } from "next/server";
import { getUnibetDeps } from "@/lib/deps";
import { badRequest, isId } from "@/lib/http";
import { withUser } from "@/lib/route";
import { finishOddsFetch } from "@/lib/unibet-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Oddsdelen steg 3. Utan priser tas hämtningen bort: { saved: false }. Annars
// sätts finishedAt och svaret är { saved: true, withOdds, fetchId, takenAt,
// finishedAt, legsOk, legsFailed, legsSkipped }. Kan köras igen efter en
// omkörd avdelning.
export const POST = withUser<{ id: string; fetchId: string }>("rounds/[id]/unibet/[fetchId]/finish", async ({ params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig omgång.");
  if (!isId(params.fetchId)) return badRequest("Ogiltig hämtning.");
  const res = await finishOddsFetch(getUnibetDeps(), { roundId: params.id, fetchId: params.fetchId, userId: user.id });
  return NextResponse.json(res.body, { status: res.status });
});
