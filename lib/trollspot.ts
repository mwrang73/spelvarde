// Trollspöt: de 10 hästar i omgången som bäst matchar kriterierna för spel,
// innan Unibets odds finns (backtestet 2026-10-20, docs/backtest/
// MODELLHISTORIK.md, "Mikaels regel och Trollspöt").
//
// Urval: högst chans till topp 3 enligt modellen bland hästar som enligt
// strecket troligen får minst 1,80 i platsodds. Strukna och lopp som har
// startat tas bort, och listan fylls på till 10. I backtestet kom de topp 3 i
// 29 % mot 18 % för alla hästar med odds över 2,0. Listan är ett förfilter:
// spelvärdet uppstår först när Unibets odds är över gränsen ("minst X").
//
// Uppskattat platsodds = K / marknadens chans till topp 3 ur strecket
// (Harville), K = medianen av platspoolens slutodds × marknadens chans i
// backtestet (0,59).
//
// Minst X = det högsta av 2,00, riktoddset (med X-faktor när hästen har en,
// samma riktodds som ringen räknas mot) minus toleransen och marknadens
// uppskattade odds: Unibet ska nå Mikaels regel, modellen och
// marknaden. Från E2.2 (e2.2 6.1, beslut 8) dras toleransen av från
// riktoddsdelen men inte från 2,00, så att Trollspöt och Spelbar säger samma
// sak, och oddset räcker när det är lika med gränsen (som Spelbar).

import { harvilleTop3 } from "@/lib/riktodds";
import { DEFAULT_TOLERANCE } from "@/lib/spelbar";
import type { RaceDto, StartDto } from "@/lib/types";

// Det som Trollspöt läser av ett lopp och en start. RaceDto och StartDto
// uppfyller typerna; servern (frysningen i lib/outcomes-server.ts) skickar in
// lättare objekt byggda direkt från databasen.
export type TrollStart = Pick<StartDto, "id" | "number" | "scratched" | "streck" | "probTop3" | "riktodds"> & { mark?: { unibetOdds: number | null; xFactor?: string; riktoddsX?: number | null } | null };
export type TrollRace<S extends TrollStart = TrollStart> = Pick<RaceDto, "id" | "leg" | "startAt" | "cancelled"> & { starts: S[] };

export const TROLL_COUNT = 10;
export const TROLL_K = 0.59;
export const TROLL_MIN_EST = 1.8;
export const TROLL_MIN_ODDS = 2.0;

export type TrollItem<R extends TrollRace = RaceDto> = {
  race: R;
  start: R["starts"][number];
  // Chans till topp 3 enligt modellen (0–1).
  chance: number;
  // Uppskattat platsodds ur strecket.
  estOdds: number;
  // Lägsta Unibet-odds för spelvärde.
  minOdds: number;
  // Unibets odds om det är ifyllt, och om det når gränsen (≥ minst X).
  unibet: number | null;
  over: boolean | null;
};

export type TrollResult<R extends TrollRace = RaceDto> = { items: TrollItem<R>[]; hasStreck: boolean; qualified: number };

const round2 = (x: number) => Math.round(x * 100) / 100;

// Marknadens chans till topp 3 ur strecket per start (id → chans).
export function marketChances(race: TrollRace): Map<string, number> {
  const run = race.starts.filter((s) => !s.scratched && s.streck !== null && s.streck > 0);
  const out = new Map<string, number>();
  if (run.length < 4) return out;
  const sum = run.reduce((a, s) => a + (s.streck as number), 0);
  harvilleTop3(run.map((s) => (s.streck as number) / sum)).forEach((p, i) => out.set(run[i].id, p));
  return out;
}

// max(2,00, riktodds − tolerans, ≈odds), avrundat till hundradelar.
export function minOddsOf(riktodds: number | null, estOdds: number, tolerance: number = DEFAULT_TOLERANCE): number {
  const rikt = riktodds === null ? 0 : round2(riktodds - round2(tolerance));
  return round2(Math.max(TROLL_MIN_ODDS, rikt, estOdds));
}

// Riktoddset som Minst X räknas mot: med X-faktor när hästen har en.
const riktForMin = (s: TrollStart): number | null => (s.mark?.xFactor && s.mark.xFactor !== "NONE" ? s.mark.riktoddsX ?? s.riktodds : s.riktodds);

// Minst X för en enskild häst (Platsspel och listan i Unibets odds). Utan
// streck eller riktodds: det som finns av 2,00 och riktoddset.
export function minOddsFor(race: TrollRace, start: TrollStart, tolerance: number = DEFAULT_TOLERANCE): number {
  const pm = marketChances(race).get(start.id);
  const est = pm && pm > 0 ? TROLL_K / pm : 0;
  return minOddsOf(riktForMin(start), est, tolerance);
}

// Chans, uppskattat odds och Minst X för en häst, i Trollspöt och Platsspel.
export type OddsFacts = { chance: number | null; estOdds: number | null; minOdds: number };

export function oddsFacts(race: TrollRace, start: TrollStart, tolerance: number = DEFAULT_TOLERANCE): OddsFacts {
  const pm = marketChances(race).get(start.id);
  const estOdds = pm && pm > 0 ? round2(TROLL_K / pm) : null;
  return { chance: start.probTop3, estOdds, minOdds: minOddsOf(riktForMin(start), estOdds ?? 0, tolerance) };
}

export function trollspot<R extends TrollRace = RaceDto>(races: R[], now: number, tolerance: number = DEFAULT_TOLERANCE): TrollResult<R> {
  const hasStreck = races.some((r) => r.starts.some((s) => s.streck !== null && s.streck > 0));
  const cands: TrollItem<R>[] = [];
  for (const race of races) {
    if (race.cancelled || Date.parse(race.startAt) <= now) continue;
    const market = marketChances(race);
    for (const start of race.starts as R["starts"][number][]) {
      if (start.scratched || start.probTop3 === null || start.riktodds === null) continue;
      const pm = market.get(start.id);
      if (pm === undefined || !(pm > 0)) continue;
      const estOdds = round2(TROLL_K / pm);
      if (estOdds < TROLL_MIN_EST) continue;
      const minOdds = minOddsOf(riktForMin(start), estOdds, tolerance);
      const unibet = start.mark?.unibetOdds ?? null;
      cands.push({ race, start, chance: start.probTop3, estOdds, minOdds, unibet, over: unibet === null ? null : unibet >= minOdds - 1e-9 });
    }
  }
  cands.sort((a, b) => b.chance - a.chance || a.race.leg - b.race.leg || a.start.number - b.start.number);
  return { items: cands.slice(0, TROLL_COUNT), hasStreck, qualified: cands.length };
}
