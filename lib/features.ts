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
  // E4: S7 Under loppet och S9 Statistik.
  raceView: boolean;
  stats: boolean;
};

export const FEATURES: Features = { odds: true, coupon: true, live: false, raceView: false, stats: false };
