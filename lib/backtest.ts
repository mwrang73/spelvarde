// Backtest av riktoddsmodellen (specen 7.6). Rena delar utan nätverk och
// databas: tolkning av gamla ATG-spel till indata som de såg ut före loppet,
// måtten (Brier, log loss, kalibreringshinkar, favoritträff, avkastning) och
// sökningen efter β och vikter. Hämtningen och rapporten ligger i
// scripts/backtest.ts. Testas i lib/backtest.test.ts.
//
// Modellen räknas alltid med lib/riktodds.ts (computeRace). Vid sökningen
// räknas z-värdena en gång per lopp med computeRace och styrkan Σ w·z, softmax
// och Harville görs sedan med samma funktioner som modellen (p3FromZ), så att
// sökningen går fort utan att modellen skrivs en gång till.

import { bestAdjusted, timeOutliers } from "@/lib/kmref";
import { distanceGroup, HIST_YEARS, MIN_RACES_ALL, toRows } from "@/lib/hist";
import { parseGame, parseStartDetail, type ParsedRecord, type ParsedStartDetail, type YearStats } from "@/lib/atg";
import {
  barefoot,
  computeRace,
  harvilleTop3,
  INPUT_KEYS,
  oddsFromP3,
  softmax,
  type Counts,
  type InputKey,
  type ModelParams,
  type StartFacts,
  type Weights,
} from "@/lib/riktodds";

// ---- Underlag -------------------------------------------------------------------------

export type BtStart = {
  number: number;
  scratched: boolean;
  // Utfall: placering 1–3 och inte diskad.
  top3: boolean;
  place: number | null;
  disqualified: boolean;
  // Hästens starter i år och i fjol före loppet. statsSource anger varifrån.
  thisYear: Counts | null;
  lastYear: Counts | null;
  lifeStarts: number | null;
  statsSource: "poster" | "ogonblick" | "saknas";
  // Om båda källorna fanns: stämde posterna med ögonblicksbilden?
  statsAgree: boolean | null;
  statsLeak: boolean | null;
  // Tidigare starter före loppdatumet, nyast först (högst 5).
  records: {
    date: string;
    place: number | null;
    galloped: boolean;
    disqualified: boolean;
    // För signalerna (extraFeatures): km-tid ("1.12,9" eller kod), distans, startmetod och kusk.
    kmTime?: string | null;
    distance?: number | null;
    startMethod?: "AUTO" | "VOLTE" | null;
    driverName?: string | null;
  }[];
  driver: { starts: number; wins: number } | null;
  trainer: { starts: number; wins: number } | null;
  // Streck i procent ur V-poolen (12.3 = 12,3 %). null = ingen V-pool.
  streck: number | null;
  // Vinnarodds vid start (decimaltal).
  winOdds: number | null;
  // Marknadens platsodds (ATG:s platspool, minOdds efter loppet).
  placeOdds: number | null;
  // Utbetalt platsodds om hästen gav plats i platspoolen, annars 0.
  placePayout: number;
  // Startnumrets plats % på loppets distans och startmetod ur statistikbasen,
  // bara lopp före loppdagen (attachPosts). null = saknas.
  post?: StartFacts["post"];
  // Hästens totala vinstsumma i kr (horse.money i ögonblicksbilden). null = saknas.
  earnings?: number | null;
  // Skor och vagn i ögonblicksbilden (ATG horse.shoes / horse.sulky, råa).
  shoes?: unknown;
  sulky?: unknown;
  // Kuskens namn ("Förnamn Efternamn") som i posterna.
  driverName?: string | null;
};

export type BtRace = {
  key: string;
  date: string;
  gameType: string;
  gameId: string;
  leg: number;
  distance: number;
  startMethod: "AUTO" | "VOLTE";
  // Förstapris i kr (null = okänt).
  prize?: number | null;
  // Antal platser som betalas i platspoolen (2 eller 3). null = ingen platspool.
  placesPaid: number | null;
  starts: BtStart[];
};

export type CalendarEntry = { id: string; gameType: string; status: string | null };

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const obj = (x: unknown): Obj | null => (isObj(x) ? x : null);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

// Spelen i kalendern för de valda spelformerna (V85, V75, V86, GS75 …).
export function calendarGames(json: unknown, types: string[]): CalendarEntry[] {
  const games = obj(obj(json)?.games);
  if (!games) return [];
  const out: CalendarEntry[] = [];
  for (const t of types) {
    for (const g of arr(games[t])) {
      const id = typeof obj(g)?.id === "string" ? (obj(g)!.id as string) : null;
      if (id) out.push({ id, gameType: t, status: typeof obj(g)?.status === "string" ? (obj(g)!.status as string) : null });
    }
  }
  return out;
}

// Läckageskyddet: bara riktiga starter (inte strukna) med datum FÖRE loppdagen,
// nyast först. Lopp samma dag räknas inte, inte heller loppet självt.
export function recordsBefore<T extends Pick<ParsedRecord, "date" | "scratched">>(records: T[], raceDate: string): T[] {
  return records.filter((r) => !r.scratched && r.date < raceDate).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// Starter, segrar och placeringar (1–3) ett visst år ur posterna.
export function countsFromRecords(records: Pick<ParsedRecord, "date" | "place" | "disqualified" | "scratched">[], year: string): Counts {
  const inYear = records.filter((r) => !r.scratched && r.date.startsWith(year));
  return {
    starts: inYear.length,
    wins: inYear.filter((r) => !r.disqualified && r.place === 1).length,
    placed: inYear.filter((r) => !r.disqualified && r.place !== null && r.place >= 1 && r.place <= 3).length,
  };
}

const countsOf = (y: YearStats | undefined | null): Counts | null => (y ? { starts: y.starts, wins: y.wins, placed: y.wins + y.seconds + y.thirds } : null);
const sameCounts = (a: Counts | null, b: Counts | null) => (a?.starts ?? 0) === (b?.starts ?? 0) && (a?.wins ?? 0) === (b?.wins ?? 0) && (a?.placed ?? 0) === (b?.placed ?? 0);

// Hästens år och fjol före loppet. Standard är ögonblicksbilden i games/<id>,
// som är från loppdagen (före loppet, se rapporten). Med source = "poster"
// räknas de från posterna före loppdatumet när posterna räcker bakåt till
// fjolårets början. Den andra källan används när den valda saknas.
// statsAgree: båda fanns och gav samma tal. statsLeak: ögonblicksbilden räknar
// med starter på eller efter loppdagen (skulle vara läckage).
export type StatsSource = "ogonblick" | "poster";
export function horseYears(
  detail: Pick<ParsedStartDetail, "records"> | null,
  snapshot: { years: Record<string, YearStats>; life: YearStats | null } | null,
  raceDate: string,
  source: StatsSource = "ogonblick",
): Pick<BtStart, "thisYear" | "lastYear" | "lifeStarts" | "statsSource" | "statsAgree" | "statsLeak"> {
  const year = raceDate.slice(0, 4);
  const lastYear = String(Number(year) - 1);
  const snapThis = countsOf(snapshot?.years[year]);
  const snapLast = countsOf(snapshot?.years[lastYear]);
  const lifeStarts = snapshot?.life ? snapshot.life.starts : null;
  const all = detail?.records ?? [];
  const oldest = all.reduce<string | null>((min, r) => (min === null || r.date < min ? r.date : min), null);
  const covered = oldest !== null && oldest < `${lastYear}-01-01`;
  const before = recordsBefore(all, raceDate);
  const recThis = covered ? countsFromRecords(before, year) : null;
  const recLast = covered ? countsFromRecords(before, lastYear) : null;
  const statsAgree = covered && snapshot ? sameCounts(recThis, snapThis) && sameCounts(recLast, snapLast) : null;
  const inYearAll = countsFromRecords(all, year).starts;
  const inYearBefore = countsFromRecords(before, year).starts;
  const statsLeak = snapshot && inYearAll > inYearBefore ? (snapThis?.starts ?? 0) >= inYearAll : null;
  const fromSnap = { thisYear: snapThis, lastYear: snapLast, lifeStarts, statsSource: "ogonblick" as const, statsAgree, statsLeak };
  const fromRec = { thisYear: recThis, lastYear: recLast, lifeStarts, statsSource: "poster" as const, statsAgree, statsLeak };
  if (source === "poster" && covered) return fromRec;
  if (snapshot) return fromSnap;
  if (covered) return fromRec;
  return { thisYear: null, lastYear: null, lifeStarts, statsSource: "saknas", statsAgree, statsLeak };
}

// Platspoolens utbetalning: { nummer: odds } och hur många platser som betalades.
export function placeWinners(racePools: unknown): { paid: Map<number, number>; places: number } | null {
  const plats = obj(obj(racePools)?.plats);
  const winners = obj(obj(plats?.result)?.winners);
  if (!winners) return null;
  const paid = new Map<number, number>();
  let places = 0;
  for (const k of ["first", "second", "third"]) {
    const list = arr(winners[k]);
    if (list.length) places++;
    for (const w of list) {
      const n = num(obj(w)?.number);
      const o = num(obj(w)?.odds);
      if (n !== null && o !== null && o > 0) paid.set(n, o / 100);
    }
  }
  return places ? { paid, places } : null;
}

// Ett spel med resultat → lopp med indata före loppet. details: startdetaljer
// per lopp-id och startnummer (races/<id>/start/<nr>), null om de saknas.
export function buildRaces(
  gameJson: unknown,
  gameType: string,
  details: (raceId: string, number: number) => unknown | null,
  source: StatsSource = "ogonblick",
): BtRace[] {
  const game = parseGame(gameJson);
  if (!game) return [];
  const rawRaces = arr(obj(gameJson)?.races);
  const out: BtRace[] = [];
  game.races.forEach((race, i) => {
    if (race.cancelled || !race.hasResult) return;
    const raw = obj(rawRaces[i]);
    const date = typeof raw?.date === "string" ? (raw.date as string) : game.date;
    const rawStarts = arr(raw?.starts).map(obj);
    const winners = placeWinners(raw?.pools);
    const year = date.slice(0, 4);
    const starts: BtStart[] = race.starts.map((s) => {
      const rs = rawStarts.find((x) => num(x?.number) === s.number) ?? null;
      const pools = obj(rs?.pools);
      const bd = num(obj(pools?.[gameType])?.betDistribution);
      const minOdds = num(obj(pools?.plats)?.minOdds);
      const detail = s.scratched ? null : parseStartDetail(details(race.atgRaceId, s.number));
      const before = recordsBefore(detail?.records ?? [], date).slice(0, 5);
      const res = s.result;
      const d = s.driver?.stats?.[year];
      const t = s.trainer?.stats?.[year];
      return {
        number: s.number,
        scratched: s.scratched,
        top3: !s.scratched && !!res && !res.disqualified && res.place !== null && res.place >= 1 && res.place <= 3,
        place: res?.place ?? null,
        disqualified: res?.disqualified ?? false,
        ...horseYears(detail, s.horseStats, date, source),
        records: before.map((r) => ({
          date: r.date,
          place: r.place,
          galloped: r.galloped,
          disqualified: r.disqualified,
          kmTime: r.kmTime,
          distance: r.distance,
          startMethod: r.startMethod,
          driverName: r.driverName,
        })),
        driver: d ? { starts: d.starts, wins: d.wins } : null,
        trainer: t ? { starts: t.starts, wins: t.wins } : null,
        streck: bd !== null && bd >= 0 ? bd / 100 : null,
        winOdds: res?.finalOdds ?? s.winOdds,
        placeOdds: minOdds !== null && minOdds > 0 ? minOdds / 100 : null,
        placePayout: winners?.paid.get(s.number) ?? 0,
        earnings: s.earnings,
        shoes: s.shoes,
        sulky: s.sulky,
        driverName: s.driver ? `${s.driver.firstName} ${s.driver.lastName}`.trim() : null,
      };
    });
    out.push({ key: race.atgRaceId, date, gameType, gameId: game.atgGameId, leg: race.leg, distance: race.distance, startMethod: race.startMethod, prize: race.prize, placesPaid: winners?.places ?? null, starts });
  });
  return out;
}

// Indata till computeRace. Spår ur statistikbasen när attachPosts har körts,
// annars null (spar 0). Streck tas med bara om withStreck (v1 har vikten 0).
export function toFacts(race: BtRace, withStreck = false): StartFacts[] {
  return race.starts.map((s) => ({
    startId: `${race.key}:${s.number}`,
    number: s.number,
    scratched: s.scratched,
    horse: { thisYear: s.thisYear, lastYear: s.lastYear, lifeStarts: s.lifeStarts },
    records: s.records.map((r) => ({ place: r.place, galloped: r.galloped, disqualified: r.disqualified, date: r.date, kmTime: r.kmTime, distance: r.distance, startMethod: r.startMethod })),
    raceDate: race.date,
    volte: race.startMethod === "VOLTE",
    barefoot: barefoot(s.shoes),
    driver: s.driver,
    trainer: s.trainer,
    post: s.post ?? null,
    streck: withStreck ? s.streck : null,
    earnings: s.earnings != null && (s.lifeStarts ?? 0) > 0 ? { total: s.earnings, lifeStarts: s.lifeStarts as number } : null,
  }));
}

// ---- Spår ur statistikbasen -----------------------------------------------------------------

// En start i statistikbasen (HistRace + HistStart), för spårtabellerna.
export type HistRow = { raceId: string; date: string; method: "AUTO" | "VOLTE"; distance: number; number: number; place: number | null; scratched: boolean };

type Series = { dates: string[]; rows: HistRow[]; raceDates: string[] };

const lowerBound = (xs: string[], x: string) => {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

// Samma regler som postTable i lib/hist.ts, men i minnet och för valfritt
// datum: lopp i [datum − 2 år, datum), exakt distans med minst 150 lopp,
// annars distansgruppen, minst 15 starter per startnummer. Ger plats % per
// startnummer eller null.
export function makePostIndex(rows: HistRow[]): (date: string, method: "AUTO" | "VOLTE", distance: number) => Map<number, number> | null {
  const series = new Map<string, Series>();
  const add = (key: string, r: HistRow) => {
    const s = series.get(key) ?? { dates: [], rows: [], raceDates: [] };
    s.rows.push(r);
    series.set(key, s);
  };
  for (const r of rows) {
    add(`${r.method}|${r.distance}`, r);
    add(`${r.method}|g${distanceGroup(r.distance).lo}`, r);
  }
  for (const s of series.values()) {
    s.rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    s.dates = s.rows.map((r) => r.date);
    const seen = new Set<string>();
    for (const r of s.rows) if (!seen.has(r.raceId)) (seen.add(r.raceId), s.raceDates.push(r.date));
  }
  const cache = new Map<string, Map<number, number> | null>();
  return (date, method, distance) => {
    const key = `${method}|${distance}|${date}`;
    if (cache.has(key)) return cache.get(key)!;
    const from = `${Number(date.slice(0, 4)) - HIST_YEARS}${date.slice(4)}`;
    let out: Map<number, number> | null = null;
    for (const k of [`${method}|${distance}`, `${method}|g${distanceGroup(distance).lo}`]) {
      const s = series.get(k);
      if (!s) continue;
      const races = lowerBound(s.raceDates, date) - lowerBound(s.raceDates, from);
      if (races < MIN_RACES_ALL) continue;
      const counts = new Map<number, { n: number; starts: number; wins: number; top3: number }>();
      for (let i = lowerBound(s.dates, from), end = lowerBound(s.dates, date); i < end; i++) {
        const r = s.rows[i];
        if (r.scratched) continue;
        const c = counts.get(r.number) ?? { n: r.number, starts: 0, wins: 0, top3: 0 };
        c.starts++;
        if (r.place === 1) c.wins++;
        if (r.place !== null && r.place >= 1 && r.place <= 3) c.top3++;
        counts.set(r.number, c);
      }
      out = new Map(toRows([...counts.values()]).filter((x) => x.placePct !== null).map((x) => [x.n, x.placePct!]));
      break;
    }
    cache.set(key, out);
    return out;
  };
}

// Sätter post (plats %, medel för loppets tabell) på varje start, som
// computeRoundRiktodds gör i drift. Ger antalet starter som fick ett värde.
export function attachPosts(races: BtRace[], index: ReturnType<typeof makePostIndex>): number {
  let n = 0;
  for (const race of races) {
    const table = index(race.date, race.startMethod, race.distance);
    const vals = table ? [...table.values()] : [];
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    for (const s of race.starts) {
      const pct = table?.get(s.number);
      s.post = pct !== undefined && mean > 0 ? { pct, mean, distance: race.distance, method: race.startMethod, kind: "plats" } : null;
      if (s.post && !s.scratched) n++;
    }
  }
  return n;
}

// ---- Förutsägelser --------------------------------------------------------------------

export type Pred = {
  raceKey: string;
  date: string;
  p: number;
  y: 0 | 1;
  // Modellens odds 1 / P3 (med marginal).
  odds: number;
  placeOdds: number | null;
  placePayout: number;
  // Platspoolen fanns för loppet.
  hasPlacePool: boolean;
};

const running = (r: BtRace) => r.starts.filter((s) => !s.scratched);

function predsFor(race: BtRace, p3: number[], marginal: number): Pred[] {
  return running(race).map((s, i) => ({
    raceKey: race.key,
    date: race.date,
    p: p3[i],
    y: s.top3 ? 1 : 0,
    odds: oddsFromP3(p3[i], marginal),
    placeOdds: s.placeOdds,
    placePayout: s.placePayout,
    hasPlacePool: race.placesPaid !== null,
  }));
}

// Modellen via computeRace (samma som i drift, där strecket alltid skickas
// med: med vikt 0 påverkar det inget).
export function modelPreds(races: BtRace[], weights: Weights, params: ModelParams): Pred[] {
  const out: Pred[] = [];
  for (const race of races) {
    const res = computeRace(toFacts(race, weights.streck !== 0), weights, params);
    if (!res.length) continue;
    out.push(...predsFor(race, res.map((r) => r.probTop3), params.marginal));
  }
  return out;
}

// Marknaden: vinstsannolikhet ur streck (eller vinnarodds) → samma Harville.
export function marketPreds(races: BtRace[], source: "streck" | "vinnarodds"): Pred[] {
  const out: Pred[] = [];
  for (const race of races) {
    const st = running(race);
    if (st.length < 4) continue;
    const raw = st.map((s) => (source === "streck" ? s.streck : s.winOdds && s.winOdds > 0 ? 1 / s.winOdds : null));
    if (raw.some((x) => x === null)) continue;
    const vals = raw.map((x) => Math.max(x as number, 1e-4));
    const sum = vals.reduce((a, b) => a + b, 0);
    out.push(...predsFor(race, harvilleTop3(vals.map((v) => v / sum)), 0));
  }
  return out;
}

// Naiv modell: alla hästar lika (P3 = 3 / N).
export function naivePreds(races: BtRace[]): Pred[] {
  const out: Pred[] = [];
  for (const race of races) {
    const n = running(race).length;
    if (n < 4) continue;
    out.push(...predsFor(race, harvilleTop3(Array(n).fill(1 / n)), 0));
  }
  return out;
}

// z-värden per lopp (rad per startande) från computeRace, för snabb sökning.
export type ZRace = { race: BtRace; z: Record<InputKey, number>[] };
export function zRaces(races: BtRace[], params: ModelParams, weights: Weights, withStreck = false): ZRace[] {
  const out: ZRace[] = [];
  for (const race of races) {
    const res = computeRace(toFacts(race, withStreck), weights, params);
    if (res.length) out.push({ race, z: res.map((r) => r.inputs.z) });
  }
  return out;
}

// Samma steg som computeRace efter z: S = Σ w·z, softmax med β, Harville.
// Nycklar utöver INPUT_KEYS (t.ex. "pengar" från withPengar) räknas med när
// vikterna har dem.
export function p3FromZ(z: Record<InputKey, number>[], weights: Weights, beta: number): number[] {
  const keys = Object.keys(weights) as InputKey[];
  const s = z.map((zi) => keys.reduce((a, k) => a + (weights[k] ?? 0) * (zi[k] ?? 0), 0));
  return harvilleTop3(softmax(s, beta));
}

export function zPreds(zr: ZRace[], weights: Weights, beta: number, marginal = 0): Pred[] {
  return zr.flatMap(({ race, z }) => predsFor(race, p3FromZ(z, weights, beta), marginal));
}

// Prövning av intjänade pengar: z för log(1 + vinstsumma per start i livet)
// inom loppet under nyckeln "pengar" (samma som modellens indata pengar, men
// saknad summa ger z = 0 i stället för fältets medel).
export const PENGAR: InputKey = "pengar";
export function withPengar(zr: ZRace[]): ZRace[] {
  return zr.map(({ race, z }) => {
    const run = race.starts.filter((s) => !s.scratched);
    const vals = run.map((s) => (s.earnings != null && (s.lifeStarts ?? 0) > 0 ? Math.log1p(s.earnings / (s.lifeStarts as number)) : null));
    const known = vals.filter((v): v is number => v !== null);
    const m = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
    const sd = known.length ? Math.sqrt(known.reduce((a, b) => a + (b - m) ** 2, 0) / known.length) : 0;
    return { race, z: z.map((zi, i) => ({ ...zi, [PENGAR]: vals[i] === null || !(sd > 1e-12) ? 0 : ((vals[i] as number) - m) / sd })) };
  });
}

// ---- Signaler att pröva (backtest 2026-10-20, punkt 1–6) ---------------------------------
//
// Råa värden per startande häst, z inom loppet i withExtras. Saknas ett värde
// får hästen fältets medel (z = 0). Alla bygger bara på data före loppet.
//   skoAv      skor av sedan förra starten (fram och/eller bak, 0–2)
//   barfota    barfota runt om
//   jankNy     bytt till amerikansk vagn (jänkare) sedan förra starten
//   vanligNy   bytt till vanlig vagn sedan förra starten
//   kuskUpp    kuskbyte sedan förra starten × kuskens vinst % mot fältets (0 utan byte)
//   klass      log(intjänat per start / loppets förstapris): högt = går ner i klass
//   vila       log(1 + dagar sedan förra starten)
//   langVila   minst 90 dagar sedan förra starten
//   galoppVolt galopp i 5 senaste (som modellen) × voltstart (0 vid autostart)
//   tid        bara när hästen sticker ut extremt: bästa justerade km-tid i 5
//              senaste mot fältets median, i robusta standardavvikelser, minus 2
//              (0 för alla som inte är minst 2 avvikelser snabbare)

export const EXTRA_KEYS = ["skoAv", "barfota", "jankNy", "vanligNy", "kuskUpp", "klass", "vila", "langVila", "galoppVolt", "tid"] as const;
export type ExtraKey = (typeof EXTRA_KEYS)[number];

// "1.12,9" → 72,9 s per km. Koder ("u", "d") och saknat → null.
export function kmSeconds(t: string | null | undefined): number | null {
  const m = /^(\d)\.(\d{2}),(\d)$/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 10 : null;
}

const distBucket = (d: number) => Math.round(d / 100) * 100;

// Referenstid per startmetod och distans (100-m-hink): medianen av alla
// giltiga km-tider i underlaget (ingen galopp, ingen diskning). Samma km-tid på
// längre distans blir då bättre än på kortare (13,4 på 2140a > 13,4 på 1640a).
export function kmReference(races: BtRace[]): (method: string, distance: number) => number | null {
  const by = new Map<string, number[]>();
  for (const race of races)
    for (const s of race.starts)
      for (const r of s.records) {
        const sec = kmSeconds(r.kmTime);
        if (sec === null || r.galloped || r.disqualified || !r.startMethod || !r.distance) continue;
        const k = `${r.startMethod}|${distBucket(r.distance)}`;
        (by.get(k) ?? by.set(k, []).get(k)!).push(sec);
      }
  const med = new Map<string, number>();
  for (const [k, xs] of by) if (xs.length >= 50) med.set(k, median(xs));
  return (method, distance) => med.get(`${method}|${distBucket(distance)}`) ?? null;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const shoeChange = (x: unknown, side: "front" | "back") => {
  const o = (x as Record<string, { hasShoe?: boolean; changed?: boolean } | undefined> | null)?.[side];
  return o?.changed === true && o.hasShoe === false ? 1 : 0;
};
const noShoe = (x: unknown, side: "front" | "back") => (x as Record<string, { hasShoe?: boolean } | undefined> | null)?.[side]?.hasShoe === false;

// Råa värden för loppets startande (samma ordning som running/predsFor).
export function extraFeatures(race: BtRace, ref: ReturnType<typeof kmReference>): Record<ExtraKey, (number | null)[]> {
  const run = race.starts.filter((s) => !s.scratched);
  const rate = (s: BtStart) => (s.driver && s.driver.starts > 0 ? s.driver.wins / s.driver.starts : null);
  const rates = run.map(rate).filter((x): x is number => x !== null);
  const driverMean = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
  const best = run.map((s) => {
    const adj = s.records
      .slice(0, 5)
      .map((r) => {
        const sec = kmSeconds(r.kmTime);
        const rf = r.startMethod && r.distance ? ref(r.startMethod, r.distance) : null;
        return sec === null || rf === null || r.galloped || r.disqualified ? null : sec - rf;
      })
      .filter((x): x is number => x !== null);
    return adj.length ? Math.min(...adj) : null;
  });
  const known = best.filter((x): x is number => x !== null);
  const med = known.length >= 4 ? median(known) : null;
  const mad = med !== null ? 1.4826 * median(known.map((x) => Math.abs(x - med))) : 0;
  const out = {} as Record<ExtraKey, (number | null)[]>;
  out.skoAv = run.map((s) => (s.shoes ? shoeChange(s.shoes, "front") + shoeChange(s.shoes, "back") : null));
  out.barfota = run.map((s) => (s.shoes ? (noShoe(s.shoes, "front") && noShoe(s.shoes, "back") ? 1 : 0) : null));
  const sulkyType = (s: BtStart) => (s.sulky as { type?: { code?: string; changed?: boolean } } | null)?.type ?? null;
  out.jankNy = run.map((s) => (sulkyType(s) ? (sulkyType(s)!.changed && sulkyType(s)!.code === "AM" ? 1 : 0) : null));
  out.vanligNy = run.map((s) => (sulkyType(s) ? (sulkyType(s)!.changed && sulkyType(s)!.code === "VA" ? 1 : 0) : null));
  out.kuskUpp = run.map((s) => {
    const last = s.records[0]?.driverName ?? null;
    if (!last || !s.driverName) return null;
    if (last.toLowerCase() === s.driverName.toLowerCase()) return 0;
    const r = rate(s);
    return r === null ? 0 : r - driverMean;
  });
  out.klass = run.map((s) => (s.earnings != null && (s.lifeStarts ?? 0) > 0 && race.prize ? Math.log((s.earnings / (s.lifeStarts as number) + 1000) / race.prize) : null));
  out.vila = run.map((s) => (s.records[0] ? Math.log1p(Math.max(0, daysBetween(s.records[0].date, race.date))) : null));
  out.langVila = run.map((s) => (s.records[0] ? (daysBetween(s.records[0].date, race.date) >= 90 ? 1 : 0) : null));
  out.galoppVolt = run.map((s) => (race.startMethod === "VOLTE" ? s.records.slice(0, 5).reduce((a, r) => a + (r.galloped ? (r.disqualified ? 1.5 : 1) : 0), 0) : 0));
  out.tid = best.map((b) => (b === null || med === null || !(mad > 0) ? 0 : Math.max(0, (med - b) / mad - 2)));
  return out;
}

// z inom loppet för valda signaler, tillagt i z-raderna (saknat värde → z = 0).
export function withExtras(zr: ZRace[], keys: readonly ExtraKey[], ref: ReturnType<typeof kmReference>): ZRace[] {
  return zr.map(({ race, z }) => {
    const raw = extraFeatures(race, ref);
    const add = z.map((zi) => ({ ...zi }) as Record<string, number>);
    for (const k of keys) {
      const vals = raw[k];
      const known = vals.filter((v): v is number => v !== null);
      const m = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
      const sd = known.length ? Math.sqrt(known.reduce((a, b) => a + (b - m) ** 2, 0) / known.length) : 0;
      vals.forEach((v, i) => (add[i][k] = v === null || !(sd > 1e-12) ? 0 : (v - m) / sd));
    }
    return { race, z: add as Record<InputKey, number>[] };
  });
}

// ---- Antal positiva signaler (backtest 2026-10-20) ----------------------------------------
//
// Tydliga ja/nej-gränser, samma som en spelare skulle använda:
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
export const SIGNAL_KEYS = ["spar", "tid", "kusk", "tranare", "barfota", "plats75", "vinst50", "form", "pengar", "felfri"] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];

const topN = (vals: (number | null)[], n: number) => {
  const sorted = vals.filter((v): v is number => v !== null).sort((a, b) => b - a);
  const cut = sorted.length >= n ? sorted[n - 1] : -Infinity;
  return vals.map((v) => v !== null && v >= cut && sorted.length > 0);
};

// Signalerna för loppets startande (samma ordning som running/predsFor).
export function positiveSignals(race: BtRace): Record<SignalKey, boolean>[] {
  const run = race.starts.filter((s) => !s.scratched);
  const rate = (p: { starts: number; wins: number } | null) => (p && p.starts >= 20 ? p.wins / p.starts : null);
  const kusk = topN(run.map((s) => rate(s.driver)), 3);
  const tranare = topN(run.map((s) => rate(s.trainer)), 3);
  const pengar = topN(run.map((s) => (s.earnings != null && (s.lifeStarts ?? 0) > 0 ? s.earnings / (s.lifeStarts as number) : null)), 3);
  const tid = timeOutliers(run.map((s) => bestAdjusted(s.records)));
  return run.map((s, i) => {
    const st = (s.thisYear?.starts ?? 0) + (s.lastYear?.starts ?? 0);
    const placed = (s.thisYear?.placed ?? 0) + (s.lastYear?.placed ?? 0);
    const wins = (s.thisYear?.wins ?? 0) + (s.lastYear?.wins ?? 0);
    const last5 = s.records.slice(0, 5);
    return {
      spar: !!s.post && s.post.mean > 0 && s.post.pct / s.post.mean >= 1.15,
      tid: tid[i] > 0,
      kusk: kusk[i],
      tranare: tranare[i],
      barfota: barefoot(s.shoes) === true,
      plats75: st >= 5 && placed / st >= 0.75,
      vinst50: st >= 5 && wins / st >= 0.5,
      form: last5.filter((r) => !r.disqualified && (r.place === 1 || r.place === 2)).length >= 2,
      pengar: pengar[i],
      felfri: last5.length >= 3 && !last5.some((r) => r.galloped),
    };
  });
}

// ---- Kalibrering (Platt) ---------------------------------------------------------------------

// p' = sigmoid(a + b · logit(p)), anpassad med Newton på log loss.
export type Platt = { a: number; b: number };
const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function fitPlatt(preds: Pick<Pred, "p" | "y">[]): Platt {
  let a = 0;
  let b = 1;
  for (let it = 0; it < 50; it++) {
    let ga = 0, gb = 0, haa = 0, hab = 0, hbb = 0;
    for (const x of preds) {
      const l = logit(x.p);
      const q = sigmoid(a + b * l);
      const r = q - x.y;
      const w = q * (1 - q);
      ga += r;
      gb += r * l;
      haa += w;
      hab += w * l;
      hbb += w * l * l;
    }
    const det = haa * hbb - hab * hab;
    if (!(Math.abs(det) > 1e-12)) break;
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    a -= da;
    b -= db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  return { a, b };
}

// Kalibrerade förutsägelser. renorm: skala per lopp så att Σ P3 = 3 (som Harville ger).
export function applyPlatt(preds: Pred[], c: Platt, renorm = false, maxP3 = 1): Pred[] {
  const out = preds.map((x) => ({ ...x, p: Math.min(maxP3, sigmoid(c.a + c.b * logit(x.p))) }));
  if (!renorm) return out.map((x) => ({ ...x, odds: oddsFromP3(x.p, 0) }));
  const sums = new Map<string, number>();
  for (const x of out) sums.set(x.raceKey, (sums.get(x.raceKey) ?? 0) + x.p);
  return out.map((x) => {
    const p = Math.min(1 - EPS, (x.p * 3) / (sums.get(x.raceKey) as number));
    return { ...x, p, odds: oddsFromP3(p, 0) };
  });
}

// ---- Mått ------------------------------------------------------------------------------

export const EPS = 1e-6;
const clampP = (p: number) => Math.min(1 - EPS, Math.max(EPS, p));

export function brier(preds: Pick<Pred, "p" | "y">[]): number {
  if (!preds.length) return NaN;
  return preds.reduce((a, x) => a + (x.p - x.y) ** 2, 0) / preds.length;
}

export function logLoss(preds: Pick<Pred, "p" | "y">[]): number {
  if (!preds.length) return NaN;
  return -preds.reduce((a, x) => a + (x.y ? Math.log(clampP(x.p)) : Math.log(1 - clampP(x.p))), 0) / preds.length;
}

export type Bucket = { lo: number; hi: number; n: number; expected: number; actual: number };

// 10 lika breda hinkar på P3: 0–10 %, 10–20 % … 90–100 % (1,0 hamnar i sista).
export function calibration(preds: Pick<Pred, "p" | "y">[], buckets = 10): Bucket[] {
  const out = Array.from({ length: buckets }, (_, i) => ({ lo: i / buckets, hi: (i + 1) / buckets, n: 0, sp: 0, sy: 0 }));
  for (const x of preds) {
    const i = Math.min(buckets - 1, Math.max(0, Math.floor(x.p * buckets)));
    out[i].n++;
    out[i].sp += x.p;
    out[i].sy += x.y;
  }
  return out.map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, expected: b.n ? b.sp / b.n : NaN, actual: b.n ? b.sy / b.n : NaN }));
}

// Andel lopp där hästen med lägst odds (högst P3) kom topp 3. Lika: första.
export function favouriteHitRate(preds: Pick<Pred, "raceKey" | "p" | "y">[]): { races: number; hits: number; rate: number } {
  const best = new Map<string, { p: number; y: number }>();
  for (const x of preds) {
    const b = best.get(x.raceKey);
    if (!b || x.p > b.p) best.set(x.raceKey, { p: x.p, y: x.y });
  }
  const races = best.size;
  const hits = [...best.values()].filter((b) => b.y === 1).length;
  return { races, hits, rate: races ? hits / races : NaN };
}

export type RoiRow = { label: string; bets: number; hits: number; hitRate: number; staked: number; returned: number; roi: number };

export const ODDS_BANDS: [number, number][] = [
  [1, 1.5],
  [1.5, 2],
  [2, 3],
  [3, 5],
  [5, 10],
  [10, Infinity],
];

const roiRow = (label: string, bets: Pick<Pred, "placePayout">[]): RoiRow => {
  const hits = bets.filter((b) => b.placePayout > 0).length;
  const returned = bets.reduce((a, b) => a + b.placePayout, 0);
  return { label, bets: bets.length, hits, hitRate: bets.length ? hits / bets.length : NaN, staked: bets.length, returned, roi: bets.length ? returned / bets.length - 1 : NaN };
};

const bandLabel = ([lo, hi]: [number, number]) => (hi === Infinity ? `${String(lo).replace(".", ",")}+` : `${String(lo).replace(".", ",")}–${String(hi).replace(".", ",")}`);

// Regeln "spela plats när marknadens platsodds > riktodds × ratio" med 1 kr per
// spel. Bara starter med platspool och känt platsodds. Uppdelat i oddsintervall
// efter marknadens platsodds.
export function roiRule(preds: Pred[], ratio = 1): { total: RoiRow; bands: RoiRow[]; all: RoiRow } {
  const eligible = preds.filter((x) => x.hasPlacePool && x.placeOdds !== null);
  const bets = eligible.filter((x) => (x.placeOdds as number) > x.odds * ratio);
  return {
    total: roiRow("Alla spel", bets),
    bands: ODDS_BANDS.map((band) => roiRow(bandLabel(band), bets.filter((x) => (x.placeOdds as number) >= band[0] && (x.placeOdds as number) < band[1]))),
    // Referens: spela på alla hästar med platsodds.
    all: roiRow("Alla hästar", eligible),
  };
}

export type Metrics = { starts: number; races: number; brier: number; logLoss: number; favourite: { races: number; hits: number; rate: number }; meanP: number; rate: number };

export function metrics(preds: Pred[]): Metrics {
  return {
    starts: preds.length,
    races: new Set(preds.map((x) => x.raceKey)).size,
    brier: brier(preds),
    logLoss: logLoss(preds),
    favourite: favouriteHitRate(preds),
    meanP: preds.length ? preds.reduce((a, x) => a + x.p, 0) / preds.length : NaN,
    rate: preds.length ? preds.reduce((a, x) => a + x.y, 0) / preds.length : NaN,
  };
}

// ---- Kalibrering ---------------------------------------------------------------------------

export function betaGrid(lo = 0.1, hi = 1.5, step = 0.05): number[] {
  const out: number[] = [];
  for (let b = lo; b <= hi + 1e-9; b += step) out.push(Math.round(b * 100) / 100);
  return out;
}

export function searchBeta(zr: ZRace[], weights: Weights, grid = betaGrid()): { beta: number; logLoss: number; curve: { beta: number; logLoss: number }[] } {
  const curve = grid.map((beta) => ({ beta, logLoss: logLoss(zPreds(zr, weights, beta)) }));
  const best = curve.reduce((a, b) => (b.logLoss < a.logLoss ? b : a));
  return { beta: best.beta, logLoss: best.logLoss, curve };
}

// Koordinatvis sökning (mönstersökning) på log loss med β fast. Bara nycklarna
// i `keys` ändras. Stegen halveras när inget steg förbättrar.
export function fitWeights(
  zr: ZRace[],
  start: Weights,
  beta: number,
  keys: InputKey[],
  steps = [0.4, 0.2, 0.1, 0.05, 0.025],
  maxRounds = 20,
): { weights: Weights; logLoss: number; evaluations: number } {
  let w = { ...start };
  let best = logLoss(zPreds(zr, w, beta));
  let evaluations = 1;
  for (const step of steps) {
    for (let round = 0; round < maxRounds; round++) {
      let improved = false;
      for (const k of keys) {
        for (const dir of [1, -1]) {
          const cand = { ...w, [k]: Math.round((w[k] + dir * step) * 1000) / 1000 };
          const ll = logLoss(zPreds(zr, cand, beta));
          evaluations++;
          if (ll < best - 1e-9) {
            best = ll;
            w = cand;
            improved = true;
            break;
          }
        }
      }
      if (!improved) break;
    }
  }
  return { weights: w, logLoss: best, evaluations };
}

// Tidsmässig delning: de äldsta `share` av loppen till träning, resten test.
export function timeSplit<T extends { date: string; key: string }>(races: T[], share = 0.7): { train: T[]; test: T[]; cut: string } {
  const sorted = [...races].sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date < b.date ? -1 : 1));
  const n = Math.round(sorted.length * share);
  // Hela dagar på samma sida.
  let i = n;
  while (i > 0 && i < sorted.length && sorted[i].date === sorted[i - 1].date) i++;
  return { train: sorted.slice(0, i), test: sorted.slice(i), cut: sorted[i]?.date ?? "" };
}
