"use client";

// Hämta streck och odds i gränssnittet (specen e2.2, Knappen, S1 Nästa steg
// och S6): tavelknappen RefreshBoardButton i vyrubriken (S1–S4), raden
// RefreshRow i S6, kortet i Nästa steg och banderollen efter en hämtning.
// Alla delar samma körning (streckOddsStore.ts). Mockupen
// docs/mockups/unibet-odds-mockup-v2.html, avsnitt 4.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Banner } from "@/components/ui/board";
import { IconClock, IconDownload, IconRefresh } from "@/components/ui/icons";
import { relTime } from "@/lib/format";
import { agoText, countdownClock, countdownShort, type BannerModel, type LegLamp } from "@/lib/streck-odds";
import type { RoundResponse } from "@/lib/types";
import { useStreckOddsRefresh, type StreckOddsApi } from "./streckOddsStore";

// Skärmläsartexten under spärren uppdateras högst var 30:e sekund (bilden varje sekund).
function useSlowText(text: string, slow: boolean, ms = 30_000): string {
  const last = useRef<{ text: string; at: number }>({ text, at: 0 });
  const now = Date.now();
  if (!slow || now - last.current.at >= ms) last.current = { text, at: now };
  return last.current.text;
}

// ---- Tavelknappen --------------------------------------------------------------------

export function RefreshBoardButton({ data }: { data: RoundResponse }) {
  const api = useStreckOddsRefresh(data);
  const v = api.view;
  const aria = useSlowText(v.aria, v.kind === "wait");
  return (
    <button type="button" className={`sbtn${v.tone ? ` ${v.tone}` : ""}`} aria-label={aria} disabled={v.disabled} onClick={() => api.start()}>
      {v.icon === "spin" ? <span className="spin" aria-hidden="true" /> : v.icon === "clock" ? <IconClock /> : <IconDownload />}
      <span className="st" aria-hidden="true">
        <small>Streck · odds</small>
        <b>
          {v.value}
          {v.check && <span className="ok"> ✓</span>}
          <em>{v.expl}</em>
        </b>
      </span>
      {v.dot && <span className="dot" aria-hidden="true" />}
    </button>
  );
}

// ---- Banderollen -----------------------------------------------------------------------

// Under tavlan i vyn där Mikael tryckte, eller under raden i S6.
export function RefreshBanner({ data, className }: { data: RoundResponse; className?: string }) {
  const api = useStreckOddsRefresh(data);
  const pathname = usePathname() ?? "/";
  const r = api.run;
  if (!r || !r.bannerOpen || !r.banner || r.origin !== pathname) return null;
  return <BannerView key={r.finishedAt ?? 0} model={r.banner} api={api} roundId={data.round.id} onOdds={pathname.endsWith("/odds")} className={className} />;
}

function BannerView({ model, api, roundId, onOdds, className }: { model: BannerModel; api: StreckOddsApi; roundId: string; onOdds: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const online = api.view.kind !== "off";
  const busy = !!api.run?.running;
  const icon = model.tone === "ok" ? "check" : model.tone === "info" ? "info" : "warn";
  const actions = (
    <>
      {model.retry && (
        <button type="button" className="btn secondary sm" disabled={!online || busy} onClick={() => api.start(model.retry!.mode)}>
          {model.retry.icon === "refresh" ? <IconRefresh /> : <IconDownload />}
          {model.retry.label}
        </button>
      )}
      {model.undo && (
        <button type="button" className="linkish" onClick={() => api.undo(model.undo!.startId)}>
          {model.undo.label}
        </button>
      )}
      {model.unmarked > 0 &&
        (onOdds ? (
          <button
            type="button"
            className="linkish"
            onClick={() => {
              const el = document.getElementById("omarkerade");
              el?.scrollIntoView({ behavior: "smooth", block: "start" });
              el?.querySelector<HTMLElement>("h2, h3, caption")?.focus({ preventScroll: true });
            }}
          >
            Visa {model.unmarked} omarkerade
          </button>
        ) : (
          <Link className="linkish" href={`/omgang/${roundId}/odds#omarkerade`}>
            Visa {model.unmarked} omarkerade
          </Link>
        ))}
      {model.changes.length > 0 && (
        <button type="button" className="linkish" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((x) => !x)}>
          {open ? "Dölj" : "Visa vilka"}
        </button>
      )}
    </>
  );
  const hasActions = !!(model.retry || model.undo || model.unmarked > 0 || model.changes.length);
  return (
    <Banner
      tone={model.tone}
      icon={icon}
      role={model.tone === "err" ? "alert" : "status"}
      className={`sban${className ? ` ${className}` : ""}`}
      actions={hasActions ? actions : undefined}
      onClose={api.dismiss}
      after={
        open ? (
          <ul className="plain sr-list" id={listId}>
            {model.changes.map((c) => (
              <li key={c.key}>{c.text}</li>
            ))}
          </ul>
        ) : null
      }
    >
      <b>{model.head}</b> {model.text}
    </Banner>
  );
}

// ---- Lamporna ----------------------------------------------------------------------------

function Lamps({ streck, legs }: { streck: "on" | "cur" | "bad" | "off"; legs: LegLamp[] }) {
  return (
    <div className="lamps" aria-hidden="true" style={{ "--n": legs.length } as React.CSSProperties}>
      <i className={`st ${streck}`}>STRECK</i>
      {legs.map((l, i) => (
        <i key={i} className={l}>
          {l === "bad" ? "!" : i + 1}
        </i>
      ))}
    </div>
  );
}

// ---- Raden i S6 --------------------------------------------------------------------------

export function RefreshRow({ data }: { data: RoundResponse }) {
  const api = useStreckOddsRefresh(data);
  const { view: v, run: r, now } = api;
  const helpId = useId();
  const streckAt = data.latestStreck?.takenAt ?? null;
  const oddsAt = data.latestOdds?.takenAt ?? null;
  const running = !!r?.running;
  const stale = v.kind === "old";
  const wait = v.lockSec > 0 && !running && v.kind !== "sOnly" && v.kind !== "uOnly" && v.kind !== "part" && v.kind !== "err";
  const offline = v.kind === "off";
  const nowMs = now.getTime();
  const streckOld = r?.streck.state === "failed" || !streckAt || nowMs - Date.parse(streckAt) > 12 * 3600_000;
  const oddsFailed = r?.odds.state === "failed" || r?.odds.state === "partial";
  const oddsOld = oddsFailed || (!!oddsAt && nowMs - Date.parse(oddsAt) > 12 * 3600_000);
  const noOdds = v.kind === "none" || r?.odds.state === "noOdds";
  const oldest = [streckAt, oddsAt].filter((x): x is string => !!x).sort()[0] ?? null;

  let live: React.ReactNode;
  if (running && r) {
    const done = r.odds.lamps.filter((l) => l === "on" || l === "bad" || l === "started").length;
    const s = r.streck.state === "ok" ? "strecket klart" : r.streck.state === "failed" ? "strecket misslyckades" : r.streck.state === "running" ? "strecket hämtas" : "";
    const o = r.odds.state === "running" ? `odds lopp ${Math.min(done + 1, r.odds.lamps.length)} av ${r.odds.lamps.length}` : "";
    live = `Hämtar … ${[s, o].filter(Boolean).join(", ")}`;
  } else
    live = (
      <span className="two">
        <span className={streckOld ? "old" : undefined}>
          Streck <b>{streckAt ? relTime(streckAt, now) : "inte hämtat"}</b>
        </span>
        <span className={oddsOld ? "old" : undefined}>
          Odds <b>{oddsAt ? `${relTime(oddsAt, now)}${r?.odds.state === "partial" ? " · delvis" : ""}` : noOdds ? "inga än" : "inte hämtade"}</b>
        </span>
        {oldest && !wait && !offline && <span className="help">{agoText(nowMs - Date.parse(oldest))}</span>}
      </span>
    );

  const showLamps = !!r && (running || r.streck.state === "failed" || r.odds.state === "failed" || r.odds.state === "partial");
  const streckLamp = !r ? "off" : r.streck.state === "ok" ? "on" : r.streck.state === "failed" ? "bad" : r.streck.state === "running" ? "cur" : "on";
  const waitText = useSlowText(countdownShort(v.lockSec), true);

  return (
    <div className={`srefresh uf${stale ? " stale" : ""}`} role="group" aria-label="Streck och odds" aria-busy={running || undefined}>
      <div className="sr-row">
        <div className="sr-t">
          <span className="k">Streck och odds</span>
          <span aria-live="polite">{live}</span>
        </div>
        {running ? (
          <button type="button" className="btn secondary sm" disabled>
            <span className="spin" aria-hidden="true" />
            Hämtar …
          </button>
        ) : wait ? (
          <button type="button" className="btn secondary sm" disabled aria-describedby={helpId}>
            <IconClock />
            Om <span className="wait num">{countdownClock(v.lockSec)}</span>
          </button>
        ) : (
          <button type="button" className={`btn ${stale ? "primary" : "secondary"} sm`} disabled={offline} aria-describedby={stale ? helpId : undefined} onClick={() => api.start()}>
            <IconDownload />
            Hämta streck och odds
          </button>
        )}
      </div>
      {showLamps && r && <Lamps streck={streckLamp} legs={r.odds.lamps} />}
      {stale && !running && (
        <p className="help" id={helpId}>
          Strecket och oddsen är äldre än 12 timmar. Hämta innan du markerar Bet.
        </p>
      )}
      {wait && (
        <p className="help" id={helpId}>
          <span aria-hidden="true">Nyss hämtat. Nästa hämtning kan göras om {countdownShort(v.lockSec)}, för att inte belasta Unibet.</span>
          <span className="sr">Nyss hämtat. Nästa hämtning kan göras om {waitText}, för att inte belasta Unibet.</span>
        </p>
      )}
      {offline && (
        <p className="help">
          Ingen uppkoppling. Du ser strecket {streckAt ? `från ${relTime(streckAt, now).replace(/^i dag /, "")}` : "som sparades senast"}
          {oddsAt ? ` och oddsen från ${relTime(oddsAt, now).replace(/^i dag /, "")}` : ""}.
        </p>
      )}
      <RefreshBanner data={data} />
    </div>
  );
}

// ---- Nästa steg i S1 ------------------------------------------------------------------------

// Fas Odds och ingen ögonblicksbild med odds de senaste 12 timmarna (e2.2, Nästa steg).
export function OddsFetchCard({ data }: { data: RoundResponse }) {
  const api = useStreckOddsRefresh(data);
  const { view: v, run: r, now } = api;
  const att = data.lastOddsAttempt ?? null;
  const oddsAt = data.latestOdds?.takenAt ?? null;
  const none = r?.odds.state === "noOdds" || (!!att && (att.outcome === "noOdds" || att.outcome === "noMeeting") && (!oddsAt || Date.parse(att.at) > Date.parse(oddsAt)));
  const running = !!r?.running;
  const locked = v.lockSec > 0;
  return (
    <section className="next" aria-labelledby="next-h">
      <span className="lbl">Nästa steg</span>
      <h2 id="next-h">{none ? "Unibet har inga odds än" : "Hämta streck och odds"}</h2>
      <p>{none ? `Senast prövat ${att ? relTime(att.at, now) : "nyss"}. Oddsen brukar komma på torsdagen.` : "Unibets plats- och vinnarodds för alla hästar, och nytt streck från ATG."}</p>
      <button type="button" className={`btn ${none ? "secondary" : "primary"}`} disabled={v.kind === "off" || running || locked} onClick={() => api.start({ kind: "all" })}>
        {running ? (
          <>
            <span className="spin" aria-hidden="true" />
            Hämtar …
          </>
        ) : locked ? (
          <>
            <IconClock />
            Om {countdownClock(v.lockSec)}
          </>
        ) : (
          <>
            <IconDownload />
            {none ? "Försök igen" : "Hämta streck och odds"}
          </>
        )}
      </button>
    </section>
  );
}
