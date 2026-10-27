import { getTipsDeps } from "@/lib/deps";
import { badRequest, isId, replyJson } from "@/lib/http";
import { withUser } from "@/lib/route";
import { approveTip } from "@/lib/tips-server";

export const dynamic = "force-dynamic";

// Godkänn ett tips (E5 12). Ingen kropp. 409 NOT_LINKED "Välj häst först."
// och RACE_STARTED. Svarar TipActionResponse (message när ett nyare tips från
// samma källa redan gäller och det här blev historik direkt).
export const POST = withUser<{ id: string }>("tips/[id]/approve", async ({ params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltigt tips.");
  return replyJson(await approveTip(getTipsDeps(), { userId: user.id, tipId: params.id }));
});
