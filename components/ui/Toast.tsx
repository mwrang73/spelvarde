"use client";

// Toast (DESIGN.md): en rad längst ned med text och eventuellt en knapp
// (Ångra, Logga in). En i taget. Regionen finns alltid i DOM så att
// skärmläsare läser upp den (role="status").

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type ToastInput = { text: string; action?: { label: string; onClick: () => void }; durationMs?: number };
type ToastState = ToastInput & { id: number };

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const seq = useRef(0);

  const show = useCallback((t: ToastInput) => {
    seq.current += 1;
    setToast({ ...t, id: seq.current });
  }, []);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!toast) return;
    timer.current = setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), toast.durationMs ?? (toast.action ? 10_000 : 5_000));
    return () => clearTimeout(timer.current);
  }, [toast]);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.id}>
            <span>{toast.text}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action!.onClick();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (t: ToastInput) => void {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast måste användas inom ToastProvider.");
  return ctx;
}
