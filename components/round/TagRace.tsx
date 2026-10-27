"use client";

// Tagga loppet (mockupen markeringar-live, del 2): sätt snabbvalen (6.6) på
// hästarna i ett lopp som har startat, när som helst efteråt. Kortet TagCta
// står i avdelningen (S2) från starttiden. Taggningen är helskärm i mobilen och
// en fast panel till höger på desktop. Byte av häst är bara lokalt tillstånd;
// allt sparas via utkorgen (tagStore).

import { useEffect, useMemo, useRef, useState } from "react";
import { useOutbox } from "@/components/outbox/OutboxProvider";
import { BetBadge, Badge, FlapNumber } from "@/components/ui/board";
import { IconX } from "@/components/ui/icons";
import { ordinal } from "@/lib/format";
import { QUICK_TAGS, quickTagForKey, toggleTag } from "@/lib/quick-tags";
import { metaOf } from "@/lib/round-overlay";
import type { RaceDto, RoundResponse, StartDto } from "@/lib/types";
import { raceStarted } from "./RoundProvider";
import { closeTagging, loadRaceTags, openTagging, saveRaceTag, selectTagStart, useRaceTags, useTaggingOpen, type TagCtx } from "./tagStore";

const UNDO_MS = 10_000;

const placeOf = (s: StartDto) => (s.result?.disqualified ? "diskad" : s.result?.place && s.result.place >= 1 ? ordinal(s.result.place) : s.result ? "5+" : "–");
const runners = (race: RaceDto) => race.starts.filter((s) => !s.scratched);

// Kortet i avdelningen: "3 av 11 hästar taggade · Tagga loppet". Bara efter start.
export function TagCta({ data, race, now }: { data: RoundResponse; race: RaceDto; now: number }) {
  const started = !race.cancelled && raceStarted(race, now);
  const tags = useRaceTags(data.round.id, race.leg);
  useEffect(() => {
    if (started) loadRaceTags(data.round.id, race.leg);
  }, [started, data.round.id, race.leg]);
  if (!started) return null;
  const all = runners(race);
  const tagged = all.filter((s) => (tags.byStart[s.id]?.tags.length ?? 0) > 0).length;
  return (
    <div className="tagcta">
      <div>
        <span className="k">Taggning i loppet</span>
        <p>{tags.loaded ? (
          <>
            <b className="num">{tagged}</b> av {all.length} hästar taggade
          </>
        ) : tags.error ? "Kunde inte läsa taggarna." : "Sätt snabbvalen på hästarna."}</p>
      </div>
      <button type="button" className="btn primary sm" onClick={() => openTagging(race.id)}>
        {tagged > 0 && tagged === all.length ? "Ändra taggar" : "Tagga loppet"}
      </button>
    </div>
  );
}

export function TagRace({ data, race }: { data: RoundResponse; race: RaceDto }) {
  const open = useTaggingOpen();
  if (!open || open.raceId !== race.id) return null;
  return <TagSheet data={data} race={race} startId={open.startId} />;
}

function TagSheet({ data, race, startId }: { data: RoundResponse; race: RaceDto; startId: string | null }) {
  const roundId = data.round.id;
  const tags = useRaceTags(roundId, race.leg);
  const { queue, status } = useOutbox();
  const hasResult = race.starts.some((s) => s.result);
  const [byPlace, setByPlace] = useState(false);
  const order = useMemo(() => {
    const list = runners(race);
    if (!byPlace) return list;
    const key = (s: StartDto) => (s.result?.disqualified ? 98 : s.result?.place && s.result.place >= 1 ? s.result.place : 50 + (s.result?.finishOrder ?? 40));
    return [...list].sort((a, b) => key(a) - key(b) || a.number - b.number);
  }, [race, byPlace]);
  const cur = order.find((s) => s.id === startId) ?? order[0];
  const idx = cur ? order.indexOf(cur) : -1;
  const prev = idx > 0 ? order[idx - 1] : null;
  const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  const ctx: TagCtx = { roundId, roundDate: data.round.date, trackName: data.round.trackName, race };
  const mine = cur ? tags.byStart[cur.id] : undefined;
  const curTags = mine?.tags ?? [];
  const [undo, setUndo] = useState<{ startId: string; tags: string[]; text: string; at: number } | null>(null);
  const [textOpen, setTextOpen] = useState(false);
  const [text, setText] = useState("");
  const headRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    loadRaceTags(roundId, race.leg);
  }, [roundId, race.leg]);

  // Ny häst: fokus på rubriken (läses upp) och fritexten följer hästen.
  useEffect(() => {
    headRef.current?.focus({ preventScroll: true });
    setText(mine?.text ?? "");
    setTextOpen(!!mine?.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id, tags.loaded]);

  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), Math.max(0, undo.at + UNDO_MS - Date.now()));
    return () => window.clearTimeout(t);
  }, [undo]);

  const ready = tags.loaded;
  const toggle = (tag: string) => {
    if (!cur || !ready) return;
    setUndo({ startId: cur.id, tags: curTags, text: mine?.text ?? "", at: Date.now() });
    saveRaceTag(ctx, cur, { tags: toggleTag(curTags, tag), text: mine?.text ?? "" });
    navigator.vibrate?.(10);
  };
  const saveText = () => {
    if (!cur || !ready || text.trim() === (mine?.text ?? "")) return;
    saveRaceTag(ctx, cur, { tags: curTags, text: text.trim() });
  };
  const doUndo = () => {
    if (!undo) return;
    const s = race.starts.find((x) => x.id === undo.startId);
    if (s) saveRaceTag(ctx, s, { tags: undo.tags, text: undo.text });
    setUndo(null);
  };

  // Desktop: bokstäverna taggar, ← → byter häst, Esc stänger. Av i fritexten.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) {
        if (e.key === "Escape") el.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") closeTagging();
      else if (e.key === "ArrowLeft" && prev) selectTagStart(prev.id);
      else if (e.key === "ArrowRight" && next) selectTagStart(next.id);
      else {
        const tag = e.key.length === 1 ? quickTagForKey(e.key) : null;
        if (!tag) return;
        toggle(tag);
      }
      e.preventDefault();
      // Avdelningsvyns egna tangenter (← → byter avdelning) ska inte också köra.
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const ids = new Set(Object.values(tags.byStart).map((t) => t.clientId));
  const pending = queue.filter((q) => {
    const m = metaOf(q);
    return m?.kind === "comment" && ids.has(m.clientId);
  }).length;
  const statusLine = !ready ? (tags.error ? <span className="e">{tags.error}</span> : "Läser taggarna …") : status.kind === "paused" && pending ? `I kö (${pending}) · skickas när nätet är tillbaka` : pending ? "Sparas …" : undo ? "Sparat" : "Sparas direkt · följer hästen";
  const taggedCount = order.filter((s) => (tags.byStart[s.id]?.tags.length ?? 0) > 0).length;

  if (!cur) return null;
  const mark = cur.mark;
  return (
    <div className="tagr" role="dialog" aria-modal="true" aria-labelledby="tagr-h">
      <div className="brd tagr-top">
        <header className="ah">
          <button type="button" className="btn icon" aria-label="Stäng taggningen" onClick={closeTagging}>
            <IconX />
          </button>
          <div className="ah-t">
            <span className="ah-title">Tagga · avd {race.leg}</span>
            <span className="ah-sub">{hasResult ? "Resultatet finns" : "Startat · väntar på resultat"}</span>
          </div>
          <button type="button" className="btn ghost" onClick={closeTagging}>
            Klar
          </button>
        </header>
        <div className="tstrip-h">
          <div className="seg" role="group" aria-label="Ordning">
            <button type="button" aria-pressed={!byPlace} onClick={() => setByPlace(false)}>
              Startnr
            </button>
            <button type="button" aria-pressed={byPlace} onClick={() => setByPlace(true)} disabled={!hasResult}>
              Placering
            </button>
          </div>
          <span className="tcount">
            <b className="num">{taggedCount}</b> av {order.length} taggade
          </span>
        </div>
        <div className="tstrip" role="tablist" aria-label={`Hästar i avd ${race.leg}`}>
          {order.map((s) => {
            const n = tags.byStart[s.id]?.tags.length ?? 0;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                className="tgb"
                aria-selected={s.id === cur.id}
                aria-label={`${s.number} ${s.horse.name}, ${placeOf(s)}${s.mark?.bet ? ", Bet" : ""}, ${n ? `${n} taggar` : "inga taggar"}`}
                onClick={() => selectTagStart(s.id)}
              >
                <FlapNumber n={s.number} />
                {s.mark?.bet && <span className="tbet" aria-hidden="true">B</span>}
                <small aria-hidden="true">{placeOf(s)}</small>
                {n > 0 && <i className="tdot" aria-hidden="true">{n}</i>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="tagr-body">
        <div className="thead">
          <FlapNumber n={cur.number} size="lg" />
          <div style={{ minWidth: 0 }}>
            <h2 id="tagr-h" className="tname" ref={headRef} tabIndex={-1} aria-live="polite">
              {cur.horse.name}
            </h2>
            <p className="tmeta">
              {cur.driver?.name ?? "Kusk saknas"} · <b>{placeOf(cur)}</b>
              {mark?.interesting && <Badge kind="i" />}
              {mark?.spelbar && <Badge kind="s" />}
              {mark?.bet && <BetBadge odds={mark.betOdds} />}
            </p>
          </div>
        </div>
        <div className="qc" role="group" aria-label={`Snabbval för ${cur.horse.name}`}>
          {QUICK_TAGS.map((q) => (
            <button key={q.tag} type="button" aria-pressed={curTags.includes(q.tag)} disabled={!ready} onClick={() => toggle(q.tag)}>
              {q.tag}
              <kbd aria-hidden="true">{q.key}</kbd>
            </button>
          ))}
        </div>
        {textOpen ? (
          <label className="ftx-l">
            <span className="sr">Fritext om {cur.horse.name}</span>
            <textarea className="ftx-a" rows={2} maxLength={2000} value={text} placeholder="Fritext om loppet" onChange={(e) => setText(e.target.value)} onBlur={saveText} disabled={!ready} />
          </label>
        ) : (
          <button type="button" className="linkish ftx" onClick={() => setTextOpen(true)} disabled={!ready}>
            + Fritext
          </button>
        )}
        <p className="tstat" aria-live="polite">
          <span>{statusLine}</span>
          {undo && (
            <button type="button" className="linkish" onClick={doUndo}>
              Ångra
            </button>
          )}
        </p>
        <p className="khelp d-only">
          <kbd>←</kbd> <kbd>→</kbd> föregående och nästa · bokstäverna taggar · <kbd>Esc</kbd> stänger
        </p>
      </div>

      <div className="tnav">
        <button type="button" className="btn secondary" disabled={!prev} onClick={() => prev && selectTagStart(prev.id)} aria-label={prev ? `Föregående häst: ${prev.number} ${prev.horse.name}` : "Ingen föregående häst"}>
          ‹ {prev && <span className="tn">{prev.number} {prev.horse.name}</span>}
        </button>
        <button type="button" className="btn primary nx" disabled={!next} onClick={() => next && selectTagStart(next.id)} aria-label={next ? `Nästa häst: ${next.number} ${next.horse.name}` : "Ingen nästa häst"}>
          {next && <span className="tn">{next.number} {next.horse.name}</span>} ›
        </button>
      </div>
    </div>
  );
}
