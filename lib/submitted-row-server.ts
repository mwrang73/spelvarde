// PUT och DELETE /api/rounds/[id]/submitted-row (E8, docs/specs/e8-live.md 9.3).
// Rutten är ett tunt omslag; här ligger reglerna, testade mot Postgres i
// lib/submitted-row.db.test.ts. userId kommer alltid från sessionen.

import type { Prisma, PrismaClient } from "@prisma/client";
import { submittedRowDto } from "@/lib/dto";
import type { Reply } from "@/lib/e2-server";
import { legName } from "@/lib/game-type";
import { isLateMark, parseSubmittedRowBody, rowsOfSelections, SUBMITTED_ROW_ROUND_MISSING } from "@/lib/submitted-row";
import type { SubmittedRowResponse } from "@/lib/types";

const fail = (status: number, error: string): Reply<never> => ({ status, body: { error } });

export async function saveSubmittedRow(db: PrismaClient, userId: string, roundId: string, body: Record<string, unknown>, now: Date): Promise<Reply<SubmittedRowResponse>> {
  const round = await db.round.findUnique({
    where: { id: roundId },
    select: { id: true, gameType: true, races: { select: { leg: true, startAt: true, starts: { select: { number: true } } } } },
  });
  if (!round) return fail(404, SUBMITTED_ROW_ROUND_MISSING);

  const parsed = parseSubmittedRowBody(body, round.gameType, now);
  if (!parsed.ok) return fail(400, parsed.error);
  const { selections, rowPrice, markedAt } = parsed.value;
  const counted = rowsOfSelections(selections, rowPrice, round.gameType);
  if (!counted.ok) return fail(400, counted.error);

  // Startnumret ska bara finnas i loppet. Struken häst och inställt lopp är
  // tillåtna, eftersom kopian kan ha varit inlämnad innan det hände.
  for (const [leg, numbers] of Object.entries(selections)) {
    const race = round.races.find((r) => r.leg === Number(leg));
    if (!race) return fail(400, `${legName(round.gameType, leg)} finns inte i omgången.`);
    const have = new Set(race.starts.map((s) => s.number));
    const bad = numbers.find((n) => !have.has(n));
    if (bad !== undefined) return fail(400, `Startnummer ${bad} finns inte i ${legName(round.gameType, leg)}.`);
  }

  const data = {
    selections: selections as unknown as Prisma.InputJsonValue,
    rows: counted.value.rows,
    cost: counted.value.cost,
    rowPrice,
    markedAt,
    markedLate: isLateMark(markedAt, round.races),
  };
  const row = await db.submittedRow.upsert({
    where: { userId_roundId: { userId, roundId } },
    create: { userId, roundId, ...data },
    update: data,
  });
  return { status: 200, body: { submittedRow: submittedRowDto(row) } };
}

// Hård borttagning, bara den egna raden. Ångra skickar en PUT med de gamla värdena.
export async function deleteSubmittedRow(db: PrismaClient, userId: string, roundId: string): Promise<Reply<{ ok: true }>> {
  await db.submittedRow.deleteMany({ where: { userId, roundId } });
  return { status: 200, body: { ok: true } };
}
