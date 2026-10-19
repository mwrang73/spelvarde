import { NextResponse } from "next/server";
import { badRequest, isId, notFound } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { riktoddsStep } from "@/lib/riktodds-server";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Steg 11 i 10.1 och "Räkna om omgången" (7.5): räknar riktodds för alla
// starter med den aktiva modellen och sparar dem. Ingen indata i kroppen.
export const POST = withUser<{ id: string }>("rounds/[id]/riktodds", async ({ params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig omgång.");
  const res = await riktoddsStep(prisma, { roundId: params.id, userId: user.id });
  if (!res) return notFound("Omgången finns inte.");
  return NextResponse.json(res);
});
