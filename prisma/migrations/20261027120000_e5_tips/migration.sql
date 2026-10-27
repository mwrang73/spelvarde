-- Etapp 5: Hämta tips (docs/specs/e5-hamta-tips.md, avsnitt 8.4).
--
-- Bara additiv: sex nya enum-typer (TipRole, TipReview, TipMatch, TipStage,
-- TipArticleStatus, SourceKind), tre nya tabeller (TipArticle, Tip, AiUsage)
-- och två nya nullbara kolumner på Source (kind, lastArticleCount), plus
-- villkor. Inga tabeller, kolumner eller rader tas bort eller skrivs om.
-- Inga UPDATE. TipFact och TipKind rörs inte (ersätts av Tip, tas bort i en
-- senare städmigrering efter Mikaels ja).
--
-- Befintliga rader: Source får kind = NULL (läsaren väljs efter adressen) och
-- lastArticleCount = NULL ("Inte läst än"). Inga andra tabeller ändras.
--
-- Sambandet mellan Tip.match = 'NONE' och startId kontrolleras i koden, inte
-- som check, eftersom ON DELETE SET NULL på starten annars skulle bryta mot
-- det. Ett tips med startId = NULL läses som ej kopplat.
--
-- De nya tabellerna får RLS påslaget utan policyer, som alla andra tabeller i
-- schemat: bara appens egen databasroll (som äger tabellerna) kommer åt dem.
-- Rättigheterna för Supabases API-roller tas bort uttryckligen, som i init.
--
-- Väg tillbaka: allt är nytt och läses bara av den nya koden. En äldre
-- version av appen fungerar mot det nya schemat. Behöver tabellerna tas bort
-- görs det i en egen migrering efter godkännande.
--
-- Allt i en transaktion: faller ett villkor ändras ingenting.

BEGIN;

-- ---- Del 1: genererat med prisma migrate diff ----------------------------------

-- CreateEnum
CREATE TYPE "spelvarde"."TipRole" AS ENUM ('SPIK', 'FAVORIT', 'SKRALL', 'AVRADAN', 'NAMND');

-- CreateEnum
CREATE TYPE "spelvarde"."TipReview" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "spelvarde"."TipMatch" AS ENUM ('SURE', 'UNSURE', 'NONE');

-- CreateEnum
CREATE TYPE "spelvarde"."TipStage" AS ENUM ('EARLY', 'FINAL');

-- CreateEnum
CREATE TYPE "spelvarde"."TipArticleStatus" AS ENUM ('NEW', 'INTERPRETED', 'FAILED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "spelvarde"."SourceKind" AS ENUM ('COLLECTION', 'PAGE');

-- AlterTable
ALTER TABLE "spelvarde"."Source" ADD COLUMN     "kind" "spelvarde"."SourceKind",
ADD COLUMN     "lastArticleCount" INTEGER;

-- CreateTable
CREATE TABLE "spelvarde"."TipArticle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "stage" "spelvarde"."TipStage" NOT NULL,
    "text" TEXT NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "textHash" TEXT NOT NULL,
    "interpretedHash" TEXT,
    "status" "spelvarde"."TipArticleStatus" NOT NULL DEFAULT 'NEW',
    "error" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "interpretedAt" TIMESTAMP(3),
    "tipCount" INTEGER,
    "discarded" INTEGER,

    CONSTRAINT "TipArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."Tip" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "leg" INTEGER,
    "number" INTEGER,
    "rawHorseName" TEXT NOT NULL,
    "role" "spelvarde"."TipRole" NOT NULL,
    "roleWord" TEXT,
    "quote" TEXT NOT NULL,
    "startId" TEXT,
    "horseId" TEXT,
    "match" "spelvarde"."TipMatch" NOT NULL,
    "flags" TEXT[],
    "suggestedStartId" TEXT,
    "review" "spelvarde"."TipReview" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "aiStartId" TEXT,
    "aiRole" "spelvarde"."TipRole" NOT NULL,
    "supersededById" TEXT,
    "undo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."AiUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roundId" TEXT,
    "articleId" TEXT,
    "purpose" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TipArticle_sourceId_idx" ON "spelvarde"."TipArticle"("sourceId");

-- CreateIndex
CREATE INDEX "TipArticle_roundId_idx" ON "spelvarde"."TipArticle"("roundId");

-- CreateIndex
CREATE INDEX "TipArticle_userId_roundId_textHash_idx" ON "spelvarde"."TipArticle"("userId", "roundId", "textHash");

-- CreateIndex
CREATE UNIQUE INDEX "TipArticle_userId_roundId_url_key" ON "spelvarde"."TipArticle"("userId", "roundId", "url");

-- CreateIndex
CREATE INDEX "Tip_userId_roundId_review_idx" ON "spelvarde"."Tip"("userId", "roundId", "review");

-- CreateIndex
CREATE INDEX "Tip_articleId_idx" ON "spelvarde"."Tip"("articleId");

-- CreateIndex
CREATE INDEX "Tip_startId_idx" ON "spelvarde"."Tip"("startId");

-- CreateIndex
CREATE INDEX "Tip_horseId_idx" ON "spelvarde"."Tip"("horseId");

-- CreateIndex
CREATE INDEX "Tip_sourceId_idx" ON "spelvarde"."Tip"("sourceId");

-- CreateIndex
CREATE INDEX "Tip_supersededById_idx" ON "spelvarde"."Tip"("supersededById");

-- CreateIndex
CREATE INDEX "AiUsage_userId_startedAt_idx" ON "spelvarde"."AiUsage"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "AiUsage_roundId_idx" ON "spelvarde"."AiUsage"("roundId");

-- CreateIndex
CREATE INDEX "AiUsage_articleId_idx" ON "spelvarde"."AiUsage"("articleId");

-- AddForeignKey
ALTER TABLE "spelvarde"."TipArticle" ADD CONSTRAINT "TipArticle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "spelvarde"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."TipArticle" ADD CONSTRAINT "TipArticle_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "spelvarde"."Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."TipArticle" ADD CONSTRAINT "TipArticle_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "spelvarde"."Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Tip" ADD CONSTRAINT "Tip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "spelvarde"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Tip" ADD CONSTRAINT "Tip_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "spelvarde"."Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Tip" ADD CONSTRAINT "Tip_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "spelvarde"."Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Tip" ADD CONSTRAINT "Tip_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "spelvarde"."TipArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Tip" ADD CONSTRAINT "Tip_startId_fkey" FOREIGN KEY ("startId") REFERENCES "spelvarde"."Start"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Tip" ADD CONSTRAINT "Tip_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "spelvarde"."Horse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Tip" ADD CONSTRAINT "Tip_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "spelvarde"."Tip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."AiUsage" ADD CONSTRAINT "AiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "spelvarde"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."AiUsage" ADD CONSTRAINT "AiUsage_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "spelvarde"."Round"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."AiUsage" ADD CONSTRAINT "AiUsage_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "spelvarde"."TipArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---- Del 2: villkor, RLS och rättigheter (för hand) ---------------------------

-- Källan: antal relevanta artiklar vid senaste läsningen.
ALTER TABLE "spelvarde"."Source" ADD CONSTRAINT "Source_lastArticleCount_check" CHECK ("lastArticleCount" IS NULL OR "lastArticleCount" >= 0);

-- Artikeln: gränserna i 10.6 (högst 60 000 tecken lagras) och sha256 i hex.
ALTER TABLE "spelvarde"."TipArticle" ADD CONSTRAINT "TipArticle_url_check" CHECK ("url" LIKE 'https://%' AND length("url") <= 2000);
ALTER TABLE "spelvarde"."TipArticle" ADD CONSTRAINT "TipArticle_title_check" CHECK (length("title") BETWEEN 1 AND 500);
ALTER TABLE "spelvarde"."TipArticle" ADD CONSTRAINT "TipArticle_text_check" CHECK (length("text") <= 60000);
ALTER TABLE "spelvarde"."TipArticle" ADD CONSTRAINT "TipArticle_textHash_check" CHECK ("textHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "spelvarde"."TipArticle" ADD CONSTRAINT "TipArticle_interpretedHash_check" CHECK ("interpretedHash" IS NULL OR "interpretedHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "spelvarde"."TipArticle" ADD CONSTRAINT "TipArticle_counts_check" CHECK (("tipCount" IS NULL OR "tipCount" >= 0) AND ("discarded" IS NULL OR "discarded" >= 0));
ALTER TABLE "spelvarde"."TipArticle" ADD CONSTRAINT "TipArticle_error_check" CHECK ("error" IS NULL OR length("error") <= 500);

-- Tipset: formen i 6.11 (Validering). leg och number tillåter NULL.
ALTER TABLE "spelvarde"."Tip" ADD CONSTRAINT "Tip_leg_check" CHECK ("leg" BETWEEN 1 AND 8);
ALTER TABLE "spelvarde"."Tip" ADD CONSTRAINT "Tip_number_check" CHECK ("number" BETWEEN 1 AND 20);
ALTER TABLE "spelvarde"."Tip" ADD CONSTRAINT "Tip_rawHorseName_check" CHECK (length("rawHorseName") BETWEEN 1 AND 60);
ALTER TABLE "spelvarde"."Tip" ADD CONSTRAINT "Tip_quote_check" CHECK (length("quote") BETWEEN 8 AND 400);
ALTER TABLE "spelvarde"."Tip" ADD CONSTRAINT "Tip_roleWord_check" CHECK ("roleWord" IS NULL OR length("roleWord") <= 40);
ALTER TABLE "spelvarde"."Tip" ADD CONSTRAINT "Tip_flags_check" CHECK (cardinality("flags") <= 20);
-- Ett tips kan inte ersätta sig självt.
ALTER TABLE "spelvarde"."Tip" ADD CONSTRAINT "Tip_supersededById_check" CHECK ("supersededById" IS NULL OR "supersededById" <> "id");
-- Granskningstiden finns precis när tipset är granskat.
ALTER TABLE "spelvarde"."Tip" ADD CONSTRAINT "Tip_reviewedAt_check" CHECK (("review" = 'PENDING') = ("reviewedAt" IS NULL));

-- AI-anropet: tokens och kostnad är aldrig negativa.
ALTER TABLE "spelvarde"."AiUsage" ADD CONSTRAINT "AiUsage_tokens_check" CHECK ("inputTokens" >= 0 AND "outputTokens" >= 0 AND "costUsd" >= 0);
ALTER TABLE "spelvarde"."AiUsage" ADD CONSTRAINT "AiUsage_purpose_check" CHECK (length("purpose") BETWEEN 1 AND 40 AND length("model") BETWEEN 1 AND 100);
ALTER TABLE "spelvarde"."AiUsage" ADD CONSTRAINT "AiUsage_error_check" CHECK ("error" IS NULL OR length("error") <= 500);

ALTER TABLE "spelvarde"."TipArticle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."Tip" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."AiUsage" ENABLE ROW LEVEL SECURITY;

-- Rollerna finns bara i Supabase, därför villkorat. Gäller bara de nya tabellerna.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "spelvarde"."TipArticle", "spelvarde"."Tip", "spelvarde"."AiUsage" FROM %I', r);
    END IF;
  END LOOP;
END
$$;

COMMIT;
