"use client";

// Bottenark (DESIGN.md Sheet): modal <dialog> som fångar fokus, stängs med
// Esc, grepp-listen eller ett tryck utanför, låser skrollningen under och
// ger tillbaka fokus till den som öppnade det.

import { useEffect, useId, useRef } from "react";
import { IconX } from "./icons";

export function Sheet({ open, onClose, title, sub, children }: { open: boolean; onClose: () => void; title: string; sub?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
      document.documentElement.classList.add("lock");
    }
    if (!open && d.open) d.close();
    return () => {
      if (!open) return;
      document.documentElement.classList.remove("lock");
    };
  }, [open]);

  useEffect(() => {
    if (open) return;
    document.documentElement.classList.remove("lock");
    const el = opener.current;
    if (el instanceof HTMLElement) el.focus();
    opener.current = null;
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Tryck på bakgrunden (själva dialog-elementet utanför innehållet).
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="sheet-in">
          <div className="grab" aria-hidden="true" />
          <button type="button" className="btn icon sheet-x" aria-label="Stäng" onClick={onClose}>
            <IconX />
          </button>
          <h2 id={titleId}>{title}</h2>
          {sub && <p className="sub">{sub}</p>}
          {children}
        </div>
      )}
    </dialog>
  );
}
