// Ett kort per avdelning i V85-raden (E6 S6b, "Avdelningskortet"; E6b 5.4):
// rubriken med typtaggen och pennan, de valda hästarna med skälen som taggar,
// nummerrutorna när det prioriterade loppet har alla hästar (ALLG),
// varför-raden och spärrraden.

import { forwardRef } from "react";
import { Badge, BetBadge, FlapNumber, XBadge } from "@/components/ui/board";
import { IconLock, IconPen } from "@/components/ui/icons";
import { hhmm } from "@/lib/format";
import type { TippaHorse, TippaLegResult, TippaResult } from "@/lib/tippa";
import { boldParts, favOutText, legSubline, legTypeLabel, legWhy, legWhyStarted, pctText, reasonClass, reasonLabel, riktText } from "@/lib/tippa-text";
import type { LegRoleDto, ReasonCode } from "@/lib/types";
import { legName } from "@/lib/game-type";

// Text med **fetstil** som <b>. Procent får hårt mellanslag ("16,4 %" bryts inte).
export function Bold({ text }: { text: string }) {
  return (
    <>
      {boldParts(text.replace(/ %/g, "\u00a0%")).map((p, i) => (p.bold ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}
    </>
  );
}

// Skälen som taggar (.rs) i fast ordning. extra = gränssnittets taggar först
// ("Ny") eller sist ("Spärr", "Appens spik nu").
export function ReasonTags({ codes, before, after }: { codes: ReasonCode[]; before?: React.ReactNode; after?: React.ReactNode }) {
  if (!codes.length && !before && !after) return null;
  return (
    <span className="rsn">
      {before}
      {codes.map((c) => (
        <span key={c} className={`rs ${reasonClass(c)}`}>
          {reasonLabel(c)}
        </span>
      ))}
      {after}
    </span>
  );
}

// Märkena efter namnet: S (annars I), X och Bet-biljetten.
export function HorseMarks({ h }: { h: Pick<TippaHorse, "spelbar" | "interesting" | "xFactor" | "bet" | "betOdds"> }) {
  return (
    <>
      {h.spelbar ? <Badge kind="s" /> : h.interesting ? <Badge kind="i" /> : null}
      <XBadge x={h.xFactor} />
      {h.bet && <BetBadge odds={h.betOdds} />}
    </>
  );
}

// Strecket till höger: "22,4 %", preliminär "–" och "rikt 1,75".
export function StreckCell({ h, prelim }: { h: Pick<TippaHorse, "streck" | "riktX">; prelim: boolean }) {
  return (
    <span className="lst num">
      <span className="sr">Streck </span>
      {prelim ? "–" : pctText(h.streck)}
      {prelim && <small>rikt {riktText(h.riktX)}</small>}
    </span>
  );
}

export type CardMode = "live" | "legacy" | "started";

type Props = {
  l: TippaLegResult;
  r: TippaResult;
  mode: CardMode;
  // Alla startnummer i loppet (allgarderingens rutor).
  all: number[];
  // Efter spelstopp: sparat tak (null = Alla), för varför-raden i ett prioriterat lopp.
  cap?: number | null;
  // Strukna hästar som visas medan strykningsbanderollen står kvar.
  struck?: { number: number; name: string }[];
  // Hästar som kom med efter en strykning (.lh.new).
  fresh?: number[];
  // Sparade skäl efter spelstopp (legRoles).
  role?: LegRoleDto;
  onEdit?: () => void;
};

export const RadLegCard = forwardRef<HTMLButtonElement, Props>(function RadLegCard({ l, r, mode, all, cap = null, struck = [], fresh = [], role, onEdit }, penRef) {
  const id = `rad-lg-${l.leg}`;
  const started = mode === "started";
  const kind = started ? (role?.k ?? null) : mode === "legacy" ? null : l.kind;
  // Nummerrutorna bara när alla löpande är med. En rad från före E6b kan ha
  // sparats som ALLG fast allgarderingen tappade hästar: då hästraderna.
  const runners = l.field.map((h) => h.number);
  const coversAll = runners.length > 0 && runners.every((n) => l.selection.includes(n));
  const isAllg = kind === "ALLG" && (!started || coversAll);
  const startedKind = started && kind === "ALLG" && !isAllg ? "PRIO" : (role?.k ?? undefined);
  const lr = (() => {
    if (started) return <span className="lr">Startat</span>;
    if (mode === "legacy") return <span className="lr">{l.selection.length === 1 ? "1 häst" : `${l.selection.length} hästar`}</span>;
    const t = legTypeLabel(l);
    if (l.kind === "SPIK") return <span className="lr spik">{t}</span>;
    if (l.kind === "OWN_SPIK" || l.kind === "OWN")
      return (
        <span className="lr lock">
          <IconLock />
          {t}
        </span>
      );
    if (l.kind === "ALLG" || l.kind === "PRIO")
      return (
        <span className="lr allg">
          <span className="sr">Prioriterat lopp, </span>
          {t}
        </span>
      );
    return <span className="lr">{t}</span>;
  })();
  const why = (() => {
    if (started) return legWhyStarted(startedKind, { count: l.selection.length, field: l.field.length, cap });
    if (mode === "legacy") return null;
    if (l.struckOwnSpik) return "Loppet saknar spik. Raden kan inte kopieras förrän den är vald.";
    return legWhy(r, l.leg);
  })();
  const favOut = mode === "live" ? favOutText(r, l.leg) : null;
  const reasonsOf = (h: TippaHorse): ReasonCode[] => (started ? (role?.h?.[String(h.number)] ?? []) : h.reasons);
  const penOff = started || l.kind === "CANCELLED" || l.kind === "NO_STARTERS";
  const fav = l.favorite?.number ?? role?.fav ?? null;

  // Struken egen spik: hästen finns inte bland de löpande.
  const struckRows = [...struck];
  if (l.struckOwnSpik && mode === "live") {
    const s = l.scratched.find((x) => x.number === l.selection[0]);
    if (s && !struckRows.some((x) => x.number === s.number)) struckRows.push(s);
  }

  let body: React.ReactNode;
  if (isAllg) {
    const scr = new Set(l.scratched.map((s) => s.number));
    const run = all.filter((n) => !scr.has(n));
    const lo = all[0];
    const hi = all[all.length - 1];
    const label = scr.size
      ? `Alla ${run.length} startande hästar, ${lo} till ${hi} utom ${[...scr].sort((a, b) => a - b).join(" och ")}.${fav !== null ? ` Favoriten är nummer ${fav}.` : ""}`
      : `Alla ${all.length} hästar, ${lo} till ${hi}.${fav !== null ? ` Favoriten är nummer ${fav}.` : ""}`;
    body = (
      <div className="allgn" role="img" aria-label={label}>
        {all.map((n) => (
          <b key={n} className={[n === fav ? "fv" : "", scr.has(n) ? "scr" : ""].filter(Boolean).join(" ") || undefined}>
            {n}
          </b>
        ))}
      </div>
    );
  } else {
    body = (
      <ul className="lhl" aria-label={`Valda hästar i ${legName(r.gameType, l.leg)}`}>
        {l.horses.map((h) => {
          const isNew = fresh.includes(h.number);
          return (
            <li key={h.number} className={`lh${h.bet ? " is-b" : ""}${isNew ? " new" : ""}`}>
              <FlapNumber n={h.number} size="sm" />
              <div className="lm">
                <span className="hl">
                  <span className="sr">Nr {h.number}, </span>
                  <span className="hn">{h.name}</span>
                  <HorseMarks h={h} />
                </span>
                <ReasonTags codes={mode === "legacy" ? [] : reasonsOf(h)} before={isNew ? <span className="rs new">Ny</span> : undefined} />
              </div>
              <StreckCell h={h} prelim={l.prelim} />
            </li>
          );
        })}
        {struckRows.map((s) => (
          <li key={`s${s.number}`} className="lh scr">
            <FlapNumber n={s.number} size="sm" />
            <div className="lm">
              <span className="hl">
                <span className="sr">Nr {s.number}, </span>
                <span className="hn">{s.name}</span>
              </span>
              <span className="rsn">
                <span className="rs scr">Struken</span>
              </span>
            </div>
            <span className="lst num">–</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="lg" aria-labelledby={id}>
      <div className="lg-h">
        <FlapNumber n={l.leg} size="sm" />
        <div className="lg-t">
          <h3 id={id}>
            {legName(r.gameType, l.leg)}
            {l.startAt ? ` · ${hhmm(l.startAt)}` : ""}
          </h3>
          <span>{legSubline(l)}</span>
        </div>
        {lr}
        <button
          ref={penRef}
          type="button"
          className="lg-e"
          aria-label={`Ändra ${legName(r.gameType, l.leg)}`}
          aria-haspopup="dialog"
          disabled={penOff}
          title={l.kind === "CANCELLED" && !started ? "Inställt lopp" : undefined}
          onClick={onEdit}
        >
          <IconPen />
        </button>
      </div>
      {body}
      {why && (
        <p className="lg-w">
          <Bold text={why} />
        </p>
      )}
      {favOut && (
        <p className="lg-x">
          <span className="rs lim">Spärr</span>
          <span>
            <Bold text={favOut} />
          </span>
        </p>
      )}
    </section>
  );
});
