import { NextResponse } from "next/server";
import { getFetchDeps } from "@/lib/deps";
import { jsonError } from "@/lib/http";
import { cronAuthorized, cronResults, slotOf } from "@/lib/results-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel Cron på lördagen (vercel.json, specen e4a 10.4): tre poster mot
// samma sökväg med olika scheman, som Vercel stöder (x-vercel-cron-schedule
// talar om vilken). Hämtar resultat och fryser Outcome för omgångar i dag och
// i går som inte är klara, även när appen är stängd. Vercel skickar
// "Authorization: Bearer <CRON_SECRET>".
export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) return jsonError(401, "Ej behörig.");
  const slot = slotOf(new URL(req.url).searchParams.get("slot"), req.headers.get("x-vercel-cron-schedule"));
  try {
    return NextResponse.json(await cronResults(getFetchDeps(), slot));
  } catch (e) {
    console.error("cron/results", e);
    return jsonError(500, "Resultathämtningen misslyckades.");
  }
}
