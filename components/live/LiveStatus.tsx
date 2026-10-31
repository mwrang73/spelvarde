"use client";

// Statusraden i Live (E8 6.3) och Ångra. Räknas på utkorgens poster för omgången.
// status.kind === "paused" betyder utloggad. Offline läses från useOnline.

import { useEffect, useState } from "react";
import { useOnline } from "@/components/hooks";
import { useOutbox } from "@/components/outbox/OutboxProvider";
import { clearLastTagChange, undoRaceTag, useLastTagChange } from "@/components/round/tagStore";
import { IconCheckThin } from "@/components/ui/icons";
import { LIVE_UNDO_MS, liveStatusText, statusSaved } from "@/lib/live-view";
import { roundCommentPosts } from "@/lib/race-tags";

export function LiveStatus({ roundId, read, className }: { roundId: string; read: "loaded" | "loading" | "failed"; className?: string }) {
  const { queue, status } = useOutbox();
  const online = useOnline();
  const { last, undoneAt } = useLastTagChange();
  const pending = roundCommentPosts(queue, roundId).length;

  // Ångra och "Sparat · …" gäller i 10 s.
  const until = last ? last.at + LIVE_UNDO_MS : undoneAt ? undoneAt + LIVE_UNDO_MS : 0;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!until) return;
    const wait = until - Date.now();
    if (wait <= 0) {
      clearLastTagChange();
      return;
    }
    const t = window.setTimeout(() => {
      clearLastTagChange();
      tick((x) => x + 1);
    }, wait);
    return () => window.clearTimeout(t);
  }, [until]);

  const recent = last ? statusSaved(last.what, `${last.start.number} ${last.start.horse.name}`, last.removed) : null;
  const text = liveStatusText({ read, paused: status.kind === "paused", online, pending, recent, undone: !!undoneAt && !last });
  if (text === null) return null;
  const saved = text.startsWith("Sparat");
  return (
    <p className={`tstat${saved ? "" : " q"}${className ? ` ${className}` : ""}`} aria-live="polite">
      {saved && <IconCheckThin />}
      <span className="tst" title={text}>
        {text}
      </span>
      {last && read === "loaded" && (
        <button type="button" className="linkish" onClick={() => undoRaceTag()}>
          Ångra
        </button>
      )}
    </p>
  );
}
