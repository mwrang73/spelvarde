-- E6 Tippa V85 (docs/specs/e6-v85-rad.md 8.5): regler och skäl för V85-raden.
-- Additiv: nya nullbara kolumner och en ny enum. Befintliga rader får null i
-- alla nya kolumner och tolkas som gamla rader (sparade före E6). Inget skrivs om.
-- RLS är redan påslaget på "Coupon" (20261019120000_init).

CREATE TYPE "spelvarde"."AllgMode" AS ENUM ('AUTO', 'CHOSEN');

ALTER TABLE "spelvarde"."Coupon"
  ADD COLUMN "spikCount" INTEGER,
  ADD COLUMN "allgMode" "spelvarde"."AllgMode",
  ADD COLUMN "allgLeg" INTEGER,
  ADD COLUMN "legRoles" JSONB,
  ADD COLUMN "copiedAt" TIMESTAMP(3),
  ADD COLUMN "copiedSelections" JSONB;

ALTER TABLE "spelvarde"."Coupon" ADD CONSTRAINT "Coupon_spikCount_check" CHECK ("spikCount" IS NULL OR "spikCount" BETWEEN 0 AND 8);
ALTER TABLE "spelvarde"."Coupon" ADD CONSTRAINT "Coupon_allgLeg_check" CHECK ("allgLeg" IS NULL OR "allgLeg" BETWEEN 1 AND 8);
