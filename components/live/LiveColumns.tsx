"use client";

// Kolumnläget i Live (E8 5.2): en kolumn per häst med alla 13 taggar under.
// Varje kolumn memoiseras, så att ett klick bara ritar om den hästen (195 knappar).
// Klick och tangenter går till lagret direkt, utan väntan på nätet.

import { memo } from "react";
import { Badge, BetTicket, FlapNumber, RadPill } from "@/components/ui/board";
import { odds } from "@/lib/format";
import { betOf, horseAria } from "@/lib/live-view";
import { postEdge } from "@/lib/post-edge";
import { QUICK_TAGS } from "@/lib/quick-tags";
import type { RaceTag } from "@/lib/race-tags";
import type { RaceDto, StartDto } from "@/lib/types";
import type { TagCtx } from "@/components/round/tagStore";
import { FritextPopover } from "./LiveFritext";

export const tagButtonId = (startId: string, i: number) => `tb-${startId}-${i}`;
export const fritextIndex = QUICK_TAGS.length;

type ColumnProps = {
  start: StartDto;
  edge: ReturnType<typeof postEdge>;
  mine: RaceTag | undefined;
  inRow: boolean;
  active: boolean;
  // Vilken knapp i kolumnen som har tabbstoppet (rovande tabindex). null = ingen.
  focusIndex: number | null;
  ready: boolean;
  showTags: boolean;
  fritextOpen: boolean;
  right: boolean;
  ctx: TagCtx;
  onActivate: (startId: string) => void;
  onToggle: (start: StartDto, tag: string, index: number) => void;
  onFritext: (startId: string | null) => void;
};

const LiveColumn = memo(function LiveColumn({ start, edge, mine, inRow, active, focusIndex, ready, showTags, fritextOpen, right, ctx, onActivate, onToggle, onFritext }: ColumnProps) {
  const bet = betOf(start);
  const mark = start.mark;
  const tags = mine?.tags ?? [];
  const text = mine?.text ?? "";
  const cls = `hc${active ? " on" : ""}${bet ? " is-b" : ""}${inRow ? " is-r" : ""}${mark?.interesting ? " is-i" : ""}`;
  return (
    <section className={cls} role="group" aria-label={horseAria(start, inRow)}>
      <div className="hh" onClick={() => onActivate(start.id)}>
        <div className="hh1">
          <FlapNumber n={start.number} edge={edge} />
          <span className="hhs">{inRow && <RadPill />}</span>
        </div>
        <h2 className="hnm" title={start.horse.name}>
          {start.horse.name}
        </h2>
        <div className="hh4">
          {bet ? (
            <BetTicket odds={mark?.betOdds} />
          ) : (
            <>
              {mark?.interesting && <Badge kind="i" />}
              {mark?.spelbar && <Badge kind="s" />}
            </>
          )}
        </div>
      </div>
      {showTags && (
        <>
          {QUICK_TAGS.map((q, i) => {
            const on = tags.includes(q.tag);
            return (
              <button
                key={q.tag}
                id={tagButtonId(start.id, i)}
                type="button"
                className="tbn"
                aria-pressed={on}
                aria-label={`${q.tag}, ${start.number} ${start.horse.name}`}
                disabled={!ready}
                tabIndex={focusIndex === i ? 0 : -1}
                onClick={() => onToggle(start, q.tag, i)}
              >
                {on && <i aria-hidden="true">✓</i>}
                <span aria-hidden="true">{q.tag}</span>
                {active && <kbd aria-hidden="true">{q.key}</kbd>}
              </button>
            );
          })}
          <button id={tagButtonId(start.id, fritextIndex)} type="button" className="tbn ftb" disabled={!ready} tabIndex={focusIndex === fritextIndex ? 0 : -1} aria-label={`${text ? "Ändra fritext" : "Fritext"}, ${start.number} ${start.horse.name}`} onClick={() => onFritext(fritextOpen ? null : start.id)}>
            <span aria-hidden="true">{text ? `✎ ${text}` : "+ Fritext"}</span>
          </button>
          {fritextOpen && (
            <FritextPopover
              ctx={ctx}
              start={start}
              saved={text}
              right={right}
              onClose={() => {
                onFritext(null);
                document.getElementById(tagButtonId(start.id, fritextIndex))?.focus();
              }}
            />
          )}
        </>
      )}
    </section>
  );
});

function ScratchedColumn({ start, inRow }: { start: StartDto; inRow: boolean }) {
  const bet = betOf(start);
  const extra = [inRow ? "i raden" : null, bet ? (start.mark?.betOdds != null ? `Bet ${odds(start.mark.betOdds)}` : "Bet") : null].filter(Boolean).join(" · ");
  return (
    <section className="hc xc" role="group" aria-label={`${start.number} ${start.horse.name}, struken${inRow ? ", med i din rad" : ""}${bet ? ", Bet" : ""}`}>
      <div className="xh" aria-hidden="true">
        <FlapNumber n={start.number} size="sm" />
        <span className="xn">
          <s>{start.horse.name}</s> · Struken{extra && ` · ${extra}`}
        </span>
      </div>
    </section>
  );
}

type Props = {
  race: RaceDto;
  starts: StartDto[];
  byStart: Record<string, RaceTag | undefined>;
  rowNumbers: readonly number[];
  activeId: string | null;
  focusIndex: number;
  ready: boolean;
  showTags: boolean;
  fritextFor: string | null;
  ctx: TagCtx;
  onActivate: (startId: string) => void;
  onToggle: (start: StartDto, tag: string, index: number) => void;
  onFritext: (startId: string | null) => void;
};

export function LiveColumns({ race, starts, byStart, rowNumbers, activeId, focusIndex, ready, showTags, fritextFor, ctx, onActivate, onToggle, onFritext }: Props) {
  const running = starts.filter((s) => !s.scratched).length;
  // Fler än 15 löpande: lägsta bredd 70 px och vågrät skroll inne i rutnätet.
  const col = running > 15 ? "minmax(70px, 200px)" : "minmax(0, 200px)";
  const template = starts.map((s) => (s.scratched ? "44px" : col)).join(" ");
  return (
    <div className="ga" style={{ gridTemplateColumns: template }}>
      {starts.map((s, i) =>
        s.scratched ? (
          <ScratchedColumn key={s.id} start={s} inRow={rowNumbers.includes(s.number)} />
        ) : (
          <LiveColumn
            key={s.id}
            start={s}
            edge={postEdge(race.statsLine, s.number)}
            mine={byStart[s.id]}
            inRow={rowNumbers.includes(s.number)}
            active={s.id === activeId}
            focusIndex={s.id === activeId ? focusIndex : null}
            ready={ready}
            showTags={showTags}
            fritextOpen={fritextFor === s.id}
            right={i >= starts.length / 2}
            ctx={ctx}
            onActivate={onActivate}
            onToggle={onToggle}
            onFritext={onFritext}
          />
        ),
      )}
    </div>
  );
}
