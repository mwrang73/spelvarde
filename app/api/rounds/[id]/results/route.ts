import { NextResponse } from "next/server";
import { AtgError } from "@/lib/atg";
import { getFetchDeps } from "@/lib/deps";
import { badRequest, isId, jsonError, notFound, readJson } from "@/lib/http";
import { resultsForClient } from "@/lib/results-server";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Resultathämtningen (specen e4a 6.10 och 12): pollningen i RoundProvider,
// knappen Hämta resultat och Försök igen. Kroppen { force?: boolean }.
// Claim på Round.liveSyncAt: ATG anropas högst var 50:e sekund (15:e med
// force), annars svarar rutten med senast sparade läge. Fryser Outcome för
// lopp som har startat och skriver resultaten. Ingen streck-snapshot.
// 502 { error: "ATG svarade inte." } när ATG inte svarar.
export const POST = withUser<{ id: string }>("rounds/[id]/results", async ({ req, params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig omgång.");
  const body = await readJson(req, 1_000);
  if (!body) return badRequest("Ogiltig kropp.");
  if (body.force !== undefined && typeof body.force !== "boolean") return badRequest("force ska vara true eller false.");
  const unknown = Object.keys(body).filter((k) => k !== "force");
  if (unknown.length) return badRequest("Okänt fält i kroppen.");
  try {
    const res = await resultsForClient(getFetchDeps(), { roundId: params.id, userId: user.id, force: body.force === true });
    if (!res) return notFound("Omgången finns inte.");
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof AtgError) return jsonError(502, "ATG svarade inte.");
    throw e;
  }
});
