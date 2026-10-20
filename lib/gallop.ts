// Galopp (G/GD) och formrutor för de 5 senaste starterna (specen 6.2).
// Rena funktioner. Underlaget är HorseRecord före omgångens datum, nyast först.

export type FormRecord = {
  date: string; // "2026-09-13"
  trackName: string;
  place: number | null;
  galloped: boolean;
  disqualified: boolean;
  scratched?: boolean;
  // För riktoddsens vila och tid (v3).
  kmTime?: string | null;
  distance?: number | null;
  startMethod?: "AUTO" | "VOLTE" | null;
};

export type GallopFlag = "G" | "GD" | null;

export type FormBox = {
  // "1"–"9", "0", "d" eller "g".
  char: string;
  // win = etta, second = tvåa (gröna i formen), gal = galopp, plain = övrigt.
  tone: "win" | "second" | "gal" | "plain";
  // Skärmläsartext för rutan, t.ex. "1:a" eller "galopp oplacerad".
  label: string;
};

const MONTHS_SHORT = ["jan", "feb", "mars", "apr", "maj", "juni", "juli", "aug", "sep", "okt", "nov", "dec"];

// De `n` senaste riktiga starterna före `beforeDate` (strukna räknas inte).
export function lastStarts<T extends FormRecord>(records: T[], beforeDate: string, n = 5): T[] {
  return records
    .filter((r) => !r.scratched && r.date < beforeDate)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, n);
}

export function gallopFlag(last: FormRecord[]): GallopFlag {
  if (last.some((r) => r.galloped && r.disqualified)) return "GD";
  if (last.some((r) => r.galloped)) return "G";
  return null;
}

export function formBox(r: FormRecord): FormBox {
  const placed = r.place !== null && r.place >= 1 && r.place <= 9;
  if (r.galloped) {
    if (r.disqualified) return { char: "d", tone: "gal", label: "galopp diskad" };
    if (placed) return { char: String(r.place), tone: "gal", label: `galopp ${r.place}:a` };
    return { char: "g", tone: "gal", label: "galopp oplacerad" };
  }
  if (r.disqualified) return { char: "d", tone: "plain", label: "diskad" };
  if (placed) return { char: String(r.place), tone: r.place === 1 ? "win" : r.place === 2 ? "second" : "plain", label: `${r.place}:a` };
  return { char: "0", tone: "plain", label: "oplacerad" };
}

export function formBoxes(last: FormRecord[]): FormBox[] {
  return last.slice(0, 5).map(formBox);
}

export function formAriaLabel(boxes: FormBox[]): string {
  if (!boxes.length) return "Form: inga tidigare starter";
  return `Form, senaste först: ${boxes.map((b) => b.label).join(", ")}`;
}

// "2026-09-13" → "13 sep".
export function shortDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return `${parseInt(m[3], 10)} ${MONTHS_SHORT[parseInt(m[2], 10) - 1]}`;
}

export type GallopWarning = {
  kind: "G" | "GD";
  count: number;
  total: number;
  date: string;
  trackName: string;
  text: string;
};

// "Galopp i 1 av 5 senaste starterna, 13 sep på Åby" eller
// "Galopp med diskning 13 sep på Åby". Null utan galopp.
export function gallopWarning(last: FormRecord[]): GallopWarning | null {
  const flag = gallopFlag(last);
  if (!flag) return null;
  const galloped = last.filter((r) => r.galloped);
  const latest = flag === "GD" ? last.find((r) => r.galloped && r.disqualified)! : galloped[0];
  const when = `${shortDate(latest.date)} på ${latest.trackName}`;
  const text =
    flag === "GD"
      ? `Galopp med diskning ${when}`
      : `Galopp i ${galloped.length} av ${last.length} senaste ${last.length === 1 ? "starten" : "starterna"}, ${when}`;
  return { kind: flag, count: galloped.length, total: last.length, date: latest.date, trackName: latest.trackName, text };
}

export type FormSummary = {
  boxes: FormBox[];
  ariaLabel: string;
  gallop: GallopFlag;
  warning: GallopWarning | null;
  // Färre än 5 tidigare starter (riktoddset blir "osäkert", tomma rutor).
  fewStarts: boolean;
  debut: boolean;
};

export function formSummary(records: FormRecord[], beforeDate: string): FormSummary {
  const last = lastStarts(records, beforeDate, 5);
  const boxes = formBoxes(last);
  return {
    boxes,
    ariaLabel: formAriaLabel(boxes),
    gallop: gallopFlag(last),
    warning: gallopWarning(last),
    fewStarts: last.length < 5,
    debut: last.length === 0,
  };
}
