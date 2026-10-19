import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { sourceDto } from "@/lib/dto";
import { badRequest, isId, jsonError, notFound, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route";
import { parseSourcePatch } from "@/lib/validate";

export const dynamic = "force-dynamic";

// { name?, url?, enabled?, sortOrder? }
export const PATCH = withUser<{ id: string }>("sources/patch", async ({ req, params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig källa.");
  const body = await readJson(req, 4_000);
  if (!body) return badRequest("Ogiltig begäran.");
  const patch = parseSourcePatch(body);
  if (!patch.ok) return badRequest(patch.error);
  const own = await prisma.source.findFirst({ where: { id: params.id, userId: user.id }, select: { id: true } });
  if (!own) return notFound("Källan finns inte.");
  try {
    const source = await prisma.source.update({ where: { id: own.id }, data: patch.value });
    return NextResponse.json({ source: sourceDto(source) });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return jsonError(409, "Källan finns redan.");
    throw e;
  }
});

// Tar bort källan och svarar med den borttagna, så att Ångra kan lägga till
// den igen med POST /api/sources.
export const DELETE = withUser<{ id: string }>("sources/delete", async ({ params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig källa.");
  const own = await prisma.source.findFirst({ where: { id: params.id, userId: user.id } });
  if (!own) return notFound("Källan finns inte.");
  await prisma.source.deleteMany({ where: { id: own.id, userId: user.id } });
  return NextResponse.json({ source: sourceDto(own) });
});
