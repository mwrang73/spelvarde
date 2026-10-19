import { NextResponse } from "next/server";
import { getCoupon, saveCoupon } from "@/lib/e2-server";
import { badRequest, isId, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";

// V85-raden (6.5), en per användare och omgång.
export const GET = withUser<{ id: string }>("rounds/[id]/coupon/get", async ({ params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig omgång.");
  const res = await getCoupon(prisma, user.id, params.id);
  return NextResponse.json(res.body, { status: res.status });
});

// Hela kupongen { budget, rowPrice?, selections: { "1": [3, 10], … }, lockedLegs }.
// Idempotent. Ändrat val i en avdelning som har startat ger 409.
export const PUT = withUser<{ id: string }>("rounds/[id]/coupon/put", async ({ req, params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig omgång.");
  const body = await readJson(req, 8_000);
  if (!body) return badRequest("Ogiltig begäran.");
  const res = await saveCoupon(prisma, user.id, params.id, body, new Date());
  return NextResponse.json(res.body, { status: res.status });
});
