import { jsonError } from "@/lib/http";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";

// Hämta tips byggs i E5.
export const POST = withUser("sources/fetch-tips", async () => jsonError(501, "Kommer i en senare version"));
