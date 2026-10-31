"use client";

// Kortet i Analys efter start (E8 3.3): länken till Live på samma plats som den
// gamla taggningsrutan. Inställt lopp: inget kort. Säger inget om resultatet.

import Link from "next/link";
import { legName } from "@/lib/game-type";
import type { RaceDto, RoundResponse } from "@/lib/types";
import { raceStarted } from "./RoundProvider";

export function LiveLink({ data, race, now }: { data: RoundResponse; race: RaceDto; now: number }) {
  if (race.cancelled || !raceStarted(race, now)) return null;
  return (
    <p className="lnk">
      <span>{legName(data.round.gameType, race.leg)} har startat.</span>
      <Link href={`/omgang/${data.round.id}/live?avd=${race.leg}`}>Se loppet i Live ›</Link>
    </p>
  );
}
