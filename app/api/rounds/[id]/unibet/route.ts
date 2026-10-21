import { NextResponse } from "next/server";
import { getUnibetDeps } from "@/lib/deps";
import { badRequest, isId } from "@/lib/http";
import { withUser } from "@/lib/route";
import { startOddsFetch } from "@/lib/unibet-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
// Region (e2.2 10.5): avgörs efter provet från en förhandsdeploy. Svarar
// Unibet inte från Vercels standardregion läggs här, och i de tre rutterna
// under [fetchId]: export const preferredRegion = "arn1";

// Hämta streck och odds, oddsdelen steg 1 (e2.2 6.9 och 12). Ingen indata.
// Kontrollerar spärren (429 { error, retryAfterSec }), skapar OddsFetch och
// slår upp banan och loppen hos Unibet. Svarar { fetchId, takenAt, legs } eller
// { fetchId: null, noMeeting: true, legs: [] } när banan inte finns (inget sparas).
// 502 när Unibet inte svarar (inget sparas, spärren gäller inte).
export const POST = withUser<{ id: string }>("rounds/[id]/unibet", async ({ params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig omgång.");
  const res = await startOddsFetch(getUnibetDeps(), { roundId: params.id, userId: user.id });
  return NextResponse.json(res.body, { status: res.status, headers: res.status === 429 && "retryAfterSec" in res.body ? { "Retry-After": String(res.body.retryAfterSec) } : undefined });
});
