-- E8 Live (docs/specs/e8-live.md 9.1–9.2): raden som Mikael har markerat som
-- inlämnad hos ATG. Ny tabell, inte fält på "Coupon": selections räknas om vid
-- varje ändring och copiedSelections skrivs över vid varje uttag, medan den här
-- kopian aldrig får ändras av appen.
-- Additiv: en ny tabell med index, FK och CHECK-villkor. Inget på befintliga
-- tabeller och inget skrivs om. Inga befintliga kuponger kopieras över, så
-- tidigare omgångar saknar rad och Live säger "Ingen inlämnad rad".
-- RLS utan policies: appen når databasen som tabellägare (förbigår RLS), och
-- Supabases API-roller stängs ute, som i 20261019120000_init.

CREATE TABLE "spelvarde"."SubmittedRow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "selections" JSONB NOT NULL,
    "rows" INTEGER NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "rowPrice" DECIMAL(6,2) NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL,
    "markedLate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubmittedRow_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SubmittedRow_rows_check" CHECK ("rows" >= 1),
    CONSTRAINT "SubmittedRow_cost_check" CHECK ("cost" >= 0),
    CONSTRAINT "SubmittedRow_rowPrice_check" CHECK ("rowPrice" > 0)
);

CREATE UNIQUE INDEX "SubmittedRow_userId_roundId_key" ON "spelvarde"."SubmittedRow"("userId", "roundId");
CREATE INDEX "SubmittedRow_roundId_idx" ON "spelvarde"."SubmittedRow"("roundId");

ALTER TABLE "spelvarde"."SubmittedRow" ADD CONSTRAINT "SubmittedRow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "spelvarde"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "spelvarde"."SubmittedRow" ADD CONSTRAINT "SubmittedRow_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "spelvarde"."Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "spelvarde"."SubmittedRow" ENABLE ROW LEVEL SECURITY;
