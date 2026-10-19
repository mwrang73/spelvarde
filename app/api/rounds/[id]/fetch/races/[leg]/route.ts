import { NextResponse } from "next/server";
import { getFetchDeps } from "@/lib/deps";
import { fetchRaceStep } from "@/lib/fetch-round";
import { badRequest, isId } from "@/lib/http";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Steg 2–9: hästarnas tidigare starter i avdelningen. 502 när någon start
// misslyckades (det som hämtades är sparat; nästa försök tar bara om resten).
export const POST = withUser<{ id: string; leg: string }>("rounds/fetch/race", async ({ params, user }) => {
  const leg = Number(params.leg);
  if (!isId(params.id) || !Number.isInteger(leg) || leg < 1 || leg > 8) return badRequest("Ogiltig avdelning.");
  const res = await fetchRaceStep(getFetchDeps(), { roundId: params.id, leg, userId: user.id });
  if (!res.ok) {
    return NextResponse.json({ ...res, error: `Hämtningen stannade vid avd ${leg}: ATG svarade inte för ${res.failed.length} ${res.failed.length === 1 ? "häst" : "hästar"}. Det som redan hämtats är sparat.` }, { status: 502 });
  }
  return NextResponse.json(res);
});
