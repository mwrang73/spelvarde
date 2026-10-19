import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { badRequest, readJson } from "@/lib/http";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";

// Byt lösenord: { currentPassword, newPassword }. POST enligt specen, PATCH
// som i Tabellgissningen.
const handler = withUser("auth/password", async ({ req, user }) => {
  const body = await readJson(req, 4_000);
  if (!body) return badRequest("Ogiltig begäran.");
  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");
  if (!(await verifyPassword(currentPassword, user.passwordHash))) return badRequest("Fel nuvarande lösenord.");
  if (newPassword.length < 10) return badRequest("Det nya lösenordet måste vara minst 10 tecken.");
  if (newPassword.length > 200) return badRequest("Det nya lösenordet är för långt.");
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } });
  return NextResponse.json({ ok: true });
});

export const POST = handler;
export const PATCH = handler;
