import { getTipsDeps } from "@/lib/deps";
import { badRequest, isId, readJson, replyJson } from "@/lib/http";
import { withUser } from "@/lib/route";
import { approveSure } from "@/lib/tips-server";

export const dynamic = "force-dynamic";

// Godkänn alla säkra (E5 12). Kropp { articleId?: string }. Godkänner alla
// väntande säkra tips som inte är låsta eller ersatta, i omgången eller i
// artikeln. Svarar TipActionResponse (tips = de godkända, kan vara tom).
export const POST = withUser<{ id: string }>("rounds/[id]/tips/approve", async ({ req, params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig omgång.");
  const body = await readJson(req, 2_000);
  if (!body) return badRequest("Ogiltig begäran.");
  const articleId = body.articleId ?? null;
  if (articleId !== null && !isId(articleId)) return badRequest("Ogiltig artikel.");
  return replyJson(await approveSure(getTipsDeps(), { userId: user.id, roundId: params.id, articleId }));
});
