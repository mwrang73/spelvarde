"use client";

// S10 Statistikbas (bara ADMIN): läget och knappen som läser in alla svenska
// travlopp från ATG de senaste två åren (lib/hist.ts). Varje anrop läser in
// i ~40 s; knappen anropar igen tills allt är inläst. Fliken måste vara
// öppen under tiden, men det som redan är inläst sparas, så det går att
// fortsätta senare. Cron-jobbet lägger sedan till gårdagens lopp varje morgon.

import { useEffect, useRef, useState } from "react";
import { apiGet, apiRequest } from "@/components/api";
import { Banner } from "@/components/ui/board";
import { relTime } from "@/lib/format";
import type { HistImportResult, HistStatus } from "@/lib/hist";

const nf = new Intl.NumberFormat("sv-SE");

export function HistAdmin() {
  const [status, setStatus] = useState<HistStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(0);
  const stop = useRef(false);

  useEffect(() => {
    apiGet<HistStatus>("/api/admin/hist").then(setStatus).catch((e) => setError(e instanceof Error ? e.message : "Kunde inte läsa läget."));
    return () => {
      stop.current = true;
    };
  }, []);

  const run = async () => {
    setRunning(true);
    setError(null);
    setFailed(0);
    stop.current = false;
    let idle = 0;
    try {
      while (!stop.current) {
        const res = await apiRequest<HistImportResult>("POST", "/api/admin/hist");
        setStatus(res.status);
        setFailed(res.failedDays.length);
        if (res.status.complete) break;
        // Inget nytt två gånger i rad: ATG svarar inte, försök senare.
        idle = res.days ? 0 : idle + 1;
        if (idle >= 2) {
          setError("ATG svarar inte just nu. Det som är inläst är sparat. Försök igen senare.");
          break;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inläsningen avbröts. Det som är inläst är sparat.");
    } finally {
      setRunning(false);
    }
  };

  const share = status && status.daysTotal ? Math.min(100, Math.round((100 * status.daysDone) / status.daysTotal)) : 0;
  return (
    <section className="set-sec" aria-labelledby="h-hist">
      <h2 id="h-hist" className="sl">
        Statistikbas
      </h2>
      <p className="help">
        Alla svenska travlopp från ATG de senaste två åren. Ger vinst % och plats % per startnummer, så att statistiken inte behöver hämtas vid varje omgång. Gårdagens lopp läggs till automatiskt varje morgon.
      </p>
      {status && (
        <dl className="kv">
          <dt>Inlästa dagar</dt>
          <dd>
            {nf.format(status.daysDone)} av {nf.format(status.daysTotal)} ({share} %)
          </dd>
          <dt>Lopp</dt>
          <dd>{nf.format(status.races)}</dd>
          <dt>Starter</dt>
          <dd>{nf.format(status.starts)}</dd>
          <dt>Period</dt>
          <dd>
            {status.firstDate ?? status.from} – {status.lastDate ?? status.to}
          </dd>
          {status.lastImportedAt && (
            <>
              <dt>Senast inläst</dt>
              <dd>{relTime(status.lastImportedAt, new Date())}</dd>
            </>
          )}
        </dl>
      )}
      {running && (
        <div className="hist-prog" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share} aria-label="Inläsning av statistikbasen">
          <i style={{ width: `${share}%` }} />
        </div>
      )}
      <p className="help" role="status" aria-live="polite">
        {running ? `Läser in … ${share} %. Låt sidan vara öppen.` : status?.complete ? "Allt är inläst." : ""}
        {failed > 0 && ` ${failed} dagar gick inte att läsa och försöks igen.`}
      </p>
      {error && (
        <Banner tone="err" className="m10">
          {error}
        </Banner>
      )}
      {!status?.complete && (
        <button type="button" className="btn primary" disabled={running || !status} onClick={() => void run()}>
          {running ? "Läser in …" : status && status.daysDone > 0 ? "Fortsätt läsa in" : "Läs in statistiken"}
        </button>
      )}
    </section>
  );
}
