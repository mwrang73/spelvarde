import { NextResponse } from "next/server";
import { AtgError, atgPaths, parseLegValues } from "@/lib/atg";
import { getFetchDeps } from "@/lib/deps";
import { badRequest, isId, jsonError, notFound } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route";
import type { LegValuesResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

// Värdet på alla rätt och antal system kvar efter varje klart lopp (rutan Omgången
// på Live). Läses direkt från ATG och sparas inte. Klienten anropar bara när ett
// nytt lopp är visat. 502 { error: "ATG svarade inte." } när ATG inte svarar.
export const GET = withUser<{ id: string }>("rounds/[id]/values", async ({ params }) => {
  if (!isId(params.id)) return badRequest("Ogiltig omgång.");
  const round = await prisma.round.findUnique({ where: { id: params.id }, select: { atgGameId: true, gameType: true } });
  if (!round) return notFound("Omgången finns inte.");
  try {
    const json = await getFetchDeps().atg(atgPaths.game(round.atgGameId));
    const res: LegValuesResponse = { values: parseLegValues(json, round.gameType) };
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof AtgError) return jsonError(502, "ATG svarade inte.");
    throw e;
  }
});
