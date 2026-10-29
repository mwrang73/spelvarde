"use client";

// Vyrubriken på tavlan (DESIGN.md AppHeader). I mobilen: tillbaka eller
// logga, titel (h1), underrad och högst två ikonknappar. På desktop:
// toppmeny med Omgång, Källor och Statistik, och en titelrad under.
//
// Analysvyn (docs/specs/analysvy-layout.md 4.4, 7): tillbaka visas som pil
// med text (BackLink), och hästkortet i mobilen har gruppen ‹ › (horseNav)
// längst till höger. Pil + text betyder tillbaka, två chevroner betyder byt häst.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { forwardRef } from "react";
import { useOutboxStale } from "@/components/outbox/OutboxProvider";
import { IconArrowLeft, IconBack, IconChev, IconWheel } from "@/components/ui/icons";

// Omgång leder till omgången du är i (/omgang/{id}) från alla vyer under
// den, annars till aktuell omgång (/).
const roundHref = (p: string) => /^\/omgang\/[^/]+/.exec(p)?.[0] ?? "/";

export const NAV = [
  { href: "/", label: "Omgång", match: (p: string) => p === "/" || p.startsWith("/omgang") || p.startsWith("/installningar"), hrefFor: roundHref },
  { href: "/kallor", label: "Källor", match: (p: string) => p.startsWith("/kallor"), hrefFor: () => "/kallor" },
  { href: "/statistik", label: "Statistik", match: (p: string) => p.startsWith("/statistik"), hrefFor: () => "/statistik" },
] as const;

// text = synlig text bredvid pilen ("Avd 5", "Omgång"). Utan text visas
// den gamla ikonknappen (övriga vyer).
export type HeaderBack = { href: string; label: string; text?: string; onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void };

export type HorseNavTarget = { label: string; onGo: () => void };
export type HorseNav = { prev: HorseNavTarget | null; next: HorseNavTarget | null };

export function BackLink({ back }: { back: HeaderBack }) {
  return (
    <Link className="btn backl" href={back.href} aria-label={back.label} onClick={back.onClick}>
      <IconArrowLeft />
      <span aria-hidden="true">{back.text}</span>
    </Link>
  );
}

// ‹ › i hästkortets rubrik (7.2). Knapparna stängs av vid första och sista hästen.
export function HorseNavButtons({ nav, className }: { nav: HorseNav; className?: string }) {
  return (
    <div className={`hnav${className ? ` ${className}` : ""}`} role="group" aria-label="Byt häst">
      <button type="button" className="hnb" aria-label={nav.prev ? `Föregående häst: ${nav.prev.label}` : "Föregående häst"} disabled={!nav.prev} onClick={() => nav.prev?.onGo()}>
        <IconBack />
      </button>
      <button type="button" className="hnb" aria-label={nav.next ? `Nästa häst: ${nav.next.label}` : "Nästa häst"} disabled={!nav.next} onClick={() => nav.next?.onGo()}>
        <IconChev />
      </button>
    </div>
  );
}

type Props = {
  title: React.ReactNode;
  sub?: React.ReactNode;
  // Logga i stället för tillbaka (S1, Källor).
  brand?: boolean;
  back?: HeaderBack;
  actions?: React.ReactNode;
  deskMeta?: React.ReactNode;
  // false: vyn har sin egen h1 på desktop (S2:s loppruta).
  deskTitle?: boolean;
  // Tavelknappen Hämta streck och odds (E2.2, S1–S4): i mobilen före
  // ikonknapparna, på desktop i toppmenyn till höger.
  refresh?: React.ReactNode;
  // Hästkortet i mobilen (5.2 A): fällbladsrutan före namnet och ‹ › till höger.
  lead?: React.ReactNode;
  horseNav?: HorseNav;
};

// ref = mobilens h1 (fokusmålet när hästkortet öppnas).
export const AppHeader = forwardRef<HTMLHeadingElement, Props>(function AppHeader({ title, sub, brand, back, actions, deskMeta, deskTitle = true, refresh, lead, horseNav }, ref) {
  return (
    <>
      <header className={`ah brd m-only${horseNav ? " mhd" : ""}`}>
        {back ? (
          back.text ? (
            <BackLink back={back} />
          ) : (
            <Link className="btn icon" href={back.href} aria-label={back.label} onClick={back.onClick}>
              <IconBack />
            </Link>
          )
        ) : (
          <span className="logo" aria-hidden="true">
            <IconWheel />
          </span>
        )}
        {lead}
        <div className="ah-t">
          {brand ? (
            <h1 className="ah-brand">
              SPELVÄRDE<span className="sr"> – {title}</span>
            </h1>
          ) : (
            <h1 className="ah-title" ref={ref} tabIndex={ref ? -1 : undefined}>
              {title}
            </h1>
          )}
          {sub && <span className="ah-sub">{sub}</span>}
        </div>
        {refresh}
        {actions}
        {horseNav && <HorseNavButtons nav={horseNav} />}
      </header>
      <DeskHeader meta={deskMeta} refresh={refresh} />
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
});

function DeskHeader({ meta, refresh }: { meta?: React.ReactNode; refresh?: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const stale = useOutboxStale();
  return (
    <header className="dhead brd d-only">
      <span className="dbrand">
        <span className="logo" aria-hidden="true">
          <IconWheel />
        </span>
        <span className="ah-brand">SPELVÄRDE</span>
      </span>
      <nav className="dnav" aria-label="Huvudmeny">
        {NAV.map((n) => (
          <Link key={n.href} href={n.hrefFor(pathname)} aria-current={n.match(pathname) ? "page" : undefined}>
            {n.label}
            {n.href === "/" && stale && <span className="ndot" role="img" aria-label="ändringar väntar på att sparas" />}
          </Link>
        ))}
      </nav>
      {meta ? <div className="dmeta">{meta}</div> : <span />}
      {refresh ?? <span />}
    </header>
  );
}
