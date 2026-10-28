"use client";

// Provläs (E5 S8): läser källan för aktuell omgång utan att spara något och
// utan AI, och visar vilka länkar som gäller omgången och varför.

import { useEffect, useState } from "react";
import { apiRequest } from "@/components/api";
import { Skeleton } from "@/components/ui/board";
import { Sheet } from "@/components/ui/Sheet";
import { dayTimeAbs } from "@/lib/tips-ui";
import type { SourceDto, TipPreviewResponse } from "@/lib/types";

export function SourcePreviewSheet({ source, onClose }: { source: SourceDto | null; onClose: () => void }) {
  const [res, setRes] = useState<TipPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = source?.id ?? null;

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setRes(null);
    setError(null);
    apiRequest<TipPreviewResponse>("POST", `/api/sources/${id}/preview`)
      .then((r) => alive && setRes(r))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Kunde inte läsa källan."));
    return () => {
      alive = false;
    };
  }, [id]);

  const failed = error ?? (res && !res.ok ? `Kunde inte läsas: ${res.error ?? "okänt fel."}` : null);
  return (
    <Sheet open={!!source} onClose={onClose} title={source ? `Provläs ${source.name}` : "Provläs"} sub={source?.url}>
      <div className="pv" aria-busy={!res && !failed ? true : undefined}>
        {!res && !failed && (
          <div className="sk-block" aria-label="Läser källan">
            <Skeleton width="85%" />
            <Skeleton width="60%" />
            <Skeleton width="75%" />
          </div>
        )}
        {failed && (
          <p className="err-msg" role="alert">
            {failed}
          </p>
        )}
        {res?.ok && !res.links.length && <p className="help">Hittade inga artikellänkar på sidan.</p>}
        {res?.ok && res.links.length > 0 && (
          <ul className="pvlist">
            {res.links.map((l) => (
              <li key={l.url}>
                <span className="pvt">{l.title || l.url}</span>
                <span className="pvm">
                  {l.publishedAt ? dayTimeAbs(l.publishedAt) : "Publiceringstid saknas"}
                  <span className={`tag ${l.relevant ? "good" : "thin"}`}>{l.relevant ? "Gäller omgången" : "Inte omgången"}</span>
                </span>
                {!l.relevant && l.reason && <span className="help">{l.reason}</span>}
              </li>
            ))}
          </ul>
        )}
        {(res || failed) && <p className="help pv-foot">Inget sparades och inget skickades till AI:n.</p>}
      </div>
    </Sheet>
  );
}
