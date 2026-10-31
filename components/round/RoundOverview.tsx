"use client";

// S1 Omgången (specen 5, S1) för en hämtad omgång: vyrubrik, fasrad, Nästa
// steg, hämtstatus och de 8 avdelningarna.

import Link from "next/link";
import { useState } from "react";
import { useNow, useOnline } from "@/components/hooks";
import { AppHeader } from "@/components/shell/AppHeader";
import { Banner, FlapNumber, Skeleton } from "@/components/ui/board";
import { IconCheck, IconChev, IconGear, IconRefresh, IconX } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { changesSummary, dayDate, hhmm, methodLabel, relTime, shortRaceName } from "@/lib/format";
import { resumeMessage } from "@/lib/fetch-chain";
import type { NextStep } from "@/lib/phase";
import { allLegsDone, lastResultAt, latestIso, legRow, revealedSummary, type LegRow } from "@/lib/results-ui";
import type { RaceDto, RoundResponse } from "@/lib/types";
import { useFetchChain } from "./fetchChain";
import { FetchBanners, FetchSteps, runChain } from "./FetchUi";
import { Counts, PhaseRail, RoundLinks, firstTodoLeg } from "./parts";
import { Summary } from "./RaceResult";
import { isShown, useShownLegs } from "./revealStore";
import { allRacesStarted, useRound } from "./RoundProvider";
import { OddsFetchCard, RefreshBanner, RefreshBoardButton } from "./StreckOdds";
import { needsOddsFetch } from "@/lib/streck-odds";
import { FEATURES } from "@/lib/features";
import { tipsLine } from "@/lib/tips-ui";
import { legName } from "@/lib/game-type";

export function roundSub(data: RoundResponse | null): string {
  if (!data) return "";
  // E4a: "V85 · Jägersro · lör 24 okt · klar" när omgången är klar.
  return `${data.round.gameType} · ${data.round.trackName} · ${dayDate(data.round.date)} · ${data.phase === "KLART" ? "klar" : hhmm(data.round.firstStartAt)}`;
}

export function HeaderActions({ roundId, gameId }: { roundId: string | null; gameId: string | null }) {
  const online = useOnline();
  const chain = useFetchChain();
  const running = chain.kind === "running";
  return (
    <>
      {gameId && (
        <button
          type="button"
          className="btn icon"
          aria-label="Hämta omgången igen"
          title={!online ? "Ingen uppkoppling" : running ? "Hämtar …" : "Hämta omgången igen"}
          disabled={!online || running}
          onClick={() => runChain({ step: "GAME" }, gameId, roundId)}
        >
          <IconRefresh />
        </button>
      )}
      <Link className="btn icon" href="/installningar" aria-label="Inställningar">
        <IconGear />
      </Link>
    </>
  );
}

export function NextStepCard({ step }: { step: NextStep }) {
  const online = useOnline();
  const chain = useFetchChain();
  const running = chain.kind === "running";
  const a = step.action;
  return (
    <section className="next" aria-labelledby="next-h">
      <span className="lbl">Nästa steg</span>
      <h2 id="next-h">{step.kind === "ANALYZE_LEG" ? step.title.replace(/ – (.+)$/, (_, n: string) => ` – ${shortRaceName(n)}`) : step.title}</h2>
      <p>{step.text}</p>
      {a?.type === "link" && (
        <Link className="btn primary" href={a.href}>
          {a.label}
        </Link>
      )}
      {a?.type === "fetch" && (
        <button type="button" className="btn primary" disabled={!online || running} onClick={() => runChain({ step: "GAME" }, a.gameId, null)}>
          {running ? "Hämtar …" : a.label}
        </button>
      )}
    </section>
  );
}

export function RoundOverview() {
  const { data, load, roundId } = useRound();
  const chain = useFetchChain();
  const [changesOpen, setChangesOpen] = useState(false);
  // Klockan för "Pågår" och "väntar på resultat" i raderna (E4a).
  const now = useNow(30_000);
  const shownLegs = useShownLegs(roundId, data?.races);

  if (!data) {
    return (
      <>
        <AppHeader brand title="Omgången" sub="" actions={<HeaderActions roundId={roundId} gameId={null} />} />
        <main className="page" id="main">
          {load.error && !load.loading ? (
            <Banner tone={load.notFound ? "info" : "err"} className="m10" actions={load.notFound ? <Link href="/">Till aktuell omgång</Link> : undefined}>
              {load.notFound ? "Omgången finns inte." : load.error}
            </Banner>
          ) : (
            <OverviewSkeleton />
          )}
        </main>
      </>
    );
  }

  const base = `/omgang/${data.round.id}`;
  const changes = changesSummary(data.fetch.lastChanges);
  const resume = data.fetch.resumeFrom;
  const done = data.phase === "KLART";
  const resultsAt = done ? latestIso(data.results?.syncedAt, lastResultAt(data.races)) : null;
  // E8 8.2 rad 12: summeringen räknas över de visade loppen, aldrig ur serverns summa.
  const revealed = revealedSummary(data.races, shownLegs);
  const summaryHead = !revealed ? "" : revealed.shown < revealed.total ? `Visade lopp (${revealed.shown} av ${revealed.total})` : allLegsDone(data.races) ? "Omgången" : "Hittills";

  return (
    <>
      <AppHeader brand title="Omgången" sub={roundSub(data)} refresh={allRacesStarted(data.races, now.getTime()) ? undefined : <RefreshBoardButton data={data} />} actions={<HeaderActions roundId={data.round.id} gameId={data.round.atgGameId} />} />
      <main className="page" id="main">
        <PhaseRail steps={data.phaseRail} analysHref={`${base}/avd/${firstTodoLeg(data.races)}`} oddsHref={`${base}/odds`} liveHref={`${base}/live`} className="rail" />
        {!data.isCurrent && data.currentRoundId && (
          <div className="ban thin m10">
            <p>
              Det här är en tidigare omgång. <Link href="/">Till aktuell omgång</Link>
            </p>
          </div>
        )}
        <FetchBanners onRetry={(from, rid) => runChain(from, data.round.atgGameId, rid ?? data.round.id)} />
        <FetchSteps state={chain} />
        <NextStepCardFor data={data} />
        {revealed && <Summary summary={revealed.summary} heading={summaryHead} label={`Summering ${summaryHead.toLowerCase()}`} />}
        {!allRacesStarted(data.races, now.getTime()) && <RefreshBanner data={data} className="m10" />}
        <p className="fetchline">
          {done && resultsAt ? (
            <>Resultat hämtade från ATG {relTime(resultsAt, now)}</>
          ) : data.round.fetchedAt ? (
            <>Startlistan hämtad {relTime(data.round.fetchedAt, now)}</>
          ) : (
            "Startlistan är inte hämtad"
          )}
          {changes && !done && (
            <>
              {" · "}
              <button type="button" className="linkish" onClick={() => setChangesOpen(true)} aria-haspopup="dialog">
                Ändrat sedan förra hämtningen: {changes}
              </button>
            </>
          )}
        </p>
        {FEATURES.tips && <TipsLineRow data={data} done={done} now={now} />}
        <RoundLinks roundId={data.round.id} analysis={data.phase === "KLART"} />
        <div className="sl">
          <h2 className="sl-h">Lopp</h2>
          {resume && <span className="todo">Hämtning ej klar</span>}
        </div>
        <ul className="olist" aria-label="Lopp">
          {data.races.map((r) => (
            <li key={r.id}>
              <LegLink gameType={data.round.gameType} race={r} href={`${base}/avd/${r.leg}`} row={legRow(r, now.getTime(), isShown(r, shownLegs))} />
            </li>
          ))}
        </ul>
        <Sheet open={changesOpen} onClose={() => setChangesOpen(false)} title="Ändrat sedan förra hämtningen" sub={data.round.fetchedAt ? `Hämtat ${relTime(data.round.fetchedAt, now)}` : undefined}>
          <ul className="plain">
            {data.fetch.lastChanges?.scratched.map((s) => (
              <li key={`s-${s.startId}`}>
                <b className="num">{legName(data.round.gameType, s.leg)} · {s.number}</b> {s.horseName} struken
              </li>
            ))}
            {data.fetch.lastChanges?.driverChanges.map((d) => (
              <li key={`d-${d.startId}`}>
                <b className="num">{legName(data.round.gameType, d.leg)} · {d.number}</b> Kuskbyte: {d.horseName} – {d.newDriver}
                {d.oldDriver && ` (förut ${d.oldDriver})`}
              </li>
            ))}
          </ul>
        </Sheet>
      </main>
    </>
  );
}

// E5 S1: tipsraden under hämtstatusen. Länkarna leder till Källor och
// granskningen. "Hämta igen" startar inte hämtningen (den kostar AI-läsningar).
function TipsLineRow({ data, done, now }: { data: RoundResponse; done: boolean; now: Date }) {
  const t = data.tips ?? null;
  const line = tipsLine(t, data.sourcesEnabled ?? 0, done || !data.isCurrent, t?.lastReadAt ? relTime(t.lastReadAt, now) : null);
  if (!line) return null;
  return (
    <p className="fetchline tipsline">
      {line.lead}
      {line.strong && <b className="num">{line.strong}</b>}
      {line.rest}
      {line.links.map((l) => (
        <span key={l.kind}>
          {" · "}
          <Link className="linkish" href={l.kind === "review" ? "/kallor/granska" : "/kallor?hamta=1"} aria-label={l.ariaLabel}>
            {l.label}
          </Link>
        </span>
      ))}
    </p>
  );
}

// En avdelning i S1: som i dag före start, och med resultatstatus efter
// (E4a: "Pågår", vinnaren och dina Bet, "Inställt"; E8: "Dolt" utan utfall). Raden
// leder till S2.
function LegLink({ race: r, gameType, href, row }: { race: RaceDto; gameType: string; href: string; row: LegRow }) {
  const counts = <Counts interesting={r.counts.interesting} spelbar={r.counts.spelbar} bet={r.counts.bet} />;
  const line1 = row.kind === "result" ? row.title : shortRaceName(r.name);
  const line2 =
    row.kind === "before" ? (
      <>
        {hhmm(r.startAt)} · {r.distance} {methodLabel(r.startMethod)} · {r.counts.starters} hästar
        {r.counts.scratched > 0 && ` · ${r.counts.scratched} strukna`}
      </>
    ) : row.kind === "cancelled" ? (
      "Inställt"
    ) : (
      row.line2
    );
  let right: React.ReactNode;
  if (row.kind === "before") right = r.reviewed ? counts : <span className="todo">Ej genomgången</span>;
  else if (row.kind === "live") right = <span className="tag live">Pågår</span>;
  else if (row.kind === "cancelled") right = <span className="tag">Inställt</span>;
  else if (row.kind === "hidden") right = <span className="tag">Dolt</span>;
  else if (row.bet)
    right = (
      <span className={`hit ${row.bet.hits ? "y" : "n"}`}>
        {row.bet.hits ? <IconCheck /> : <IconX />}
        <span aria-hidden="true">
          {row.bet.hits ? "Träff" : "Miss"} {row.bet.hits}/{row.bet.total}
        </span>
        <span className="sr">
          Bet {row.bet.hits} av {row.bet.total} träff
        </span>
      </span>
    );
  else right = counts;
  return (
    <Link className={`orow${row.kind === "result" ? " res" : ""}`} href={href} title={r.name}>
      <FlapNumber n={r.leg} size="sm" />
      <span className="o-mid">
        <span className="on">
          <span className="sr">{legName(gameType, r.leg)}: </span>
          {line1}
        </span>
        <span className={`om${row.kind === "before" ? " num" : ""}`}>{line2}</span>
      </span>
      {right}
      <IconChev className="chev" />
    </Link>
  );
}

// Steg som kortet "Hämta streck och odds" går före i fas Odds (e2.2, Nästa
// steg punkt 5): allt utom en ofullständig hämtning och larm.
const ODDS_FETCH_BEFORE = new Set<NextStep["kind"]>(["ODDS_FILL", "MARK_BET", "BUILD_COUPON", "ANALYZE_LEG", "ALL_REVIEWED"]);

function NextStepCardFor({ data }: { data: RoundResponse }) {
  const chain = useFetchChain();
  const step = data.nextStep;
  if (data.phase === "ODDS" && ODDS_FETCH_BEFORE.has(step.kind) && needsOddsFetch(data.latestOdds ?? null, Date.now())) return <OddsFetchCard data={data} />;
  // Under en körning och efter ett fel i den visar stegraden och banderollen
  // läget, så kortet "Slutför hämtningen" skulle bara säga samma sak igen.
  if (step.kind === "RESUME_FETCH" && (chain.kind === "running" || chain.kind === "error")) return null;
  if (step.action?.type === "resume" && data.fetch.resumeFrom) {
    const from = data.fetch.resumeFrom;
    return <ResumeCard step={step} onResume={() => runChain(from, data.round.atgGameId, data.round.id)} text={resumeMessage(from)} />;
  }
  return <NextStepCard step={step} />;
}

function ResumeCard({ step, onResume, text }: { step: NextStep; onResume: () => void; text: string }) {
  const online = useOnline();
  const chain = useFetchChain();
  const running = chain.kind === "running";
  return (
    <section className="next" aria-labelledby="next-h">
      <span className="lbl">Nästa steg</span>
      <h2 id="next-h">{step.title}</h2>
      <p>{text}</p>
      <button type="button" className="btn primary" disabled={!online || running} onClick={onResume}>
        {running ? "Hämtar …" : (step.action?.label ?? "Slutför hämtningen")}
      </button>
    </section>
  );
}

export function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Laddar omgången">
      <ol className="phase brd rail" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <li key={i}>
            <b>&nbsp;</b>
            <small>&nbsp;</small>
          </li>
        ))}
      </ol>
      <div className="next sk-card">
        <Skeleton width="30%" />
        <Skeleton width="80%" height={18} />
        <Skeleton width="60%" />
      </div>
      <ul className="olist" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i} className="orow">
            <FlapNumber n={i + 1} size="sm" />
            <span className="o-mid">
              <Skeleton width="70%" height={14} />
              <Skeleton width="45%" height={10} />
            </span>
            <span />
            <span />
          </li>
        ))}
      </ul>
    </div>
  );
}
