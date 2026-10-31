// Typer för API-svaren. Delas av rutterna (app/api) och klienten.
// Alla tider är ISO-strängar i UTC. Datum utan tid är "YYYY-MM-DD" (svenskt
// lokalt datum). Odds och procent är vanliga tal (3.1 = 3,10; 19.24 = 19,24 %).
// Felsvar har alltid formen ApiError.

import type { FormSummary, GallopWarning } from "@/lib/gallop";
import type { GameType } from "@/lib/game-type";
import type { PostTable } from "@/lib/hist";
import type { SignalResult } from "@/lib/positive-signals";
import type { NextStep, Phase, PhaseStep } from "@/lib/phase";
import type { InputKey } from "@/lib/riktodds";
import type { OddsClass } from "@/lib/spelbar";
import type { Bucket, LeagueRow, StartnrGroup, StartnrLeg } from "@/lib/travstatistik";
import type { XFactor } from "@/lib/xfactor";

export type ApiError = { error: string; code?: string };

export type StartMethod = "AUTO" | "VOLTE";
export type FetchStatus = "COMPLETE" | "PARTIAL" | "FAILED";
export type ThemeSetting = "system" | "light" | "dark";
export type SpelbarOverride = "NONE" | "ON" | "OFF";
export type CommentKind = "NOTE" | "RACE";
// Källan till Mark.unibetOdds (E2.2): MANUAL = eget (inskrivet), UNIBET = hämtat.
export type OddsSource = "MANUAL" | "UNIBET";
export type { OddsClass } from "@/lib/spelbar";
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
  // ---- E2.2 ----
  // Källan till unibetOdds. null = inget odds. "UNIBET" med unibetOdds = null
  // = struken hos Unibet (taggen "Struken hos Unibet", fältet avstängt).
  // Äldre cachade svar saknar fälten (läs med ?? null).
  unibetOddsSource: OddsSource | null;
  // Ångra (6.9): det egna oddset som hämtningen replacedByFetchId ersatte
  // ("Ersatte ditt 3,10"). Båda null när inget ersattes.
  replacedOdds: number | null;
  replacedByFetchId: string | null;
  // Grön markering (6.1): skillnaden round2(unibetOdds − riktoddsX) mot
  // användarens tolerans. "over" > 0, "near" −tolerans…0, "under" < −tolerans,
  // null när odds eller riktodds saknas. Gäller även hästar som inte är
  // Intressant; S-märket följer spelbar.
  oddsClass: OddsClass | null;
};

// Unibets senaste och första platsodds för en start i omgången (E2.2). null =
// ingen hämtning har haft hästen. place/win = senaste hämtningen där hästen
// fanns (null om struken hos Unibet), status = Unibets status då ("Starter"
// = startar, annat = struken hos Unibet). first/firstAt = första
// ögonblicksbilden med platsodds (för rörelsen), null om ingen haft odds.
export type StartUnibetDto = {
  place: number | null;
  win: number | null;
  status: string;
  at: string;
  first: number | null;
  firstAt: string | null;
};

export type StartResultDto = {
  place: number | null;
  finishOrder: number | null;
  disqualified: boolean;
  galloped: boolean;
  kmTime: string | null;
  finalOdds: number | null;
};

// ---- Resultat (E4a) ---------------------------------------------------------------

// Träff av antal i en grupp. Bet = placering 1–3 ("träff"), övriga = topp 3.
export type HitCount = { hits: number; total: number };

// Summeringen räknad från de frysta Outcome (lib/outcomes.ts, outcomeSummary).
// Bara lopp med resultat som inte är inställda räknas. trollspot = hästar som
// var i Trollspöt vid loppets start (avsnitt 18). total = 0 → visa "–".
export type OutcomeSummary = { bet: HitCount; spelbar: HitCount; interesting: HitCount; trollspot: HitCount };

// De frysta värdena för användaren och starten (null = ingen Outcome: loppet
// har inte startat, hästen var omarkerad och inte i Trollspöt, eller struken).
// hit: null före resultat och för inställda lopp. place/disqualified följer
// resultatet (null före). trollspotRank 1–10 = platsen i Trollspöt precis
// före start, med minst X (trollspotMinOdds) och uppskattat platsodds.
export type StartOutcomeDto = {
  interesting: boolean;
  spelbar: boolean;
  bet: boolean;
  xFactor: XFactor;
  hit: boolean | null;
  place: number | null;
  disqualified: boolean;
  unibetOdds: number | null;
  trollspotRank: number | null;
  trollspotMinOdds: number | null;
  trollspotEstOdds: number | null;
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
  // lifeStarts = starter i livet, för intjänat per start (horse.earnings / lifeStarts).
  quick: { winPct: number | null; placePct: number | null; starts: number | null; lifeStarts: number | null; postPct: number | null; postPlacePct: number | null };
  // Positiva signaler (lib/positive-signals.ts). null = struken.
  signals: SignalResult | null;
  // E2.2: Unibets odds över tid i kort form (se StartUnibetDto).
  unibet: StartUnibetDto | null;
  // E4a: frysta värden vid loppets start (se StartOutcomeDto). Äldre cachade
  // svar saknar fältet (läs med ?? null).
  outcome?: StartOutcomeDto | null;
  // E5: rolltaggen i S2 och förslaget till källstöd i S3 (se StartTipDto).
  // Äldre cachade svar saknar fältet (läs med ?? null).
  tip?: StartTipDto | null;
};

// S2 statistikrad (3 värden). ok = false: "Statistik saknas just nu".
export type RaceStatsLine = {
  ok: boolean;
  fetchedAt: string | null;
  // Bästa startnummer bland loppets hästar på distansen och startmetoden,
  // för vinst och för plats (topp 3).
  bestNumber: { number: number; pct: number } | null;
  bestPlace: { number: number; pct: number } | null;
  // Banans eget bästa spår (kan vara ett annat nummer), när banan har minst
  // 150 lopp på distansen och startmetoden. trackRaces = banans antal lopp
  // (null = ingen statistik för banan).
  trackBestWin: { number: number; pct: number } | null;
  trackBestPlace: { number: number; pct: number } | null;
  trackRaces: number | null;
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
  // E4a: summeringen för avdelningen från de frysta Outcome. null före
  // resultat och när loppet är inställt. Äldre cachade svar saknar fältet.
  summary?: OutcomeSummary | null;
  // Unibets nyckel för loppet (sparas vid oddshämtningen), för länken
  // "Spela hos Unibet". Saknas = länken går till Unibets travsida.
  unibetEventKey?: string | null;
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
  // E8: raden som användaren har markerat som inlämnad (null = ingen). Äldre
  // cachade svar saknar fältet: läs med ?? null.
  submittedRow?: SubmittedRowDto | null;
  // Modellversionen som riktoddsen kommer från.
  // calibrated = modellen har kalibrering (v3: plattA/plattB/maxP3 ändrar P3).
  model: { id: string; key: string; calibrated?: boolean } | null;
  // Användarens inställningar som S2–S6 behöver. X-faktorerna (E2.1) skickas
  // alltid av servern. Äldre cachade svar (localStorage) kan sakna dem tills
  // omgången har hämtats igen, så läs dem med xFactorsOf() i
  // lib/round-overlay.ts, som faller tillbaka på standardfaktorerna.
  settings: RoundSettings;
  // Antal påslagna källor (Source.enabled) för användaren: m i "n av m källor" (6.8).
  sourcesEnabled: number;
  // E2.2: senaste ögonblicksbilden av Unibets odds (pågående eller klar).
  // null = ingen sparad. Spärren gäller till takenAt + 2 min (ODDS_LOCK_MS i
  // lib/unibet.ts), jämför med serverTime.
  latestOdds: LatestOddsDto | null;
  // E2.2: senaste försöket att hämta odds, även när inget sparades (Nästa
  // steg: "Unibet har inga odds än … Senast prövat i dag 14:30").
  // outcome: "saved" = sparat, "noOdds" = Unibet hade inga odds,
  // "noMeeting" = banan fanns inte hos Unibet, "failed" = Unibet svarade inte.
  lastOddsAttempt: { at: string; outcome: "saved" | "noOdds" | "noMeeting" | "failed" } | null;
  // E4a: resultathämtningen. syncedAt = senaste lyckade hämtning från ATG
  // (Round.liveOkAt, "Senast kollat"). nextSyncAt = när nästa automatiska
  // hämtning väntas (null = ingen pollning gäller). summary = hela omgången
  // ("Hittills"/"Omgången"), null tills någon avdelning har resultat.
  // Äldre cachade svar saknar fältet.
  results?: RoundResultsDto;
  // E5: tipsraden i S1 (se RoundTipsDto). null utan tips och utan läsning.
  // Äldre cachade svar saknar fältet (läs med ?? null).
  tips?: RoundTipsDto | null;
};

export type RoundResultsDto = { syncedAt: string | null; nextSyncAt: string | null; summary: OutcomeSummary | null };

// POST /api/rounds/[id]/results, body { force?: boolean }. Lättdata efter
// resultathämtningen. changed = något ändrades (rev ökade): läs om omgången.
// claimed = det här anropet hämtade från ATG (false = någon annan gjorde det
// nyss, svaret är senast sparade läge). 502 { error: "ATG svarade inte." }.
export type ResultsSyncResponse = {
  serverTime: string;
  rev: number;
  changed: boolean;
  claimed: boolean;
  syncedAt: string | null;
  nextSyncAt: string | null;
  races: { leg: number; resultAt: string | null; cancelled: boolean }[];
};

// GET /api/cron/results
export type CronResultsResponse = { slot: string | null; rounds: { roundId: string; legsWithResult: number; finished: boolean; ok: boolean }[] };

export type LatestOddsDto = { fetchId: string; takenAt: string; finishedAt: string | null; legsOk: number[]; legsFailed: number[]; legsSkipped: number[] };

// spelbarTolerance (E2.2) saknas i äldre cachade svar: läs med toleranceOf()
// i lib/round-overlay.ts, som faller tillbaka på 0,10.
export type RoundSettings = { spelbarGuideline: number; rowPrice: number; xFactorTror: number; xFactorStark: number; spelbarTolerance: number };

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
  // E4a (S1 under och efter loppen).
  cancelled: boolean;
  // Placering 1 (lägsta startnummer vid dött lopp). null före resultat.
  winner: { number: number; name: string } | null;
  // Användarens frysta Bet i avdelningen, i startnummerordning. place/
  // disqualified = resultatet (null/false före resultat).
  betResults: { number: number; name: string; place: number | null; disqualified: boolean }[];
  summary: OutcomeSummary | null;
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
  // E5: samma som RoundResponse.tips, för Källor och S1. null utan omgång,
  // utan tips och utan läsning.
  tips?: RoundTipsDto | null;
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

// earnings = intjänat i kr under perioden (null = okänt).
export type YearStatsDto = { year: string; starts: number; wins: number; seconds: number; thirds: number; winPct: number | null; placePct: number | null; earnings: number | null };

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
  round: { id: string; date: string; trackName: string; gameType: string } | null;
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
  // E5: godkända tips för starten från alla källor (gällande först, sedan
  // historik), nyast först inom varje grupp.
  tips: TipDto[];
  // E5: förslaget till källstöd (StartTipDto.support) från påslagna källor.
  // null när starten inte har något godkänt, gällande tips.
  tipSourceCount: number | null;
  // E5 (tillägg): väntande tips för starten ("1 tips väntar på granskning").
  tipsPending: number;
  // E2.2: Unibets odds för starten i varje ögonblicksbild där hästen fanns,
  // äldst först. place/win null = struken hos Unibet (status ≠ "Starter").
  unibetHistory: UnibetHistoryPoint[];
};

export type UnibetHistoryPoint = { fetchId: string; at: string; place: number | null; win: number | null; status: string };

export type WhyRowDto = { key: InputKey; text: string; contribution: number };

export type RiktoddsDetailDto = {
  modelKey: string;
  computedAt: string;
  odds: number;
  probTop3: number;
  uncertain: boolean;
  // "Osäkert: färre än 5 starter" (visas överst), null när det inte är osäkert.
  uncertainLine: string | null;
  // "Strecket saknas än, så modellens vikter utan streck används." eller null.
  noteLine: string | null;
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
  // ---- E6 (docs/specs/e6-v85-rad.md 8.5 och 12) ----
  // null = raden sparades före E6 (gammal rad, visas som den är). Äldre
  // cachade svar saknar fälten: läs med ?? null.
  spikCount?: number | null;
  // Prioriterat lopp (hette allgardering före E6b). CHOSEN: Mikaels val.
  // AUTO: det lopp appen valde vid senaste sparningen.
  allgMode?: AllgMode | null;
  allgLeg?: number | null;
  // E6b (docs/specs/e6b-max-per-lopp.md 4.3): Max hästar per lopp, 3–30.
  // null = Alla (inget tak), också för kuponger sparade före E6b. Äldre
  // cachade svar saknar fältet: läs med ?? null.
  maxPerLeg?: number | null;
  // Skälen per avdelning och häst vid senaste sparningen.
  legRoles?: LegRolesDto | null;
  // Senaste Kopiera texten och raden som kopierades då.
  copiedAt?: string | null;
  copiedSelections?: Record<string, number[]> | null;
};

// PUT /api/rounds/[id]/submitted-row (E8, docs/specs/e8-live.md 9.3). En kopia:
// ändras aldrig av kupongen, och struken häst står kvar.
export type SubmittedRowDto = {
  roundId: string;
  // { "1": [2, 5], … }
  selections: Record<string, number[]>;
  rows: number;
  cost: number;
  rowPrice: number;
  // När användaren tryckte, enligt klienten.
  markedAt: string;
  // markedAt var vid eller efter första start.
  markedLate: boolean;
  updatedAt: string;
  // Bara i klienten: posten ligger i utkorgen (applyPending). Skickas aldrig av servern.
  pending?: boolean;
};
export type SubmittedRowResponse = { submittedRow: SubmittedRowDto };

// GET /api/rounds/[id]/values: värdet på alla rätt (kr) och system kvar efter loppet.
export type LegValue = { leg: number; value: number; systems: number };
export type LegValuesResponse = { values: LegValue[] };

// E6: prioriterat lopp, Auto eller valt (hette allgardering före E6b). Ingen NONE (spec 8.5).
export type AllgMode = "AUTO" | "CHOSEN";

// E6 skälen (6.5.2), i taggordningen PRE, grupp (T3/MEL/SKR eller LOW/NOMEL),
// FEL, SIG4–SIG10, FAV.
export type ReasonCode = "PRE" | "T3" | "MEL" | "SKR" | "LOW" | "NOMEL" | "FEL" | "SIG4" | "SIG5" | "SIG6" | "SIG7" | "SIG8" | "SIG9" | "SIG10" | "FAV";
// PRIO (E6b): prioriterat lopp där inte alla löpande är med (h som OPEN).
// ALLG: prioriterat lopp med alla löpande (allgardering, fav i stället för h).
export type LegRoleKind = "OPEN" | "SPIK" | "OWN_SPIK" | "OWN" | "ALLG" | "PRIO" | "CANCELLED";
// h = valda hästar (startnummer som nyckel) och deras koder. favOut = spärrad
// favorits nummer. fav = favoritens nummer (bara ALLG).
export type LegRoleDto = { k: LegRoleKind; h?: Record<string, ReasonCode[]>; favOut?: number; fav?: number };
// Version 1 (8.5). Nycklarna i legs är avdelningarna "1"–"8".
export type LegRolesDto = { v: 1; prelim: boolean; favLimit: number; legs: Record<string, LegRoleDto> };

export type CouponResponse = { coupon: CouponDto | null; defaults: { budget: number; rowPrice: number } };

// GET/PUT /api/admin/model
export type ModelDto = {
  id: string;
  key: string;
  weights: Record<InputKey, number>;
  // noStreck = vikterna när loppet saknar streck (null = samma vikter).
  params: { beta: number; marginal: number; kPlats: number; kVinst: number; kKusk: number; kTranare: number; plattA: number; plattB: number; maxP3: number; noStreck: Record<InputKey, number> | null };
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
export type SettingsDto = { theme: ThemeSetting; rushThresholdPe: number; rowPrice: number; spelbarGuideline: number; xFactorTror: number; xFactorStark: number; gameType: GameType; spelbarTolerance: number };

// ---- Unibets odds (E2.2, specen e2.2 12) ------------------------------------------------

// POST /api/rounds/[id]/unibet. 429 inom spärren: UnibetLockedError.
// noMeeting: banan finns inte hos Unibet, inget sparades (fetchId null).
export type UnibetStartResponse =
  | { fetchId: string; takenAt: string; noMeeting?: false; legs: { leg: number; eventKey: string | null; skipped: "started" | "no-event" | null }[] }
  | { fetchId: null; noMeeting: true; legs: [] };
export type UnibetLockedError = { error: string; retryAfterSec: number };

// POST /api/rounds/[id]/unibet/[fetchId]/legs/[leg]. 502 med ok: false och
// error när Unibet inte svarade. noPrices = Unibet hade inga odds för loppet
// (inget skrevs). missing = startnummer som inte fanns hos Unibet (oddset
// ändrades inte), scratchedAtUnibet = strukna hos Unibet (oddset blev null).
// replaced = egna odds som ersattes (from = ditt, to = Unibets).
export type UnibetLegResponse = {
  leg: number;
  ok: boolean;
  noPrices: boolean;
  withOdds: number;
  missing: number[];
  scratchedAtUnibet: number[];
  replaced: { startId: string; from: number; to: number | null }[];
  error?: string;
};

// POST /api/rounds/[id]/unibet/[fetchId]/finish
export type UnibetFinishResponse = { saved: false } | ({ saved: true; withOdds: number } & LatestOddsDto);

// POST /api/rounds/[id]/unibet/[fetchId]/undo, body { startId? }
export type UnibetUndoResponse = { restored: { startId: string; odds: number }[]; marks: MarkDto[] };

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
  // E5: antal tips (godkända och väntande) från källan i omgången vid senaste läsningen.
  lastFactCount: number | null;
  createdAt: string;
  // E5: läsaren. null = väljs efter adressen (travstugan.se och travcash.se
  // läses som samlingssida, annat som en sida).
  kind: SourceKind | null;
  // E5: relevanta artiklar vid senaste läsningen. null = inte läst än.
  lastArticleCount: number | null;
};
export type SourcesResponse = { sources: SourceDto[] };
export type SourceResponse = { source: SourceDto };

// /api/auth/me och login
export type MeResponse = { id: string; name: string; email: string; role: "USER" | "ADMIN" };

// ---- Hämta tips (E5, docs/specs/e5-hamta-tips.md 12) ---------------------------------------
//
// Felsvar har formen ApiError ({ error, code? }). Koder:
//   ROUND_CLOSED       409 Alla lopp har startat.
//   SOURCE_DISABLED    409 Källan är avstängd.
//   SCAN_LOCKED        429 Nyss läst (TipScanLockedError, med retryAfterSec).
//   UNCHANGED          409 Artikeln är redan läst.
//   DUPLICATE          409 Samma text som en annan artikel.
//   BUSY               409 Artikeln läses redan.
//   AI_QUOTA           429 Dagens gräns är nådd (TipAiError, med quota).
//   AI_NOT_CONFIGURED  503 ANTHROPIC_API_KEY saknas. Inget räknades.
//   AI_ERROR           502/503/504 AI-anropet misslyckades (TipAiError, med quota: läsningen räknades).
//   RACE_STARTED       409 Loppet har startat.
//   NOT_LINKED         409 Välj häst först.
//   NOTHING_TO_UNDO    409 Det finns inget att ångra.
//   NO_ROUND           409 Ingen omgång hämtad (Provläs).

export type TipRole = "SPIK" | "FAVORIT" | "SKRALL" | "AVRADAN" | "NAMND";
export type TipReview = "PENDING" | "APPROVED" | "REJECTED";
export type TipMatch = "SURE" | "UNSURE" | "NONE";
export type TipStage = "EARLY" | "FINAL";
export type TipArticleStatus = "NEW" | "INTERPRETED" | "FAILED" | "DUPLICATE";
export type SourceKind = "COLLECTION" | "PAGE";
export type TipFlag =
  | "NO_MATCH"
  | "ROLE_WORD_UNKNOWN"
  | "ROLE_CONFLICT"
  | "ROLE_WORD_MISSING"
  | "NAME_MISMATCH"
  | "NAME_SPELLING"
  | "NUMBER_MISMATCH"
  | "NUMBER_MISSING"
  | "LEG_MISMATCH"
  | "LEG_MISSING"
  | "QUOTE_NO_NAME"
  | "SCRATCHED";

// AI-läsningar i dag (svensk tid). resetsAt = nästa 00:00 i Stockholm (UTC-ISO).
export type QuotaDto = { used: number; limit: number; resetsAt: string };

export type TipArticleDto = {
  id: string;
  sourceId: string;
  sourceName: string;
  url: string;
  title: string;
  publishedAt: string | null;
  stage: TipStage;
  firstSeenAt: string;
  lastSeenAt: string;
  interpretedAt: string | null;
  status: TipArticleStatus;
  error: string | null;
  tipCount: number | null;
  discarded: number | null;
  truncated: boolean;
};

// En start kort: avdelning, nummer och namn.
export type TipStartRef = { startId: string; leg: number; number: number; name: string };
// Ett annat tips i ersättningskedjan (samma källa och start).
export type TipLinkRef = { id: string; role: TipRole; articleTitle: string; at: string };

export type TipDto = {
  id: string;
  articleId: string;
  sourceId: string;
  sourceName: string;
  // Som AI:n läste texten.
  leg: number | null;
  number: number | null;
  rawHorseName: string;
  role: TipRole;
  roleWord: string | null;
  quote: string;
  // Kopplingen. horseName = startens namn, null när ej kopplat.
  startId: string | null;
  horseName: string | null;
  // Tillägg: den kopplade startens avdelning och nummer (för "Avd 1" och
  // fällbladsrutan). null när ej kopplat.
  startLeg: number | null;
  startNumber: number | null;
  // NONE när startId är null, oavsett vad som sparades.
  match: TipMatch;
  flags: TipFlag[];
  // Tillägg: texten för den första flaggan (6.11) och desktopens korta form.
  flagText: string | null;
  flagShort: string | null;
  // "Närmast är 5 Mellby Harley" för ej kopplade.
  suggestion: TipStartRef | null;
  review: TipReview;
  reviewedAt: string | null;
  editedByUser: boolean;
  aiRole: TipRole;
  // Ersatt av ett nyare tips från samma källa (historik).
  superseded: { byId: string; role: TipRole; articleTitle: string; at: string } | null;
  // Godkänt tips från samma källa och start som det här ersätter (eller
  // ersätter när det godkänns): "Ersätter tidiga tips: ~~Skräll~~ (tis 27 okt)".
  replaces: (TipLinkRef & { stage: TipStage }) | null;
  // Tillägg: artikeln (för S3: rubrikraden, titeln och "Artikeln ↗").
  article: { title: string; url: string; publishedAt: string | null; firstSeenAt: string; stage: TipStage };
  // Loppet har startat: tipset kan inte ändras.
  locked: boolean;
  // Senaste åtgärden kan ångras (POST /api/tips/undo).
  canUndo: boolean;
};

// GET /api/rounds/[id]/tips. tips = alla utom borttagna.
export type TipsResponse = {
  roundId: string;
  articles: TipArticleDto[];
  tips: TipDto[];
  counts: { pending: number; pendingSure: number; pendingUnsure: number; approved: number; approvedHorses: number };
  quota: QuotaDto;
  // Senaste läsningen av någon källa för omgången, och källans namn.
  lastReadAt: string | null;
  lastSourceName: string | null;
};

export type TipScanArticle = {
  articleId: string;
  title: string;
  url: string;
  publishedAt: string | null;
  stage: TipStage;
  change: "new" | "changed" | "unchanged" | "duplicate";
  needsAi: boolean;
};

// POST /api/rounds/[id]/tips/sources/[sourceId]/scan. Fel från sajten ger 200
// med ok: false, status "error" och error (felorsaken i källraden).
export type TipScanResponse = {
  sourceId: string;
  ok: boolean;
  status: "ok" | "noArticle" | "error";
  error?: string;
  articles: TipScanArticle[];
  irrelevant: number;
  quota: QuotaDto;
};
// 429 inom spärren (60 s per källa).
export type TipScanLockedError = { error: string; code: "SCAN_LOCKED"; retryAfterSec: number };

// POST /api/tips/articles/[articleId]/interpret
export type TipInterpretResponse = {
  articleId: string;
  ok: boolean;
  tips: TipDto[];
  created: number;
  // Summan av kastade poster (form, citat, dubbletter, tak).
  discarded: number;
  // Tillägg: uppdelningen ("2 tips kastades eftersom citatet inte fanns i texten").
  discardedBy: { shape: number; quote: number; duplicate: number; overflow: number };
  skippedStarted: number;
  // Artikeln kortades före läsningen ("bara början lästes").
  truncated: boolean;
  // Svaret blev för långt (max_tokens), bara en del av tipsen lästes.
  cutOff: boolean;
  // Tillägg: tips som inte kunde kopplas till en häst.
  unlinked: number;
  quota: QuotaDto;
};
// 429 AI_QUOTA och 502/503/504 AI_ERROR.
export type TipAiError = { error: string; code: "AI_QUOTA" | "AI_ERROR"; quota: QuotaDto };

// Förslaget och taggen per start. Bara godkända, gällande tips från påslagna
// källor. role = starkaste rollen, sources = antal källor, support = antal
// källor med Spik, Favorit eller Skräll (förslaget till källstöd).
export type StartTipDto = { role: TipRole; sources: number; support: number };

// Svar på granskningens åtgärder. tips = de tips som ändrades (efter
// ändringen). affected = starter vars StartDto.tip ändrades (patchStartTips).
// message: t.ex. "Ett nyare tips från Travstugan gäller redan."
export type TipActionResponse = {
  tips: TipDto[];
  affected: { startId: string; tip: StartTipDto | null }[];
  message?: string;
};

// POST /api/sources/[id]/preview (Provläs). Inget sparas och inget räknas.
export type TipPreviewResponse = {
  sourceId: string;
  ok: boolean;
  error?: string;
  links: { url: string; title: string; publishedAt: string | null; relevant: boolean; reason: string | null }[];
};

// Tipsraden i S1. approved = godkända, gällande tips från påslagna källor,
// horses = starter med minst ett sådant, pending = att granska.
// lastSourceName = källan som lästes senast, sourcesRead = antal olika
// källor som har lästs för omgången.
export type RoundTipsDto = { approved: number; horses: number; pending: number; lastReadAt: string | null; lastSourceName: string | null; sourcesRead: number };
