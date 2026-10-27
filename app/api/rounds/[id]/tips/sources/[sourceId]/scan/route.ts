import { getTipsDeps } from "@/lib/deps";
import { badRequest, isId, replyJson } from "@/lib/http";
import { withUser } from "@/lib/route";
import { scanSource } from "@/lib/tips-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
// Region (e5 risk 7): svarar Travstugan inte från Vercels standardregion läggs
// här: export const preferredRegion = "arn1";

// Läser en källa för omgången (E5 10.6 och 12). Ingen kropp. Svarar
// TipScanResponse. Fel från sajten ger 200 med ok: false och error, så att
// kedjan fortsätter med nästa källa. 404 okänd källa eller omgång. 409
// SOURCE_DISABLED och ROUND_CLOSED. 429 SCAN_LOCKED med retryAfterSec (och
// Retry-After) inom 60 s.
export const POST = withUser<{ id: string; sourceId: string }>("rounds/[id]/tips/sources/[sourceId]/scan", async ({ params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig omgång.");
  if (!isId(params.sourceId)) return badRequest("Ogiltig källa.");
  return replyJson(await scanSource(getTipsDeps(), { userId: user.id, roundId: params.id, sourceId: params.sourceId }));
});
