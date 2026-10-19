import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/jwt";

// Snabb JWT-koll i edge-runtimen (ingen databas här). Färsk koll av
// användaren görs i varje rutt via lib/session.ts (lib/route.ts).
const PUBLIC_API_PATHS = ["/api/auth/login"];
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const isAuthenticated = !!token && !!(await verifySessionToken(token));

  if (pathname === "/login") {
    if (isAuthenticated) return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    // Skrivande anrop från en annan webbplats avvisas (utöver SameSite=Lax).
    if (UNSAFE.has(request.method)) {
      const origin = request.headers.get("origin");
      if (origin && origin !== request.nextUrl.origin) {
        return NextResponse.json({ error: "Otillåten begäran." }, { status: 403 });
      }
    }
    // /api/cron/* (E3–E4) skyddas av CRON_SECRET i rutten, inte av inloggning.
    if (PUBLIC_API_PATHS.includes(pathname) || pathname.startsWith("/api/cron/") || isAuthenticated) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: "Ej inloggad." }, { status: 401 });
  }

  if (!isAuthenticated) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)"],
};
