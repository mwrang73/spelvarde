import { NextResponse } from "next/server";
import { getModel, saveModel } from "@/lib/e2-server";
import { badRequest, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Riktoddsmodellen (S10), bara ADMIN (403 annars).
export const GET = withUser("admin/model/get", async ({ user }) => {
  const res = await getModel(prisma, user);
  return NextResponse.json(res.body, { status: res.status });
});

// { weights?: { plats: 1.1, … }, params?: { beta, marginal, … }, roundId? }.
// Skapar en ny aktiv modellversion och räknar om omgången (angiven eller aktuell).
export const PUT = withUser("admin/model/put", async ({ req, user }) => {
  const body = await readJson(req, 4_000);
  if (!body) return badRequest("Ogiltig begäran.");
  const res = await saveModel(prisma, user, body, new Date());
  return NextResponse.json(res.body, { status: res.status });
});
