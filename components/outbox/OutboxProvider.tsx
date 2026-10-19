"use client";

// Kopplar utkorgen till React: toaster för avvisade ändringar och läget för
// statusraden ("Sparat", "Sparas …", "I kö (n)") och den globala pricken på
// Omgång-fliken (kön har inte tömts på 30 s).

import { useEffect, useState, useSyncExternalStore } from "react";
import { toLogin } from "@/components/api";
import { useToast } from "@/components/ui/Toast";
import { isStale } from "@/lib/outbox";
import { getOutboxServerSnapshot, getOutboxSnapshot, setOutboxNotifier, subscribeOutbox, type OutboxSnapshot } from "./outbox-client";

export function OutboxNotifications() {
  const toast = useToast();
  useEffect(() => {
    setOutboxNotifier({
      conflict: (text) => toast({ text }),
      rejected: (text) => toast({ text }),
      retry: (text) => toast({ text }),
      auth: () => toast({ text: "Logga in igen för att spara ändringarna.", action: { label: "Logga in", onClick: toLogin }, durationMs: 30_000 }),
    });
    return () => setOutboxNotifier(null);
  }, [toast]);
  return null;
}

export function useOutbox(): OutboxSnapshot {
  return useSyncExternalStore(subscribeOutbox, getOutboxSnapshot, getOutboxServerSnapshot);
}

// Sant när kön inte har tömts på 30 s (räknas om var 5:e sekund).
export function useOutboxStale(): boolean {
  const { queue } = useOutbox();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!queue.length) return;
    const t = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(t);
  }, [queue.length]);
  return isStale(queue, now);
}
