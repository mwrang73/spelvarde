import { getTipsDeps } from "@/lib/deps";
import { badRequest, isId, replyJson } from "@/lib/http";
import { withUser } from "@/lib/route";
import { buildTipsResponse } from "@/lib/tips-server";

export const dynamic = "force-dynamic";

// Granskningen och Källor (E5 12): artiklar, tips (utom borttagna), antal,
// dygnsgränsen och senaste läsningen. Svarar TipsResponse. 404 okänd omgång.
export const GET = withUser<{ id: string }>("rounds/[id]/tips", async ({ params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig omgång.");
  return replyJson(await buildTipsResponse(getTipsDeps(), { userId: user.id, roundId: params.id }));
});
