import { NextResponse } from "next/server";
import { buildOverTime } from "@/lib/analysis-server";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";

// Statistik · Över tid: ?period=4 | 8 | alla (standard 8).
export const GET = withUser("analysis", async ({ req, user }) => {
  const p = new URL(req.url).searchParams.get("period");
  const period = p === "alla" ? null : p === "4" ? 4 : 8;
  return NextResponse.json(await buildOverTime(prisma, user.id, period));
});
