// Vilka delar av appen som finns i den här etappen. Styr Nästa steg (3.2) så
// att kortet inte pekar på vyer som inte är byggda än. Slås på i respektive
// etapp.
export type Features = {
  // E2: S4 Unibets odds, Spelbar och Bet.
  odds: boolean;
  // E2: S6b V85-raden.
  coupon: boolean;
  // E3: S5 Lördag live och larm.
  live: boolean;
  // E8: Live (S7), och resultatet visas per lopp. stats: S9 Statistik.
  raceView: boolean;
  stats: boolean;
  // E4a: resultatet i S2 och S1, automatisk hämtning och Nästa steg med länkar.
  results: boolean;
  // E5: Hämta tips, granskningen, rolltaggen i S2 och Tips i S3.
  tips: boolean;
};

export const FEATURES: Features = { odds: true, coupon: true, live: false, raceView: true, stats: false, results: true, tips: true };
