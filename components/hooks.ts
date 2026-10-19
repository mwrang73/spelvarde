"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

// Uppkopplad enligt webbläsaren. Servern och första ritningen räknar med uppkoppling.
export function useOnline(): boolean {
  return useSyncExternalStore(
    (fn) => {
      window.addEventListener("online", fn);
      window.addEventListener("offline", fn);
      return () => {
        window.removeEventListener("online", fn);
        window.removeEventListener("offline", fn);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (fn) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", fn);
      return () => mq.removeEventListener("change", fn);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const DESKTOP_QUERY = "(min-width: 1024px)";
export const useIsDesktop = () => useMediaQuery(DESKTOP_QUERY);

// Klockan, uppdaterad med ett intervall (för "Loppet har startat" och fas).
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}
