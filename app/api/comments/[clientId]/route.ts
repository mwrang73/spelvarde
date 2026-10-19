import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { COMMENT_INCLUDE, commentDto } from "@/lib/dto";
import { badRequest, jsonError, notFound, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route";
import { isUuid, parseCommentBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

// Idempotent upsert på (userId, clientId). Kommentarer får skrivas även efter
// start. Body { horseId, startId?, roundId?, kind, tags, text }. Omgången
// tas från starten när den finns (klientens roundId litas inte på då).
// En PUT på en borttagen kommentar tar fram den igen (Ångra).
export const PUT = withUser<{ clientId: string }>("comments/put", async ({ req, params, user }) => {
  if (!isUuid(params.clientId)) return badRequest("Ogiltigt kommentar-id.");
  const body = await readJson(req, 16_000);
  if (!body) return badRequest("Ogiltig begäran.");
  const parsed = parseCommentBody(body);
  if (!parsed.ok) return badRequest(parsed.error);
  const input = parsed.value;

  const horse = await prisma.horse.findUnique({ where: { id: input.horseId }, select: { id: true } });
  if (!horse) return notFound("Hästen finns inte.");
  let roundId = input.roundId;
  if (input.startId) {
    const start = await prisma.start.findUnique({ where: { id: input.startId }, select: { horseId: true, race: { select: { roundId: true } } } });
    if (!start || start.horseId !== input.horseId) return jsonError(422, "Starten hör inte till hästen.");
    roundId = start.race.roundId;
  } else if (roundId) {
    const round = await prisma.round.findUnique({ where: { id: roundId }, select: { id: true } });
    if (!round) return jsonError(422, "Omgången finns inte.");
  }

  const existing = await prisma.horseComment.findUnique({ where: { userId_clientId: { userId: user.id, clientId: params.clientId } }, select: { horseId: true } });
  if (existing && existing.horseId !== input.horseId) return jsonError(422, "Kommentaren hör till en annan häst.");

  try {
    const data = { kind: input.kind, tags: input.tags, text: input.text, startId: input.startId, roundId };
    const comment = await prisma.horseComment.upsert({
      where: { userId_clientId: { userId: user.id, clientId: params.clientId } },
      create: { userId: user.id, clientId: params.clientId, horseId: input.horseId, ...data },
      update: { ...data, deletedAt: null },
      include: COMMENT_INCLUDE,
    });
    return NextResponse.json({ comment: commentDto(comment) });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return jsonError(422, "Det finns redan en kommentar under loppet för hästen.");
    }
    throw e;
  }
});

// Mjuk borttagning. Idempotent: svarar ok även om kommentaren inte finns.
export const DELETE = withUser<{ clientId: string }>("comments/delete", async ({ params, user }) => {
  if (!isUuid(params.clientId)) return badRequest("Ogiltigt kommentar-id.");
  await prisma.horseComment.updateMany({ where: { userId: user.id, clientId: params.clientId, deletedAt: null }, data: { deletedAt: new Date() } });
  return NextResponse.json({ ok: true });
});
