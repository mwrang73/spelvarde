// Inlämnad rad (E8, docs/specs/e8-live.md 9–11): tolkning av kroppen, rader och
// kostnad, skillnaden mot arbetsraden, träffräkningen och alla texter för raden.
// Rena funktioner som också används i klienten. Testade i lib/submitted-row.test.ts.
//
// Raden är Mikaels egen markering. Appen vet inte vad ATG har tagit emot, och
// träffräkningen är Spelvärdes räkning, inte ATG:s rättning.

import { couponCost, parseSelections, r2, sameNumbers, type Selections } from "@/lib/coupon";
import { legName, legsFor } from "@/lib/game-type";
import { firstStartOf } from "@/lib/phase";
import type { Result } from "@/lib/validate";

// ---- Felsvar (9.3) ------------------------------------------------------------

export const SUBMITTED_ROW_ROUND_MISSING = "Omgången finns inte.";
export const SUBMITTED_ROW_BAD_BODY = "Ogiltig begäran.";
export const SUBMITTED_ROW_UNKNOWN_FIELD = "Okänt fält i raden.";
export const SUBMITTED_ROW_TOO_MANY = "Raden har för många rader.";
export const SUBMITTED_ROW_PRICE_ERROR = "Radpriset ska ligga mellan 0,01 och 100 kr.";
export const SUBMITTED_ROW_TIME_ERROR = "Ogiltig tid för markeringen.";
export const SUBMITTED_ROW_LEG_MISSING = (gameType: string, leg: number | string) => `${legName(gameType, leg)} finns inte i omgången.`;
export const SUBMITTED_ROW_LEG_EMPTY = (gameType: string, leg: number | string) => `${legName(gameType, leg)} har inga hästar i raden.`;

// ---- Texter i gränssnittet (10, 11) ---------------------------------------------

export const SUBMITTED_ROW_NONE = "Ingen inlämnad rad";
export const SUBMITTED_ROW_NONE_TITLE = "Ingen rad är markerad som inlämnad.";
export const SUBMITTED_ROW_NONE_TEXT = "Live visar ingen rad.";
export const SUBMITTED_ROW_HELP = "Din egen markering. Appen vet inte vad ATG har tagit emot.";
export const SUBMITTED_ROW_MARK = "Jag har lämnat in raden";
export const SUBMITTED_ROW_MARK_LATE = "Jag lämnade in raden före start";
export const SUBMITTED_ROW_MARK_LATE_HELP = "Sparas som markerad efter spelstopp. Det är din egen markering, och appen vet inte vad ATG har tagit emot.";
export const SUBMITTED_ROW_MARK_HELP = (summary: string) => `Sparar raden på kupongen ovan: ${summary}. Det är din egen markering, och appen vet inte vad ATG har tagit emot.`;
export const SUBMITTED_ROW_STAMP = "✓ Inlämnad";
export const SUBMITTED_ROW_LATE_NOTE = "markerad efter spelstopp";
export const SUBMITTED_ROW_SAVED = "Sparad. Live visar den här raden.";
export const SUBMITTED_ROW_QUEUED = "I kö · sparas när nätet är tillbaka";
export const SUBMITTED_ROW_SAME = "✓ Den här raden är markerad som inlämnad.";
export const SUBMITTED_ROW_REPLACE = "Ersätt raden";
export const SUBMITTED_ROW_REPLACE_HELP = "Ersätt bara om du har makulerat raden hos ATG.";
export const SUBMITTED_ROW_REPLACED_TITLE = "Raden är ersatt.";
export const SUBMITTED_ROW_REPLACED_TEXT = "Den tidigare markeringen är borttagen.";
export const SUBMITTED_ROW_UNDO_MARK = "Ångra markeringen";
export const SUBMITTED_ROW_REMOVED_TITLE = "Markeringen är borttagen.";
export const SUBMITTED_ROW_REMOVED_TEXT = "Live visar inte den raden längre. Spelet hos ATG påverkas inte.";
export const SUBMITTED_ROW_WHICH = "Vilken rad lämnade du in?";
export const SUBMITTED_ROW_CHOICE_COPIED = (time: string, summary: string) => `Raden du laddade ner eller kopierade ${time} · ${summary}`;
export const SUBMITTED_ROW_CHOICE_CURRENT = (summary: string) => `Raden som visas i appen nu · ${summary}`;
export const SUBMITTED_ROW_CHANGED_TITLE = "Raden här har ändrats efter inlämningen:";
export const SUBMITTED_ROW_CHANGED_TEXT = "Din inlämnade rad är oförändrad. Ändringen gäller inte hos ATG förrän du lämnar in igen.";
export const SUBMITTED_ROW_SCRATCHED_TITLE = (number: number, horse: string, gameType: string, leg: number) => `${number} ${horse} i ${legName(gameType, leg)} är struken.`;
export const SUBMITTED_ROW_SCRATCHED_TEXT = "Den står kvar i din sparade rad. ATG:s regler avgör vad som händer med den, så kontrollera kupongen hos ATG. Spelvärde räknar den inte som rätt.";
export const SUBMITTED_ROW_RETRY = "Kunde inte spara markeringen. Försöker igen.";
export const SUBMITTED_ROW_REJECTED = (error: string) => `Kunde inte spara markeringen: ${error}`;

// ---- Kroppen till PUT (9.3) -----------------------------------------------------

// Högsta antal rader, under gränsen för kolumnen rows (int).
export const SUBMITTED_ROW_MAX_ROWS = 2_000_000_000;
const MAX_FUTURE_MS = 5 * 60_000;
// Tider före appens tid är skräp och skulle kunna bli årtal som Postgres och JS tolkar olika.
const MIN_MARKED_AT = Date.UTC(2020, 0, 1);
const BODY_KEYS = ["selections", "rowPrice", "markedAt"];
// Samma format som Coupon.copiedAt: ISO-tid med tidszon.
const TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export type SubmittedRowInput = { selections: Selections; rowPrice: number; markedAt: Date };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function parseMarkedAt(v: unknown, now: Date): Date | null {
  if (typeof v !== "string") return null;
  const m = TIME_RE.exec(v);
  if (!m) return null;
  // Date rullar 31 feb vidare till mars, så att datumet måste finnas kontrolleras här.
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (day.getUTCMonth() !== Number(m[2]) - 1 || day.getUTCDate() !== Number(m[3])) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime()) || d.getTime() < MIN_MARKED_AT || d.getTime() > now.getTime() + MAX_FUTURE_MS) return null;
  return d;
}

export function parseSubmittedRowBody(body: Record<string, unknown>, gameType: string, now: Date): Result<SubmittedRowInput> {
  if (Object.keys(body).some((k) => !BODY_KEYS.includes(k))) return fail(SUBMITTED_ROW_UNKNOWN_FIELD);
  const raw = body.selections;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail(SUBMITTED_ROW_BAD_BODY);
  // Före parseSelections, som bara känner till loppen 1–8 och inte spelformen.
  const outside = Object.keys(raw).find((k) => /^\d{1,3}$/.test(k) && Number(k) > legsFor(gameType));
  if (outside) return fail(SUBMITTED_ROW_LEG_MISSING(gameType, Number(outside)));
  const sel = parseSelections(raw, "Raden");
  if (!sel.ok) return sel;
  const price = body.rowPrice;
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0.01 || price > 100) return fail(SUBMITTED_ROW_PRICE_ERROR);
  const markedAt = parseMarkedAt(body.markedAt, now);
  if (!markedAt) return fail(SUBMITTED_ROW_TIME_ERROR);
  return { ok: true, value: { selections: sel.value, rowPrice: r2(price), markedAt } };
}

// Rader och kostnad för kopian. Varje lopp i spelformen ska ha minst en häst.
export function rowsOfSelections(selections: Selections, rowPrice: number, gameType: string): Result<{ rows: number; cost: number }> {
  const legs = legsFor(gameType);
  const outside = Object.keys(selections).find((k) => Number(k) > legs);
  if (outside) return fail(SUBMITTED_ROW_LEG_MISSING(gameType, Number(outside)));
  let rows = 1;
  for (let leg = 1; leg <= legs; leg++) {
    const n = selections[leg]?.length ?? 0;
    if (!n) return fail(SUBMITTED_ROW_LEG_EMPTY(gameType, leg));
    rows *= n;
  }
  if (rows > SUBMITTED_ROW_MAX_ROWS) return fail(SUBMITTED_ROW_TOO_MANY);
  return { ok: true, value: { rows, cost: couponCost(rows, rowPrice) } };
}

// ---- Regler (10) ----------------------------------------------------------------

// Markerad vid eller efter första start (också ett inställt lopp, som spelstoppet).
export function isLateMark(markedAt: Date | string, races: readonly { startAt: Date | string }[]): boolean {
  const first = firstStartOf(races);
  if (!first) return false;
  return new Date(markedAt).getTime() >= first.getTime();
}

const LEG_KEYS = (a: Selections, b: Selections) => [...new Set([...Object.keys(a), ...Object.keys(b)].map(Number))].sort((x, y) => x - y);

// Samma rad, oavsett ordning. Tomt lopp och saknat lopp räknas lika.
export function sameRow(a: Selections, b: Selections): boolean {
  return LEG_KEYS(a, b).every((leg) => sameNumbers(a[leg], b[leg]));
}

// "V85-3 +7. V85-4 +12 −10." = det som arbetsraden (current) har lagt till och
// tagit bort jämfört med den inlämnade. Tom text när raderna är lika.
export function rowDiff(submitted: Selections, current: Selections, gameType: string): string {
  const parts: string[] = [];
  for (const leg of LEG_KEYS(submitted, current)) {
    const was = new Set(submitted[leg] ?? []);
    const now = new Set(current[leg] ?? []);
    const added = [...now].filter((n) => !was.has(n)).sort((x, y) => x - y).map((n) => `+${n}`);
    const removed = [...was].filter((n) => !now.has(n)).sort((x, y) => x - y).map((n) => `−${n}`);
    if (added.length || removed.length) parts.push(`${legName(gameType, leg)} ${[...added, ...removed].join(" ")}.`);
  }
  return parts.join(" ");
}

// Det som träffräkningen behöver av ett lopp. RaceDto passar direkt.
export type RowRace = {
  leg: number;
  cancelled: boolean;
  resultAt: string | null;
  starts: { number: number; scratched: boolean; result: { place: number | null; disqualified: boolean } | null }[];
};

// Vinnarna i loppet. Dött lopp ger flera. Diskad och struken vinner aldrig.
export function winnerNumbers(race: RowRace): number[] {
  if (!race.resultAt || race.cancelled) return [];
  return race.starts.filter((s) => !s.scratched && s.result?.place === 1 && !s.result.disqualified).map((s) => s.number);
}

export type RowScore = { hits: number; shown: number; total: number; allShown: boolean; text: string };

// Summan för raden (7.4). Räknar bara lopp som är visade på enheten (shownLegs)
// och har resultat. Inställda lopp räknas varken som rätt eller i nämnaren.
export function winnersInRow(row: { selections: Selections } | null | undefined, races: readonly RowRace[], shownLegs: readonly number[]): RowScore {
  const counted = races.filter((r) => !r.cancelled);
  const shownRaces = counted.filter((r) => r.resultAt && shownLegs.includes(r.leg));
  if (!row) return { hits: 0, shown: shownRaces.length, total: counted.length, allShown: false, text: SUBMITTED_ROW_NONE };
  const hits = shownRaces.filter((r) => winnerNumbers(r).some((n) => row.selections[r.leg]?.includes(n))).length;
  const allShown = counted.length > 0 && shownRaces.length === counted.length;
  return {
    hits,
    shown: shownRaces.length,
    total: counted.length,
    allShown,
    text: allShown ? `Raden: ${hits} rätt av ${counted.length}` : `Raden: ${hits} rätt av ${shownRaces.length} visade`,
  };
}
