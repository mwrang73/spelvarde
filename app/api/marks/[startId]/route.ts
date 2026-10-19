import { NextResponse } from "next/server";
import { saveMark } from "@/lib/e2-server";
import { badRequest, isId, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";

// Idempotent: kroppen är hela tillståndet för fälten som skickas, något av
// { interesting, spelbar: "on" | "off" | "auto", bet, unibetOdds, betOdds,
//   xFactor: "NONE" | "TROR" | "STARK", sourceSupport: 0–20 | null }.
// Svarar { mark } med beräknade spelbar/forslag/riktoddsX. X ≠ NONE tänder
// Intressant, interesting: false nollställer X och override (båda i samma
// kropp: 400). Efter loppets starttid: 409 "Loppet har startat". Struken häst:
// 422 om något sätts på. Reglerna ligger i lib/marks.ts och lib/e2-server.ts.
export const PUT = withUser<{ startId: string }>("marks/[startId]", async ({ req, params, user }) => {
  if (!isId(params.startId)) return badRequest("Ogiltig start.");
  const body = await readJson(req, 2_000);
  if (!body) return badRequest("Ogiltig begäran.");
  const res = await saveMark(prisma, user.id, params.startId, body, new Date());
  return NextResponse.json(res.body, { status: res.status });
});
