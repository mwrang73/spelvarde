import { NextResponse } from "next/server";
import { THEME_FROM_API, settingsDto } from "@/lib/dto";
import { badRequest, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route";
import { parseSettingsBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const GET = withUser("settings/get", async ({ user }) => {
  const s = await prisma.userSettings.findUnique({ where: { userId: user.id } });
  return NextResponse.json(settingsDto(s));
});

// I E1 bara { theme: "system" | "light" | "dark" }.
export const PUT = withUser("settings/put", async ({ req, user }) => {
  const body = await readJson(req, 1_000);
  if (!body) return badRequest("Ogiltig begäran.");
  const parsed = parseSettingsBody(body);
  if (!parsed.ok) return badRequest(parsed.error);
  const theme = THEME_FROM_API[parsed.value.theme];
  const s = await prisma.userSettings.upsert({ where: { userId: user.id }, create: { userId: user.id, theme }, update: { theme } });
  return NextResponse.json(settingsDto(s));
});
