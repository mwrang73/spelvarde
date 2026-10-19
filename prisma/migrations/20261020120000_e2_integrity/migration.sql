-- Etapp 2: riktodds, odds, Spelbar, Bet och V85-raden.
--
-- Tabellerna och kolumnerna för E2 finns redan sedan init-migreringen
-- (Mark, Coupon, ModelVersion, Riktodds, UserSettings). Den här migreringen
-- är bara additiv: den lägger till villkor som skyddar reglerna i
-- databasen, inte bara i appen. Inga tabeller, kolumner eller rader tas bort
-- eller ändras, och inga nya objekt skapas som kräver RLS eller rättigheter.
-- Befintliga rader från E1 uppfyller villkoren (E1 skriver bara interesting
-- och sätter spelbarOverride = NONE när Intressant tas bort).

-- Spelbar är en delmängd av Intressant (6.1): ett eget val (ON/OFF) kräver Intressant.
ALTER TABLE "spelvarde"."Mark" ADD CONSTRAINT "Mark_override_needs_interesting_check" CHECK ("spelbarOverride" = 'NONE' OR "interesting");
-- Bet-odds och tiden för Bet finns bara när hästen har Bet (S6a).
ALTER TABLE "spelvarde"."Mark" ADD CONSTRAINT "Mark_betOdds_needs_bet_check" CHECK ("bet" OR ("betOdds" IS NULL AND "betAt" IS NULL));

-- Kupongen (6.5): avdelningar 1–8 och ett objekt med valen.
ALTER TABLE "spelvarde"."Coupon" ADD CONSTRAINT "Coupon_lockedLegs_check" CHECK ("lockedLegs" <@ ARRAY[1, 2, 3, 4, 5, 6, 7, 8] AND cardinality("lockedLegs") <= 8);
ALTER TABLE "spelvarde"."Coupon" ADD CONSTRAINT "Coupon_selections_check" CHECK (jsonb_typeof("selections") = 'object');
ALTER TABLE "spelvarde"."Coupon" ADD CONSTRAINT "Coupon_budget_max_check" CHECK ("budget" <= 100000);
ALTER TABLE "spelvarde"."Coupon" ADD CONSTRAINT "Coupon_rowPrice_max_check" CHECK ("rowPrice" <= 100);

-- Radpriset i inställningarna (S10).
ALTER TABLE "spelvarde"."UserSettings" ADD CONSTRAINT "UserSettings_rowPrice_max_check" CHECK ("rowPrice" <= 100);

-- Modellversioner (7.3, S10): nyckeln v1, v1.1 … och vikter/parametrar som objekt.
ALTER TABLE "spelvarde"."ModelVersion" ADD CONSTRAINT "ModelVersion_key_check" CHECK ("key" ~ '^v[0-9]+(\.[0-9]+)?$');
ALTER TABLE "spelvarde"."ModelVersion" ADD CONSTRAINT "ModelVersion_weights_check" CHECK (jsonb_typeof("weights") = 'object' AND jsonb_typeof("params") = 'object');
