// Listar källorna (sidan Källor) för alla användare. Läser bara, ändrar inget.
//
//   bash scripts/prod-db.sh sources
import { PrismaClient } from "@prisma/client";

try {
  if (new URL(process.env.DATABASE_URL ?? "").searchParams.get("schema") !== "spelvarde") {
    console.error("DATABASE_URL måste ha schema=spelvarde. Avbryter.");
    process.exit(1);
  }
} catch {
  console.error("DATABASE_URL saknas eller är ogiltig.");
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const sources = await prisma.source.findMany({
    orderBy: [{ userId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: { name: true, url: true, enabled: true, lastReadAt: true, lastStatus: true, user: { select: { email: true } } },
  });
  if (sources.length === 0) console.log("Inga källor.");
  for (const s of sources) {
    const read = s.lastReadAt ? ` · läst ${s.lastReadAt.toISOString()} (${s.lastStatus ?? "–"})` : "";
    console.log(`${s.enabled ? "på " : "av "} ${s.name} · ${s.url} · ${s.user.email}${read}`);
  }
} finally {
  await prisma.$disconnect();
}
