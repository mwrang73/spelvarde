"use client";

// E5 S3: Tips i hästkortet (analysvy-layout 3.5). En rad per källa med det
// godkända tipset som gäller nu: rolltaggen, källan, när och artikelns
// titel. Ett tryck fäller ut citatet, historiken, Rätta och Artikeln. Bara
// ett tips är utfällt åt gången. Data från GET /api/starts/[id] (tips, tipsPending).

import Link from "next/link";
import { useState } from "react";
import { TipEditSheet } from "@/components/sources/TipEditSheet";
import { Quote, RoleTag } from "@/components/tips/RoleTag";
import { Skeleton } from "@/components/ui/board";
import { IconExt } from "@/components/ui/icons";
import { dayAbs, dayTimeAbs, roleLabel, stageLabel } from "@/lib/tips-ui";
import type { RaceDto, StartDetailResponse, StartDto, TipDto } from "@/lib/types";
import { loadDetail } from "./roundStore";

// Gällande tips (godkända och inte ersatta) och antalet väntande.
export function currentTips(detail: StartDetailResponse | null): { current: TipDto[]; pending: number } {
  const all = detail?.tips ?? [];
  return { current: all.filter((t) => t.review === "APPROVED" && !t.superseded), pending: detail?.tipsPending ?? 0 };
}

export const tipsHref = (startId: string) => `/kallor/granska?start=${startId}`;

export function TipsCompact({ roundId, races, start, detail, locked, onExpand }: { roundId: string; races: RaceDto[]; start: StartDto; detail: StartDetailResponse | null; locked: boolean; onExpand?: (open: boolean) => void }) {
  const [editing, setEditing] = useState<TipDto | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  if (!detail) {
    // Laddar: skelett bara när vi vet att det finns godkända tips.
    if (!start.tip) return null;
    return (
      <div className="sk-block" aria-busy="true" aria-label="Laddar tipsen">
        <Skeleton width="80%" />
        <Skeleton width="60%" />
      </div>
    );
  }
  const all = detail.tips ?? [];
  const { current, pending } = currentTips(detail);
  if (!current.length && !pending) return null;
  const toggle = (id: string) => {
    const next = open === id ? null : id;
    setOpen(next);
    onExpand?.(next !== null);
  };
  return (
    <>
      {!current.length && (
        <p className="help">
          {pending} tips väntar på granskning. <Link href={tipsHref(start.id)}>Granska</Link>
        </p>
      )}
      {current.length > 0 && (
        <ul className="tipl">
          {current.map((t) => {
            const history = all.filter((h) => h.sourceId === t.sourceId && h.superseded?.byId === t.id);
            const when = t.article.publishedAt ?? t.article.firstSeenAt;
            const isOpen = open === t.id;
            const pid = `tip-${t.id}`;
            return (
              <li key={t.id} className={isOpen ? "open" : undefined}>
                <button type="button" className="tipr" aria-expanded={isOpen} aria-controls={pid} onClick={() => toggle(t.id)}>
                  <RoleTag role={t.role} />
                  <span className="tipr-s">{t.sourceName}</span>
                  <span className="tipr-w num">{dayTimeAbs(when)}</span>
                  <span className="tipr-t">{t.article.title}</span>
                </button>
                <div id={pid} className="tipx" hidden={!isOpen}>
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
                  {(locked || t.locked) && <p className="help">Loppet har startat. Tipset kan inte ändras.</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <TipEditSheet roundId={roundId} tip={editing} races={races} onClose={() => setEditing(null)} onSaved={() => loadDetail(start.id, true)} onRemoved={() => loadDetail(start.id, true)} />
    </>
  );
}
