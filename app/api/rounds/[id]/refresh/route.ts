import { NextResponse } from "next/server";
import { getFetchDeps } from "@/lib/deps";
import { refreshStreck } from "@/lib/fetch-round";
import { badRequest, isId, notFound } from "@/lib/http";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Knappen "Uppdatera streck och riktodds", del 1: nytt streck från ATG.
// Klienten räknar sedan om riktoddset med POST /api/rounds/[id]/riktodds.
// Ingen indata i kroppen.
export const POST = withUser<{ id: string }>("rounds/[id]/refresh", async ({ params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig omgång.");
  const res = await refreshStreck(getFetchDeps(), { roundId: params.id, userId: user.id });
  if (!res) return notFound("Omgången finns inte.");
  return NextResponse.json(res);
});
