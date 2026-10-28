import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { sourceDto } from "@/lib/dto";
import { badRequest, jsonError, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route";
import { SOURCES_MAX, normalizeSourceUrl, parseSourceName } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const GET = withUser("sources/get", async ({ user }) => {
  const sources = await prisma.source.findMany({ where: { userId: user.id }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return NextResponse.json({ sources: sources.map(sourceDto) });
});

// { url, name?, enabled? }. Används också för Ångra efter borttagning.
// E5: kind lämnas tomt – läsaren väljs efter adressen vid varje läsning (readerFor).
export const POST = withUser("sources/post", async ({ req, user }) => {
  const body = await readJson(req, 4_000);
  if (!body) return badRequest("Ogiltig begäran.");
  const url = normalizeSourceUrl(body.url);
  if (!url.ok) return badRequest(url.error);
  const name = parseSourceName(body.name, url.value);
  if (!name.ok) return badRequest(name.error);
  const enabled = body.enabled === undefined ? true : body.enabled;
  if (typeof enabled !== "boolean") return badRequest("enabled ska vara true eller false.");

  const count = await prisma.source.count({ where: { userId: user.id } });
  if (count >= SOURCES_MAX) return badRequest(`Högst ${SOURCES_MAX} källor.`);
  const last = await prisma.source.findFirst({ where: { userId: user.id }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  try {
    const source = await prisma.source.create({ data: { userId: user.id, url: url.value, name: name.value, enabled, sortOrder: (last?.sortOrder ?? -1) + 1 } });
    return NextResponse.json({ source: sourceDto(source) }, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return jsonError(409, "Källan finns redan.");
    throw e;
  }
});
