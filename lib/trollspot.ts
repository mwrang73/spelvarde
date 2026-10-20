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
// Minst X = det högsta av 2,00, riktoddset (utan X-faktor) och marknadens
// uppskattade odds: Unibet ska slå Mikaels regel, modellen och marknaden.

import { harvilleTop3 } from "@/lib/riktodds";
import type { RaceDto, StartDto } from "@/lib/types";

export const TROLL_COUNT = 10;
export const TROLL_K = 0.59;
export const TROLL_MIN_EST = 1.8;
export const TROLL_MIN_ODDS = 2.0;

export type TrollItem = {
  race: RaceDto;
  start: StartDto;
  // Chans till topp 3 enligt modellen (0–1).
  chance: number;
  // Uppskattat platsodds ur strecket.
  estOdds: number;
  // Lägsta Unibet-odds för spelvärde.
  minOdds: number;
  // Unibets odds om det är ifyllt, och om det slår gränsen.
  unibet: number | null;
  over: boolean | null;
};

export type TrollResult = { items: TrollItem[]; hasStreck: boolean; qualified: number };

const round2 = (x: number) => Math.round(x * 100) / 100;

// Marknadens chans till topp 3 ur strecket per start (id → chans).
export function marketChances(race: RaceDto): Map<string, number> {
  const run = race.starts.filter((s) => !s.scratched && s.streck !== null && s.streck > 0);
  const out = new Map<string, number>();
  if (run.length < 4) return out;
  const sum = run.reduce((a, s) => a + (s.streck as number), 0);
  harvilleTop3(run.map((s) => (s.streck as number) / sum)).forEach((p, i) => out.set(run[i].id, p));
  return out;
}

export function trollspot(races: RaceDto[], now: number): TrollResult {
  const hasStreck = races.some((r) => r.starts.some((s) => s.streck !== null && s.streck > 0));
  const cands: TrollItem[] = [];
  for (const race of races) {
    if (race.cancelled || Date.parse(race.startAt) <= now) continue;
    const market = marketChances(race);
    for (const start of race.starts) {
      if (start.scratched || start.probTop3 === null || start.riktodds === null) continue;
      const pm = market.get(start.id);
      if (pm === undefined || !(pm > 0)) continue;
      const estOdds = round2(TROLL_K / pm);
      if (estOdds < TROLL_MIN_EST) continue;
      const minOdds = round2(Math.max(TROLL_MIN_ODDS, start.riktodds, estOdds));
      const unibet = start.mark?.unibetOdds ?? null;
      cands.push({ race, start, chance: start.probTop3, estOdds, minOdds, unibet, over: unibet === null ? null : unibet > minOdds });
    }
  }
  cands.sort((a, b) => b.chance - a.chance || a.race.leg - b.race.leg || a.start.number - b.start.number);
  return { items: cands.slice(0, TROLL_COUNT), hasStreck, qualified: cands.length };
}
