// Km-tider för signalen "tid" (modellen v3, specen 7). Tider är trubbiga
// (lopp körs olika, väder och årstid), så signalen räknas bara för en häst som
// sticker ut extremt mot fältet.
//
// Referenstiden per startmetod och distans är en rät linje: inom samma häst blir
// km-tiden i snitt 1,0 s långsammare per 500 m längre distans (ATG-poster
// 2023–2026, 262 000 lopp). Därför är 1.13,4 på 2140a bättre än 1.13,4 på
// 1640a. Nivån (75,0 s auto och 77,0 s volte på 2140 m) är medianen.

export const KM_SLOPE_PER_M = 0.00199;
export const KM_BASE: Record<"AUTO" | "VOLTE", number> = { AUTO: 75.0, VOLTE: 77.0 };

// "1.12,9" → 72,9 s per km. Koder ("u", "d") och saknat → null.
export function kmSeconds(t: string | null | undefined): number | null {
  const m = /^(\d)\.(\d{2}),(\d)$/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 10 : null;
}

export function kmRef(method: string, distance: number): number | null {
  const base = KM_BASE[method as "AUTO" | "VOLTE"];
  return base === undefined || !(distance > 0) ? null : base + KM_SLOPE_PER_M * (distance - 2140);
}

export type KmRecord = { kmTime?: string | null; distance?: number | null; startMethod?: string | null; galloped: boolean; disqualified: boolean };

// Hästens bästa km-tid mot referensen i de 5 senaste giltiga starterna
// (ingen galopp, ingen diskning). Negativt = snabbare än referensen. null = ingen tid.
export function bestAdjusted(records: KmRecord[], ref: (method: string, distance: number) => number | null = kmRef): number | null {
  const adj = records
    .slice(0, 5)
    .map((r) => {
      const sec = kmSeconds(r.kmTime);
      const rf = r.startMethod && r.distance ? ref(r.startMethod, r.distance) : null;
      return sec === null || rf === null || r.galloped || r.disqualified ? null : sec - rf;
    })
    .filter((x): x is number => x !== null);
  return adj.length ? Math.min(...adj) : null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

// Extremvärdet per häst: hur många robusta standardavvikelser (MAD) hästens
// bästa tid är snabbare än fältets median, minus 2. 0 för alla som inte är
// minst 2 avvikelser snabbare, och för alla när färre än 4 har tid.
export function timeOutliers(bests: (number | null)[]): number[] {
  const known = bests.filter((x): x is number => x !== null);
  if (known.length < 4) return bests.map(() => 0);
  const med = median(known);
  const mad = 1.4826 * median(known.map((x) => Math.abs(x - med)));
  return bests.map((b) => (b === null || !(mad > 0) ? 0 : Math.max(0, (med - b) / mad - 2)));
}
