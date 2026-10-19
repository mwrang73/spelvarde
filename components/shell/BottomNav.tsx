"use client";

// Bottenmenyn i mobilen (DESIGN.md Layoutmönster): Omgång, Källor och
// Statistik, 64 px. Pricken på Omgång visar att utkorgen inte har tömts på 30 s.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOutboxStale } from "@/components/outbox/OutboxProvider";
import { IconFlag, IconLink, IconStat } from "@/components/ui/icons";
import { NAV } from "./AppHeader";

const ICONS = { "/": IconFlag, "/kallor": IconLink, "/statistik": IconStat } as const;

export function BottomNav() {
  const pathname = usePathname() ?? "/";
  const stale = useOutboxStale();
  return (
    <nav className="tabbar m-only" aria-label="Huvudmeny">
      {NAV.map((n) => {
        const Icon = ICONS[n.href];
        return (
          <Link key={n.href} className="tab" href={n.href} aria-current={n.match(pathname) ? "page" : undefined}>
            <Icon />
            <span>{n.label}</span>
            {n.href === "/" && stale && <span className="ndot" role="img" aria-label="ändringar väntar på att sparas" />}
          </Link>
        );
      })}
    </nav>
  );
}
