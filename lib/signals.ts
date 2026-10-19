// Positiva signaler (grönt i gränssnittet): plats % från 75 och vinst % från
// 50, men bara med minst 5 starter. Med färre starter visas siffran dämpad,
// eftersom t.ex. 3 av 4 = 75 % säger mer om slumpen än om hästen.
// Ettor och tvåor i formen är gröna via FormBox.tone (lib/gallop.ts).

export const SIGNAL_PLACE_PCT = 75;
export const SIGNAL_WIN_PCT = 50;
export const SIGNAL_MIN_STARTS = 5;

export type Signal = "good" | "few" | null;

export function pctSignal(kind: "win" | "place", pct: number | null, starts: number | null): Signal {
  if (pct === null || starts === null || starts <= 0) return null;
  if (starts < SIGNAL_MIN_STARTS) return "few";
  return pct >= (kind === "place" ? SIGNAL_PLACE_PCT : SIGNAL_WIN_PCT) ? "good" : null;
}

// CSS-klassen för signalen (styles/app.css: .sig och .few).
export const signalClass = (s: Signal): string | undefined => (s === "good" ? "sig" : s === "few" ? "few" : undefined);

// Hur mycket Unibets odds ligger över riktoddset, i procent (2,40 mot 2,00 = 20).
// null när något saknas.
export function valuePct(unibet: number | null, rikt: number | null): number | null {
  if (unibet === null || rikt === null || rikt <= 0) return null;
  return Math.round((unibet / rikt - 1) * 1000) / 10;
}

// Nära gränsen: Unibet högst 10 % under riktoddset.
export const NEAR_LIMIT_PCT = -10;

// Skärmläsartext efter siffran.
export const signalSr = (s: Signal): string => (s === "good" ? ", stark" : s === "few" ? ", få starter" : "");

export type SignalChip = { key: string; text: string };

// De gröna signalerna för en häst, för listan över spelbara (S6a).
// formTones = tonerna i formen (lib/gallop.ts), nyast först.
export function horseSignals(h: {
  placePct: number | null;
  winPct: number | null;
  starts: number | null;
  formTones: string[];
  postPlacePct: number | null;
  bestPlaceNumber: boolean;
}): SignalChip[] {
  const out: SignalChip[] = [];
  const form = h.formTones.slice(0, 5);
  const top2 = form.filter((t) => t === "win" || t === "second").length;
  if (top2 >= 2) out.push({ key: "form", text: `${top2} av ${form.length} senaste etta/tvåa` });
  if (pctSignal("place", h.placePct, h.starts) === "good") out.push({ key: "plats", text: `Plats ${Math.round(h.placePct!)} %` });
  if (pctSignal("win", h.winPct, h.starts) === "good") out.push({ key: "vinst", text: `Vinst ${Math.round(h.winPct!)} %` });
  if (h.bestPlaceNumber && h.postPlacePct !== null) out.push({ key: "spar", text: `Bästa spåret, plats ${Math.round(h.postPlacePct)} %` });
  return out;
}
