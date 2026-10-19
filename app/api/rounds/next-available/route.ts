import { NextResponse } from "next/server";
import { getFetchDeps } from "@/lib/deps";
import { settingsDto } from "@/lib/dto";
import { getNextAvailable } from "@/lib/next-available";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";

export const GET = withUser("rounds/next-available", async ({ user }) => {
  const { gameType } = settingsDto(await prisma.userSettings.findUnique({ where: { userId: user.id } }));
  return NextResponse.json(await getNextAvailable(prisma, getFetchDeps().atg, new Date(), gameType));
});
