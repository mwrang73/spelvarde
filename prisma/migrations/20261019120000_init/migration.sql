-- Spelvärde: första migreringen. Hela datamodellen (specen avsnitt 8).
--
-- Rör BARA schemat "spelvarde". Varje CREATE och ALTER nedan är fullt
-- kvalificerad med "spelvarde". och migreringen innehåller ingen DROP.
-- Kontrolleras av `npm run check:migration` (och lib/migration-check.test.ts).
--
-- Körs mot drift med `npx prisma migrate deploy` och en DATABASE_URL/DIRECT_URL
-- som slutar på ?schema=spelvarde (då hamnar Prismas _prisma_migrations också
-- i spelvarde, skild från Tabellgissningens i public).
--
-- Del 1 är genererad av `prisma migrate diff --from-empty`. Del 2 är skriven
-- för hand: villkor som Prisma inte kan uttrycka, delvisa unika index, RLS
-- och indragna rättigheter för Supabases API-roller.

-- ===========================================================================
-- Del 1: tabeller, index och främmande nycklar (genererat)
-- ===========================================================================

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "spelvarde";

-- CreateEnum
CREATE TYPE "spelvarde"."Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "spelvarde"."UserStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "spelvarde"."ThemeChoice" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

-- CreateEnum
CREATE TYPE "spelvarde"."FetchStatus" AS ENUM ('COMPLETE', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "spelvarde"."StartMethod" AS ENUM ('AUTO', 'VOLTE');

-- CreateEnum
CREATE TYPE "spelvarde"."SnapshotKind" AS ENUM ('BASELINE', 'LIVE', 'FETCH');

-- CreateEnum
CREATE TYPE "spelvarde"."AliasSource" AS ENUM ('TRAVSTATISTIK');

-- CreateEnum
CREATE TYPE "spelvarde"."SpelbarOverride" AS ENUM ('NONE', 'ON', 'OFF');

-- CreateEnum
CREATE TYPE "spelvarde"."CommentKind" AS ENUM ('NOTE', 'RACE');

-- CreateEnum
CREATE TYPE "spelvarde"."AlarmKind" AS ENUM ('RUSH', 'DROP');

-- CreateEnum
CREATE TYPE "spelvarde"."TipKind" AS ENUM ('FACT', 'PATTERN');

-- CreateTable
CREATE TABLE "spelvarde"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "spelvarde"."Role" NOT NULL DEFAULT 'USER',
    "status" "spelvarde"."UserStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."UserSettings" (
    "userId" TEXT NOT NULL,
    "theme" "spelvarde"."ThemeChoice" NOT NULL DEFAULT 'SYSTEM',
    "rushThresholdPe" DECIMAL(6,2) NOT NULL DEFAULT 10.0,
    "rowPrice" DECIMAL(6,2) NOT NULL DEFAULT 0.50,
    "spelbarGuideline" DECIMAL(6,2) NOT NULL DEFAULT 2.00,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "spelvarde"."Round" (
    "id" TEXT NOT NULL,
    "atgGameId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "trackId" INTEGER NOT NULL,
    "trackName" TEXT NOT NULL,
    "firstStartAt" TIMESTAMP(3) NOT NULL,
    "atgStatus" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "fetchStatus" "spelvarde"."FetchStatus" NOT NULL DEFAULT 'PARTIAL',
    "liveSyncAt" TIMESTAMP(3),
    "liveOkAt" TIMESTAMP(3),
    "baselineAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "rev" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Round_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."Race" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "atgRaceId" TEXT NOT NULL,
    "leg" INTEGER NOT NULL,
    "raceNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "scheduledStartAt" TIMESTAMP(3),
    "distance" INTEGER NOT NULL,
    "startMethod" "spelvarde"."StartMethod" NOT NULL,
    "prize" INTEGER,
    "prizeText" TEXT,
    "classLabel" TEXT,
    "terms" TEXT[],
    "atgStatus" TEXT,
    "resultAt" TIMESTAMP(3),
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "recordsFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Race_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."Horse" (
    "id" TEXT NOT NULL,
    "atgHorseId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sex" TEXT,
    "birthYear" INTEGER,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Horse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."Person" (
    "id" TEXT NOT NULL,
    "atgPersonId" INTEGER NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "shortName" TEXT,
    "location" TEXT,
    "statsJson" JSONB,
    "statsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."PersonAlias" (
    "id" TEXT NOT NULL,
    "source" "spelvarde"."AliasSource" NOT NULL,
    "rawName" TEXT NOT NULL,
    "personId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."Start" (
    "id" TEXT NOT NULL,
    "raceId" TEXT NOT NULL,
    "horseId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "postPosition" INTEGER,
    "distance" INTEGER NOT NULL,
    "driverId" TEXT,
    "trainerId" TEXT,
    "prevDriverId" TEXT,
    "scratched" BOOLEAN NOT NULL DEFAULT false,
    "scratchedAt" TIMESTAMP(3),
    "age" INTEGER,
    "record" TEXT,
    "earnings" INTEGER,
    "horseStatsJson" JSONB,
    "shoes" JSONB,
    "sulky" JSONB,
    "lastFetchedAt" TIMESTAMP(3),
    "recordsFetchedAt" TIMESTAMP(3),
    "recordsError" TEXT,
    "place" INTEGER,
    "finishOrder" INTEGER,
    "disqualified" BOOLEAN NOT NULL DEFAULT false,
    "galloped" BOOLEAN NOT NULL DEFAULT false,
    "kmTime" TEXT,
    "finalOdds" DECIMAL(6,2),
    "placeOddsMin" DECIMAL(6,2),
    "placeOddsMax" DECIMAL(6,2),
    "resultAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Start_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."HorseRecord" (
    "id" TEXT NOT NULL,
    "horseId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "trackName" TEXT NOT NULL,
    "trackId" INTEGER,
    "atgRaceRef" TEXT,
    "raceNumber" INTEGER,
    "distance" INTEGER,
    "startMethod" "spelvarde"."StartMethod",
    "postPosition" INTEGER,
    "place" INTEGER,
    "galloped" BOOLEAN NOT NULL DEFAULT false,
    "disqualified" BOOLEAN NOT NULL DEFAULT false,
    "scratched" BOOLEAN NOT NULL DEFAULT false,
    "kmTime" TEXT,
    "odds" DECIMAL(6,2),
    "driverName" TEXT,
    "firstPrize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HorseRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."RoundSnapshot" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "spelvarde"."SnapshotKind" NOT NULL,

    CONSTRAINT "RoundSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."StreckValue" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "startId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "StreckValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."StatsSnapshot" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "data" JSONB,

    CONSTRAINT "StatsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."ModelVersion" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "weights" JSONB NOT NULL,
    "params" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "backtest" JSONB,

    CONSTRAINT "ModelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."Riktodds" (
    "id" TEXT NOT NULL,
    "startId" TEXT NOT NULL,
    "modelVersionId" TEXT NOT NULL,
    "probTop3" DECIMAL(8,6) NOT NULL,
    "odds" DECIMAL(6,2) NOT NULL,
    "uncertain" BOOLEAN NOT NULL DEFAULT false,
    "inputs" JSONB NOT NULL,
    "contributions" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Riktodds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."FetchLog" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "userId" TEXT,
    "step" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT,
    "changes" JSONB,

    CONSTRAINT "FetchLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."Mark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startId" TEXT NOT NULL,
    "interesting" BOOLEAN NOT NULL DEFAULT false,
    "interestingAt" TIMESTAMP(3),
    "spelbarOverride" "spelvarde"."SpelbarOverride" NOT NULL DEFAULT 'NONE',
    "bet" BOOLEAN NOT NULL DEFAULT false,
    "betAt" TIMESTAMP(3),
    "betOdds" DECIMAL(6,2),
    "unibetOdds" DECIMAL(6,2),
    "unibetOddsAt" TIMESTAMP(3),
    "unibetOddsPrev" DECIMAL(6,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."RaceReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "raceId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "noneInteresting" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RaceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."HorseComment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "horseId" TEXT NOT NULL,
    "startId" TEXT,
    "roundId" TEXT,
    "kind" "spelvarde"."CommentKind" NOT NULL,
    "tags" TEXT[],
    "text" TEXT NOT NULL DEFAULT '',
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HorseComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."Coupon" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "budget" INTEGER NOT NULL,
    "rowPrice" DECIMAL(6,2) NOT NULL,
    "selections" JSONB NOT NULL,
    "lockedLegs" INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."LiveAlarm" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startId" TEXT NOT NULL,
    "kind" "spelvarde"."AlarmKind" NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deltaAtFirst" DECIMAL(6,2) NOT NULL,
    "lastDelta" DECIMAL(6,2) NOT NULL,
    "ackAt" TIMESTAMP(3),
    "rearmedAt" TIMESTAMP(3),

    CONSTRAINT "LiveAlarm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."Outcome" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "interesting" BOOLEAN NOT NULL,
    "spelbar" BOOLEAN NOT NULL,
    "bet" BOOLEAN NOT NULL,
    "unibetOdds" DECIMAL(6,2),
    "betOdds" DECIMAL(6,2),
    "riktodds" DECIMAL(6,2),
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "place" INTEGER,
    "disqualified" BOOLEAN NOT NULL DEFAULT false,
    "hit" BOOLEAN,

    CONSTRAINT "Outcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."Source" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lastReadAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "lastFactCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."TipFact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "startId" TEXT,
    "horseId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "kind" "spelvarde"."TipKind" NOT NULL,
    "quote" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TipFact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "spelvarde"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Round_atgGameId_key" ON "spelvarde"."Round"("atgGameId");

-- CreateIndex
CREATE INDEX "Round_date_idx" ON "spelvarde"."Round"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Race_atgRaceId_key" ON "spelvarde"."Race"("atgRaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Race_roundId_leg_key" ON "spelvarde"."Race"("roundId", "leg");

-- CreateIndex
CREATE UNIQUE INDEX "Horse_atgHorseId_key" ON "spelvarde"."Horse"("atgHorseId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_atgPersonId_key" ON "spelvarde"."Person"("atgPersonId");

-- CreateIndex
CREATE INDEX "PersonAlias_personId_idx" ON "spelvarde"."PersonAlias"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonAlias_source_rawName_key" ON "spelvarde"."PersonAlias"("source", "rawName");

-- CreateIndex
CREATE INDEX "Start_horseId_idx" ON "spelvarde"."Start"("horseId");

-- CreateIndex
CREATE INDEX "Start_driverId_idx" ON "spelvarde"."Start"("driverId");

-- CreateIndex
CREATE INDEX "Start_trainerId_idx" ON "spelvarde"."Start"("trainerId");

-- CreateIndex
CREATE INDEX "Start_prevDriverId_idx" ON "spelvarde"."Start"("prevDriverId");

-- CreateIndex
CREATE UNIQUE INDEX "Start_raceId_horseId_key" ON "spelvarde"."Start"("raceId", "horseId");

-- CreateIndex
CREATE UNIQUE INDEX "Start_raceId_number_key" ON "spelvarde"."Start"("raceId", "number");

-- CreateIndex
CREATE INDEX "HorseRecord_horseId_date_idx" ON "spelvarde"."HorseRecord"("horseId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "HorseRecord_horseId_date_trackName_key" ON "spelvarde"."HorseRecord"("horseId", "date", "trackName");

-- CreateIndex
CREATE INDEX "RoundSnapshot_roundId_kind_takenAt_idx" ON "spelvarde"."RoundSnapshot"("roundId", "kind", "takenAt");

-- CreateIndex
CREATE INDEX "StreckValue_startId_idx" ON "spelvarde"."StreckValue"("startId");

-- CreateIndex
CREATE UNIQUE INDEX "StreckValue_snapshotId_startId_key" ON "spelvarde"."StreckValue"("snapshotId", "startId");

-- CreateIndex
CREATE INDEX "StatsSnapshot_roundId_source_fetchedAt_idx" ON "spelvarde"."StatsSnapshot"("roundId", "source", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModelVersion_key_key" ON "spelvarde"."ModelVersion"("key");

-- CreateIndex
CREATE INDEX "ModelVersion_createdById_idx" ON "spelvarde"."ModelVersion"("createdById");

-- CreateIndex
CREATE INDEX "Riktodds_modelVersionId_idx" ON "spelvarde"."Riktodds"("modelVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Riktodds_startId_modelVersionId_key" ON "spelvarde"."Riktodds"("startId", "modelVersionId");

-- CreateIndex
CREATE INDEX "FetchLog_roundId_startedAt_idx" ON "spelvarde"."FetchLog"("roundId", "startedAt");

-- CreateIndex
CREATE INDEX "FetchLog_userId_idx" ON "spelvarde"."FetchLog"("userId");

-- CreateIndex
CREATE INDEX "Mark_startId_idx" ON "spelvarde"."Mark"("startId");

-- CreateIndex
CREATE UNIQUE INDEX "Mark_userId_startId_key" ON "spelvarde"."Mark"("userId", "startId");

-- CreateIndex
CREATE INDEX "RaceReview_raceId_idx" ON "spelvarde"."RaceReview"("raceId");

-- CreateIndex
CREATE UNIQUE INDEX "RaceReview_userId_raceId_key" ON "spelvarde"."RaceReview"("userId", "raceId");

-- CreateIndex
CREATE INDEX "HorseComment_userId_horseId_idx" ON "spelvarde"."HorseComment"("userId", "horseId");

-- CreateIndex
CREATE INDEX "HorseComment_horseId_idx" ON "spelvarde"."HorseComment"("horseId");

-- CreateIndex
CREATE INDEX "HorseComment_startId_idx" ON "spelvarde"."HorseComment"("startId");

-- CreateIndex
CREATE INDEX "HorseComment_roundId_idx" ON "spelvarde"."HorseComment"("roundId");

-- CreateIndex
CREATE UNIQUE INDEX "HorseComment_userId_clientId_key" ON "spelvarde"."HorseComment"("userId", "clientId");

-- CreateIndex
CREATE INDEX "Coupon_roundId_idx" ON "spelvarde"."Coupon"("roundId");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_userId_roundId_key" ON "spelvarde"."Coupon"("userId", "roundId");

-- CreateIndex
CREATE INDEX "LiveAlarm_userId_startId_kind_idx" ON "spelvarde"."LiveAlarm"("userId", "startId", "kind");

-- CreateIndex
CREATE INDEX "LiveAlarm_startId_idx" ON "spelvarde"."LiveAlarm"("startId");

-- CreateIndex
CREATE INDEX "Outcome_userId_roundId_idx" ON "spelvarde"."Outcome"("userId", "roundId");

-- CreateIndex
CREATE INDEX "Outcome_startId_idx" ON "spelvarde"."Outcome"("startId");

-- CreateIndex
CREATE INDEX "Outcome_roundId_idx" ON "spelvarde"."Outcome"("roundId");

-- CreateIndex
CREATE UNIQUE INDEX "Outcome_userId_startId_key" ON "spelvarde"."Outcome"("userId", "startId");

-- CreateIndex
CREATE UNIQUE INDEX "Source_userId_url_key" ON "spelvarde"."Source"("userId", "url");

-- CreateIndex
CREATE INDEX "TipFact_userId_roundId_idx" ON "spelvarde"."TipFact"("userId", "roundId");

-- CreateIndex
CREATE INDEX "TipFact_sourceId_idx" ON "spelvarde"."TipFact"("sourceId");

-- CreateIndex
CREATE INDEX "TipFact_roundId_idx" ON "spelvarde"."TipFact"("roundId");

-- CreateIndex
CREATE INDEX "TipFact_startId_idx" ON "spelvarde"."TipFact"("startId");

-- CreateIndex
CREATE INDEX "TipFact_horseId_idx" ON "spelvarde"."TipFact"("horseId");

-- AddForeignKey
ALTER TABLE "spelvarde"."UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "spelvarde"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Race" ADD CONSTRAINT "Race_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "spelvarde"."Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."PersonAlias" ADD CONSTRAINT "PersonAlias_personId_fkey" FOREIGN KEY ("personId") REFERENCES "spelvarde"."Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Start" ADD CONSTRAINT "Start_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "spelvarde"."Race"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Start" ADD CONSTRAINT "Start_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "spelvarde"."Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Start" ADD CONSTRAINT "Start_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "spelvarde"."Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Start" ADD CONSTRAINT "Start_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "spelvarde"."Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Start" ADD CONSTRAINT "Start_prevDriverId_fkey" FOREIGN KEY ("prevDriverId") REFERENCES "spelvarde"."Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."HorseRecord" ADD CONSTRAINT "HorseRecord_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "spelvarde"."Horse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."RoundSnapshot" ADD CONSTRAINT "RoundSnapshot_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "spelvarde"."Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."StreckValue" ADD CONSTRAINT "StreckValue_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "spelvarde"."RoundSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."StreckValue" ADD CONSTRAINT "StreckValue_startId_fkey" FOREIGN KEY ("startId") REFERENCES "spelvarde"."Start"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."StatsSnapshot" ADD CONSTRAINT "StatsSnapshot_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "spelvarde"."Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."ModelVersion" ADD CONSTRAINT "ModelVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "spelvarde"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Riktodds" ADD CONSTRAINT "Riktodds_startId_fkey" FOREIGN KEY ("startId") REFERENCES "spelvarde"."Start"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Riktodds" ADD CONSTRAINT "Riktodds_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "spelvarde"."ModelVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."FetchLog" ADD CONSTRAINT "FetchLog_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "spelvarde"."Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."FetchLog" ADD CONSTRAINT "FetchLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "spelvarde"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Mark" ADD CONSTRAINT "Mark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "spelvarde"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Mark" ADD CONSTRAINT "Mark_startId_fkey" FOREIGN KEY ("startId") REFERENCES "spelvarde"."Start"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."RaceReview" ADD CONSTRAINT "RaceReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "spelvarde"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."RaceReview" ADD CONSTRAINT "RaceReview_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "spelvarde"."Race"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."HorseComment" ADD CONSTRAINT "HorseComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "spelvarde"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."HorseComment" ADD CONSTRAINT "HorseComment_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "spelvarde"."Horse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."HorseComment" ADD CONSTRAINT "HorseComment_startId_fkey" FOREIGN KEY ("startId") REFERENCES "spelvarde"."Start"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."HorseComment" ADD CONSTRAINT "HorseComment_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "spelvarde"."Round"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Coupon" ADD CONSTRAINT "Coupon_userId_fkey" FOREIGN KEY ("userId") REFERENCES "spelvarde"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Coupon" ADD CONSTRAINT "Coupon_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "spelvarde"."Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."LiveAlarm" ADD CONSTRAINT "LiveAlarm_userId_fkey" FOREIGN KEY ("userId") REFERENCES "spelvarde"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."LiveAlarm" ADD CONSTRAINT "LiveAlarm_startId_fkey" FOREIGN KEY ("startId") REFERENCES "spelvarde"."Start"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Outcome" ADD CONSTRAINT "Outcome_userId_fkey" FOREIGN KEY ("userId") REFERENCES "spelvarde"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Outcome" ADD CONSTRAINT "Outcome_startId_fkey" FOREIGN KEY ("startId") REFERENCES "spelvarde"."Start"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Outcome" ADD CONSTRAINT "Outcome_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "spelvarde"."Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."Source" ADD CONSTRAINT "Source_userId_fkey" FOREIGN KEY ("userId") REFERENCES "spelvarde"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."TipFact" ADD CONSTRAINT "TipFact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "spelvarde"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."TipFact" ADD CONSTRAINT "TipFact_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "spelvarde"."Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."TipFact" ADD CONSTRAINT "TipFact_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "spelvarde"."Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."TipFact" ADD CONSTRAINT "TipFact_startId_fkey" FOREIGN KEY ("startId") REFERENCES "spelvarde"."Start"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spelvarde"."TipFact" ADD CONSTRAINT "TipFact_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "spelvarde"."Horse"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- Del 2: handskrivet
-- ===========================================================================

-- ---- Villkor (dataintegritet i databasen, inte bara i appen) --------------

ALTER TABLE "spelvarde"."User" ADD CONSTRAINT "User_email_lower_check" CHECK ("email" = lower("email") AND length("email") BETWEEN 3 AND 320);

ALTER TABLE "spelvarde"."UserSettings" ADD CONSTRAINT "UserSettings_rushThresholdPe_check" CHECK ("rushThresholdPe" BETWEEN 1.0 AND 30.0);
ALTER TABLE "spelvarde"."UserSettings" ADD CONSTRAINT "UserSettings_rowPrice_check" CHECK ("rowPrice" > 0);
ALTER TABLE "spelvarde"."UserSettings" ADD CONSTRAINT "UserSettings_spelbarGuideline_check" CHECK ("spelbarGuideline" BETWEEN 1.01 AND 99.99);

ALTER TABLE "spelvarde"."Race" ADD CONSTRAINT "Race_leg_check" CHECK ("leg" BETWEEN 1 AND 8);
ALTER TABLE "spelvarde"."Race" ADD CONSTRAINT "Race_distance_check" CHECK ("distance" > 0);

ALTER TABLE "spelvarde"."Start" ADD CONSTRAINT "Start_number_check" CHECK ("number" BETWEEN 1 AND 30);
ALTER TABLE "spelvarde"."Start" ADD CONSTRAINT "Start_distance_check" CHECK ("distance" > 0);
ALTER TABLE "spelvarde"."Start" ADD CONSTRAINT "Start_place_check" CHECK ("place" IS NULL OR "place" >= 0);

ALTER TABLE "spelvarde"."StreckValue" ADD CONSTRAINT "StreckValue_value_check" CHECK ("value" BETWEEN 0 AND 10000);

ALTER TABLE "spelvarde"."Riktodds" ADD CONSTRAINT "Riktodds_probTop3_check" CHECK ("probTop3" >= 0 AND "probTop3" <= 1);
ALTER TABLE "spelvarde"."Riktodds" ADD CONSTRAINT "Riktodds_odds_check" CHECK ("odds" BETWEEN 1.01 AND 99.99);

ALTER TABLE "spelvarde"."Mark" ADD CONSTRAINT "Mark_unibetOdds_check" CHECK ("unibetOdds" IS NULL OR "unibetOdds" BETWEEN 1.01 AND 99.99);
ALTER TABLE "spelvarde"."Mark" ADD CONSTRAINT "Mark_unibetOddsPrev_check" CHECK ("unibetOddsPrev" IS NULL OR "unibetOddsPrev" BETWEEN 1.01 AND 99.99);
ALTER TABLE "spelvarde"."Mark" ADD CONSTRAINT "Mark_betOdds_check" CHECK ("betOdds" IS NULL OR "betOdds" BETWEEN 1.01 AND 99.99);

ALTER TABLE "spelvarde"."HorseComment" ADD CONSTRAINT "HorseComment_text_check" CHECK (length("text") <= 4000);
ALTER TABLE "spelvarde"."HorseComment" ADD CONSTRAINT "HorseComment_tags_check" CHECK (cardinality("tags") <= 20);
ALTER TABLE "spelvarde"."HorseComment" ADD CONSTRAINT "HorseComment_clientId_check" CHECK (length("clientId") BETWEEN 8 AND 64);

ALTER TABLE "spelvarde"."Coupon" ADD CONSTRAINT "Coupon_budget_check" CHECK ("budget" >= 0);
ALTER TABLE "spelvarde"."Coupon" ADD CONSTRAINT "Coupon_rowPrice_check" CHECK ("rowPrice" > 0);

ALTER TABLE "spelvarde"."Outcome" ADD CONSTRAINT "Outcome_place_check" CHECK ("place" IS NULL OR "place" >= 0);

ALTER TABLE "spelvarde"."Source" ADD CONSTRAINT "Source_url_check" CHECK ("url" ~ '^https?://' AND length("url") <= 2000);
ALTER TABLE "spelvarde"."Source" ADD CONSTRAINT "Source_name_check" CHECK (length("name") BETWEEN 1 AND 200);

-- ---- Delvisa unika index (Prisma kan inte uttrycka dem) -------------------
-- OBS för senare migreringar: `prisma migrate diff` känner inte till de här
-- och kan föreslå DROP INDEX för dem. Ta i så fall bort de raderna.

-- Högst en BASELINE per omgång (6.3, 10.4).
CREATE UNIQUE INDEX "RoundSnapshot_one_baseline_key" ON "spelvarde"."RoundSnapshot"("roundId") WHERE "kind" = 'BASELINE';
-- Exakt en aktiv modellversion (appen ser till att det finns en, databasen att det inte blir två).
CREATE UNIQUE INDEX "ModelVersion_one_active_key" ON "spelvarde"."ModelVersion"("active") WHERE "active";
-- Högst en levande RACE-kommentar per användare och start (8.2).
CREATE UNIQUE INDEX "HorseComment_one_race_per_start_key" ON "spelvarde"."HorseComment"("userId", "startId") WHERE "kind" = 'RACE' AND "startId" IS NOT NULL AND "deletedAt" IS NULL;

-- ---- Row Level Security -----------------------------------------------------
-- Appen når databasen bara via Prisma som tabellägare (rollen postgres i
-- Supabase), och ägaren förbigår RLS. RLS utan policies stänger därmed bara
-- vägen förbi appen (Supabases API-roller), utan att påverka appen. Samma
-- resonemang som i Tabellgissningens migrering enable_row_level_security.
ALTER TABLE "spelvarde"."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."UserSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."Round" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."Race" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."Horse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."Person" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."PersonAlias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."Start" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."HorseRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."RoundSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."StreckValue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."StatsSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."ModelVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."Riktodds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."FetchLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."Mark" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."RaceReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."HorseComment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."Coupon" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."LiveAlarm" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."Outcome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."Source" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."TipFact" ENABLE ROW LEVEL SECURITY;

-- Prismas migreringstabell ligger i spelvarde (via ?schema=spelvarde) och
-- skapas av Prisma innan migreringen körs. Finns den inte (t.ex. i en
-- skuggdatabas) hoppas steget över.
DO $$
BEGIN
  IF to_regclass('"spelvarde"."_prisma_migrations"') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE "spelvarde"."_prisma_migrations" ENABLE ROW LEVEL SECURITY';
  END IF;
END
$$;

-- ---- Rättigheter --------------------------------------------------------------
-- Schemat ska inte vara nåbart för Supabases API-roller (anon, authenticated)
-- eller för PUBLIC. Rollerna finns bara i Supabase, därför villkorat.
-- Gäller enbart objekt i schemat spelvarde.
REVOKE ALL ON SCHEMA "spelvarde" FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA "spelvarde" FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA "spelvarde" FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA "spelvarde" FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "spelvarde" FROM %I', r);
    END IF;
  END LOOP;
END
$$;
