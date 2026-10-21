import { NextResponse } from "next/server";
import { getUnibetDeps } from "@/lib/deps";
import { badRequest, isId } from "@/lib/http";
import { withUser } from "@/lib/route";
import { fetchOddsLeg } from "@/lib/unibet-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Oddsdelen steg 2: en avdelning (1 anrop mot Unibet). Skriver UnibetPrice och
// användarens Mark för alla starter som inte är strukna hos ATG. Bet-oddset
// ändras aldrig. Går att köra om (räknas inte mot spärren). Svarar
// { leg, ok, noPrices, withOdds, missing, scratchedAtUnibet, replaced }; 502
// med ok: false och error när Unibet inte svarade, 409 när loppet har startat
// eller en nyare hämtning finns.
export const POST = withUser<{ id: string; fetchId: string; leg: string }>("rounds/[id]/unibet/[fetchId]/legs/[leg]", async ({ params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig omgång.");
  if (!isId(params.fetchId)) return badRequest("Ogiltig hämtning.");
  const leg = /^[1-8]$/.test(params.leg) ? Number(params.leg) : NaN;
  if (!Number.isInteger(leg)) return badRequest("Ogiltig avdelning.");
  const res = await fetchOddsLeg(getUnibetDeps(), { roundId: params.id, fetchId: params.fetchId, leg, userId: user.id });
  return NextResponse.json(res.body, { status: res.status });
});
