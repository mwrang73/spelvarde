import { getTipsDeps } from "@/lib/deps";
import { badRequest, isId, readJson, replyJson } from "@/lib/http";
import { withUser } from "@/lib/route";
import { undoTips } from "@/lib/tips-server";

export const dynamic = "force-dynamic";

// Ångra (E5 12). Kropp { ids: string[] } (1–100, samma omgång). Återställer
// varje tips till läget före dess senaste åtgärd. 409 NOTHING_TO_UNDO och
// RACE_STARTED. Svarar TipActionResponse.
export const POST = withUser("tips/undo", async ({ req, user }) => {
  const body = await readJson(req, 8_000);
  if (!body) return badRequest("Ogiltig begäran.");
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || !ids.every(isId)) return badRequest("ids ska vara 1–100 tips.");
  return replyJson(await undoTips(getTipsDeps(), { userId: user.id, ids: [...new Set(ids as string[])] }));
});
