-- Etapp 2.2: Hämta streck och odds (specen e2.2, avsnitt 8.3).
--
-- Bara additiv: en ny enum (OddsSource), två nya tabeller (OddsFetch,
-- UnibetPrice) och nya kolumner på Mark, UserSettings och Race, plus villkor.
-- Inga tabeller, kolumner eller rader tas bort. Inga UPDATE.
--
-- Befintliga rader:
-- - Mark: unibetOddsSource läggs till med standardvärdet 'MANUAL', så att alla
--   befintliga rader får källan eget i samma sats (alla odds hittills är
--   inskrivna för hand). Därefter blir standardvärdet NULL för nya rader.
--   Rader utan odds får också 'MANUAL'; appen läser MANUAL utan odds som
--   "ingen källa" (lib/dto.ts). replacedOdds och replacedByFetchId blir NULL.
-- - UserSettings: spelbarTolerance får standardvärdet 0,10.
-- - Race: unibetEventKey blir NULL tills en oddshämtning slår upp banan.
-- - Outcome: rörs inte. Tidigare frysta rader räknas inte om.
--
-- De nya tabellerna får RLS påslaget utan policyer, som alla andra tabeller i
-- schemat: bara appens egen databasroll (som äger tabellerna) kommer åt dem.
-- Rättigheterna för Supabases API-roller tas bort uttryckligen, som i init.
--
-- Allt i en transaktion: faller ett villkor på befintlig data ändras ingenting.

BEGIN;

-- ---- Del 1: genererat med prisma migrate diff (källkolumnen för hand, se ovan) --

-- CreateEnum
CREATE TYPE "spelvarde"."OddsSource" AS ENUM ('MANUAL', 'UNIBET');

-- AlterTable
ALTER TABLE "spelvarde"."Mark" ADD COLUMN     "replacedByFetchId" TEXT,
ADD COLUMN     "replacedOdds" DECIMAL(6,2),
ADD COLUMN     "unibetOddsSource" "spelvarde"."OddsSource" DEFAULT 'MANUAL';
-- Nya rader: ingen källa förrän ett odds skrivs.
ALTER TABLE "spelvarde"."Mark" ALTER COLUMN "unibetOddsSource" SET DEFAULT NULL;

-- AlterTable
ALTER TABLE "spelvarde"."Race" ADD COLUMN     "unibetEventKey" TEXT;

-- AlterTable
ALTER TABLE "spelvarde"."UserSettings" ADD COLUMN     "spelbarTolerance" DECIMAL(4,2) NOT NULL DEFAULT 0.10;

-- CreateTable
CREATE TABLE "spelvarde"."OddsFetch" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "userId" TEXT,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "legsOk" INTEGER[],
    "legsFailed" INTEGER[],
    "legsSkipped" INTEGER[],

    CONSTRAINT "OddsFetch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."UnibetPrice" (
    "id" TEXT NOT NULL,
    "fetchId" TEXT NOT NULL,
    "startId" TEXT NOT NULL,
    "placeOdds" DECIMAL(6,2),
    "winOdds" DECIMAL(7,2),
    "status" TEXT NOT NULL,

    CONSTRAINT "UnibetPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OddsFetch_roundId_takenAt_idx" ON "spelvarde"."OddsFetch"("roundId", "takenAt");

-- CreateIndex
CREATE INDEX "OddsFetch_userId_idx" ON "spelvarde"."OddsFetch"("userId");

-- CreateIndex
CREATE INDEX "UnibetPrice_startId_idx" ON "spelvarde"."UnibetPrice"("startId");

-- CreateIndex
CREATE UNIQUE INDEX "UnibetPrice_fetchId_startId_key" ON "spelvarde"."UnibetPrice"("fetchId", "startId");

-- CreateIndex
CREATE INDEX "Mark_replacedByFetchId_idx" ON "spelvarde"."Mark"("replacedByFetchId");

-- AddForeignKey
ALTER TABLE "spelvarde"."OddsFetch" ADD CONSTRAINT "OddsFetch_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "spelvarde"."Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."OddsFetch" ADD CONSTRAINT "OddsFetch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "spelvarde"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."UnibetPrice" ADD CONSTRAINT "UnibetPrice_fetchId_fkey" FOREIGN KEY ("fetchId") REFERENCES "spelvarde"."OddsFetch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."UnibetPrice" ADD CONSTRAINT "UnibetPrice_startId_fkey" FOREIGN KEY ("startId") REFERENCES "spelvarde"."Start"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Mark" ADD CONSTRAINT "Mark_replacedByFetchId_fkey" FOREIGN KEY ("replacedByFetchId") REFERENCES "spelvarde"."OddsFetch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---- Del 2: villkor, RLS och rättigheter (för hand) ---------------------------

-- Toleransen i S10: 0,00–0,50.
ALTER TABLE "spelvarde"."UserSettings" ADD CONSTRAINT "UserSettings_spelbarTolerance_check" CHECK ("spelbarTolerance" BETWEEN 0.00 AND 0.50);

-- Ett odds har alltid en källa. (UNIBET utan odds = struken hos Unibet.)
ALTER TABLE "spelvarde"."Mark" ADD CONSTRAINT "Mark_unibetOddsSource_check" CHECK ("unibetOdds" IS NULL OR "unibetOddsSource" IS NOT NULL);
-- Det ersatta egna oddset för Ångra, samma gränser som unibetOdds.
ALTER TABLE "spelvarde"."Mark" ADD CONSTRAINT "Mark_replacedOdds_check" CHECK ("replacedOdds" IS NULL OR "replacedOdds" BETWEEN 1.01 AND 99.99);

-- Avdelningarna 1–8.
ALTER TABLE "spelvarde"."OddsFetch" ADD CONSTRAINT "OddsFetch_legs_check" CHECK ("legsOk" <@ ARRAY[1, 2, 3, 4, 5, 6, 7, 8] AND "legsFailed" <@ ARRAY[1, 2, 3, 4, 5, 6, 7, 8] AND "legsSkipped" <@ ARRAY[1, 2, 3, 4, 5, 6, 7, 8]);
ALTER TABLE "spelvarde"."OddsFetch" ADD CONSTRAINT "OddsFetch_finishedAt_check" CHECK ("finishedAt" IS NULL OR "finishedAt" >= "takenAt");

-- Unibets priser är decimalodds (minst 1,00). NULL = inget pris.
ALTER TABLE "spelvarde"."UnibetPrice" ADD CONSTRAINT "UnibetPrice_placeOdds_check" CHECK ("placeOdds" IS NULL OR "placeOdds" >= 1.00);
ALTER TABLE "spelvarde"."UnibetPrice" ADD CONSTRAINT "UnibetPrice_winOdds_check" CHECK ("winOdds" IS NULL OR "winOdds" >= 1.00);
ALTER TABLE "spelvarde"."UnibetPrice" ADD CONSTRAINT "UnibetPrice_status_check" CHECK (length("status") BETWEEN 1 AND 40);

ALTER TABLE "spelvarde"."OddsFetch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."UnibetPrice" ENABLE ROW LEVEL SECURITY;

-- Rollerna finns bara i Supabase, därför villkorat. Gäller bara de nya tabellerna.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "spelvarde"."OddsFetch", "spelvarde"."UnibetPrice" FROM %I', r);
    END IF;
  END LOOP;
END
$$;

COMMIT;
