import { NextResponse } from "next/server";
import { badRequest, isId, notFound } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { buildStartDetail } from "@/lib/round-server";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";

// Hästkortet S3: tidigare starter, statistik och användarens kommentarer.
export const GET = withUser<{ id: string }>("starts/[id]", async ({ params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig start.");
  const res = await buildStartDetail(prisma, params.id, user.id, new Date());
  if (!res) return notFound("Starten finns inte.");
  return NextResponse.json(res);
});
