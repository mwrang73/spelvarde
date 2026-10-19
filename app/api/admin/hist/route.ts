import { NextResponse } from "next/server";
import { getFetchDeps } from "@/lib/deps";
import { histStatus, importHist } from "@/lib/hist";
import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ADMIN_ONLY = "Bara administratören kan läsa in statistikbasen.";

// Statistikbasen (S10): läget.
export const GET = withUser("admin/hist/get", async ({ user }) => {
  if (user.role !== "ADMIN") return jsonError(403, ADMIN_ONLY);
  return NextResponse.json(await histStatus(prisma));
});

// Läser in dagar som saknas i högst ~40 s och svarar med läget. Klienten
// anropar igen tills status.complete är sant.
export const POST = withUser("admin/hist/post", async ({ user }) => {
  if (user.role !== "ADMIN") return jsonError(403, ADMIN_ONLY);
  return NextResponse.json(await importHist(prisma, getFetchDeps().atg));
});
