-- E6b Max hästar per lopp (docs/specs/e6b-max-per-lopp.md 4.3).
-- Additiv: en ny nullbar kolumn och ett CHECK-villkor. Befintliga rader får
-- null = Alla (inget tak) och ger exakt samma rad som före E6b. Inget skrivs om.
-- allgMode/allgLeg återanvänds för prioriterat lopp (oförändrade).
-- RLS är redan påslaget på "Coupon" (20261019120000_init).

ALTER TABLE "spelvarde"."Coupon" ADD COLUMN "maxPerLeg" INTEGER;
ALTER TABLE "spelvarde"."Coupon" ADD CONSTRAINT "Coupon_maxPerLeg_check" CHECK ("maxPerLeg" IS NULL OR "maxPerLeg" BETWEEN 3 AND 30);
