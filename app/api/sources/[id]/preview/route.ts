import { getTipsDeps } from "@/lib/deps";
import { badRequest, isId, replyJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { currentRoundId } from "@/lib/round-server";
import { withUser } from "@/lib/route";
import { previewSource } from "@/lib/tips-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Provläs (E5 S8 och 12): läser källan för aktuell omgång utan att spara
// något, utan AI och utan spärren. Svarar TipPreviewResponse (fel från sajten
// som ok: false och error). 404 okänd källa. 409 NO_ROUND utan omgång.
export const POST = withUser<{ id: string }>("sources/[id]/preview", async ({ params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig källa.");
  const roundId = await currentRoundId(prisma);
  return replyJson(await previewSource(getTipsDeps(), { userId: user.id, sourceId: params.id, roundId }));
});
