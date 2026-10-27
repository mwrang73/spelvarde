import { getTipsDeps } from "@/lib/deps";
import { badRequest, isId, readJson, replyJson } from "@/lib/http";
import { withUser } from "@/lib/route";
import { editTip, rejectTip } from "@/lib/tips-server";

export const dynamic = "force-dynamic";

// Rätta och Välj (E5 12). Kropp { startId?: string, role?: TipRole }, minst
// ett fält. Sparar, sätter editedByUser, match SURE och inga flaggor, och
// godkänner. 400 "Okänd roll." och "Starten finns inte i omgången." 409
// RACE_STARTED (gamla eller nya starten). Svarar TipActionResponse.
export const PATCH = withUser<{ id: string }>("tips/[id]/patch", async ({ req, params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltigt tips.");
  const body = await readJson(req, 2_000);
  if (!body) return badRequest("Ogiltig begäran.");
  if (body.startId !== undefined && !isId(body.startId)) return badRequest("Starten finns inte i omgången.");
  if (body.role !== undefined && typeof body.role !== "string") return badRequest("Okänd roll.");
  return replyJson(
    await editTip(getTipsDeps(), {
      userId: user.id,
      tipId: params.id,
      startId: body.startId as string | undefined,
      role: body.role as string | undefined,
    }),
  );
});

// Ta bort (E5 12): review = REJECTED. Var tipset gällande blir tipset det
// ersatte gällande igen. Svarar TipActionResponse. 409 RACE_STARTED.
export const DELETE = withUser<{ id: string }>("tips/[id]/delete", async ({ params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltigt tips.");
  return replyJson(await rejectTip(getTipsDeps(), { userId: user.id, tipId: params.id }));
});
