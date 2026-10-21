import { NextResponse } from "next/server";
import { getUnibetDeps } from "@/lib/deps";
import { badRequest, isId, readJson } from "@/lib/http";
import { withUser } from "@/lib/route";
import { parseUndoBody, undoOddsFetch } from "@/lib/unibet-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Ångra (e2.2 6.9): body { startId? }. Återställer de egna odds som
// hämtningen ersatte (en häst, eller alla utan startId) med källan eget.
// Svarar { restored: [{ startId, odds }], marks: MarkDto[] }. 409 med "Ångra
// gäller bara den senaste hämtningen." om en nyare finns, och 409 "Loppet har
// startat" efter start.
export const POST = withUser<{ id: string; fetchId: string }>("rounds/[id]/unibet/[fetchId]/undo", async ({ req, params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig omgång.");
  if (!isId(params.fetchId)) return badRequest("Ogiltig hämtning.");
  const body = await readJson(req, 1_000);
  if (!body) return badRequest("Ogiltig begäran.");
  const parsed = parseUndoBody(body);
  if (!parsed.ok) return badRequest(parsed.error);
  const res = await undoOddsFetch(getUnibetDeps(), { roundId: params.id, fetchId: params.fetchId, userId: user.id, startId: parsed.startId });
  return NextResponse.json(res.body, { status: res.status });
});
