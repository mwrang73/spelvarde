// Antal positiva signaler per häst (backtestet 2026-10-20, docs/backtest/
// MODELLHISTORIK.md). Samma funktion används av appen (round-server) och av
// backtestet, så att siffrorna i backtestet gäller det som visas.
//
// Tio ja/nej-signaler med fasta gränser:
//   spar      startnumrets plats % minst 15 % över tabellens medel
//   tid       sticker ut extremt på tid (lib/kmref.ts)
//   kusk      kuskens vinst % i år bland fältets 3 bästa (minst 20 starter)
//   tranare   tränarens vinst % i år bland fältets 3 bästa (minst 20 starter)
//   barfota   barfota runt om
//   plats75   plats % i år och i fjol minst 75 % (minst 5 starter)
//   vinst50   vinst % i år och i fjol minst 50 % (minst 5 starter)
//   form      minst 2 ettor eller tvåor i de 5 senaste
//   pengar    intjänat per start bland fältets 3 bästa
//   felfri    ingen galopp i de 5 senaste (minst 3 starter)
// Saknas underlaget blir signalen null ("Okänt") och räknas inte.
//
// Lågt streck: minst 4 signaler och inte bland loppets 3 mest streckade
// (null innan strecket finns). Topp 3 i 25–26 % mot strecket 20 % i backtestet.

import { bestAdjusted, timeOutliers, type KmRecord } from "@/lib/kmref";

export const SIGNAL_KEYS = ["spar", "tid", "kusk", "tranare", "barfota", "plats75", "vinst50", "form", "pengar", "felfri"] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];

// "Många" signaler (grön fylld bricka) och gränsen för Lågt streck.
export const MANY_SIGNALS = 5;
export const LOW_STRECK_MIN = 4;

// Topp 3-andel per antal signaler i backtestet (23 880 starter), för hästkortet.
export const TOP3_BY_COUNT: Record<number, number> = { 0: 12, 1: 16, 2: 22, 3: 28, 4: 37, 5: 46, 6: 57 };

export type SignalInput = {
  scratched: boolean;
  thisYear: { starts: number; wins: number; placed: number } | null;
  lastYear: { starts: number; wins: number; placed: number } | null;
  // Senaste starterna, nyast först.
  records: (KmRecord & { place: number | null })[];
  driver: { starts: number; wins: number } | null;
  trainer: { starts: number; wins: number } | null;
  earnings: { total: number; lifeStarts: number } | null;
  barefoot: boolean | null;
  // Startnumrets plats % och tabellens medel (statistikbasen). null = saknas.
  post: { pct: number; mean: number } | null;
  // Streck i procent. null = inget streck än.
  streck: number | null;
};

// Värdena bakom signalerna, för texterna i hästkortet.
export type SignalValues = {
  postPct: number | null;
  postMean: number | null;
  tidBetter: number | null; // sekunder snabbare än fältets median (justerat)
  driverPct: number | null;
  driverRank: number | null;
  trainerPct: number | null;
  trainerRank: number | null;
  placePct: number | null;
  winPct: number | null;
  yearsStarts: number;
  top2: number;
  formStarts: number;
  perStart: number | null;
  moneyRank: number | null;
  gallops: number;
};

export type SignalResult = {
  flags: Record<SignalKey, boolean | null>;
  count: number;
  lowStreck: boolean | null;
  values: SignalValues;
};

// Plats i fältet (1 = högst) för värden; null för saknade.
function ranks(vals: (number | null)[]): (number | null)[] {
  return vals.map((v) => (v === null ? null : 1 + vals.filter((o) => o !== null && o > v).length));
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

// Signalerna för loppets hästar, i samma ordning. Strukna får null.
export function positiveSignals(all: SignalInput[]): (SignalResult | null)[] {
  const run = all.filter((s) => !s.scratched);
  const rate = (p: { starts: number; wins: number } | null) => (p && p.starts >= 20 ? p.wins / p.starts : null);
  const driverRates = run.map((s) => rate(s.driver));
  const trainerRates = run.map((s) => rate(s.trainer));
  const perStart = run.map((s) => (s.earnings && s.earnings.lifeStarts > 0 ? s.earnings.total / s.earnings.lifeStarts : null));
  const dRank = ranks(driverRates);
  const tRank = ranks(trainerRates);
  const mRank = ranks(perStart);
  const bests = run.map((s) => bestAdjusted(s.records));
  const tid = timeOutliers(bests);
  const known = bests.filter((x): x is number => x !== null);
  const tidMedian = known.length >= 4 ? median(known) : null;
  const streckVals = run.map((s) => s.streck);
  const hasStreck = streckVals.some((v) => v !== null && v > 0);
  const streckRank = ranks(streckVals.map((v) => v ?? 0));

  const results = run.map((s, i): SignalResult => {
    const st = (s.thisYear?.starts ?? 0) + (s.lastYear?.starts ?? 0);
    const placed = (s.thisYear?.placed ?? 0) + (s.lastYear?.placed ?? 0);
    const wins = (s.thisYear?.wins ?? 0) + (s.lastYear?.wins ?? 0);
    const last5 = s.records.slice(0, 5);
    const top2 = last5.filter((r) => !r.disqualified && (r.place === 1 || r.place === 2)).length;
    const gallops = last5.filter((r) => r.galloped).length;
    const flags: Record<SignalKey, boolean | null> = {
      spar: s.post && s.post.mean > 0 ? s.post.pct / s.post.mean >= 1.15 : null,
      tid: bests[i] === null ? null : tid[i] > 0,
      kusk: driverRates[i] === null ? null : (dRank[i] as number) <= 3,
      tranare: trainerRates[i] === null ? null : (tRank[i] as number) <= 3,
      barfota: s.barefoot,
      plats75: st >= 5 ? placed / st >= 0.75 : null,
      vinst50: st >= 5 ? wins / st >= 0.5 : null,
      form: last5.length ? top2 >= 2 : null,
      pengar: perStart[i] === null ? null : (mRank[i] as number) <= 3,
      felfri: last5.length >= 3 ? gallops === 0 : null,
    };
    const count = Object.values(flags).filter((f) => f === true).length;
    return {
      flags,
      count,
      lowStreck: hasStreck ? count >= LOW_STRECK_MIN && (streckRank[i] as number) >= 4 : null,
      values: {
        postPct: s.post?.pct ?? null,
        postMean: s.post?.mean ?? null,
        tidBetter: bests[i] !== null && tidMedian !== null ? tidMedian - (bests[i] as number) : null,
        driverPct: driverRates[i] === null ? null : 100 * (driverRates[i] as number),
        driverRank: dRank[i],
        trainerPct: trainerRates[i] === null ? null : 100 * (trainerRates[i] as number),
        trainerRank: tRank[i],
        placePct: st ? (100 * placed) / st : null,
        winPct: st ? (100 * wins) / st : null,
        yearsStarts: st,
        top2,
        formStarts: last5.length,
        perStart: perStart[i],
        moneyRank: mRank[i],
        gallops,
      },
    };
  });
  let j = 0;
  return all.map((s) => (s.scratched ? null : results[j++]));
}
