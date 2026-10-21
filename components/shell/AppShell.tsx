"use client";

// Ramen för de inloggade sidorna: toaster, utkorgens notiser, följ systemets
// tema när valet är System, och bottenmenyn i mobilen.

import { useEffect } from "react";
import { OutboxNotifications } from "@/components/outbox/OutboxProvider";
import { StreckOddsRouteWatch } from "@/components/round/streckOddsStore";
import { ToastProvider } from "@/components/ui/Toast";
import { BottomNav } from "./BottomNav";
import { applyTheme, readThemeChoice } from "./theme-client";

function ThemeSync() {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readThemeChoice() === "system") applyTheme("system", false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <OutboxNotifications />
      <ThemeSync />
      <StreckOddsRouteWatch />
      <div className="shell">{children}</div>
      <BottomNav />
    </ToastProvider>
  );
}
