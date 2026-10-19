import { NextResponse } from "next/server";
import { getFetchDeps } from "@/lib/deps";
import { getNextAvailable } from "@/lib/next-available";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";

export const GET = withUser("rounds/next-available", async () => NextResponse.json(await getNextAvailable(prisma, getFetchDeps().atg)));
