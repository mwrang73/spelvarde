"use client";

// Vyrubriken på tavlan (DESIGN.md AppHeader). I mobilen: tillbaka eller
// logga, titel (h1), underrad och högst två ikonknappar. På desktop:
// toppmeny med Omgång, Källor och Statistik, och en titelrad under.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOutboxStale } from "@/components/outbox/OutboxProvider";
import { IconBack, IconWheel } from "@/components/ui/icons";

export const NAV = [
  { href: "/", label: "Omgång", match: (p: string) => p === "/" || p.startsWith("/omgang") || p.startsWith("/installningar") },
  { href: "/kallor", label: "Källor", match: (p: string) => p.startsWith("/kallor") },
  { href: "/statistik", label: "Statistik", match: (p: string) => p.startsWith("/statistik") },
] as const;

export type HeaderBack = { href: string; label: string; onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void };

export function AppHeader({
  title,
  sub,
  brand,
  back,
  actions,
  deskMeta,
  deskTitle = true,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  // Logga i stället för tillbaka (S1, Källor).
  brand?: boolean;
  back?: HeaderBack;
  actions?: React.ReactNode;
  deskMeta?: React.ReactNode;
  // false: vyn har sin egen h1 på desktop (S2:s loppruta).
  deskTitle?: boolean;
}) {
  return (
    <>
      <header className="ah brd m-only">
        {back ? (
          <Link className="btn icon" href={back.href} aria-label={back.label} onClick={back.onClick}>
            <IconBack />
          </Link>
        ) : (
          <span className="logo" aria-hidden="true">
            <IconWheel />
          </span>
        )}
        <div className="ah-t">
          {brand ? (
            <h1 className="ah-brand">
              SPELVÄRDE<span className="sr"> – {title}</span>
            </h1>
          ) : (
            <h1 className="ah-title">{title}</h1>
          )}
          {sub && <span className="ah-sub">{sub}</span>}
        </div>
        {actions}
      </header>
      <DeskHeader meta={deskMeta} />
      {deskTitle && (
        <div className="dtitle brd d-only">
          {back && (
            <Link className="btn ghost sm" href={back.href} onClick={back.onClick}>
              <IconBack /> {back.label.replace(/^Tillbaka till /, "")}
            </Link>
          )}
          <div className="ah-t">
            <h1 className="ah-title">{title}</h1>
            {sub && <span className="ah-sub">{sub}</span>}
          </div>
          {actions}
        </div>
      )}
    </>
  );
}

function DeskHeader({ meta }: { meta?: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const stale = useOutboxStale();
  return (
    <header className="dhead brd d-only">
      <span className="logo" aria-hidden="true">
        <IconWheel />
      </span>
      <span className="ah-brand">SPELVÄRDE</span>
      <nav className="dnav" aria-label="Huvudmeny">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} aria-current={n.match(pathname) ? "page" : undefined}>
            {n.label}
            {n.href === "/" && stale && <span className="ndot" role="img" aria-label="ändringar väntar på att sparas" />}
          </Link>
        ))}
      </nav>
      {meta && <div className="dmeta">{meta}</div>}
    </header>
  );
}
