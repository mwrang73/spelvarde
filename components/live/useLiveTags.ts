"use client";

// Läser taggarna för alla startade lopp när Live öppnas (E8 12.4), så att loppraden
// visar antal och taggning fungerar efter öppning. Fel i ett lopp påverkar inte
// andra. Läses om med force när sidan syns igen.

import { useEffect, useMemo } from "react";
import { getRaceTags, loadRaceTags, useTagVersion } from "@/components/round/tagStore";
import { runnersOf, taggedCount, type LegTagState, type TabTags } from "@/lib/live-view";
import type { RaceDto } from "@/lib/types";

const startedAt = (r: RaceDto, now: number) => !r.cancelled && (r.started || Date.parse(r.startAt) <= now);

export function useLiveTags(roundId: string, races: RaceDto[], now: number) {
  const version = useTagVersion();
  const legs = useMemo(() => races.filter((r) => startedAt(r, now)).map((r) => r.leg), [races, now]);
  const legKey = legs.join(",");

  useEffect(() => {
    for (const leg of legs) loadRaceTags(roundId, leg, true);
    // Bara när listan över startade lopp ändras.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId, legKey]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      for (const leg of legKey ? legKey.split(",") : []) loadRaceTags(roundId, Number(leg), true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [roundId, legKey]);

  return useMemo(() => {
    const tagged: Record<number, TabTags> = {};
    const state = new Map<number, LegTagState>();
    for (const r of races) {
      const t = getRaceTags(roundId, r.leg);
      const runners = runnersOf(r);
      const count = t.loaded ? taggedCount(runners, t.byStart) : null;
      tagged[r.leg] = count === null ? null : { tagged: count, total: runners.length };
      state.set(r.leg, count ?? (t.error ? "failed" : null));
    }
    return { tagged, taggedOf: (leg: number): LegTagState => state.get(leg) ?? null };
    // version: lagret har ändrats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId, races, version]);
}
