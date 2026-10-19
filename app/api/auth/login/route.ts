import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";
import { setSessionCookie } from "@/lib/session";
import { badRequest, jsonError, readJson, serverError } from "@/lib/http";
import { loginThrottle } from "@/lib/login-throttle";

export const dynamic = "force-dynamic";

// Ingen registrering: Mikael skapas av scripts/seed.mjs.
export async function POST(request: Request) {
  try {
    const body = await readJson(request, 4_000);
    if (!body) return badRequest("Ogiltig begäran.");
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!email || !password) return jsonError(401, "Fel e-postadress eller lösenord.");
    if (loginThrottle.blocked(email)) return jsonError(429, "För många försök. Vänta en stund och försök igen.");

    const user = await prisma.user.findUnique({ where: { email } });
    const passwordOk = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !passwordOk) {
      loginThrottle.fail(email);
      return jsonError(401, "Fel e-postadress eller lösenord.");
    }
    if (user.status !== "APPROVED") return jsonError(403, "Kontot är inte aktivt.");

    loginThrottle.reset(email);
    await setSessionCookie(user.id);
    return NextResponse.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  } catch (e) {
    return serverError("auth/login", e);
  }
}
