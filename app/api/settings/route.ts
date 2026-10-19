import { NextResponse } from "next/server";
import { settingsDto } from "@/lib/dto";
import { saveSettings } from "@/lib/e2-server";
import { badRequest, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";

export const GET = withUser("settings/get", async ({ user }) => {
  const s = await prisma.userSettings.findUnique({ where: { userId: user.id } });
  return NextResponse.json(settingsDto(s));
});

// Något av { theme: "system" | "light" | "dark", rowPrice, spelbarGuideline,
// xFactorTror, xFactorStark }. Bara fälten som skickas ändras. Svarar med alla
// inställningar. Reglerna ligger i lib/validate.ts och lib/e2-server.ts.
export const PUT = withUser("settings/put", async ({ req, user }) => {
  const body = await readJson(req, 1_000);
  if (!body) return badRequest("Ogiltig begäran.");
  const res = await saveSettings(prisma, user.id, body);
  return NextResponse.json(res.body, { status: res.status });
});
