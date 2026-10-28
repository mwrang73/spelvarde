"use client";

// Rutan Hämta tips i Källor (E5 S8): knappen, hjälptexten för varje läge,
// dygnsgränsen, förloppet medan kedjan körs och banderollerna efteråt.

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useOnline } from "@/components/hooks";
import { Banner } from "@/components/ui/board";
import { IconClock, IconSpark } from "@/components/ui/icons";
import { mmss, quotaFull, scanLockLeft } from "@/lib/tips-ui";
import type { QuotaDto, SourceDto } from "@/lib/types";
import { clearTipsBanners, useTipsChain, type TipsChainState } from "./useTipsChain";

const Dots = () => (
  <span className="dots" aria-hidden="true">
    <i />
    <i />
    <i />
  </span>
);

// Sekunder kvar av spärren per källa, uppdaterad varje sekund medan den gäller.
function useLockLeft(enabled: SourceDto[]): number {
  const reads = enabled.map((s) => s.lastReadAt);
  const key = reads.join("|");
  const [now, setNow] = useState(() => Date.now());
  const left = scanLockLeft(reads, now);
  useEffect(() => {
    setNow(Date.now());
  }, [key]);
  useEffect(() => {
    if (left <= 0) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [left > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  return left;
}

export function FetchTips({
  roundId,
  roundLabel,
  noRound,
  closed,
  enabled,
  quota,
  secondary,
  onRun,
  onRetryArticle,
}: {
  roundId: string | null;
  roundLabel: string | null;
  noRound: boolean;
  closed: boolean;
  enabled: SourceDto[];
  quota: QuotaDto | null;
  secondary: boolean;
  onRun: () => void;
  onRetryArticle: (articleId: string) => void;
}) {
  const online = useOnline();
  const chain = useTipsChain();
  const helpId = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const lockLeft = useLockLeft(enabled);
  const running = chain.kind === "running";
  const full = quotaFull(quota);

  // /kallor?hamta=1 (från S1): skrolla till och fokusera knappen. Hämtningen startar inte av sig själv.
  useEffect(() => {
    if (!/[?&]hamta=1\b/.test(window.location.search)) return;
    const t = window.setTimeout(() => {
      boxRef.current?.scrollIntoView({ block: "center" });
      if (btnRef.current && !btnRef.current.disabled) btnRef.current.focus();
      else boxRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(t);
  }, []);

  // Skärmläsartexten för spärren uppdateras högst var 30:e sekund.
  const [srLock, setSrLock] = useState(lockLeft);
  useEffect(() => {
    if (lockLeft <= 0 || Math.abs(srLock - lockLeft) >= 30 || srLock <= 0) setSrLock(lockLeft);
  }, [lockLeft, srLock]);

  let help: React.ReactNode;
  let disabled = true;
  if (running) help = null;
  else if (!online) help = "Ingen uppkoppling. Hämta tips kräver nät.";
  else if (noRound || !roundId)
    help = (
      <>
        Hämta omgången först. Tips läses för en omgång i taget. <Link href="/">Till Omgång</Link>
      </>
    );
  else if (closed) help = "Alla lopp har startat. Tips kan inte längre hämtas för omgången.";
  else if (!enabled.length) help = "Slå på minst en källa för att hämta tips.";
  else if (full) help = "Dagens gräns för AI-läsning är nådd. Hämta tips fungerar igen i morgon kl. 00:00.";
  else if (lockLeft > 0)
    help = (
      <>
        <span aria-hidden="true">Nyss hämtat. Hämta tips går igen om {mmss(lockLeft)}.</span>
        <span className="sr">Nyss hämtat. Hämta tips går igen om {mmss(srLock)}.</span>
      </>
    );
  else {
    disabled = false;
    help = `Läser dina påslagna källor för ${roundLabel}. AI:n tolkar tipsen, och du granskar dem innan de räknas.`;
  }
  const locked = !running && lockLeft > 0 && online && !!roundId && !closed && enabled.length > 0 && !full;

  return (
    <>
      <div className="tips-box" ref={boxRef} tabIndex={-1} aria-busy={running || undefined}>
        <button type="button" ref={btnRef} className={`btn ${secondary ? "secondary" : "primary"} full`} disabled={disabled || running} aria-describedby={help ? helpId : undefined} onClick={onRun}>
          {locked ? <IconClock /> : <IconSpark />}
          {running ? "Hämtar tips …" : "Hämta tips"}
        </button>
        {help && (
          <p className="help" id={helpId}>
            {help}
          </p>
        )}
        {quota && !running && (
          <div className="quota">
            <span>
              AI-läsningar i dag{" "}
              <b>
                {Math.min(quota.used, quota.limit)} av {quota.limit}
              </b>
            </span>
            <span className={`meter${full ? " full" : ""}`} aria-hidden="true">
              <i style={{ width: `${Math.min(100, (quota.used / Math.max(1, quota.limit)) * 100)}%` }} />
            </span>
          </div>
        )}
      </div>
      <TipsProgress state={chain} />
      {chain.kind === "done" &&
        chain.banners.map((b, i) => (
          <Banner
            key={`${chain.seq}-${i}`}
            tone={b.tone}
            className="m10 tban"
            role={b.tone === "err" ? "alert" : "status"}
            onClose={() => clearTipsBanners(i)}
            actions={
              b.retryArticleId ? (
                <button type="button" className="btn secondary sm" disabled={!online} onClick={() => onRetryArticle(b.retryArticleId!)}>
                  Försök igen
                </button>
              ) : undefined
            }
          >
            {b.strong && <b>{b.strong}</b>}
            {b.strong && b.text && !/^\s/.test(b.text) ? " " : ""}
            {b.text}
          </Banner>
        ))}
    </>
  );
}

function TipsProgress({ state }: { state: TipsChainState }) {
  if (state.kind !== "running") return null;
  const pct = state.total ? Math.min(100, (state.done / state.total) * 100) : 0;
  return (
    <div className="tprog">
      <ol className="steps" aria-live="polite" aria-label="Hämtar tips">
        {state.steps.map((s) => (
          <li key={s.key} className={s.state === "ok" ? "ok" : s.state === "cur" ? "cur" : s.state === "bad" ? "bad" : undefined}>
            {s.state === "ok" && <span aria-hidden="true">✓ </span>}
            {s.state === "bad" && <span aria-hidden="true">! </span>}
            {s.text}
            {s.state === "cur" && <Dots />}
          </li>
        ))}
      </ol>
      <div className="prog" aria-hidden="true">
        <i style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
      <p className="help prog-help">Det brukar ta 10–20 sekunder per artikel. Inget räknas förrän du har granskat.</p>
    </div>
  );
}
