// Typer för API-svaren. Delas av rutterna (app/api) och klienten.
// Alla tider är ISO-strängar i UTC. Datum utan tid är "YYYY-MM-DD" (svenskt
// lokalt datum). Odds och procent är vanliga tal (3.1 = 3,10; 19.24 = 19,24 %).
// Felsvar har alltid formen ApiError.

import type { FormSummary, GallopWarning } from "@/lib/gallop";
import type { GameType } from "@/lib/game-type";
import type { PostTable } from "@/lib/hist";
import type { NextStep, Phase, PhaseStep } from "@/lib/phase";
import type { InputKey } from "@/lib/riktodds";
import type { Bucket, LeagueRow, StartnrGroup, StartnrLeg } from "@/lib/travstatistik";
import type { XFactor } from "@/lib/xfactor";

export type ApiError = { error: string; code?: string };

export type StartMethod = "AUTO" | "VOLTE";
export type FetchStatus = "COMPLETE" | "PARTIAL" | "FAILED";
export type ThemeSetting = "system" | "light" | "dark";
export type SpelbarOverride = "NONE" | "ON" | "OFF";
export type CommentKind = "NOTE" | "RACE";
export type { XFactor } from "@/lib/xfactor";
export type { GameType } from "@/lib/game-type";

// ---- Hämtning -------------------------------------------------------------------

export type FetchChanges = {
  scratched: { startId: string; leg: number; number: number; horseName: string }[];
  driverChanges: { startId: string; leg: number; number: number; horseName: string; newDriver: string; oldDriver: string | null }[];
  // Starter som inte kunde skrivas (startnumret hade redan en annan häst).
  skipped: { leg: number; number: number; horseName: string }[];
};

// Var kedjan ska fortsätta. null = allt klart.
export type ResumePoint = { step: "GAME" } | { step: "RACE"; leg: number } | { step: "STATS" } | { step: "RIKTODDS" };

export type FetchState = {
  status: FetchStatus;
  fetchedAt: string | null;
  // Ändringar vid senaste lyckade steg 1 (S1: "2 strykningar, 1 kuskbyte").
  lastChanges: FetchChanges | null;
  resumeFrom: ResumePoint | null;
  // Senaste misslyckade steg, om det är nyare än senaste lyckade steg 1.
  lastError: { step: string; message: string | null; at: string } | null;
};

// POST /api/rounds/fetch
export type FetchGameResponse = {
  roundId: string;
  atgGameId: string;
  legs: { leg: number; raceId: string; starts: number }[];
  changes: FetchChanges;
  hasStreck: boolean;
  warnings: number;
};
// 404 { error, code: "NO_GAME" } när ATG inte har något spel av spelformen de närmaste 7 dagarna.

// POST /api/rounds/[id]/fetch/races/[leg] (502 med samma fält + error när någon start misslyckades)
export type FetchRaceResponse = {
  leg: number;
  ok: boolean;
  fetched: number;
  skipped: number;
  failed: { startId: string; number: number; error: string }[];
};

// POST /api/rounds/[id]/fetch/stats (502 med samma fält + error vid nätverksfel)
export type FetchStatsResponse = {
  ok: boolean;
  pages: { key: string; ok: boolean; error: string | null }[];
  aliases: { linked: number; unlinked: number };
  fetchStatus: "COMPLETE" | "PARTIAL";
};

// POST /api/rounds/[id]/riktodds (steg 11 och "Räkna om omgången")
export type RiktoddsStepResponse = {
  roundId: string;
  modelKey: string;
  // Antal starter som fick riktodds.
  computed: number;
  // Avdelningar utan riktodds (färre än 4 startande).
  skippedLegs: number[];
};

// GET /api/rounds/next-available
export type NextAvailableResponse = {
  game: { gameId: string; gameType: GameType; trackName: string | null; date: string; firstStartAt: string; status: string | null } | null;
  fetched: boolean;
  roundId: string | null;
  checkedAt: string;
  // false när ATG inte gick att nå (då är game null).
  ok: boolean;
};

// ---- Omgången -----------------------------------------------------------------

export type RoundDto = {
  id: string;
  atgGameId: string;
  gameType: GameType;
  date: string;
  trackId: number;
  trackName: string;
  firstStartAt: string;
  atgStatus: string | null;
  fetchedAt: string | null;
  fetchStatus: FetchStatus;
  finishedAt: string | null;
  rev: number;
};

export type PersonDto = { id: string; name: string; firstName: string; lastName: string; shortName: string | null };

export type MarkDto = {
  startId: string;
  interesting: boolean;
  interestingAt: string | null;
  spelbarOverride: SpelbarOverride;
  bet: boolean;
  betAt: string | null;
  betOdds: number | null;
  unibetOdds: number | null;
  unibetOddsAt: string | null;
  unibetOddsPrev: number | null;
  updatedAt: string;
  // X-faktor (6.8, E2.1). xFactorAt = när läget sattes (null för NONE).
  xFactor: XFactor;
  xFactorAt: string | null;
  // 1 för NONE, annars användarens faktor (1,25 / 1,50 som standard).
  xFactorValue: number;
  // Källstöd 0–20, null = inte ifyllt. Påverkar inte riktodds eller Spelbar.
  sourceSupport: number | null;
  // Beräknade (6.1) mot riktoddset med X-faktor (riktoddsX).
  forslag: boolean;
  spelbar: boolean;
  // Det aktiva riktoddset utan X-faktor (null = saknas). Oförändrat från E2.
  riktodds: number | null;
  // Riktoddset med X-faktor: max(1,01, round2(riktodds / faktor)), = riktodds
  // för NONE, null när riktodds saknas. Det är detta förslaget räknas mot.
  riktoddsX: number | null;
  // Unibet-oddset är under riktlinjen (2,00): taggen "Under 2,00". Gäller
  // Unibet-oddset, inte riktoddset med X-faktor.
  belowGuideline: boolean;
};

export type StartResultDto = {
  place: number | null;
  finishOrder: number | null;
  disqualified: boolean;
  galloped: boolean;
  kmTime: string | null;
  finalOdds: number | null;
};

export type StartDto = {
  id: string;
  number: number;
  postPosition: number | null;
  distance: number;
  scratched: boolean;
  scratchedAt: string | null;
  horse: { id: string; name: string; sex: string | null; age: number | null; record: string | null; earnings: number | null };
  driver: PersonDto | null;
  trainer: PersonDto | null;
  // Satt vid kuskbyte: S2 visar "↻ Ny: <kusk>".
  prevDriver: PersonDto | null;
  form: FormSummary;
  // Senaste streck i procent med två decimaler (19.24), null innan V85 öppnat.
  streck: number | null;
  // Aktivt riktodds (plats) och chans till topp 3 (0–1). null = saknas
  // (struken, lopp med färre än 4 startande eller inte räknat än).
  riktodds: number | null;
  probTop3: number | null;
  // Riktoddset är osäkert (7.2 punkt 6). Utan riktodds: färre än 5 starter.
  uncertain: boolean;
  mark: MarkDto | null;
  result: StartResultDto | null;
  // Tillägg för desktoptabellen i S2: hästens vinst % och plats % i år och
  // i fjol tillsammans (ATG, samma period som riktoddset; starts = starterna
  // under perioden) och vinst % och plats % för
  // startnumret på loppets distans och startmetod (statistikbasen, annars
  // vinst % från travstatistik.se). null när uppgiften saknas.
  quick: { winPct: number | null; placePct: number | null; starts: number | null; postPct: number | null; postPlacePct: number | null };
};

// S2 statistikrad (3 värden). ok = false: "Statistik saknas just nu".
export type RaceStatsLine = {
  ok: boolean;
  fetchedAt: string | null;
  // Bästa startnummer bland loppets hästar på distansen och startmetoden,
  // för vinst och för plats (topp 3).
  bestNumber: { number: number; pct: number } | null;
  bestPlace: { number: number; pct: number } | null;
  number1Pct: number | null;
  number1PlacePct: number | null;
  // "ATG 2 år" (statistikbasen) eller "travstatistik.se".
  postSource: string | null;
  favoriteWinPct: number | null;
};

export type RaceDto = {
  id: string;
  leg: number;
  raceNumber: number;
  name: string;
  startAt: string;
  distance: number;
  startMethod: StartMethod;
  prize: number | null;
  classLabel: string | null;
  terms: string[];
  cancelled: boolean;
  resultAt: string | null;
  // Starttiden har passerat: I/S/B/odds är låsta (409).
  started: boolean;
  // Minst en Intressant eller "Inga intressanta här".
  reviewed: boolean;
  review: { reviewedAt: string; noneInteresting: boolean } | null;
  counts: { starters: number; scratched: number; interesting: number; spelbar: number; bet: number };
  statsLine: RaceStatsLine;
  starts: StartDto[];
};

// GET /api/rounds/[id]
export type RoundResponse = {
  serverTime: string;
  rev: number;
  round: RoundDto;
  // Är det här den aktuella omgången (annars banderollen "tidigare omgång").
  isCurrent: boolean;
  currentRoundId: string | null;
  phase: Phase;
  phaseRail: PhaseStep[];
  nextStep: NextStep;
  fetch: FetchState;
  races: RaceDto[];
  latestStreck: { kind: "BASELINE" | "LIVE" | "FETCH"; takenAt: string } | null;
  // Användarens V85-rad för omgången (null = inte sparad).
  coupon: CouponDto | null;
  // Modellversionen som riktoddsen kommer från.
  model: { id: string; key: string } | null;
  // Användarens inställningar som S2–S6 behöver. X-faktorerna (E2.1) skickas
  // alltid av servern. Äldre cachade svar (localStorage) kan sakna dem tills
  // omgången har hämtats igen, så läs dem med xFactorsOf() i
  // lib/round-overlay.ts, som faller tillbaka på standardfaktorerna.
  settings: RoundSettings;
  // Antal påslagna källor (Source.enabled) för användaren: m i "n av m källor" (6.8).
  sourcesEnabled: number;
};

export type RoundSettings = { spelbarGuideline: number; rowPrice: number; xFactorTror: number; xFactorStark: number };

export type LegSummary = {
  raceId: string;
  leg: number;
  name: string;
  startAt: string;
  distance: number;
  startMethod: StartMethod;
  classLabel: string | null;
  starters: number;
  interesting: number;
  spelbar: number;
  bet: number;
  reviewed: boolean;
  started: boolean;
  hasResult: boolean;
};

// GET /api/rounds/current
export type CurrentRoundResponse = {
  serverTime: string;
  // Användarens spelform (S10). Omgångens egen står i round.gameType.
  gameType: GameType;
  round: RoundDto | null;
  phase: Phase | null;
  phaseRail: PhaseStep[] | null;
  nextStep: NextStep;
  fetch: FetchState | null;
  legs: LegSummary[];
  // Bara uppslagen när den behövs (ingen omgång, eller omgången är klar).
  nextAvailable: NextAvailableResponse | null;
};

// ---- Loppstatistik S2b -----------------------------------------------------------

export type StatsBlockMeta = { source: "travstatistik.se" | "ATG"; fetchedAt: string | null; ok: boolean; error: string | null };

export type PersonFormDto = {
  personId: string;
  name: string;
  shortName: string | null;
  startNumbers: number[];
  // ATG: innevarande år.
  year: { year: string; starts: number; wins: number; winPct: number | null } | null;
  // travstatistik.se: V85-ligan och formtoppen (kuskar). null = ingen rad.
  league: LeagueRow | null;
  form: LeagueRow | null;
  // false = namnet gick inte att koppla ("ej kopplad").
  linked: boolean;
  rawName: string | null;
};

// GET /api/rounds/[id]/races/[leg]/stats
export type RaceStatsResponse = {
  raceId: string;
  leg: number;
  distance: number;
  startMethod: StartMethod;
  trackName: string;
  // Vinst % och plats % per startnummer ur statistikbasen (lib/hist.ts), alla
  // banor och loppets bana. null = för få lopp eller basen inte inläst.
  posts: { all: PostTable | null; track: PostTable | null; numbers: number[]; baseRaces: number };
  startnr: StatsBlockMeta & {
    // Loppets klass på distansen och startmetoden (alla banor).
    leg: StartnrLeg | null;
    // Alla klasser på distansen och startmetoden (alla banor).
    group: StartnrGroup | null;
    // Startnummer som finns i loppet (ej strukna), för markeringen i staplarna.
    numbers: number[];
    // Urvalet "<bana>" finns inte hos källan (se lib/travstatistik.ts).
    trackAvailable: false;
  };
  favorites: StatsBlockMeta & {
    // Loppets plats när omgångens lopp sorteras efter favoritens streck (1 = största favoriten).
    msRank: number | null;
    favoriteWinPct: number | null;
    // Favoriten vinner i alla V85/V75-lopp sedan 2016.
    overallWinPct: number | null;
    // Topp 3-andel finns inte hos källan.
    top3Pct: null;
  };
  rank: StatsBlockMeta & { byRank: Bucket[]; races: number | null; range: [number, number] | null };
  drivers: StatsBlockMeta & { rows: PersonFormDto[] };
  trainers: StatsBlockMeta & { rows: PersonFormDto[] };
};

// ---- Hästkortet S3 ------------------------------------------------------------------

export type RecordDto = {
  date: string;
  trackName: string;
  distance: number | null;
  startMethod: StartMethod | null;
  postPosition: number | null;
  place: number | null;
  galloped: boolean;
  disqualified: boolean;
  kmTime: string | null;
  odds: number | null;
  driverName: string | null;
};

export type YearStatsDto = { year: string; starts: number; wins: number; seconds: number; thirds: number; winPct: number | null; placePct: number | null };

export type CommentDto = {
  id: string;
  clientId: string;
  horseId: string;
  startId: string | null;
  roundId: string | null;
  kind: CommentKind;
  tags: string[];
  text: string;
  createdAt: string;
  updatedAt: string;
  // Sammanhang för listan i S3.
  round: { id: string; date: string; trackName: string } | null;
  leg: number | null;
  result: { place: number | null; disqualified: boolean } | null;
};

// GET /api/starts/[id]
export type StartDetailResponse = {
  start: StartDto & { raceId: string; roundId: string; leg: number; raceName: string; startAt: string; started: boolean };
  // Upp till 10 tidigare starter före omgångens datum, nyast först.
  records: RecordDto[];
  recordsTotal: number;
  recordsFetchedAt: string | null;
  recordsError: string | null;
  gallopWarning: GallopWarning | null;
  stats: {
    horse: { thisYear: YearStatsDto | null; lastYear: YearStatsDto | null; life: YearStatsDto | null };
    driver: YearStatsDto | null;
    trainer: YearStatsDto | null;
    // Vinst % och plats % för startnumret på distansen och startmetoden
    // (statistikbasen, annars vinst % från travstatistik.se).
    post: { number: number; pct: number | null; placePct: number | null; races: number; label: string | null } | null;
  };
  comments: CommentDto[];
  // Riktodds med förklaring (7.4). null = saknas.
  riktodds: RiktoddsDetailDto | null;
  // E5.
  tips: [];
};

export type WhyRowDto = { key: InputKey; text: string; contribution: number };

export type RiktoddsDetailDto = {
  modelKey: string;
  computedAt: string;
  odds: number;
  probTop3: number;
  uncertain: boolean;
  // "Osäkert: färre än 5 starter" (visas överst), null när det inte är osäkert.
  uncertainLine: string | null;
  // Högst 3 + 3, bidrag under 0,15 visas inte. Störst först.
  pros: WhyRowDto[];
  cons: WhyRowDto[];
  // "Chans till topp 3 ≈ 31 % → 1 / 0,31 = 3,20"
  calcLine: string;
  // Alla bidrag c_ij = w_j · z_ij.
  contributions: Record<InputKey, number>;
};

// GET /api/horses/[id]/comments
export type CommentsResponse = { comments: CommentDto[] };
// PUT /api/comments/[clientId]
export type CommentResponse = { comment: CommentDto };

// PUT /api/marks/[startId]
export type MarkResponse = { mark: MarkDto };

// PUT /api/races/[id]/review
export type ReviewResponse = { raceId: string; reviewed: boolean; review: { reviewedAt: string; noneInteresting: boolean } | null };

// GET/PUT /api/rounds/[id]/coupon
export type CouponDto = {
  roundId: string;
  budget: number;
  rowPrice: number;
  // { "1": [3, 10], "2": [5], … }
  selections: Record<string, number[]>;
  lockedLegs: number[];
  rows: number;
  cost: number;
  updatedAt: string;
};
export type CouponResponse = { coupon: CouponDto | null; defaults: { budget: number; rowPrice: number } };

// GET/PUT /api/admin/model
export type ModelDto = {
  id: string;
  key: string;
  weights: Record<InputKey, number>;
  params: { beta: number; marginal: number; kPlats: number; kVinst: number; kKusk: number; kTranare: number };
  active: boolean;
  createdAt: string;
};
export type ModelResponse = {
  active: ModelDto | null;
  versions: ModelDto[];
  // PUT: omräkningen av aktuell omgång (null om ingen omgång finns).
  recomputed?: RiktoddsStepResponse | null;
};

// GET/PUT /api/settings
export type SettingsDto = { theme: ThemeSetting; rushThresholdPe: number; rowPrice: number; spelbarGuideline: number; xFactorTror: number; xFactorStark: number; gameType: GameType };

// /api/sources
export type SourceDto = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  sortOrder: number;
  lastReadAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastFactCount: number | null;
  createdAt: string;
};
export type SourcesResponse = { sources: SourceDto[] };
export type SourceResponse = { source: SourceDto };

// /api/auth/me och login
export type MeResponse = { id: string; name: string; email: string; role: "USER" | "ADMIN" };
