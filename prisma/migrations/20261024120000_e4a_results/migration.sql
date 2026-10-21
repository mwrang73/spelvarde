-- Etapp 4a: Resultat (specen e4a, avsnitt 6.4, 8 och 18).
--
-- Bara additiv: nya nullbara kolumner på Outcome och Race, plus villkor.
-- Inga tabeller, kolumner eller rader tas bort eller skrivs om. Inga UPDATE.
-- Inga nya tabeller, så RLS och rättigheterna från init gäller oförändrade
-- (nya kolumner ärver tabellens rättigheter, och schemat är stängt för
-- anon/authenticated/PUBLIC).
--
-- - Outcome.trollspotRank, trollspotMinOdds och trollspotEstOdds (avsnitt
--   18): Trollspöt precis före loppets start. NULL = hästen var inte med
--   (eller data saknades). Befintliga rader får NULL.
-- - Race.outcomesFrozenAt: när frysningen gjordes för loppet. NULL = inte
--   fryst. Befintliga lopp får NULL och fryses vid nästa läsning efter
--   starttiden, vilket är idempotent (createMany med skipDuplicates).
--
-- Väg tillbaka: kolumnerna är nullbara och läses bara av den nya koden. En
-- äldre version av appen fungerar mot det nya schemat. Behöver de tas bort
-- görs det i en egen migrering efter godkännande.
--
-- Allt i en transaktion: faller ett villkor på befintlig data ändras ingenting.

BEGIN;

-- ---- Del 1: kolumner (samma form som prisma migrate diff) ------------------

-- AlterTable
ALTER TABLE "spelvarde"."Outcome" ADD COLUMN     "trollspotEstOdds" DECIMAL(6,2),
ADD COLUMN     "trollspotMinOdds" DECIMAL(6,2),
ADD COLUMN     "trollspotRank" INTEGER;

-- AlterTable
ALTER TABLE "spelvarde"."Race" ADD COLUMN     "outcomesFrozenAt" TIMESTAMP(3);

-- ---- Del 2: villkor (för hand) ---------------------------------------------------

-- Plats 1–10 i Trollspöt (TROLL_COUNT i lib/trollspot.ts).
ALTER TABLE "spelvarde"."Outcome" ADD CONSTRAINT "Outcome_trollspotRank_check" CHECK ("trollspotRank" IS NULL OR "trollspotRank" BETWEEN 1 AND 10);
-- Oddsen finns precis när platsen finns, och är decimalodds (minst 1,00).
ALTER TABLE "spelvarde"."Outcome" ADD CONSTRAINT "Outcome_trollspot_odds_check" CHECK (
  ("trollspotRank" IS NULL AND "trollspotMinOdds" IS NULL AND "trollspotEstOdds" IS NULL)
  OR ("trollspotRank" IS NOT NULL AND "trollspotMinOdds" >= 1.00 AND "trollspotEstOdds" >= 1.00)
);
-- Placeringen gäller bara efter resultat; träff kräver att hästen inte är diskad.
ALTER TABLE "spelvarde"."Outcome" ADD CONSTRAINT "Outcome_hit_check" CHECK ("hit" IS NOT TRUE OR (NOT "disqualified" AND "place" BETWEEN 1 AND 3));

COMMIT;
