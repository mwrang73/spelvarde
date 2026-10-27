import { NextResponse } from "next/server";
import { buildRoundAnalysis } from "@/lib/analysis-server";
import { badRequest, isId, notFound } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";

// Efteranalysen för en omgång (lib/analysis.ts).
export const GET = withUser<{ id: string }>("rounds/[id]/analysis", async ({ params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig omgång.");
  const res = await buildRoundAnalysis(prisma, params.id, user.id);
  if (!res) return notFound("Omgången finns inte.");
  return NextResponse.json(res);
});
