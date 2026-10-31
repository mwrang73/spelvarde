"use client";

// En häst i taget i Live (E8 5.2): under 1100 px bredd. Remsan har ingen placering,
// och ordningen är alltid startnummer.

import { forwardRef, useEffect, useRef, useState } from "react";
import { Badge, BetTicket, FlapNumber, RadPill } from "@/components/ui/board";
import { betOf, horseAria } from "@/lib/live-view";
import { postEdge } from "@/lib/post-edge";
import { QUICK_TAGS } from "@/lib/quick-tags";
import type { RaceTag } from "@/lib/race-tags";
import type { TagCtx } from "@/components/round/tagStore";
import type { RaceDto, StartDto } from "@/lib/types";
import { fritextIndex, tagButtonId } from "./LiveColumns";
import { FritextInline } from "./LiveFritext";

export function LiveStrip({ legLabel, runners, byStart, rowNumbers, currentId, onSelect }: { legLabel: string; runners: StartDto[]; byStart: Record<string, RaceTag | undefined>; rowNumbers: readonly number[]; currentId: string | null; onSelect: (id: string) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    if (currentId) refs.current[currentId]?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [currentId]);
  return (
    <div className="tstrip brd" role="tablist" aria-label={`Hästar i ${legLabel}`}>
      {runners.map((s) => {
        const n = byStart[s.id]?.tags.length ?? 0;
        const bet = betOf(s);
        const inRow = rowNumbers.includes(s.number);
        return (
          <button
            key={s.id}
            ref={(el) => {
              refs.current[s.id] = el;
            }}
            type="button"
            role="tab"
            className={`tgb${bet ? " is-b" : ""}`}
            aria-selected={s.id === currentId}
            tabIndex={s.id === currentId ? 0 : -1}
            aria-label={`${s.number} ${s.horse.name}${bet ? ", Bet" : ""}${inRow ? ", med i din rad" : ""}, ${n ? `${n} taggar` : "inga taggar"}`}
            onClick={() => onSelect(s.id)}
          >
            <FlapNumber n={s.number} />
            {bet && (
              <span className="tbet" aria-hidden="true">
                BET
              </span>
            )}
            <span className={`rdl${inRow ? "" : " none"}`} aria-hidden="true">
              {inRow ? "RAD" : " "}
            </span>
            {n > 0 && (
              <i className="tdot" aria-hidden="true">
                {n}
              </i>
            )}
          </button>
        );
      })}
    </div>
  );
}

type Props = {
  race: RaceDto;
  ctx: TagCtx;
  start: StartDto;
  mine: RaceTag | undefined;
  inRow: boolean;
  ready: boolean;
  scratched: { start: StartDto; inRow: boolean }[];
  focusIndex: number;
  onToggle: (start: StartDto, tag: string, index: number) => void;
  fritextSignal: number;
  children?: React.ReactNode;
};

export const LiveSingle = forwardRef<HTMLHeadingElement, Props>(function LiveSingle({ race, ctx, start, mine, inRow, ready, scratched, focusIndex, onToggle, fritextSignal, children }, ref) {
  const tags = mine?.tags ?? [];
  const saved = mine?.text ?? "";
  const [open, setOpen] = useState(!!saved);
  const bet = betOf(start);
  const mark = start.mark;
  // Tangenten + öppnar fritexten.
  const seen = useRef(fritextSignal);
  useEffect(() => {
    if (seen.current === fritextSignal) return;
    seen.current = fritextSignal;
    setOpen(true);
  }, [fritextSignal]);
  // Texten kan komma senare (läsningen).
  useEffect(() => {
    if (saved) setOpen(true);
  }, [saved]);
  return (
    <>
      <div className={`thead${bet ? " is-b" : ""}${inRow ? " is-r" : ""}`} role="group" aria-label={horseAria(start, inRow)}>
        <FlapNumber n={start.number} size="lg" edge={postEdge(race.statsLine, start.number)} />
        <div className="thd">
          <h2 className="tname" ref={ref} tabIndex={-1}>
            {start.horse.name}
          </h2>
          <p className="tmeta">
            {start.driver?.name ?? "Kusk saknas"}
            {!bet && mark?.interesting && <Badge kind="i" />}
            {!bet && mark?.spelbar && <Badge kind="s" />}
            {inRow && <RadPill />}
          </p>
        </div>
        {bet && <BetTicket odds={mark?.betOdds} />}
      </div>
      <div className="qc" role="group" aria-label={`Snabbval för ${start.horse.name}`}>
        {QUICK_TAGS.map((q, i) => (
          <button key={q.tag} id={tagButtonId(start.id, i)} type="button" aria-pressed={tags.includes(q.tag)} aria-label={`${q.tag}, ${start.number} ${start.horse.name}`} disabled={!ready} tabIndex={focusIndex === i ? 0 : -1} onClick={() => onToggle(start, q.tag, i)}>
            <span aria-hidden="true">{q.tag}</span>
            <kbd aria-hidden="true">{q.key}</kbd>
          </button>
        ))}
      </div>
      {open ? (
        <FritextInline key={start.id} ctx={ctx} start={start} saved={saved} disabled={!ready} onClose={() => setOpen(false)} />
      ) : (
        <button id={tagButtonId(start.id, fritextIndex)} type="button" className="linkish ftx" disabled={!ready} onClick={() => setOpen(true)}>
          + Fritext
        </button>
      )}
      {children}
      {scratched.length > 0 && (
        <p className="help lv-scr">
          Struken:{" "}
          {scratched.map((x, i) => (
            <span key={x.start.id}>
              {i > 0 && " · "}
              {x.start.number} {x.start.horse.name}
              {x.inRow && " · i raden"}
            </span>
          ))}
        </p>
      )}
    </>
  );
});
