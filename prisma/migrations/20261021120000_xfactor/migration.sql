-- Etapp 2.1: X-faktor och källstöd (specen 6.8 och 8.2).
--
-- Bara additiv: en ny enum och nya kolumner på Mark, UserSettings och
-- Outcome, plus villkor. Inga tabeller, kolumner eller rader tas bort eller
-- skrivs om. Inga nya tabeller, så RLS och rättigheterna från init gäller
-- oförändrade (nya kolumner ärver tabellens rättigheter, och schemat är
-- stängt för anon/authenticated/PUBLIC).
--
-- Befintliga rader uppfyller villkoren utan omräkning:
-- - Mark: xFactor = NONE, xFactorAt = NULL och sourceSupport = NULL (standard).
-- - UserSettings: 1,25 och 1,50 (standard), alltså 1,05–3,00 och Stark > Tror.
-- - Outcome: skrivs inte förrän E4, så tabellen är tom. Skulle en rad finnas
--   får den xFactor = NONE och xFactorValue = 1,00. riktoddsX lämnas NULL,
--   eftersom migreringar här inte får innehålla UPDATE; statistiken i E4 ska
--   läsa NULL med xFactor = NONE som riktodds (specen 8.2).
--
-- Allt i en transaktion: faller ett villkor på befintlig data ändras ingenting.

BEGIN;

-- ---- Del 1: genererat med prisma migrate diff ------------------------------

-- CreateEnum
CREATE TYPE "spelvarde"."XFactor" AS ENUM ('NONE', 'TROR', 'STARK');

-- AlterTable
ALTER TABLE "spelvarde"."UserSettings" ADD COLUMN     "xFactorStark" DECIMAL(4,2) NOT NULL DEFAULT 1.50,
ADD COLUMN     "xFactorTror" DECIMAL(4,2) NOT NULL DEFAULT 1.25;

-- AlterTable
ALTER TABLE "spelvarde"."Mark" ADD COLUMN     "sourceSupport" INTEGER,
ADD COLUMN     "xFactor" "spelvarde"."XFactor" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "xFactorAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "spelvarde"."Outcome" ADD COLUMN     "riktoddsX" DECIMAL(6,2),
ADD COLUMN     "sourceSupport" INTEGER,
ADD COLUMN     "sourceTotal" INTEGER,
ADD COLUMN     "xFactor" "spelvarde"."XFactor" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "xFactorValue" DECIMAL(4,2) NOT NULL DEFAULT 1.00;

-- ---- Del 2: villkor (för hand) ----------------------------------------------

-- Faktorerna i S10: 1,05–3,00 och Stark känsla större än Tror på.
ALTER TABLE "spelvarde"."UserSettings" ADD CONSTRAINT "UserSettings_xFactorTror_check" CHECK ("xFactorTror" BETWEEN 1.05 AND 3.00);
ALTER TABLE "spelvarde"."UserSettings" ADD CONSTRAINT "UserSettings_xFactorStark_check" CHECK ("xFactorStark" BETWEEN 1.05 AND 3.00);
ALTER TABLE "spelvarde"."UserSettings" ADD CONSTRAINT "UserSettings_xFactor_order_check" CHECK ("xFactorStark" > "xFactorTror");

-- X-faktor är en delmängd av Intressant (6.8), och tiden finns bara när X är satt.
ALTER TABLE "spelvarde"."Mark" ADD CONSTRAINT "Mark_xFactor_needs_interesting_check" CHECK ("xFactor" = 'NONE' OR "interesting");
ALTER TABLE "spelvarde"."Mark" ADD CONSTRAINT "Mark_xFactorAt_check" CHECK (("xFactor" = 'NONE') = ("xFactorAt" IS NULL));
-- Källstöd 0–20 eller NULL (inte ifyllt).
ALTER TABLE "spelvarde"."Mark" ADD CONSTRAINT "Mark_sourceSupport_check" CHECK ("sourceSupport" IS NULL OR "sourceSupport" BETWEEN 0 AND 20);

-- De frysta värdena (E4 skriver dem): faktorn 1,00 för NONE, annars 1,05–3,00.
ALTER TABLE "spelvarde"."Outcome" ADD CONSTRAINT "Outcome_xFactorValue_check" CHECK (CASE WHEN "xFactor" = 'NONE' THEN "xFactorValue" = 1.00 ELSE "xFactorValue" BETWEEN 1.05 AND 3.00 END);
ALTER TABLE "spelvarde"."Outcome" ADD CONSTRAINT "Outcome_riktoddsX_check" CHECK ("riktoddsX" IS NULL OR "riktoddsX" BETWEEN 1.01 AND 99.99);
ALTER TABLE "spelvarde"."Outcome" ADD CONSTRAINT "Outcome_sourceSupport_check" CHECK ("sourceSupport" IS NULL OR "sourceSupport" BETWEEN 0 AND 20);
ALTER TABLE "spelvarde"."Outcome" ADD CONSTRAINT "Outcome_sourceTotal_check" CHECK ("sourceTotal" IS NULL OR "sourceTotal" BETWEEN 0 AND 20);

COMMIT;
