"use client";

// E5 S3: Tips i hästkortet, direkt efter X-faktor och källstöd. En post per
// källa med det godkända tipset som gäller nu, och historiken när det
// ersatte ett äldre. Data från GET /api/starts/[id] (tips, tipsPending).

import Link from "next/link";
import { useState } from "react";
import { TipEditSheet } from "@/components/sources/TipEditSheet";
import { Quote, RoleTag } from "@/components/tips/RoleTag";
import { Skeleton } from "@/components/ui/board";
import { IconExt } from "@/components/ui/icons";
import { dayAbs, dayTimeAbs, roleLabel, stageLabel } from "@/lib/tips-ui";
import type { RaceDto, StartDetailResponse, StartDto, TipDto } from "@/lib/types";
import { loadDetail } from "./roundStore";

export function TipsSection({ roundId, races, start, detail, locked }: { roundId: string; races: RaceDto[]; start: StartDto; detail: StartDetailResponse | null; locked: boolean }) {
  const [editing, setEditing] = useState<TipDto | null>(null);
  const hid = `tips-${start.id}`;
  if (!detail) {
    // Laddar: skelett bara när vi vet att det finns godkända tips.
    if (!start.tip) return null;
    return (
      <section className="hk-sec" aria-labelledby={hid} aria-busy="true">
        <h3 id={hid}>Tips</h3>
        <div className="sk-block">
          <Skeleton width="80%" />
          <Skeleton width="60%" />
        </div>
      </section>
    );
  }
  const all = detail.tips ?? [];
  const current = all.filter((t) => t.review === "APPROVED" && !t.superseded);
  const pending = detail.tipsPending ?? 0;
  if (!current.length && !pending) return null;
  const href = `/kallor/granska?start=${start.id}`;
  return (
    <section className="hk-sec tsec" aria-labelledby={hid}>
      <h3 id={hid} className="tsec-h">
        <span>Tips ({current.length})</span>
        <Link className="linkish" href={href}>
          Alla tips
        </Link>
      </h3>
      {!current.length && (
        <p className="help">
          {pending} tips väntar på granskning. <Link href={href}>Granska</Link>
        </p>
      )}
      {current.length > 0 && (
        <ul className="cm">
          {current.map((t) => {
            const history = all.filter((h) => h.sourceId === t.sourceId && h.superseded?.byId === t.id);
            const when = t.article.publishedAt ?? t.article.firstSeenAt;
            return (
              <li key={t.id}>
                <span className="cmh">
                  {t.sourceName} · {dayTimeAbs(when)} · {stageLabel(t.article.stage)}
                </span>
                <span className="cm-t">
                  <RoleTag role={t.role} />
                  <span className="cm-title">{t.article.title}</span>
                </span>
                <Quote quote={t.quote} word={t.roleWord} />
                {history.map((h) => (
                  <p key={h.id} className="hist">
                    <span aria-hidden="true">
                      Tidigare: <s>{roleLabel(h.role)}</s> {stageLabel(h.article.stage)} {dayAbs(h.article.publishedAt ?? h.article.firstSeenAt)}
                    </span>
                    <span className="sr">
                      Tidigare {roleLabel(h.role)}, {stageLabel(h.article.stage)} {dayAbs(h.article.publishedAt ?? h.article.firstSeenAt)}
                    </span>
                  </p>
                ))}
                <span className="cm-acts">
                  {!locked && !t.locked && (
                    <button type="button" className="btn ghost sm" onClick={() => setEditing(t)} aria-label={`Rätta tipset om ${start.horse.name} från ${t.sourceName}`}>
                      Rätta
                    </button>
                  )}
                  <a className="btn ghost sm" href={t.article.url} target="_blank" rel="noopener noreferrer" aria-label={`Artikeln ${t.article.title} (öppnas i ny flik)`}>
                    Artikeln <IconExt />
                  </a>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {(locked || current.some((t) => t.locked)) && <p className="help">Loppet har startat. Tipset kan inte ändras.</p>}
      <TipEditSheet roundId={roundId} tip={editing} races={races} onClose={() => setEditing(null)} onSaved={() => loadDetail(start.id, true)} onRemoved={() => loadDetail(start.id, true)} />
    </section>
  );
}
