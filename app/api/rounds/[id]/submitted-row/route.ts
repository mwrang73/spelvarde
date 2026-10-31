import { NextResponse } from "next/server";
import { badRequest, isId, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route";
import { deleteSubmittedRow, saveSubmittedRow } from "@/lib/submitted-row-server";

export const dynamic = "force-dynamic";

// Raden som användaren har markerat som inlämnad hos ATG (E8, docs/specs/e8-live.md
// 9.3). userId kommer alltid från sessionen. Läses med GET /api/rounds/[id].

// { selections: { "1": [2, 5], … }, rowPrice, markedAt }. Idempotent upsert, som
// täcker både markering och Ersätt raden. Ingen tidsspärr och inget 409.
export const PUT = withUser<{ id: string }>("rounds/[id]/submitted-row/put", async ({ req, params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig omgång.");
  const body = await readJson(req, 16_000);
  if (!body) return badRequest("Ogiltig begäran.");
  const res = await saveSubmittedRow(prisma, user.id, params.id, body, new Date());
  return NextResponse.json(res.body, { status: res.status });
});

// Idempotent: svarar { ok: true } även utan rad.
export const DELETE = withUser<{ id: string }>("rounds/[id]/submitted-row/delete", async ({ params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig omgång.");
  const res = await deleteSubmittedRow(prisma, user.id, params.id);
  return NextResponse.json(res.body, { status: res.status });
});
