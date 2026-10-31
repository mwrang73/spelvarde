// Små delar av tavlan och listorna (DESIGN.md, Komponenter): FlapNumber,
// Badge, FormStrip, LampToggle, Banner, EmptyState och Skeleton.

import { odds } from "@/lib/format";
import type { FormBox } from "@/lib/gallop";
import { MANY_SIGNALS } from "@/lib/positive-signals";
import type { PostEdge } from "@/lib/post-edge";
import type { Override } from "@/lib/spelbar";
import { IconCheck, IconCheckThin, IconInfo, IconOffline, IconTicket, IconWarn, IconX } from "./icons";
import { WandSpark } from "./WandSpark";

const EDGE_TEXT: Record<PostEdge, string> = { v: "V", p: "P", vp: "V+P" };

// Brickan i löptext, så att statistikraden förklarar märket på startnumret.
export function EdgeKey({ edge }: { edge: PostEdge }) {
  return (
    <i className={`spb spk ${edge}`} aria-hidden="true">
      {EDGE_TEXT[edge]}
    </i>
  );
}

// ---- FlapNumber -----------------------------------------------------------------------

// signals = antal positiva signaler (lib/positive-signals.ts): en bricka i
// nedre hörnet, grön ring för 1–4 och fylld grön för 5 eller fler. Brickan är
// dold för skärmläsare; raden säger antalet i text.
// edge = spårfördel (lib/post-edge.ts): en bricka i övre hörnet.
export function FlapNumber({ n, size = "md", index, placed, signals, edge }: { n: number | string; size?: "sm" | "md" | "lg"; index?: number; placed?: boolean; signals?: number | null; edge?: PostEdge | null }) {
  const style = index !== undefined ? ({ "--i": Math.min(index, 12) } as React.CSSProperties) : undefined;
  return (
    <span className={`nr${size === "md" ? "" : ` ${size}`}${placed ? " pl" : ""}`} style={style} aria-hidden="true">
      <b>{n}</b>
      {signals ? <i className={`sigb${signals >= MANY_SIGNALS ? " many" : ""}`}>{signals}</i> : null}
      {edge ? <i className={`spb ${edge}`}>{EDGE_TEXT[edge]}</i> : null}
    </span>
  );
}

// Märket "Lågt streck": minst 4 positiva signaler men inte bland loppets 3 mest streckade.
export function LowStreckTag() {
  return (
    <span className="tag good lowst" title="Minst 4 positiva signaler men inte bland loppets 3 mest streckade. Topp 3 i 25–26 % mot strecket 20 % i backtestet.">
      Lågt streck
    </span>
  );
}

// Skärmläsartext för antalet signaler.
export const signalsSr = (n: number | null | undefined) => (n ? `, ${n} positiva signaler${n >= MANY_SIGNALS ? ", många" : ""}` : "");

// ---- Badge ------------------------------------------------------------------------------

const BADGE = {
  i: { short: "I", wide: "Intressant", label: "Intressant" },
  s: { short: "S", wide: "Spelbar", label: "Spelbar" },
  b: { short: "B", wide: "Bet", label: "Bet" },
  g: { short: "G", wide: "Galopp", label: "Galoppvarning: galopp i de 5 senaste starterna" },
  gd: { short: "GD", wide: "Galopp diskad", label: "Galoppvarning: galopp med diskning i de 5 senaste starterna" },
  // X-faktor (E2.1, 6.8): "lysande" tavelstil.
  x: { short: "X", wide: "Tror på", label: "X-faktor: Tror på" },
  xp: { short: "X+", wide: "Stark känsla", label: "X-faktor: Stark känsla" },
} as const;

export function Badge({ kind, wide }: { kind: keyof typeof BADGE; wide?: boolean }) {
  const b = BADGE[kind];
  return (
    <span className={`bdg ${kind}${wide ? " wide" : ""}`} role="img" aria-label={b.label}>
      {wide ? b.wide : b.short}
    </span>
  );
}

// Bet som biljett med oddset du fick ("B 2,40"), alternativ A i mockupen
// markeringar-live. Utan Bet-odds bara "B".
export function BetBadge({ odds: o }: { odds: number | null | undefined }) {
  return (
    <span className="tkt" role="img" aria-label={o != null ? `Bet, spelad till ${odds(o)}` : "Bet"}>
      B{o != null && <b>{odds(o)}</b>}
    </span>
  );
}

// E8 Live: Bet som rak biljett med hack, "BET 2,40". Dagens BetBadge används kvar i övriga vyer.
export function BetTicket({ odds: o }: { odds: number | null | undefined }) {
  return (
    <span className="tk" role="img" aria-label={o != null ? `Bet, spelad till ${odds(o)}` : "Bet"}>
      BET{o != null && <b>{odds(o)}</b>}
    </span>
  );
}

// E8 Live: inlämnad rad som rund pill. hit = hästen vann loppet ("✓ RAD").
export function RadPill({ hit }: { hit?: boolean }) {
  return (
    <span className={`rad${hit ? " hit" : ""}`} role="img" aria-label={hit ? "Med i din inlämnade rad, vann loppet" : "Med i din inlämnade rad"}>
      {hit ? "✓ RAD" : "RAD"}
    </span>
  );
}

// Träff eller Miss: ord och ikon, aldrig bara färg.
export function Verdict({ hit }: { hit: boolean }) {
  return (
    <span className={`vd ${hit ? "y" : "n"}`} role="img" aria-label={hit ? "Träff" : "Miss"}>
      {hit ? <IconCheck /> : <IconX />}
      {hit ? "Träff" : "Miss"}
    </span>
  );
}

// X-märket efter S och B. Inget märke för Ingen.
export function XBadge({ x, wide }: { x: "NONE" | "TROR" | "STARK" | undefined; wide?: boolean }) {
  if (!x || x === "NONE") return null;
  return <Badge kind={x === "STARK" ? "xp" : "x"} wide={wide} />;
}

// Trollspöt-märket (e4a avsnitt 18): samma trollspö som fliken Trollspöt.
export function TrollBadge({ rank }: { rank?: number }) {
  return (
    <>
      <span className="bdg tsb" role="img" aria-label={rank ? `Trollspöt, plats ${rank}` : "Trollspöt"} title="Trollspöt">
        <WandSpark />
      </span>
      {rank ? (
        <span className="trk" aria-hidden="true">
          #{rank}
        </span>
      ) : null}
    </>
  );
}

export function GallopBadge({ flag }: { flag: "G" | "GD" | null }) {
  if (!flag) return null;
  return <Badge kind={flag === "GD" ? "gd" : "g"} />;
}

// ---- FormStrip ----------------------------------------------------------------------

export function FormStrip({ boxes, ariaLabel, large }: { boxes: FormBox[]; ariaLabel: string; large?: boolean }) {
  const cells = [...boxes.slice(0, 5)];
  const empty = Math.max(0, 5 - cells.length);
  const label = empty && boxes.length ? `${ariaLabel}. Bara ${boxes.length} tidigare ${boxes.length === 1 ? "start" : "starter"}` : ariaLabel;
  return (
    <span className={`form${large ? " lg" : ""}`} role="img" aria-label={label}>
      {cells.map((b, i) => (
        <i key={i} className={b.tone === "win" ? "w" : b.tone === "second" ? "w2" : b.tone === "gal" ? "gx" : undefined} aria-hidden="true">
          {b.char}
        </i>
      ))}
      {Array.from({ length: empty }, (_, i) => (
        <i key={`e${i}`} className="e" aria-hidden="true" />
      ))}
    </span>
  );
}

// ---- LampToggle -------------------------------------------------------------------------

export function LampToggle({
  on,
  horseName,
  labeled,
  disabledReason,
  onToggle,
  tabIndex,
}: {
  on: boolean;
  horseName: string;
  labeled?: boolean;
  // Satt = avstängd med aria-disabled och tooltip (t.ex. "Loppet har startat").
  disabledReason?: string | null;
  onToggle: () => void;
  tabIndex?: number;
}) {
  const disabled = !!disabledReason;
  return (
    <button
      type="button"
      className={`lamp${labeled ? " lab" : ""}`}
      aria-pressed={on}
      aria-label={labeled ? undefined : `Intressant: ${horseName}`}
      aria-disabled={disabled || undefined}
      title={disabledReason ?? undefined}
      tabIndex={tabIndex}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onToggle();
      }}
    >
      <span className="lamp-i" aria-hidden="true">
        <IconCheck />
      </span>
      {labeled && <span>Intressant</span>}
      {disabled && !labeled && <span className="sr">, {disabledReason}</span>}
    </button>
  );
}

// ---- BetToggle ---------------------------------------------------------------------------

// Samma tangent som lampan, med biljettikon. Tänd tangent är inverterad (--bet).
export function BetToggle({
  on,
  horseName,
  labeled,
  betOdds,
  disabledReason,
  onToggle,
}: {
  on: boolean;
  horseName: string;
  labeled?: boolean;
  // Med etikett och tänd: "Bet 2,40" (oddset du fick).
  betOdds?: number | null;
  disabledReason?: string | null;
  onToggle: () => void;
}) {
  const disabled = !!disabledReason;
  return (
    <button
      type="button"
      className={`betk${labeled ? " lab" : ""}`}
      aria-pressed={on}
      aria-label={labeled ? undefined : `Bet: ${horseName}`}
      aria-disabled={disabled || undefined}
      title={disabledReason ?? undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onToggle();
      }}
    >
      <span className="lamp-i" aria-hidden="true">
        <IconTicket />
      </span>
      {labeled && (
        <span>
          Bet{on && betOdds != null && <b className="num"> {odds(betOdds)}</b>}
        </span>
      )}
      {disabled && !labeled && <span className="sr">, {disabledReason}</span>}
    </button>
  );
}

// ---- SpelbarToggle -----------------------------------------------------------------------

export function spelbarOrigin(on: boolean, override: Override): string {
  if (override === "ON") return "Satt av dig";
  if (override === "OFF") return "Borttagen av dig";
  return on ? "Förslag" : "Inte föreslagen";
}

// Chip med "S Spelbar" och ursprunget som underrad (Förslag, Satt av dig,
// Borttagen av dig).
export function SpelbarToggle({
  on,
  override,
  id,
  disabledReason,
  onToggle,
  bare,
}: {
  on: boolean;
  override: Override;
  id: string;
  disabledReason?: string | null;
  onToggle: () => void;
  // Utan ursprungsraden under (analysvyns valrad och knapplist). Ursprunget
  // ska då finnas med id `${id}-o` på annan plats (aria-describedby).
  bare?: boolean;
}) {
  const disabled = !!disabledReason;
  const button = (
      <button
        type="button"
        className="sptg"
        aria-pressed={on}
        aria-describedby={`${id}-o`}
        aria-disabled={disabled || undefined}
        title={disabledReason ?? undefined}
        onClick={() => {
          if (!disabled) onToggle();
        }}
      >
        <span className="bdg s" aria-hidden="true">
          S
        </span>
        Spelbar
      </button>
  );
  if (bare) return button;
  return (
    <span className="sp-wrap">
      {button}
      <span className="sp-orig" id={`${id}-o`}>
        {spelbarOrigin(on, override)}
      </span>
    </span>
  );
}

// ---- Banner -------------------------------------------------------------------------------

export function Banner({
  tone = "info",
  icon,
  children,
  actions,
  className,
  role,
  after,
  onClose,
}: {
  tone?: "info" | "ok" | "warn" | "err";
  icon?: "offline" | "check" | "warn" | "info";
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  role?: "alert" | "status";
  // Innehåll under handlingarna (t.ex. listan i "Visa vilka").
  after?: React.ReactNode;
  // Stängknappen × (44 × 44, "Stäng").
  onClose?: () => void;
}) {
  const Ic = icon === "offline" ? IconOffline : icon === "check" || tone === "ok" ? IconCheckThin : tone === "info" && icon !== "warn" ? IconInfo : IconWarn;
  return (
    <div className={`ban ${tone}${className ? ` ${className}` : ""}`} role={role}>
      <Ic />
      <div className="ban-b">
        <p>{children}</p>
        {actions && <div className="acts">{actions}</div>}
        {after}
      </div>
      {onClose && (
        <button type="button" className="x" aria-label="Stäng" onClick={onClose}>
          <IconX />
        </button>
      )}
    </div>
  );
}

// ---- EmptyState -------------------------------------------------------------------------

export function EmptyState({ icon, title, text, children }: { icon: React.ReactNode; title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="ic brd" aria-hidden="true">
        {icon}
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  );
}

// ---- Skeleton -------------------------------------------------------------------------------

export function Skeleton({ width, height }: { width?: string; height?: number }) {
  return <span className="sk" style={{ width, height }} aria-hidden="true" />;
}
