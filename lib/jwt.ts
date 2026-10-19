import { SignJWT, jwtVerify } from "jose";

// Edge-kompatibel (inga Node-bara APIs) - importeras av middleware.ts. Håll
// bcryptjs (lib/auth.ts) borta härifrån så den inte bundlas in i edge-runtimen.
export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 dagar

function authSecretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET saknas. Sätt den i miljövariablerna innan inloggning kan användas.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(userId: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(authSecretKey());
}

export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, authSecretKey());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
