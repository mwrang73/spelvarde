// Små delar av tavlan och listorna (DESIGN.md, Komponenter): FlapNumber,
// Badge, FormStrip, LampToggle, Banner, EmptyState och Skeleton.

import type { FormBox } from "@/lib/gallop";
import { IconCheck, IconCheckThin, IconInfo, IconOffline, IconWarn } from "./icons";

// ---- FlapNumber -----------------------------------------------------------------------

export function FlapNumber({ n, size = "md", index, placed }: { n: number | string; size?: "sm" | "md" | "lg"; index?: number; placed?: boolean }) {
  const style = index !== undefined ? ({ "--i": Math.min(index, 12) } as React.CSSProperties) : undefined;
  return (
    <span className={`nr${size === "md" ? "" : ` ${size}`}${placed ? " pl" : ""}`} style={style} aria-hidden="true">
      <b>{n}</b>
    </span>
  );
}

// ---- Badge ------------------------------------------------------------------------------

const BADGE = {
  i: { short: "I", wide: "Intressant", label: "Intressant" },
  s: { short: "S", wide: "Spelbar", label: "Spelbar" },
  b: { short: "B", wide: "Bet", label: "Bet" },
  g: { short: "G", wide: "Galopp", label: "Galoppvarning: galopp i de 5 senaste starterna" },
  gd: { short: "GD", wide: "Galopp diskad", label: "Galoppvarning: galopp med diskning i de 5 senaste starterna" },
} as const;

export function Badge({ kind, wide }: { kind: keyof typeof BADGE; wide?: boolean }) {
  const b = BADGE[kind];
  return (
    <span className={`bdg ${kind}${wide ? " wide" : ""}`} role="img" aria-label={b.label}>
      {wide ? b.wide : b.short}
    </span>
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
        <i key={i} className={b.tone === "win" ? "w" : b.tone === "gal" ? "gx" : undefined} aria-hidden="true">
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

// ---- Banner -------------------------------------------------------------------------------

export function Banner({
  tone = "info",
  icon,
  children,
  actions,
  className,
  role,
}: {
  tone?: "info" | "ok" | "warn" | "err";
  icon?: "offline" | "check" | "warn" | "info";
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  const Ic = icon === "offline" ? IconOffline : icon === "check" || tone === "ok" ? IconCheckThin : tone === "info" && icon !== "warn" ? IconInfo : IconWarn;
  return (
    <div className={`ban ${tone}${className ? ` ${className}` : ""}`} role={role}>
      <Ic />
      <div>
        <p>{children}</p>
        {actions && <div className="acts">{actions}</div>}
      </div>
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
