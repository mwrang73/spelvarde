-- Statistikbasen och spelformen.
--
-- Bara additiv: tre nya tabeller (HistDay, HistRace, HistStart) för alla
-- svenska travlopp från ATG, och kolumnen gameType på Round och
-- UserSettings. Inga tabeller, kolumner eller rader tas bort eller skrivs om.
--
-- Befintliga rader uppfyller villkoren utan omräkning: alla omgångar hittills
-- är V85, och standardvärdet är V85.
--
-- De nya tabellerna får RLS påslaget utan policyer, som alla andra tabeller i
-- schemat: bara appens egen databasroll (som äger tabellerna) kommer åt dem.
--
-- Allt i en transaktion: faller ett villkor på befintlig data ändras ingenting.

BEGIN;

-- ---- Del 1: genererat med prisma migrate diff ------------------------------

-- AlterTable
ALTER TABLE "spelvarde"."UserSettings" ADD COLUMN     "gameType" TEXT NOT NULL DEFAULT 'V85';

-- AlterTable
ALTER TABLE "spelvarde"."Round" ADD COLUMN     "gameType" TEXT NOT NULL DEFAULT 'V85';

-- CreateTable
CREATE TABLE "spelvarde"."HistDay" (
    "date" DATE NOT NULL,
    "races" INTEGER NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistDay_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "spelvarde"."HistRace" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "trackId" INTEGER NOT NULL,
    "trackName" TEXT NOT NULL,
    "raceNumber" INTEGER NOT NULL,
    "distance" INTEGER NOT NULL,
    "startMethod" "spelvarde"."StartMethod" NOT NULL,
    "starters" INTEGER NOT NULL,

    CONSTRAINT "HistRace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spelvarde"."HistStart" (
    "raceId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "postPosition" INTEGER,
    "distance" INTEGER NOT NULL,
    "scratched" BOOLEAN NOT NULL DEFAULT false,
    "place" INTEGER,
    "disqualified" BOOLEAN NOT NULL DEFAULT false,
    "galloped" BOOLEAN NOT NULL DEFAULT false,
    "finalOdds" DECIMAL(6,2),

    CONSTRAINT "HistStart_pkey" PRIMARY KEY ("raceId","number")
);

-- CreateIndex
CREATE INDEX "HistRace_startMethod_distance_date_idx" ON "spelvarde"."HistRace"("startMethod", "distance", "date");

-- CreateIndex
CREATE INDEX "HistRace_trackId_date_idx" ON "spelvarde"."HistRace"("trackId", "date");

-- AddForeignKey
ALTER TABLE "spelvarde"."HistStart" ADD CONSTRAINT "HistStart_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "spelvarde"."HistRace"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---- Del 2: villkor och RLS (för hand) ----------------------------------------

ALTER TABLE "spelvarde"."Round" ADD CONSTRAINT "Round_gameType_check" CHECK ("gameType" IN ('V75', 'V85', 'V86', 'GS75'));
ALTER TABLE "spelvarde"."UserSettings" ADD CONSTRAINT "UserSettings_gameType_check" CHECK ("gameType" IN ('V75', 'V85', 'V86', 'GS75'));
ALTER TABLE "spelvarde"."HistRace" ADD CONSTRAINT "HistRace_starters_check" CHECK ("starters" >= 0);
ALTER TABLE "spelvarde"."HistDay" ADD CONSTRAINT "HistDay_races_check" CHECK ("races" >= 0);

ALTER TABLE "spelvarde"."HistDay" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."HistRace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spelvarde"."HistStart" ENABLE ROW LEVEL SECURITY;

COMMIT;
