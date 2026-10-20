"use client";

// Raden "Streck och riktodds" med knappen Uppdatera (mockupen trollspot-mockup,
// alternativ A). Hämtar nytt streck från ATG och räknar om riktoddset för hela
// omgången (POST /api/rounds/[id]/refresh). Spelbar som Mikael har satt eller
// tagit bort ändras inte, bara förslagen. Äldre än 12 timmar: raden blir gul.

import { useState } from "react";
import { apiRequest } from "@/components/api";
import { useNow, useOnline } from "@/components/hooks";
import { Banner } from "@/components/ui/board";
import { IconRefresh } from "@/components/ui/icons";
import { relTime } from "@/lib/format";
import type { StreckRefreshResult } from "@/lib/fetch-round";
import type { RoundResponse } from "@/lib/types";
import { loadRound } from "./roundStore";

export const STRECK_STALE_MS = 12 * 3600_000;

type Change = { key: string; text: string };
type Result = { tone: "ok" | "err" | "info"; text: string; changes: Change[] };

// Skillnaden mellan två läsningar av omgången: riktodds och Spelbar per häst.
function diff(before: RoundResponse, after: RoundResponse): { rikt: number; spelbar: Change[] } {
  const old = new Map(before.races.flatMap((r) => r.starts.map((s) => [s.id, s] as const)));
  let rikt = 0;
  const spelbar: Change[] = [];
  for (const race of after.races)
    for (const s of race.starts) {
      const o = old.get(s.id);
      if (!o) continue;
      if (o.riktodds !== s.riktodds) rikt++;
      if (!!o.mark?.spelbar !== !!s.mark?.spelbar)
        spelbar.push({ key: s.id, text: `Avd ${race.leg} · ${s.number} ${s.horse.name}: ${s.mark?.spelbar ? "nu Spelbar" : "inte längre Spelbar"}` });
    }
  return { rikt, spelbar };
}

export function StreckRefresh({ data, compact }: { data: RoundResponse; compact?: boolean }) {
  const now = useNow(60_000);
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [showAll, setShowAll] = useState(false);
  const takenAt = data.latestStreck?.takenAt ?? null;
  const ageMs = takenAt ? now.getTime() - Date.parse(takenAt) : null;
  const stale = ageMs !== null && ageMs > STRECK_STALE_MS;
  const ago = ageMs === null ? "" : ageMs < 3600_000 ? `för ${Math.max(1, Math.round(ageMs / 60_000))} min sedan` : `för ${Math.round(ageMs / 3600_000)} timmar sedan`;

  const run = async () => {
    setBusy(true);
    setResult(null);
    setShowAll(false);
    try {
      // Två korta anrop: först strecket, sedan riktoddset (håller sig långt under Vercels tidsgräns).
      const res = await apiRequest<StreckRefreshResult>("POST", `/api/rounds/${data.round.id}/refresh`);
      await apiRequest("POST", `/api/rounds/${data.round.id}/riktodds`);
      const after = await loadRound(data.round.id);
      const d = diff(data, after);
      const extra = [res.changes.scratched.length ? `${res.changes.scratched.length} strukna` : "", res.changes.driverChanges.length ? `${res.changes.driverChanges.length} kuskbyten` : ""].filter(Boolean).join(", ");
      if (!res.hasStreck) setResult({ tone: "info", text: "Strecket finns inte än. Det kommer när V-spelet öppnar, oftast måndag.", changes: [] });
      else
        setResult({
          tone: "ok",
          text: `Strecket är uppdaterat. Riktoddset ändrades för ${d.rikt} hästar, Spelbar för ${d.spelbar.length}.${extra ? ` ${extra}.` : ""}${res.needsResume ? " Några avdelningar behöver hämtas om: tryck Slutför hämtningen." : ""}`,
          changes: d.spelbar,
        });
    } catch (e) {
      setResult({ tone: "err", text: e instanceof Error && e.message ? e.message : "ATG svarar inte. Försök igen.", changes: [] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`srefresh${stale ? " stale" : ""}${compact ? " compact" : ""}`}>
      <div className="sr-row">
        <p className="sr-t">
          <span className="k">Streck och riktodds</span>
          <span>
            {takenAt ? (
              <>
                <b className="num">{relTime(takenAt, now)}</b> · {ago}
              </>
            ) : (
              "Strecket finns inte än"
            )}
          </span>
        </p>
        <button type="button" className={`btn ${stale ? "primary" : "secondary"} sm`} disabled={busy || !online} onClick={() => void run()} aria-describedby={stale ? `${data.round.id}-stale` : undefined}>
          <IconRefresh />
          {busy ? "Uppdaterar …" : "Uppdatera streck"}
        </button>
      </div>
      {stale && !result && (
        <p className="help" id={`${data.round.id}-stale`}>
          Strecket är äldre än 12 timmar. Uppdatera innan du fyller i Unibets odds.
        </p>
      )}
      <div role="status" aria-live="polite">
        {result && (
          <Banner tone={result.tone} icon={result.tone === "ok" ? "check" : undefined}>
            {result.text}
            {result.changes.length > 0 && (
              <>
                {" "}
                <button type="button" className="linkish" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                  {showAll ? "Dölj" : "Visa vilka"}
                </button>
                {showAll && (
                  <ul className="plain sr-list">
                    {result.changes.map((c) => (
                      <li key={c.key}>{c.text}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Banner>
        )}
      </div>
    </div>
  );
}
