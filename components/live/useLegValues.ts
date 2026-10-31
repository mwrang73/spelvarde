"use client";

// Värdet på alla rätt per lopp, från GET /api/rounds/[id]/values. Ligger utanför
// komponenten så att byte av lopp inte hämtar om: ATG anropas bara när ett nytt
// lopp är visat och dess värde saknas. Misslyckas hämtningen försöks den igen när
// nästa lopp är klart eller visas.

import { useEffect, useState } from "react";
import { apiGet } from "@/components/api";
import type { LegValue, LegValuesResponse } from "@/lib/types";

type Entry = { values: LegValue[]; tried: string | null; pending: boolean };
const EMPTY: Entry = { values: [], tried: null, pending: false };
const store = new Map<string, Entry>();

export function useLegValues(roundId: string, lastShownLeg: number | null, resultCount: number): { values: readonly LegValue[]; pending: boolean } {
  const [, rerender] = useState(0);
  const key = `${resultCount}:${lastShownLeg}`;
  useEffect(() => {
    if (lastShownLeg === null) return;
    const cur = store.get(roundId) ?? EMPTY;
    if (cur.tried === key || cur.values.some((v) => v.leg === lastShownLeg)) return;
    store.set(roundId, { ...cur, tried: key, pending: true });
    rerender((n) => n + 1);
    apiGet<LegValuesResponse>(`/api/rounds/${roundId}/values`)
      .then((r) => store.set(roundId, { values: r.values, tried: key, pending: false }))
      .catch(() => store.set(roundId, { ...(store.get(roundId) ?? EMPTY), pending: false }))
      .finally(() => rerender((n) => n + 1));
  }, [roundId, key, lastShownLeg]);
  const entry = store.get(roundId) ?? EMPTY;
  return { values: entry.values, pending: entry.pending };
}
