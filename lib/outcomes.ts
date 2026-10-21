// Utfall per användare och start (specen e4a 6.4 och 18): de rena delarna av
// frysningen och summeringarna. Ingen databas här; lib/outcomes-server.ts
// läser och skriver, och klienten kan använda samma funktioner.
//
// - freezeValues: värdena som sparas i Outcome vid loppets start, ur Mark och
//   användarens inställningar då (Spelbar enligt 6.1 med tolerans, X-faktor
//   och riktodds med X).
// - trollspotAtStart: Trollspöt precis före varje loppets starttid. Listan
//   fylls på när lopp startar, så den är bara entydig per lopp om den räknas
//   vid just det loppets start: trollspot(races, startAt − 1 ms, tolerans).
// - hitOf: träff = placering 1–3 utan diskning. Inställt lopp = null.
// - outcomeSummary: {hits, total} per grupp, bara rader med hit ≠ null (lopp
//   med resultat som inte är inställda).

import { spelbar } from "@/lib/spelbar";
import { trollspot, type TrollRace } from "@/lib/trollspot";
import { factorFor, riktoddsX, type XFactor, type XFactorSettings } from "@/lib/xfactor";
import type { HitCount, OutcomeSummary } from "@/lib/types";

export type FreezeSettings = XFactorSettings & { spelbarTolerance: number };

// Det som frysningen läser av Mark (null = ingen Mark, t.ex. en Trollspöt-häst
// som aldrig rörts).
export type FreezeMark = {
  interesting: boolean;
  bet: boolean;
  spelbarOverride: "NONE" | "ON" | "OFF";
  unibetOdds: number | null;
  betOdds: number | null;
  xFactor: XFactor;
  sourceSupport: number | null;
};

export type FrozenValues = {
  interesting: boolean;
  spelbar: boolean;
  bet: boolean;
  unibetOdds: number | null;
  betOdds: number | null;
  riktodds: number | null;
  xFactor: XFactor;
  xFactorValue: number;
  riktoddsX: number | null;
  sourceSupport: number | null;
  sourceTotal: number | null;
};

// Outcome-kolumnernas tak (sourceTotal 0–20 enligt villkoret i migreringen).
const SOURCE_TOTAL_MAX = 20;

// riktodds = aktivt riktodds utan X-faktor, sourceTotal = påslagna källor vid frysningen.
export function freezeValues(mark: FreezeMark | null, riktodds: number | null, settings: FreezeSettings, sourceTotal: number | null): FrozenValues {
  const xFactor: XFactor = mark?.xFactor ?? "NONE";
  const rx = riktoddsX(riktodds, xFactor, settings);
  const interesting = mark?.interesting ?? false;
  const unibetOdds = mark?.unibetOdds ?? null;
  return {
    interesting,
    // Samma regel som markDto: override ON räknas som Spelbar, OFF aldrig.
    spelbar: mark ? spelbar({ interesting, unibetOdds, riktodds: rx, override: mark.spelbarOverride }, settings.spelbarTolerance) : false,
    bet: mark?.bet ?? false,
    unibetOdds,
    betOdds: mark?.betOdds ?? null,
    riktodds,
    xFactor,
    xFactorValue: factorFor(xFactor, settings),
    riktoddsX: rx,
    sourceSupport: mark?.sourceSupport ?? null,
    sourceTotal: sourceTotal === null ? null : Math.max(0, Math.min(SOURCE_TOTAL_MAX, sourceTotal)),
  };
}

// Ska en Outcome skrivas för starten? I, S eller B, eller med i Trollspöt (18).
// Spelbar kräver Intressant (override ON tänder Intressant), så I || B räcker
// för markeringarna.
export function shouldFreeze(mark: Pick<FreezeMark, "interesting" | "bet"> | null, inTrollspot: boolean): boolean {
  return inTrollspot || !!mark?.interesting || !!mark?.bet;
}

export type TrollAtStart = { rank: number; minOdds: number; estOdds: number };

// Trollspöt precis före varje loppets start (avsnitt 18): för varje lopp som
// inte är inställt räknas listan vid startAt − 1 ms, och bara loppets egna
// hästar tas med. Nyckeln är startens id. Utan streck eller riktodds blir
// listan tom, vilket aldrig är ett fel.
export function trollspotAtStart(races: TrollRace[], tolerance: number, only?: Set<string>): Map<string, TrollAtStart> {
  const out = new Map<string, TrollAtStart>();
  for (const race of races) {
    if (race.cancelled || (only && !only.has(race.id))) continue;
    const res = trollspot(races, Date.parse(race.startAt) - 1, tolerance);
    res.items.forEach((item, i) => {
      if (item.race.id === race.id) out.set(item.start.id, { rank: i + 1, minOdds: item.minOdds, estOdds: item.estOdds });
    });
  }
  return out;
}

// Träff: placering 1–3 utan diskning. 0 (oplacerad), null, 4+ och diskad =
// false. Inställt lopp = null (räknas inte).
export function hitOf(place: number | null, disqualified: boolean, cancelled: boolean): boolean | null {
  if (cancelled) return null;
  if (disqualified) return false;
  return place !== null && place >= 1 && place <= 3;
}

export type SummaryRow = { interesting: boolean; spelbar: boolean; bet: boolean; trollspotRank: number | null; hit: boolean | null };

const empty = (): HitCount => ({ hits: 0, total: 0 });

// Summeringen per grupp. Rader utan resultat (hit = null) räknas inte. En
// häst kan ingå i flera grupper.
export function outcomeSummary(rows: SummaryRow[]): OutcomeSummary {
  const s: OutcomeSummary = { bet: empty(), spelbar: empty(), interesting: empty(), trollspot: empty() };
  for (const r of rows) {
    if (r.hit === null) continue;
    const add = (c: HitCount) => {
      c.total++;
      if (r.hit) c.hits++;
    };
    if (r.bet) add(s.bet);
    if (r.spelbar) add(s.spelbar);
    if (r.interesting) add(s.interesting);
    if (r.trollspotRank !== null) add(s.trollspot);
  }
  return s;
}

// "Bet 2/4 träff · Spelbar 3/6 topp 3 · Intressant 6/13 topp 3 · Trollspöt 2/3 topp 3."
// Grupper utan hästar utelämnas. Utan några: null.
export function summaryText(s: OutcomeSummary): string | null {
  const parts = [
    s.bet.total ? `Bet ${s.bet.hits}/${s.bet.total} träff` : null,
    s.spelbar.total ? `Spelbar ${s.spelbar.hits}/${s.spelbar.total} topp 3` : null,
    s.interesting.total ? `Intressant ${s.interesting.hits}/${s.interesting.total} topp 3` : null,
    s.trollspot.total ? `Trollspöt ${s.trollspot.hits}/${s.trollspot.total} topp 3` : null,
  ].filter((x): x is string => x !== null);
  return parts.length ? `${parts.join(" · ")}.` : null;
}

// Sortering på placering med dött lopp: samma placering står i startnummerordning.
export function byPlace<T extends { place: number | null; number: number }>(a: T, b: T): number {
  const pa = a.place && a.place > 0 ? a.place : Infinity;
  const pb = b.place && b.place > 0 ? b.place : Infinity;
  return pa - pb || a.number - b.number;
}

// Pollningen (6.10): var 60:e sekund medan något lopp har passerat starttiden,
// saknar resultat, inte är inställt och startade för högst 30 min sedan.
export const POLL_INTERVAL_MS = 60_000;
export const POLL_WINDOW_MS = 30 * 60_000;

export function pollingRaces<R extends { startAt: Date | string; hasResult: boolean; cancelled: boolean }>(races: R[], now: Date): R[] {
  const t = now.getTime();
  return races.filter((r) => {
    const s = typeof r.startAt === "string" ? Date.parse(r.startAt) : r.startAt.getTime();
    return !r.cancelled && !r.hasResult && s <= t && t - s <= POLL_WINDOW_MS;
  });
}

// När nästa automatiska hämtning väntas: senaste claimet + 60 s (eller nu, om
// det har passerat). null när ingen pollning gäller (då tar cron över).
export function nextResultsSyncAt(races: { startAt: Date | string; hasResult: boolean; cancelled: boolean }[], lastSyncAt: Date | null, now: Date): Date | null {
  if (!pollingRaces(races, now).length) return null;
  const next = lastSyncAt ? lastSyncAt.getTime() + POLL_INTERVAL_MS : now.getTime();
  return new Date(Math.max(next, now.getTime()));
}
