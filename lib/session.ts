import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, createSessionToken, verifySessionToken } from "@/lib/jwt";

export async function setSessionCookie(userId: string) {
  const token = await createSessionToken(userId);
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie() {
  cookies().set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}

// Slår alltid upp användaren färskt i databasen (inte bara JWT-payloaden) så att
// en rolländring eller nekad/borttagen användare får effekt direkt, utan att
// vänta ut sessionens livslängd.
export async function getCurrentUser() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const userId = await verifySessionToken(token);
  if (!userId) return null;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== "APPROVED") return null;

  return user;
}

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
