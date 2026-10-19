import { NextResponse } from "next/server";
import { getFetchDeps } from "@/lib/deps";
import { fetchStatsStep } from "@/lib/fetch-round";
import { badRequest, isId } from "@/lib/http";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Steg 10: travstatistik.se. "Sidan visar en annan omgång" är inget fel i
// kedjan (sparas som ok = false och visas som "Statistik saknas just nu"),
// men nätverksfel ger 502 så att klienten kan försöka igen.
export const POST = withUser<{ id: string }>("rounds/fetch/stats", async ({ params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig omgång.");
  const res = await fetchStatsStep(getFetchDeps(), { roundId: params.id, userId: user.id });
  if (!res.ok) return NextResponse.json({ ...res, error: "Kunde inte hämta statistiken från travstatistik.se. Det som redan hämtats är sparat." }, { status: 502 });
  return NextResponse.json(res);
});
