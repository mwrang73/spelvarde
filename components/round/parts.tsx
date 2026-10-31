"use client";

// Delar som flera vyer i omgången använder: PhaseRail, RaceTabs,
// räknarna I/S/B, märkena och riktoddset i raderna och länkarna till S4/S6.

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Badge, BetBadge, TrollBadge, XBadge } from "@/components/ui/board";
import { IconChev, IconList, IconOdds } from "@/components/ui/icons";
import { hhmm, odds, shortRaceName } from "@/lib/format";
import { liveTabs, type TabTags } from "@/lib/live-view";
import type { PhaseStep } from "@/lib/phase";
import type { RaceDto, StartDto, StartOutcomeDto } from "@/lib/types";
import type { XFactor } from "@/lib/xfactor";
import { riktLabel, riktX, xOf } from "@/lib/xfactor-ui";
import { WandSpark } from "@/components/ui/WandSpark";
import { legName } from "@/lib/game-type";

// ---- PhaseRail --------------------------------------------------------------------------

// Rutorna är länkar till fasens vy. Klart är vanlig text.
// variant "seg" (analysvyn 3.2): segmentkontroll i zonraden, aktiv fas i bärnsten.
// activePage (E8 3.4): sidan du står på lyser med aria-current="page", och
// automatikens ruta är inte tänd. Utan activePage gäller automatiken ("step").
export type PhasePage = "ANALYS" | "ODDS" | "LIVE";

export function PhaseRail({ steps, analysHref, oddsHref, liveHref, activePage, className, variant = "rail" }: { steps: PhaseStep[]; analysHref: string; oddsHref?: string; liveHref?: string; activePage?: PhasePage; className?: string; variant?: "rail" | "seg" }) {
  const hrefOf = (s: PhaseStep) => (s.phase === "ANALYS" ? analysHref : s.phase === "ODDS" ? oddsHref : s.phase === "LIVE" ? liveHref : undefined);
  const currentOf = (s: PhaseStep): "page" | "step" | undefined => (activePage ? (s.phase === activePage ? "page" : undefined) : s.state === "current" ? "step" : undefined);
  const inner = (s: PhaseStep) => (
    <>
      <b>
        {s.state === "done" && <span aria-hidden="true">✓ </span>}
        {s.label}
      </b>
      <small>{s.dayLabel}</small>
      {s.state === "done" && <span className="sr">, klar</span>}
    </>
  );
  if (variant === "seg")
    return (
      <nav className={`seg nav phseg${className ? ` ${className}` : ""}`} aria-label="Veckans faser">
        {steps.map((s) => {
          const href = hrefOf(s);
          const cls = s.state === "done" ? "done" : undefined;
          if (href)
            return (
              <Link key={s.phase} href={href} aria-current={currentOf(s)} className={cls}>
                {inner(s)}
              </Link>
            );
          return (
            <span key={s.phase} aria-current={currentOf(s)} className={cls}>
              {inner(s)}
            </span>
          );
        })}
      </nav>
    );
  return (
    <ol className={`phase brd${className ? ` ${className}` : ""}`} aria-label="Veckans faser">
      {steps.map((s) => {
        const href = hrefOf(s);
        return (
          <li key={s.phase} className={s.state === "done" ? "done" : undefined} aria-current={currentOf(s)}>
            {href ? <Link href={href}>{inner(s)}</Link> : <span>{inner(s)}</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function firstTodoLeg(races: RaceDto[]): number {
  return races.find((r) => !r.reviewed)?.leg ?? 1;
}

// ---- RaceTabs ---------------------------------------------------------------------------

// Mobilens avdelningsknapp: kort namn utan "STL ", högst 14 tecken.
function tabName(name: string): string {
  const n = shortRaceName(name).replace(/^STL\s+/i, "");
  return n.length > 14 ? `${n.slice(0, 13).trimEnd()}…` : n;
}

function tabLabel(r: RaceDto, gameType: string): string {
  const parts = [`${legName(gameType, r.leg)}`, shortRaceName(r.name), hhmm(r.startAt)];
  if (r.cancelled) parts.push("inställd");
  else parts.push(`${r.counts.interesting} ${r.counts.interesting === 1 ? "intressant" : "intressanta"}`);
  if (r.reviewed) parts.push("genomgången");
  return parts.join(", ");
}

// variant: "flaps" = dagens fällbladsrutor, "band" = zonraden på desktop
// (analysvyn 3.2), "scroll" = mobilens svepbara rad med namn (5.1), "live" =
// Live (E8 5.2). I "live" säger raden aldrig något om resultatet. compact = svepbar rad.
export function RaceTabs({ gameType, races, selected, onSelect, panelId, variant = "flaps", tagged, now, compact }: { gameType: string; races: RaceDto[]; selected: number; onSelect: (leg: number) => void; panelId: string; variant?: "flaps" | "band" | "scroll" | "live"; tagged?: Record<number, TabTags>; now?: number; compact?: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (to: number) => {
    const leg = Math.max(1, Math.min(races.length, to));
    onSelect(leg);
    refs.current[leg - 1]?.focus();
  };
  // Mobilen: vald knapp scrollas in i raden när avdelningen byts.
  useEffect(() => {
    if (variant !== "scroll" && !(variant === "live" && compact)) return;
    refs.current[selected - 1]?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [variant, compact, selected]);
  const cls = variant === "live" ? (compact ? "mavs brd" : "ltabs") : variant === "band" ? "seg nav avt" : variant === "scroll" ? "mavs brd" : "avd brd";
  const live = variant === "live" ? liveTabs(gameType, races, tagged ?? {}, now ?? Date.now()) : null;
  return (
    <div
      className={cls}
      role="tablist"
      aria-label="Lopp"
      style={live && !compact ? ({ "--n": races.length } as React.CSSProperties) : undefined}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") move(selected + 1);
        else if (e.key === "ArrowLeft") move(selected - 1);
        else if (e.key === "Home") move(1);
        else if (e.key === "End") move(races.length);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {races.map((r, i) => {
        const on = r.leg === selected;
        const common = {
          ref: (el: HTMLButtonElement | null) => {
            refs.current[i] = el;
          },
          type: "button" as const,
          role: "tab",
          id: `tab-${r.leg}`,
          "aria-selected": on,
          "aria-controls": panelId,
          tabIndex: on ? 0 : -1,
          onClick: () => onSelect(r.leg),
        };
        const lt = live?.[i];
        if (lt)
          return (
            <button key={r.id} {...common} className={`${compact ? "" : "lt"}${r.cancelled ? " off" : ""}`.trim() || undefined} aria-label={lt.label}>
              <span className="nr sm" aria-hidden="true">
                <b>{r.leg}</b>
              </span>
              <span className={compact ? "mavs-t" : "lx"} aria-hidden="true">
                <b className={compact ? "mavs-n" : undefined}>
                  {lt.name}
                  {lt.running && <i className="pulse" />}
                  {lt.bet && <span className="ltb">B</span>}
                </b>
                <small className="num">
                  {lt.cancelled ? "Inställt" : lt.time}
                  {lt.count && ` ${lt.count}`}
                </small>
              </span>
            </button>
          );
        if (variant === "band")
          return (
            <button key={r.id} {...common} className={r.cancelled ? "off" : undefined} aria-label={tabLabel(r, gameType)} title={r.cancelled ? `${shortRaceName(r.name)} inställd` : undefined}>
              <span className="nr sm" aria-hidden="true">
                <b>{r.leg}</b>
              </span>
              {r.counts.interesting > 0 || !r.reviewed ? (
                <span className="cnt" aria-hidden="true">
                  <span className="bdg i">I</span>
                  <span className="num">{r.counts.interesting}</span>
                </span>
              ) : (
                <span className="tck" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          );
        if (variant === "scroll")
          return (
            <button key={r.id} {...common} className={r.cancelled ? "off" : undefined} aria-label={tabLabel(r, gameType)}>
              <span className="nr sm" aria-hidden="true">
                <b>{r.leg}</b>
              </span>
              <span className="mavs-t" aria-hidden="true">
                <span className="mavs-n">{tabName(r.name)}</span>
                <small className="num">
                  {hhmm(r.startAt)}
                  <span className="mavs-i"> · I {r.counts.interesting}</span>
                </small>
              </span>
            </button>
          );
        return (
          <button key={r.id} {...common} className="avd-t" aria-label={`${legName(gameType, r.leg)}, ${shortRaceName(r.name)}${r.reviewed ? ", genomgången" : ""}`}>
            {r.leg}
            {r.reviewed && (
              <span className="tick" aria-hidden="true">
                ✓
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---- Räknare ---------------------------------------------------------------------------

// I, S och B per avdelning. Noll visas dämpat.
export function Counts({ interesting, spelbar, bet }: { interesting: number; spelbar: number; bet: number }) {
  const one = (kind: "i" | "s" | "b", n: number, label: string) => (
    <span className={n ? undefined : "dim"}>
      <span className={`bdg ${kind}`} aria-hidden="true">
        {kind.toUpperCase()}
      </span>
      <span className="num">{n}</span>
      <span className="sr"> {label}</span>
    </span>
  );
  return (
    <span className="cnt">
      {one("i", interesting, interesting === 1 ? "intressant" : "intressanta")}
      {one("s", spelbar, "spelbara")}
      {one("b", bet, "med Bet")}
    </span>
  );
}

// Märkena S, B och X/X+ efter hästnamnet (I syns som kant och namnfärg).
export function MarkBadges({ s }: { s: StartDto }) {
  return (
    <>
      {s.mark?.spelbar && <Badge kind="s" />}
      {s.mark?.bet && <BetBadge odds={s.mark.betOdds} />}
      <XBadge x={xOf(s.mark)} />
    </>
  );
}

// Märkena I, S, B och X ur de frysta värdena (E4a, resultatvyn), och
// Trollspöt-märket när hästen var i Trollspöt vid start.
export function OutcomeBadges({ o, betOdds }: { o: StartOutcomeDto | null; betOdds?: number | null }) {
  if (!o) return null;
  return (
    <>
      {o.interesting && <Badge kind="i" />}
      {o.spelbar && <Badge kind="s" />}
      {o.bet && <BetBadge odds={betOdds} />}
      <XBadge x={o.xFactor} />
      {o.trollspotRank !== null && <TrollBadge />}
    </>
  );
}

// Riktoddset i raderna, "osäkert" med asterisk (S2, Lägen). Med X-faktor
// (6.8) visas riktoddset med X-faktor i --accent (X-märket står i samma rad).
// two = desktop: två rader i cellen, med "3,00 utan X" under.
export function RiktCell({ s, className = "rk num", two }: { s: StartDto; className?: string; two?: boolean }) {
  if (s.riktodds === null || s.scratched)
    return (
      <span className={className}>
        –<span className="sr"> riktodds saknas</span>
      </span>
    );
  const x = xOf(s.mark);
  const rx = riktX(s);
  const withX = x !== "NONE" && rx !== null;
  const text = odds(withX ? rx : s.riktodds);
  const unc = s.uncertain && (
    <>
      <sup aria-hidden="true">*</sup>
      <span className="sr">, osäkert</span>
    </>
  );
  if (!withX)
    return (
      <span className={`${className}${text.length > 4 ? " w" : ""}`} title={s.uncertain ? "Osäkert riktodds" : undefined}>
        <span className="sr">Riktodds </span>
        {text}
        {unc}
      </span>
    );
  const label = riktLabel(s.riktodds, x, rx);
  return (
    <span className={`${className} x${text.length > 4 ? " w" : ""}${two ? " two" : ""}`} title={`${label}${s.uncertain ? " (osäkert)" : ""}`}>
      <span className="sr">{label}</span>
      <span className="rkx" aria-hidden="true">
        {text}
      </span>
      {unc}
      {two && (
        <span className="rk0" aria-hidden="true">
          {odds(s.riktodds)} utan X
        </span>
      )}
    </span>
  );
}

// Kort form i sammanfattningsarket (S4) och S6a mobil: "rikt 3,00 → X 2,40"
// med siffrorna i fetstil (texten är riktShort i lib/xfactor-ui.ts).
export function RiktShort({ riktodds, x, rx }: { riktodds: number | null; x: XFactor; rx: number | null }) {
  const withX = x !== "NONE" && riktodds !== null && rx !== null;
  return (
    <span className="rshort">
      rikt <b>{odds(riktodds)}</b>
      {withX && (
        <>
          {" → X "}
          <b className="rkx">{odds(rx)}</b>
        </>
      )}
    </span>
  );
}

// Länkar till S4 och S6 (navigeringen inom omgången).
// analysis = omgången är klar: Efteranalys först.
// variant "row" (analysvyn 3.2): knappar i zonraden, Trollspöt som primär.
export function RoundLinks({ roundId, className, analysis, variant = "grid" }: { roundId: string; className?: string; analysis?: boolean; variant?: "grid" | "row" }) {
  if (variant === "row")
    return (
      <nav className={`tools${className ? ` ${className}` : ""}`} aria-label="Odds och spel">
        {analysis && (
          <Link className="btn secondary" href={`/omgang/${roundId}/analys`}>
            Efteranalys
          </Link>
        )}
        <Link className="btn primary" href={`/omgang/${roundId}/spel?flik=trollspot`} title="10 hästar att bevaka">
          <WandSpark />
          <span>Trollspöt</span>
        </Link>
        <Link className="btn secondary" href={`/omgang/${roundId}/odds`}>
          <IconOdds />
          <span>Unibets odds</span>
        </Link>
        <Link className="btn secondary" href={`/omgang/${roundId}/spel?flik=plats`}>
          <IconList />
          <span>Spelförslag</span>
        </Link>
      </nav>
    );
  return (
    <nav className={`qlinks${className ? ` ${className}` : ""}`} aria-label="Odds och spel">
      {analysis && (
        <Link className="qlink" href={`/omgang/${roundId}/analys`}>
          <span>Efteranalys</span>
          <IconChev />
        </Link>
      )}
      <Link className="qlink troll-link" href={`/omgang/${roundId}/spel?flik=trollspot`} title="10 hästar att bevaka">
        <WandSpark />
        <span>Trollspöt</span>
        <IconChev />
      </Link>
      <Link className="qlink" href={`/omgang/${roundId}/odds`}>
        <span>Unibets odds</span>
        <IconChev />
      </Link>
      <Link className="qlink" href={`/omgang/${roundId}/spel?flik=plats`}>
        <span>Spelförslag</span>
        <IconChev />
      </Link>
    </nav>
  );
}
