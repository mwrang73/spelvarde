"use client";

// Fritexten i Live (E8 5.2). Sparas när fältet lämnas, vid Klar, vid Esc, vid byte
// av lopp eller häst (avmontering) och när sidan döljs.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { setRaceText, type TagCtx } from "@/components/round/tagStore";
import type { StartDto } from "@/lib/types";

const MAX = 2000;

export function useFritext(ctx: TagCtx, start: StartDto, saved: string) {
  const [text, setText] = useState(saved);
  const latest = useRef({ ctx, start, text });
  latest.current = { ctx, start, text };
  const save = useCallback(() => {
    const l = latest.current;
    setRaceText(l.ctx, l.start, l.text.trim());
  }, []);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") save();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      save();
    };
  }, [save]);
  return { text, setText, save };
}

// Popover över kolumnen. rgt: öppnas till vänster i kolumnernas högra halva.
export function FritextPopover({ ctx, start, saved, right, onClose }: { ctx: TagCtx; start: StartDto; saved: string; right: boolean; onClose: () => void }) {
  const id = useId();
  const { text, setText, save } = useFritext(ctx, start, saved);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    area.current?.focus();
  }, []);
  const close = () => {
    save();
    onClose();
  };
  return (
    <div className={`ftpop${right ? " rgt" : ""}`}>
      <label htmlFor={id}>
        Fritext · {start.number} {start.horse.name}
      </label>
      <textarea
        id={id}
        ref={area}
        rows={3}
        maxLength={MAX}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      />
      <div className="fa">
        <button type="button" className="btn secondary sm" onClick={close}>
          Klar
        </button>
      </div>
    </div>
  );
}

// I flödet under taggarna, en häst i taget.
export function FritextInline({ ctx, start, saved, disabled, onClose }: { ctx: TagCtx; start: StartDto; saved: string; disabled: boolean; onClose: () => void }) {
  const { text, setText, save } = useFritext(ctx, start, saved);
  const area = useRef<HTMLTextAreaElement>(null);
  return (
    <label className="ftx-l">
      <span className="sr">
        Fritext om {start.number} {start.horse.name}
      </span>
      <textarea
        ref={area}
        className="ftx-a"
        rows={2}
        maxLength={MAX}
        value={text}
        placeholder="Fritext om loppet"
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            save();
            if (!text.trim()) onClose();
            else area.current?.blur();
          }
        }}
      />
    </label>
  );
}
