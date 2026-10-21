// Positiva signaler (grönt i gränssnittet): plats % från 75 och vinst % från
// 50, men bara med minst 5 starter. Med färre starter visas siffran dämpad,
// eftersom t.ex. 3 av 4 = 75 % säger mer om slumpen än om hästen.
// Ettor och tvåor i formen är gröna via FormBox.tone (lib/gallop.ts).

import type { SignalKey, SignalResult } from "@/lib/positive-signals";

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

// ---- Antal positiva signaler (lib/positive-signals.ts) ---------------------------------------


const pct0 = (x: number) => `${Math.round(x)}${" "}%`;
const sec1 = (x: number) => `${x.toFixed(1).replace(".", ",")}${" "}s`;
const tkr = (x: number) => (x >= 1000 ? `${Math.round(x / 1000)}${" "}tkr` : `${Math.round(x)}${" "}kr`);

// Korta taggar för de uppfyllda signalerna (Spelförslag).
export function signalTags(sig: SignalResult): SignalChip[] {
  const v = sig.values;
  const text: Record<SignalKey, string> = {
    spar: "Spår",
    tid: "Tid",
    kusk: "Kusk",
    tranare: "Tränare",
    barfota: "Barfota",
    plats75: `Plats ${v.placePct === null ? "" : pct0(v.placePct)}`.trim(),
    vinst50: `Vinst ${v.winPct === null ? "" : pct0(v.winPct)}`.trim(),
    form: `Form ${v.top2}/${v.formStarts}`,
    pengar: "Pengar",
    felfri: "Felfri",
  };
  return (Object.keys(text) as SignalKey[]).filter((k) => sig.flags[k] === true).map((k) => ({ key: k, text: text[k] }));
}

export type SignalLine = { key: SignalKey; label: string; state: "ok" | "no" | "unknown"; text: string };

const LABELS: Record<SignalKey, string> = {
  spar: "Spår",
  tid: "Tid",
  kusk: "Kusk",
  tranare: "Tränare",
  barfota: "Barfota",
  plats75: "Plats",
  vinst50: "Vinst",
  form: "Form",
  pengar: "Pengar",
  felfri: "Felfri",
};

// Alla tio signalerna med verkligt värde och gräns (hästkortet).
export function signalLines(sig: SignalResult, names: { driver: string | null; trainer: string | null } = { driver: null, trainer: null }): SignalLine[] {
  const v = sig.values;
  const ord = (r: number | null) => (r === null ? "" : ` · ${r}:a i fältet`);
  const text: Record<SignalKey, string> = {
    spar: v.postPct === null || v.postMean === null ? "Spårstatistik saknas" : `Plats ${pct0(v.postPct)} mot medel ${pct0(v.postMean)} · gräns +15 %`,
    tid: v.tidBetter === null ? "Inga jämförbara tider" : v.tidBetter >= 0 ? `${sec1(v.tidBetter)} bättre än fältet · bara extrema räknas` : `${sec1(-v.tidBetter)} sämre än fältet`,
    kusk: v.driverPct === null ? "Kuskstatistik saknas (minst 20 starter)" : `${names.driver ? `${names.driver} ` : ""}${pct0(v.driverPct)}${ord(v.driverRank)} · gräns topp 3`,
    tranare: v.trainerPct === null ? "Tränarstatistik saknas (minst 20 starter)" : `${names.trainer ? `${names.trainer} ` : ""}${pct0(v.trainerPct)}${ord(v.trainerRank)} · gräns topp 3`,
    barfota: sig.flags.barfota === null ? "Okänt" : sig.flags.barfota ? "Barfota runt om" : "Går med skor",
    plats75: v.placePct === null || v.yearsStarts < 5 ? `För få starter (${v.yearsStarts})` : `${pct0(v.placePct)} (${v.yearsStarts} starter) · gräns 75 %`,
    vinst50: v.winPct === null || v.yearsStarts < 5 ? `För få starter (${v.yearsStarts})` : `${pct0(v.winPct)} (${v.yearsStarts} starter) · gräns 50 %`,
    form: v.formStarts === 0 ? "Inga tidigare starter" : `${v.top2} ettor/tvåor av ${v.formStarts} · gräns 2`,
    pengar: v.perStart === null ? "Vinstsumma saknas" : `${tkr(v.perStart)} per start${ord(v.moneyRank)} · gräns topp 3`,
    felfri: v.formStarts < 3 ? `För få starter (${v.formStarts})` : v.gallops === 0 ? `Ingen galopp i ${v.formStarts} senaste` : `Galopp i ${v.gallops} av ${v.formStarts}`,
  };
  return (Object.keys(LABELS) as SignalKey[]).map((k) => ({ key: k, label: LABELS[k], state: sig.flags[k] === true ? "ok" : sig.flags[k] === false ? "no" : "unknown", text: text[k] }));
}
