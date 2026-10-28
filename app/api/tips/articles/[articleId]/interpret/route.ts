import { getTipsDeps } from "@/lib/deps";
import { badRequest, isId, readJson, replyJson } from "@/lib/http";
import { withUser } from "@/lib/route";
import { interpretArticle } from "@/lib/tips-server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// AI-tolkningen av en artikel (E5 10.7 och 12). Kropp {}. Svarar
// TipInterpretResponse. 409 UNCHANGED, DUPLICATE, BUSY och ROUND_CLOSED.
// 429 AI_QUOTA med quota. 503 AI_NOT_CONFIGURED (inget räknades). 502, 503
// och 504 AI_ERROR med quota (läsningen räknades).
export const POST = withUser<{ articleId: string }>("tips/articles/[articleId]/interpret", async ({ req, params, user }) => {
  if (!isId(params.articleId)) return badRequest("Ogiltig artikel.");
  if (!(await readJson(req, 2_000))) return badRequest("Ogiltig begäran.");
  return replyJson(await interpretArticle(getTipsDeps(), { userId: user.id, articleId: params.articleId }));
});
