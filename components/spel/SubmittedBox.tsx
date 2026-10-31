"use client";

// Rutan "Jag har lämnat in raden" i V85-raden (E8 11). Raden är Mikaels egen
// markering: appen vet inte vad ATG har tagit emot. Kopian ändras aldrig av appen.

import { forwardRef, useState } from "react";
import { Banner } from "@/components/ui/board";
import { relTime, thousands } from "@/lib/format";
import {
  SUBMITTED_ROW_HELP,
  SUBMITTED_ROW_LATE_NOTE,
  SUBMITTED_ROW_MARK,
  SUBMITTED_ROW_MARK_LATE,
  SUBMITTED_ROW_NONE_TEXT,
  SUBMITTED_ROW_NONE_TITLE,
  SUBMITTED_ROW_QUEUED,
  SUBMITTED_ROW_REMOVED_TEXT,
  SUBMITTED_ROW_REMOVED_TITLE,
  SUBMITTED_ROW_REPLACED_TEXT,
  SUBMITTED_ROW_REPLACED_TITLE,
  SUBMITTED_ROW_SAVED,
  SUBMITTED_ROW_STAMP,
  SUBMITTED_ROW_UNDO_MARK,
} from "@/lib/submitted-row";
import { krText } from "@/lib/tippa-text";
import type { SubmittedRowDto } from "@/lib/types";

export type SubmittedNotice = "saved" | "removed" | "replaced" | null;

type Props = {
  submitted: SubmittedRowDto | null;
  started: boolean;
  // Det finns en sparad kupong att markera efter spelstopp.
  hasCoupon: boolean;
  blocked: boolean;
  now: Date;
  notice: SubmittedNotice;
  rowView: React.ReactNode;
  onOpen: () => void;
  onRemove: () => void;
  onUndo: () => void;
};

export const SubmittedBox = forwardRef<HTMLParagraphElement, Props>(function SubmittedBox({ submitted, started, hasCoupon, blocked, now, notice, rowView, onOpen, onRemove, onUndo }, statusRef) {
  const [open, setOpen] = useState(false);
  const undo = (
    <button type="button" className="btn secondary sm" onClick={onUndo}>
      Ångra
    </button>
  );
  const status = (
    <p className="help sub-st" role="status" tabIndex={-1} ref={statusRef}>
      {submitted?.pending ? SUBMITTED_ROW_QUEUED : notice === "saved" && submitted ? SUBMITTED_ROW_SAVED : ""}
    </p>
  );
  const notices = (
    <>
      {notice === "removed" && (
        <Banner tone="warn" actions={undo}>
          <b>{SUBMITTED_ROW_REMOVED_TITLE}</b> {SUBMITTED_ROW_REMOVED_TEXT}
        </Banner>
      )}
      {notice === "replaced" && (
        <Banner tone="info" actions={undo}>
          <b>{SUBMITTED_ROW_REPLACED_TITLE}</b> {SUBMITTED_ROW_REPLACED_TEXT}
        </Banner>
      )}
    </>
  );
  if (submitted)
    return (
      <>
        {notices}
        <section className="subbox brd" aria-label="Inlämnad rad">
          <span className="stamp">{SUBMITTED_ROW_STAMP}</span>
          <p className="sline">
            <b>{relTime(submitted.markedAt, now)}</b> · <b>{thousands(submitted.rows)}</b> {submitted.rows === 1 ? "rad" : "rader"} · <b>{krText(submitted.cost)}</b>
            {submitted.markedLate && ` · ${SUBMITTED_ROW_LATE_NOTE}`}
          </p>
          <div className="sact">
            <button type="button" className="linkish" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? "Dölj raden" : "Visa raden"}
            </button>
            <button type="button" className="linkish" onClick={onRemove}>
              {SUBMITTED_ROW_UNDO_MARK}
            </button>
          </div>
          {open && rowView}
          <p className="help">{SUBMITTED_ROW_HELP}</p>
          {status}
        </section>
      </>
    );
  return (
    <>
      {notices}
      <section className="subbox plain" aria-label="Inlämnad rad">
        {started && (
          <p className="sline">
            <strong>{SUBMITTED_ROW_NONE_TITLE}</strong> {SUBMITTED_ROW_NONE_TEXT}
          </p>
        )}
        {(!started || hasCoupon) && (
          <button type="button" className="btn secondary" aria-haspopup="dialog" disabled={blocked} onClick={onOpen}>
            {started ? SUBMITTED_ROW_MARK_LATE : SUBMITTED_ROW_MARK}
          </button>
        )}
        {(!started || hasCoupon) && <p className="help">{SUBMITTED_ROW_HELP}</p>}
        {status}
      </section>
    </>
  );
});
