import { NextResponse } from "next/server";
import { markDto } from "@/lib/dto";
import { badRequest, isId, jsonError, notFound, raceStarted, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route";
import { parseMarkBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

// Idempotent: kroppen är hela tillståndet för fälten som skickas.
// I E1 bara { interesting }. Efter loppets starttid: 409 "Loppet har startat".
export const PUT = withUser<{ startId: string }>("marks/[startId]", async ({ req, params, user }) => {
  if (!isId(params.startId)) return badRequest("Ogiltig start.");
  const body = await readJson(req, 2_000);
  if (!body) return badRequest("Ogiltig begäran.");
  const parsed = parseMarkBody(body);
  if (!parsed.ok) return badRequest(parsed.error);

  const start = await prisma.start.findUnique({ where: { id: params.startId }, select: { id: true, scratched: true, race: { select: { startAt: true } } } });
  if (!start) return notFound("Starten finns inte.");
  const now = new Date();
  if (start.race.startAt.getTime() <= now.getTime()) return raceStarted();
  if (start.scratched && parsed.value.interesting) return jsonError(422, "Hästen är struken.");

  const { interesting } = parsed.value;
  const existing = await prisma.mark.findUnique({ where: { userId_startId: { userId: user.id, startId: start.id } } });
  const mark = await prisma.mark.upsert({
    where: { userId_startId: { userId: user.id, startId: start.id } },
    create: { userId: user.id, startId: start.id, interesting, interestingAt: interesting ? now : null },
    update: {
      interesting,
      interestingAt: interesting ? (existing?.interestingAt ?? now) : null,
      // Spelbar är en delmängd av Intressant (6.1).
      ...(interesting ? {} : { spelbarOverride: "NONE" as const }),
    },
  });
  return NextResponse.json({ mark: markDto(mark) });
});
