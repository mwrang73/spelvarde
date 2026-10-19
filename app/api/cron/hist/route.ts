import { NextResponse } from "next/server";
import { atgFetch } from "@/lib/atg";
import { importHist } from "@/lib/hist";
import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel Cron varje morgon (vercel.json): lägger till gårdagens lopp i
// statistikbasen, och dagar som missats (högst 14 per körning). Vercel skickar
// "Authorization: Bearer <CRON_SECRET>".
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return jsonError(401, "Ej behörig.");
  try {
    const res = await importHist(prisma, atgFetch, { maxDays: 14 });
    return NextResponse.json({ days: res.days, races: res.races, failedDays: res.failedDays, complete: res.status.complete });
  } catch (e) {
    console.error("cron/hist", e);
    return jsonError(500, "Inläsningen misslyckades.");
  }
}
