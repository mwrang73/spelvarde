"use client";

// S3 Hästkortet (specen 5, S3, och docs/specs/analysvy-layout.md 3.4 och 5.2).
// Det som finns i omgångens cache (namn, kusk, form, galopp, Intressant,
// Spelbar, Bet, riktodds) visas direkt. Tidigare starter, statistik,
// kommentarer, tips och riktoddsets skäl hämtas med GET /api/starts/[id]
// när kortet öppnas (förhandsladdas för grannhästarna).
//
// layout "desk": en panel med rubrik, tavla (nyckeltal), valrad och sex
// sektioner i två rader. "Alla"-länkarna öppnar dialoger.
// layout "mobile": en lång sida med fasta hoppknappar överst (scroll-spy),
// tavlan, sex sektioner och en fast knapplist nederst.

import { forwardRef, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { rawPost } from "@/components/api";
import { addToOutbox } from "@/components/outbox/outbox-client";
import { useOutbox } from "@/components/outbox/OutboxProvider";
import { HorseNavButtons, type HorseNav } from "@/components/shell/AppHeader";
import { Badge, Banner, BetToggle, EdgeKey, FlapNumber, LampToggle, LowStreckTag, Skeleton, SpelbarToggle, spelbarOrigin } from "@/components/ui/board";
import { IconTicket } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { postEdge, type PostEdge } from "@/lib/post-edge";
import { ageSex, distShort, odds, ordinal, pct, placeChar, placeLabel, relTime, shortDay, thousands } from "@/lib/format";
import { applyPendingComments, toleranceOf, xFactorsOf, type CommentBody, type PendingComment } from "@/lib/round-overlay";
import { unibetRaceUrl } from "@/lib/odds-ui";
import { nextXFactor } from "@/lib/xfactor";
import { riktX, xOf } from "@/lib/xfactor-ui";
import { UnibetHistory, UnibetHistoryCompact } from "./UnibetHistory";
import type { CommentDto, RaceDto, RecordDto, RoundResponse, StartDetailResponse, StartDto, YearStatsDto } from "@/lib/types";
import { modelLabel, RiktDetail, RiktKeys, useRiktView, type RiktView } from "./Riktodds";
import { raceStarted, useRound } from "./RoundProvider";
import { getDetail, loadDetail, subscribeDetails } from "./roundStore";
import { newClientId } from "@/lib/race-tags";
import { hidesCommentResult } from "@/lib/reveal";
import { useShownLegs } from "./revealStore";
import { SourceSupport, XCycleButton, XFactorSeg, xLockReason } from "./XFactor";
import { currentTips, TipsCompact, tipsHref } from "./TipsSection";
import { FEATURES } from "@/lib/features";
import { pctSignal, signalClass, signalLines, signalSr } from "@/lib/signals";
import { MANY_SIGNALS, SIGNAL_KEYS, TOP3_BY_COUNT } from "@/lib/positive-signals";
import { legName } from "@/lib/game-type";

export function useDetail(startId: string) {
  return useSyncExternalStore(
    subscribeDetails,
    () => getDetail(startId),
    () => getDetail(""),
  );
}

// Mobilens sektioner i ordning, med hoppknapparnas text (5.2 B och D).
export const HK_SECTIONS = [
  { id: "riktodds", jump: "Riktodds" },
  { id: "signaler", jump: "Signaler" },
  { id: "statistik", jump: "Statistik" },
  { id: "starter", jump: "Starter" },
  { id: "odds", jump: "Odds" },
  { id: "noter", jump: "Noter" },
] as const;
// "top" = ingen sektion har nått linjen under menyerna än.
export type HkSection = (typeof HK_SECTIONS)[number]["id"] | "top";

export type HorseCardNav = { index: number; total: number; nav: HorseNav };

type Props = {
  data: RoundResponse;
  race: RaceDto;
  start: StartDto;
  onToggle: (value: boolean) => void;
  layout: "desk" | "mobile";
  nav: HorseCardNav;
  // Mobilen: vald sektion (scroll-spy) och innehåll överst i tavlan (RefreshBanner).
  section?: HkSection;
  onSection?: (s: HkSection) => void;
  before?: React.ReactNode;
};

// ref = hästens namn (desktop, fokusmålet för Enter).
export const HorseCard = forwardRef<HTMLHeadingElement, Props>(function HorseCard({ data, race, start, onToggle, layout, nav, section = "top", onSection, before }, headingRef) {
  const detail = useDetail(start.id);
  const now = new Date();

  // Hämtas när kortet öppnas, och igen om cachen har tömts (efter Hämta igen
  // eller Hämta streck och odds).
  const empty = !detail.data && !detail.loading && !detail.error;
  useEffect(() => {
    if (empty) loadDetail(start.id);
  }, [start.id, empty]);

  const d = detail.data;
  const loading = !d && !detail.error;
  const retry = () => loadDetail(start.id, true);
  const started = raceStarted(race, now.getTime());
  const factors = xFactorsOf(data.settings);
  const tolerance = toleranceOf(data.settings);
  const view = useRiktView({ race, start, factors, tolerance, guideline: data.settings?.spelbarGuideline ?? 2 });

  // Sparstatusen visas efter första ändringen i kortet (gäller bara den här hästen).
  const [touchedFor, setTouchedFor] = useState<string | null>(null);
  const touch = () => setTouchedFor(start.id);
  const status = useSaveStatus(start, touchedFor === start.id);

  // Dialogerna bakom "Alla"-länkarna (desktop).
  const [sheet, setSheet] = useState<null | "odds" | "records" | "comments">(null);
  // Mobilen: "Visa fler" fäller ut i sektionen.
  const [recAll, setRecAll] = useState(false);
  useEffect(() => setRecAll(false), [start.id]);

  const history = d?.unibetHistory ?? null;
  const { current: tips, pending: tipsPending } = currentTips(d);
  const recordsMore = !!d && d.recordsTotal > 5;
  const comments = useComments({ data, race, start, detail: d, onTouch: touch });

  const riktHead = <span className="mver">{modelLabel(d?.riktodds?.modelKey ?? data.model?.key ?? null, !!data.model?.calibrated)}</span>;
  const signalsHead = start.signals ? <SignalSummary count={start.signals.count} /> : null;
  const oddsHead =
    history && history.length > 2 && layout === "desk" ? (
      <button type="button" className="linkish" aria-haspopup="dialog" onClick={() => setSheet("odds")}>
        Alla {history.length}
      </button>
    ) : null;
  const notesHead =
    FEATURES.tips && (tips.length > 0 || tipsPending > 0) ? (
      <Link className="linkish" href={tipsHref(start.id)}>
        Alla tips
      </Link>
    ) : null;
  const recordsHead = recordsMore ? (
    layout === "desk" ? (
      <button type="button" className="linkish" aria-haspopup="dialog" onClick={() => setSheet("records")}>
        Visa fler
      </button>
    ) : (
      <button type="button" className="linkish" aria-expanded={recAll} onClick={() => setRecAll((v) => !v)}>
        {recAll ? "Visa färre" : "Visa fler"}
      </button>
    )
  ) : null;

  const signalsBody = start.signals ? <SignalsBlock start={start} /> : <p className="help">Signaler räknas inte för strukna hästar.</p>;
  const statsBody = d ? <StatsTable d={d} race={race} /> : detail.error ? <DetailError onRetry={retry} /> : <SkeletonBlock rows={4} />;
  const recordsBody = <Records d={d} error={detail.error} race={race} start={start} roundId={data.round.id} all={layout === "mobile" && recAll} />;
  const notesEmpty = !!d && !tips.length && !tipsPending && !comments.list.length;
  const tipsBody = FEATURES.tips && !notesEmpty ? <TipsCompact gameType={data.round.gameType} roundId={data.round.id} races={data.races} start={start} detail={d} locked={started} /> : null;

  if (layout === "desk") {
    return (
      <article className="pn hc" aria-labelledby={`hk-${start.id}`}>
        <div className="pn-h">
          <span>Hästkortet</span>
          <span className="meta">
            · {nav.index + 1} av {nav.total}
          </span>
          <span className="end">
            <span className="meta sstat" aria-live="polite">
              {status}
            </span>
            <a className="btn secondary xs" href={unibetRaceUrl(race)} target="_blank" rel="noopener noreferrer" aria-label={`${legName(data.round.gameType, race.leg)} hos Unibet (öppnas i ny flik)`}>
              Unibet ↗
            </a>
            <HorseNavButtons nav={nav.nav} className="xsg" />
          </span>
        </div>
        <HorseBoard start={start} edge={postEdge(race.statsLine, start.number)} view={view} headingRef={headingRef} />
        <div className="vr">
          {race.cancelled ? (
            <p className="vr-off">Inställt lopp. Inget att markera.</p>
          ) : (
            <>
              <MarkControls race={race} start={start} layout="row" onToggle={onToggle} onTouch={touch} />
              <span className="vsep" aria-hidden="true" />
              <XFactorSeg key={start.id} race={race} start={start} factors={factors} tolerance={tolerance} layout="row" onTouch={touch} />
              <span className="vsep" aria-hidden="true" />
              <SourceSupport race={race} start={start} sourcesEnabled={data.sourcesEnabled ?? 0} layout="row" onTouch={touch} />
              {started && !race.cancelled && !start.scratched && (
                <Link className="linkish vr-live" href={`/omgang/${data.round.id}/live?avd=${race.leg}&hast=${start.id}`}>
                  Tagga i Live ›
                </Link>
              )}
            </>
          )}
        </div>
        <div className="hc-secs">
          <Sec title="Riktodds plats" end={riktHead}>
            <RiktDetail v={view} detail={d?.riktodds ?? null} detailLoading={loading} error={detail.error} onRetry={retry} />
          </Sec>
          <Sec title="Positiva signaler" end={signalsHead}>
            {signalsBody}
          </Sec>
          <Sec title="Statistik">{statsBody}</Sec>
          <Sec title="Unibets odds över tid" end={oddsHead} r2>
            <UnibetHistoryCompact horseName={start.horse.name} history={history} loading={loading} rikt={riktX(start, factors)} tolerance={tolerance} mark={start.mark} onRetry={retry} />
          </Sec>
          <Sec title="Tips och kommentarer" end={notesHead} r2>
            {!d && detail.error ? (
              <DetailError onRetry={retry} />
            ) : (
              <>
                {notesEmpty && <p className="help">Inga tips om hästen än. Inga kommentarer än.</p>}
                {tipsBody}
                <CommentsCompact c={comments} empty={notesEmpty} loading={!d} onAll={() => setSheet("comments")} />
              </>
            )}
          </Sec>
          <Sec title="5 senaste starter" end={recordsHead} r2>
            {recordsBody}
          </Sec>
        </div>

        <Sheet open={sheet === "odds"} onClose={() => setSheet(null)} title="Unibets odds över tid" sub={`${start.number} ${start.horse.name}`}>
          <UnibetHistory horseName={start.horse.name} history={history} loading={loading} rikt={riktX(start, factors)} tolerance={tolerance} mark={start.mark} />
        </Sheet>
        <Sheet open={sheet === "records"} onClose={() => setSheet(null)} title="Senaste starter" sub={d ? `${d.records.length} senaste av ${d.recordsTotal}` : undefined}>
          {d && <RecordsTable rows={d.records} horseName={start.horse.name} />}
        </Sheet>
        <Sheet open={sheet === "comments"} onClose={() => setSheet(null)} title="Mina kommentarer" sub={`${start.number} ${start.horse.name}`}>
          <CommentList c={comments} />
        </Sheet>
      </article>
    );
  }

  // ---- Mobil ----
  const locked = started ? "Loppet har startat" : start.scratched ? "Hästen är struken" : null;
  return (
    <div className="hkm">
      <MobileJump section={section} onSection={onSection} startId={start.id} detailReady={!!d} />
      {before}
      <div className="mkeys brd">
        {start.scratched && (
          <Banner tone="warn" className="mk-ban">
            <b>Struken{start.scratchedAt ? ` ${relTime(start.scratchedAt, now)}` : ""}.</b> Hästen startar inte.
          </Banner>
        )}
        <RiktKeys v={view} variant="mobile" />
        <Flags start={start} now={now} rows />
      </div>
      <div className="mhk-b">
        <Sec id="riktodds" title="Riktodds plats" end={riktHead} level={2}>
          {started && (
            <>
              <p className="help">Loppet har startat. Intressant, Spelbar, Bet, X-faktor och källstöd är låsta.</p>
              {!race.cancelled && !start.scratched && (
                <Link className="linkish vr-live" href={`/omgang/${data.round.id}/live?avd=${race.leg}&hast=${start.id}`}>
                  Tagga i Live ›
                </Link>
              )}
            </>
          )}
          <RiktDetail v={view} detail={d?.riktodds ?? null} detailLoading={loading} error={detail.error} onRetry={retry} />
          {!race.cancelled && (
            <>
              <XFactorSeg key={start.id} race={race} start={start} factors={factors} tolerance={tolerance} layout="block" onTouch={touch} />
              <MarkStatus race={race} start={start} locked={locked} />
              <SourceSupport race={race} start={start} sourcesEnabled={data.sourcesEnabled ?? 0} layout="block" onTouch={touch} />
            </>
          )}
          {status && (
            <p className="help status" aria-live="polite">
              {status}
            </p>
          )}
        </Sec>
        <Sec id="signaler" title="Positiva signaler" end={signalsHead} level={2}>
          {signalsBody}
        </Sec>
        <Sec id="statistik" title="Statistik" level={2}>
          {statsBody}
        </Sec>
        <Sec id="starter" title="5 senaste starter" end={recordsHead} level={2}>
          {recordsBody}
        </Sec>
        <Sec id="odds" title="Unibets odds över tid" level={2}>
          <UnibetHistory horseName={start.horse.name} history={history} loading={loading} rikt={riktX(start, factors)} tolerance={tolerance} mark={start.mark} onRetry={retry} />
        </Sec>
        <Sec id="noter" title="Tips och kommentarer" end={notesHead} level={2}>
          {notesEmpty && <p className="help">Inga tips om hästen än. Inga kommentarer än.</p>}
          {tipsBody}
          {!d && detail.error ? <DetailError onRetry={retry} /> : !d ? <SkeletonBlock rows={2} /> : <CommentList c={comments} />}
          <NewComment key={`${start.id}-${comments.draftId}`} id={`nc-${start.id}`} onSave={comments.saveDraft} onDelete={comments.deleteDraft} onDone={comments.nextDraft} />
          <p className="help">Följer hästen till kommande omgångar.</p>
        </Sec>
      </div>
      {!race.cancelled && <MobileActions race={race} start={start} onToggle={onToggle} onTouch={touch} locked={locked} />}
    </div>
  );
});

// ---- Ramar --------------------------------------------------------------------------------

// En sektion: desktopcell (h3) eller mobilens panel (h2 med id för hoppknapparna).
function Sec({ id, title, end, children, level = 3, r2 }: { id?: string; title: string; end?: React.ReactNode; children: React.ReactNode; level?: 2 | 3; r2?: boolean }) {
  const hid = `${id ? `hk-${id}` : `c-${title.replace(/\W+/g, "")}`}-h`;
  const H = level === 2 ? "h2" : "h3";
  return (
    <section className={level === 2 ? "pn msec" : `cell${r2 ? " r2" : ""}`} id={id ? `hk-${id}` : undefined} aria-labelledby={hid}>
      <div className="pn-h">
        <H id={hid} tabIndex={level === 2 ? -1 : undefined}>
          {title}
        </H>
        {end && <span className="end">{end}</span>}
      </div>
      <div className="pn-b">{children}</div>
    </section>
  );
}

function DetailError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="stat-empty">
      <p>Kunde inte hämta</p>
      <button type="button" className="btn secondary sm" onClick={onRetry}>
        Försök igen
      </button>
    </div>
  );
}

// Utkorgens text ("Sparas …", "I kö (2)", "Sparat") efter första ändringen i
// kortet, eller när något för hästen väntar i utkorgen. null = visas inte.
function useSaveStatus(start: StartDto, touched: boolean): string | null {
  const { queue, status } = useOutbox();
  const pending = queue.some((q) => {
    const m = q.meta as { startId?: string; horseId?: string } | undefined;
    return m?.startId === start.id || m?.horseId === start.horse.id;
  });
  const [seenFor, setSeenFor] = useState<string | null>(null);
  useEffect(() => {
    if (pending) setSeenFor(start.id);
  }, [pending, start.id]);
  return touched || pending || seenFor === start.id ? status.text : null;
}

// ---- Tavlan -------------------------------------------------------------------------------

// Galopp, Bet och ny kusk. rows = mobilen (en rad per flagga, ny kusk med).
function Flags({ start, now, rows }: { start: StartDto; now: Date; rows?: boolean }) {
  const warning = start.form.warning;
  const mark = start.mark;
  if (!warning && !mark?.bet && !(rows && start.prevDriver)) return null;
  return (
    <div className={rows ? "mflags" : "hb-flags"}>
      {warning && (
        <span className={`fl-g${warning.kind === "GD" ? " gd" : ""}`} aria-label={warning.text} title={warning.text}>
          <Badge kind={warning.kind === "GD" ? "gd" : "g"} />
          <span aria-hidden="true">{warning.text}</span>
        </span>
      )}
      {mark?.bet && (
        <span className="fl-b">
          <IconTicket />
          <b className="num">{mark.betOdds != null ? odds(mark.betOdds) : "Bet"}</b>
          <span>
            {mark.betAt ? `spelad ${relTime(mark.betAt, now)}` : "spelad"}
            {mark.unibetOdds != null && mark.unibetOdds !== mark.betOdds && ` · Unibet nu ${odds(mark.unibetOdds)}`}
          </span>
        </span>
      )}
      {rows && start.prevDriver && (
        <span className="fl-k">
          ↻ Ny kusk: {start.driver?.name ?? "–"} (förut {start.prevDriver.name})
        </span>
      )}
    </div>
  );
}

// Desktoptavlan i hästkortet (3.4 punkt 2): nummer, namn och info, flaggor och nyckeltal.
function HorseBoard({ start, edge, view, headingRef }: { start: StartDto; edge: PostEdge | null; view: RiktView; headingRef: React.ForwardedRef<HTMLHeadingElement> }) {
  const now = new Date();
  const info = [ageSex(start.horse.age, start.horse.sex), start.horse.record ? `rekord ${start.horse.record}` : null].filter(Boolean).join(" · ");
  return (
    <div className="hb brd">
      <FlapNumber n={start.number} signals={start.signals?.count} edge={start.scratched ? null : edge} />
      <div className="hb-id">
        <h2 id={`hk-${start.id}`} ref={headingRef} tabIndex={-1} className="nm" title={start.horse.name}>
          {start.horse.name}
        </h2>
        <p className="inf">
          {info}
          {start.prevDriver ? (
            <span className="chg">
              {" · "}↻ Ny kusk: {start.driver?.name ?? "–"} (förut {start.prevDriver.name})
            </span>
          ) : (
            <>
              {" · "}
              <b>{start.driver?.name ?? "Kusk saknas"}</b>
            </>
          )}
          {start.trainer && ` · tr ${start.trainer.name}`}
        </p>
      </div>
      <Flags start={start} now={now} />
      <RiktKeys v={view} variant="desk" />
    </div>
  );
}

// ---- Markeringar ----------------------------------------------------------------------------

function lockText(race: RaceDto, start: StartDto, now: Date): string | null {
  if (raceStarted(race, now.getTime())) return "Låst: loppet har startat";
  if (start.scratched) return `Låst: struken${start.scratchedAt ? ` ${relTime(start.scratchedAt, now)}` : ""}`;
  return null;
}

const betText = (start: StartDto) => (start.mark?.bet ? (start.mark.betOdds !== null ? "Spelad" : "Utan odds") : "Inte spelad");

// Intressant, Spelbar och Bet i valraden (3.4 punkt 3). Etikettraden visar
// ursprunget för Spelbar och läget för Bet, eller varför reglagen är låsta.
function MarkControls({ race, start, layout, onToggle, onTouch }: { race: RaceDto; start: StartDto; layout: "row"; onToggle: (v: boolean) => void; onTouch: () => void }) {
  const { setSpelbar, setBet } = useRound();
  const now = new Date();
  const started = raceStarted(race, now.getTime());
  const locked = started ? "Loppet har startat" : start.scratched ? "Hästen är struken" : null;
  const mark = start.mark;
  const on = !!mark?.interesting;
  const override = mark?.spelbarOverride ?? "NONE";
  const isSpelbar = !!mark?.spelbar;
  const lt = lockText(race, start, now);
  const spId = `sp-${start.id}`;
  return (
    <div className={layout === "row" ? "vg vg-m" : "mg"}>
      <span className="vl">
        <span>Markeringar</span>
        <span className="st">
          {lt ?? (
            <>
              <span id={`${spId}-o`}>S: {spelbarOrigin(isSpelbar, override).toLowerCase()}</span> · B: {betText(start).toLowerCase()}
              {override !== "NONE" && (
                <>
                  {" · "}
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => {
                      onTouch();
                      setSpelbar(race, start, "auto");
                    }}
                  >
                    Återställ
                  </button>
                </>
              )}
            </>
          )}
          {lt && (
            <span className="sr" id={`${spId}-o`}>
              {spelbarOrigin(isSpelbar, override)}
            </span>
          )}
        </span>
      </span>
      <div className="vc">
        <LampToggle
          labeled
          on={on}
          horseName={start.horse.name}
          disabledReason={locked}
          onToggle={() => {
            onTouch();
            onToggle(!on);
          }}
        />
        <SpelbarToggle
          bare
          id={spId}
          on={isSpelbar}
          override={override}
          disabledReason={locked}
          onToggle={() => {
            onTouch();
            setSpelbar(race, start, isSpelbar ? "off" : "on");
          }}
        />
        <BetToggle
          labeled
          on={!!mark?.bet}
          betOdds={mark?.betOdds}
          horseName={start.horse.name}
          disabledReason={started || (start.scratched && !mark?.bet) ? locked : null}
          onToggle={() => {
            onTouch();
            setBet(race, start, !mark?.bet);
          }}
        />
      </div>
    </div>
  );
}

// Mobilens statusrader i sektionen Riktodds (5.2 D).
function MarkStatus({ race, start, locked }: { race: RaceDto; start: StartDto; locked: string | null }) {
  const { setSpelbar } = useRound();
  const mark = start.mark;
  const override = mark?.spelbarOverride ?? "NONE";
  return (
    <div className="mstat">
      <p>
        Spelbar: {spelbarOrigin(!!mark?.spelbar, override).toLowerCase()}
        {override !== "NONE" && !locked && (
          <>
            {" · "}
            <button type="button" className="linkish" onClick={() => setSpelbar(race, start, "auto")}>
              Återställ till förslag
            </button>
          </>
        )}
      </p>
      <p>Bet: {betText(start).toLowerCase()}</p>
    </div>
  );
}

// Mobilens fasta knapplist (5.2 E): Intressant, Spelbar, Bet och X.
function MobileActions({ race, start, onToggle, onTouch, locked }: { race: RaceDto; start: StartDto; onToggle: (v: boolean) => void; onTouch: () => void; locked: string | null }) {
  const { setSpelbar, setBet, setXFactor } = useRound();
  const toast = useToast();
  const mark = start.mark;
  const on = !!mark?.interesting;
  const isSpelbar = !!mark?.spelbar;
  const x = xOf(mark);
  const xLocked = xLockReason(race, start);
  const started = raceStarted(race);
  const spId = `msp-${start.id}`;
  const lockId = `mact-l-${start.id}`;
  return (
    <div className="mact" role="group" aria-label={`Markeringar för ${start.horse.name}`} aria-describedby={locked ? lockId : undefined}>
      {locked && (
        <span className="sr" id={lockId}>
          Låst: {locked.toLowerCase()}
        </span>
      )}
      <span className="sr" id={`${spId}-o`}>
        {spelbarOrigin(isSpelbar, mark?.spelbarOverride ?? "NONE")}
      </span>
      <LampToggle
        labeled
        on={on}
        horseName={start.horse.name}
        disabledReason={locked}
        onToggle={() => {
          onTouch();
          onToggle(!on);
        }}
      />
      <SpelbarToggle
        bare
        id={spId}
        on={isSpelbar}
        override={mark?.spelbarOverride ?? "NONE"}
        disabledReason={locked}
        onToggle={() => {
          onTouch();
          setSpelbar(race, start, isSpelbar ? "off" : "on");
        }}
      />
      <BetToggle
        labeled
        on={!!mark?.bet}
        betOdds={mark?.betOdds}
        horseName={start.horse.name}
        disabledReason={started || (start.scratched && !mark?.bet) ? locked : null}
        onToggle={() => {
          onTouch();
          setBet(race, start, !mark?.bet);
        }}
      />
      <XCycleButton
        x={x}
        horseName={start.horse.name}
        locked={!!xLocked}
        onCycle={(e) => {
          if (xLocked) {
            toast({ text: `${xLocked}. X-faktorn går inte att ändra.` });
            return;
          }
          onTouch();
          setXFactor(race, start, nextXFactor(x, e.shiftKey));
        }}
      />
    </div>
  );
}

// ---- Mobilens hoppknappar och scroll-spy (5.3) ------------------------------------------------

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function MobileJump({ section, onSection, startId, detailReady }: { section: HkSection; onSection?: (s: HkSection) => void; startId: string; detailReady: boolean }) {
  const navRef = useRef<HTMLElement>(null);
  const lock = useRef<HkSection | null>(null);
  const idle = useRef<number | undefined>(undefined);
  const latest = useRef({ section, onSection });
  latest.current = { section, onSection };

  const set = (s: HkSection) => {
    if (s !== latest.current.section) latest.current.onSection?.(s);
  };

  // Aktiv sektion = den sista vars överkant har passerat linjen under
  // menyerna. Längst ned blir sista sektionen aktiv. Under ett hopp är
  // spyn låst på målet tills skrollningen har stått still i 150 ms.
  useEffect(() => {
    let raf = 0;
    const compute = () => {
      raf = 0;
      if (lock.current) return;
      const line = (navRef.current?.getBoundingClientRect().bottom ?? 108) + 8;
      const doc = document.documentElement;
      let cur: HkSection = "top";
      for (const s of HK_SECTIONS) {
        const el = document.getElementById(`hk-${s.id}`);
        if (el && el.getBoundingClientRect().top <= line + 1) cur = s.id;
      }
      if (cur !== "top" && window.scrollY + window.innerHeight >= doc.scrollHeight - 2) cur = HK_SECTIONS[HK_SECTIONS.length - 1].id;
      set(cur);
    };
    const onScroll = () => {
      if (lock.current) {
        window.clearTimeout(idle.current);
        idle.current = window.setTimeout(() => {
          lock.current = null;
          compute();
        }, 150);
        return;
      }
      if (!raf) raf = requestAnimationFrame(compute);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(idle.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Den aktiva länken scrollas in i raden i sidled (utan att sidan flyttas lodrätt).
  useEffect(() => {
    const nav = navRef.current;
    const a = nav?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!nav || !a) return;
    const l = a.offsetLeft - 16;
    const r = a.offsetLeft + a.offsetWidth + 16 - nav.clientWidth;
    if (nav.scrollLeft > l) nav.scrollLeft = l;
    else if (nav.scrollLeft < r) nav.scrollLeft = r;
  }, [section]);

  // Byte av häst (‹ ›): samma sektion visas för nästa häst. Görs om en gång
  // när detaljen har laddats och höjderna ändrats, om Mikael inte har skrollat själv.
  const pending = useRef<HkSection | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const target = latest.current.section;
    const restore = () => {
      if (target === "top") window.scrollTo(0, 0);
      else {
        lock.current = target;
        document.getElementById(`hk-${target}`)?.scrollIntoView({ block: "start", behavior: "auto" });
        window.clearTimeout(idle.current);
        idle.current = window.setTimeout(() => (lock.current = null), 150);
      }
    };
    restore();
    pending.current = target;
    const cancel = () => (pending.current = null);
    const opts = { passive: true, once: true } as const;
    window.addEventListener("wheel", cancel, opts);
    window.addEventListener("touchmove", cancel, opts);
    window.addEventListener("keydown", cancel, opts);
    return () => {
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchmove", cancel);
      window.removeEventListener("keydown", cancel);
    };
  }, [startId]);
  useEffect(() => {
    const target = pending.current;
    if (!detailReady || target === null) return;
    pending.current = null;
    if (target === "top") window.scrollTo(0, 0);
    else {
      lock.current = target;
      document.getElementById(`hk-${target}`)?.scrollIntoView({ block: "start", behavior: "auto" });
      window.clearTimeout(idle.current);
      idle.current = window.setTimeout(() => (lock.current = null), 150);
    }
  }, [detailReady, startId]);

  const jump = (id: HkSection) => {
    const el = document.getElementById(`hk-${id}`);
    if (!el) return;
    lock.current = id;
    set(id);
    el.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    el.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    // Om sidan inte skrollar alls (redan på plats) släpps låset ändå.
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => (lock.current = null), 400);
  };

  return (
    <nav className="mjump" aria-label="Hoppa till avsnitt" ref={navRef}>
      {HK_SECTIONS.map((s) => (
        <a
          key={s.id}
          href={`#hk-${s.id}`}
          aria-current={section === s.id ? "location" : undefined}
          onClick={(e) => {
            e.preventDefault();
            jump(s.id);
          }}
        >
          {s.jump}
        </a>
      ))}
    </nav>
  );
}

// ---- Signaler -----------------------------------------------------------------------------

// Stapeln (10 × 8 px) och "2 av 10" i sektionens rubrik.
function SignalSummary({ count }: { count: number }) {
  return (
    <>
      <span className={`sigh${count >= MANY_SIGNALS ? " many" : ""}`} role="img" aria-label={`${count} av 10 positiva signaler`}>
        {SIGNAL_KEYS.map((k, i) => (
          <i key={k} className={i < count ? "on" : undefined} />
        ))}
      </span>
      <b className="num" aria-hidden="true">
        {count} av 10
      </b>
    </>
  );
}

// Positiva signaler (lib/positive-signals.ts): hjälptexten, Lågt streck och
// alla tio signalerna med värde och gräns.
function SignalsBlock({ start }: { start: StartDto }) {
  const sig = start.signals!;
  const lines = signalLines(sig, { driver: start.driver?.name ?? null, trainer: start.trainer?.name ?? null });
  const top3 = TOP3_BY_COUNT[Math.min(sig.count, 6)];
  return (
    <>
      <p className="help">
        Hästar med {sig.count >= 6 ? "6 eller fler" : sig.count} signaler kom topp 3 i {top3} % av fallen i backtestet.
      </p>
      {sig.lowStreck && (
        <p className="lowbox">
          <LowStreckTag /> Minst 4 signaler men inte bland loppets 3 mest streckade. Sådana hästar kom topp 3 i 25–26 % av fallen, strecket sa 20 %.
        </p>
      )}
      {sig.lowStreck === null && sig.count >= 4 && <p className="help">Streck saknas än, så Lågt streck kan inte bedömas.</p>}
      <ul className="siglist">
        {lines.map((l) => (
          <li key={l.key} className={l.state}>
            <span className="sig-i" aria-hidden="true">
              {l.state === "ok" ? "✓" : l.state === "unknown" ? "?" : "–"}
            </span>
            <b>{l.label}</b>
            <span>{l.text}</span>
            <span className="sr">{l.state === "ok" ? ", uppfylld" : l.state === "unknown" ? ", okänt" : ", inte uppfylld"}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function SkeletonBlock({ rows }: { rows: number }) {
  return (
    <div className="sk-block" aria-busy="true" aria-label="Laddar">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} width={`${85 - i * 9}%`} />
      ))}
    </div>
  );
}

// ---- Statistik ----------------------------------------------------------------------------

// Grönt från 50 % vinst och 75 % plats med minst 5 starter (lib/signals.ts).
function yearLine(y: YearStatsDto | null, what: "win" | "place", signal = true): React.ReactNode {
  if (!y || !y.starts) return "–";
  const v = what === "win" ? y.winPct : y.placePct;
  const sg = signal ? pctSignal(what, v, y.starts) : null;
  return (
    <span className={signalClass(sg)}>
      {pct(v, 0)}
      <span className="sr">{signalSr(sg)}</span>
    </span>
  );
}

const krNum = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : thousands(v));

// Statistiken som tabell med I år, I fjol och Totalt (3.4, kan ändras), och
// spår, kusk och tränare under. Alla tolv värden från den tidigare listan finns med.
function StatsTable({ d, race }: { d: StartDetailResponse; race: RaceDto }) {
  const h = d.stats.horse;
  const lifeEarn = h.life?.earnings ?? d.start.horse.earnings;
  const perStart = h.life?.starts ? (lifeEarn ?? 0) / h.life.starts : null;
  const starts = (y: YearStatsDto | null) => (y ? String(y.starts) : "–");
  const edgeOf = postEdge(race.statsLine, d.start.number);
  return (
    <>
      <table className="stt">
        <caption className="sr">Statistik för {d.start.horse.name} per år</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr">Mått</span>
            </th>
            <th scope="col">I år</th>
            <th scope="col">I fjol</th>
            <th scope="col">Totalt</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Starter</th>
            <td>{starts(h.thisYear)}</td>
            <td>{starts(h.lastYear)}</td>
            <td>{starts(h.life)}</td>
          </tr>
          <tr>
            <th scope="row">Vinst %</th>
            <td>{yearLine(h.thisYear, "win")}</td>
            <td>{yearLine(h.lastYear, "win")}</td>
            <td>{yearLine(h.life, "win", false)}</td>
          </tr>
          <tr>
            <th scope="row">Plats %</th>
            <td>{yearLine(h.thisYear, "place")}</td>
            <td>{yearLine(h.lastYear, "place")}</td>
            <td>{yearLine(h.life, "place", false)}</td>
          </tr>
          <tr>
            <th scope="row">Intjänat, kr</th>
            <td>{krNum(h.thisYear?.earnings)}</td>
            <td>{krNum(h.lastYear?.earnings)}</td>
            <td>{krNum(lifeEarn)}</td>
          </tr>
          <tr>
            <th scope="row">Per start, kr</th>
            <td className="dimv">–</td>
            <td className="dimv">–</td>
            <td>{krNum(perStart)}</td>
          </tr>
        </tbody>
      </table>
      <dl className="kv">
        <dt>
          {edgeOf === "v" || edgeOf === "vp" ? <EdgeKey edge={edgeOf} /> : null}
          Spår {d.start.number}, {race.distance} m {race.startMethod === "VOLTE" ? "volte" : "auto"}, vinst
        </dt>
        <dd>{d.stats.post ? pct(d.stats.post.pct) : "–"}</dd>
        {d.stats.post?.placePct != null && (
          <>
            <dt>
              {edgeOf === "p" ? <EdgeKey edge="p" /> : null}
              Spår {d.start.number}, plats{d.stats.post.label ? ` (${d.stats.post.label}, ${thousands(d.stats.post.races)} lopp)` : ""}
            </dt>
            <dd>{pct(d.stats.post.placePct)}</dd>
          </>
        )}
        <dt>Kusken vinner i år</dt>
        <dd>{yearLine(d.stats.driver, "win", false)}</dd>
        <dt>Tränaren vinner i år</dt>
        <dd>{yearLine(d.stats.trainer, "win", false)}</dd>
      </dl>
    </>
  );
}

// ---- Starter ------------------------------------------------------------------------------

function RecordsTable({ rows, horseName }: { rows: RecordDto[]; horseName: string }) {
  return (
    <div className="tscroll">
      <table className="starts">
        <caption className="sr">Senaste starter för {horseName}, nyast först</caption>
        <thead>
          <tr>
            <th scope="col">Datum</th>
            <th scope="col">Bana</th>
            <th scope="col">Dist.</th>
            <th scope="col" className="r">
              Spår
            </th>
            <th scope="col" className="r">
              Plac.
            </th>
            <th scope="col" className="r">
              Km-tid
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ch = placeChar(r);
            const cls = r.galloped ? "plc g" : ch === "1" ? "plc w" : ch === "2" ? "plc w2" : "plc";
            return (
              <tr key={`${r.date}-${r.trackName}`} className={r.galloped ? "gal" : undefined}>
                <td className="num">{shortDay(r.date)}</td>
                <td>{r.trackName}</td>
                <td className="num">{distShort(r.distance, r.startMethod)}</td>
                <td className="r num">{r.postPosition ?? "–"}</td>
                <td className="r">
                  <span className={cls} role="img" aria-label={placeLabel(r)}>
                    {ch}
                  </span>
                </td>
                <td className="r num">{r.kmTime ?? "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Records({ d, error, race, start, roundId, all }: { d: StartDetailResponse | null; error: string | null; race: RaceDto; start: StartDto; roundId: string; all: boolean }) {
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    try {
      await rawPost(`/api/rounds/${roundId}/fetch/races/${race.leg}`);
    } catch {
      // Felet syns i kortet efter nästa hämtning.
    }
    loadDetail(start.id, true);
    setRetrying(false);
  };
  if (!d) {
    if (error)
      return (
        <div className="stat-empty">
          <p>{error}</p>
          <button type="button" className="btn secondary sm" onClick={() => loadDetail(start.id, true)}>
            Försök igen
          </button>
        </div>
      );
    return <SkeletonBlock rows={5} />;
  }
  if (d.recordsError && !d.records.length)
    return (
      <div className="stat-empty">
        <p>Senaste starter kunde inte hämtas</p>
        <button type="button" className="btn secondary sm" disabled={retrying} onClick={() => void retry()}>
          {retrying ? "Hämtar …" : "Försök igen"}
        </button>
      </div>
    );
  if (!d.records.length) return <p className="stat-empty">Debuterar. Hästen har inga tidigare starter.</p>;
  return (
    <>
      <RecordsTable rows={all ? d.records : d.records.slice(0, 5)} horseName={start.horse.name} />
      <p className="help">0 = oplacerad, g = galopp, d = diskad.</p>
    </>
  );
}

// ---- Kommentarer ----------------------------------------------------------------------------

function commentWhen(c: CommentDto): string {
  const parts: string[] = [shortDay((c.round?.date ?? c.createdAt).slice(0, 10))];
  if (c.round) parts.push(c.round.trackName);
  if (c.leg) parts.push(c.round ? legName(c.round.gameType, c.leg) : `lopp ${c.leg}`);
  if (c.result) parts.push(c.result.disqualified ? "diskad" : c.result.place && c.result.place >= 1 ? ordinal(c.result.place) : "oplacerad");
  return parts.join(" · ");
}

type CommentsState = ReturnType<typeof useComments>;

// Kommentarerna om hästen med utkorgens ändringar ovanpå, och sparningen.
function useComments({ data, race, start, detail, onTouch }: { data: RoundResponse; race: RaceDto; start: StartDto; detail: StartDetailResponse | null; onTouch: () => void }) {
  const { queue } = useOutbox();
  const [draftId, setDraftId] = useState(() => newClientId());
  const horseId = start.horse.id;
  const roundId = data.round.id;
  const shownLegs = useShownLegs(roundId, data.races);
  // E8 8.2 rad 16: kommentar från samma omgång med dolt lopp visar ingen placering.
  const list = useMemo(
    () => (detail ? applyPendingComments(detail.comments, queue, horseId).filter((c) => c.clientId !== draftId).map((c) => (c.result && hidesCommentResult(c, roundId, shownLegs) ? { ...c, result: null } : c)) : []),
    [detail, queue, horseId, draftId, roundId, shownLegs],
  );
  const ctx = { round: { id: data.round.id, date: data.round.date, trackName: data.round.trackName, gameType: data.round.gameType }, leg: race.leg };
  const save = (clientId: string, body: CommentBody) => {
    onTouch();
    addToOutbox({ method: "PUT", url: `/api/comments/${clientId}`, body, meta: { kind: "comment", horseId, horseName: start.horse.name, clientId, ...ctx } });
  };
  const remove = (clientId: string) => {
    onTouch();
    addToOutbox({ method: "DELETE", url: `/api/comments/${clientId}`, meta: { kind: "comment-delete", horseId, horseName: start.horse.name, clientId } });
  };
  const body = (text: string, from?: CommentDto): CommentBody => ({
    horseId,
    startId: from ? from.startId : start.id,
    roundId: from ? from.roundId : data.round.id,
    kind: from ? from.kind : "NOTE",
    tags: from ? from.tags : [],
    text,
  });
  return {
    list,
    draftId,
    horseName: start.horse.name,
    startId: start.id,
    saveDraft: (text: string) => save(draftId, body(text)),
    deleteDraft: () => remove(draftId),
    nextDraft: () => setDraftId(newClientId()),
    edit: (c: PendingComment, text: string) => save(c.clientId, body(text, c)),
    remove: (c: PendingComment) => remove(c.clientId),
    undo: (c: PendingComment) => save(c.clientId, body(c.text, c)),
  };
}

// Hela listan med Redigera och Ta bort (mobilen och dialogen "Alla N kommentarer").
function CommentList({ c }: { c: CommentsState }) {
  if (!c.list.length) return <p className="help">Inga kommentarer om hästen än.</p>;
  return (
    <ul className="cmts">
      {c.list.map((x) => (
        <CommentItem key={x.clientId} c={x} horseName={c.horseName} onSave={(text) => c.edit(x, text)} onDelete={() => c.remove(x)} onUndo={() => c.undo(x)} />
      ))}
    </ul>
  );
}

// R2 K2 på desktop: den senaste kommentaren på en rad, "Alla N kommentarer"
// och fältet för en ny kommentar.
function CommentsCompact({ c, empty, loading, onAll }: { c: CommentsState; empty: boolean; loading: boolean; onAll: () => void }) {
  const last = c.list[0];
  return (
    <>
      {loading ? (
        <SkeletonBlock rows={1} />
      ) : last ? (
        <div className="cmt1">
          <span className="when">{commentWhen(last)}</span>
          {last.tags.map((t) => (
            <span key={t} className={`tag${t === "Galopp" || t === "Diskad" ? " bad" : ""}`}>
              {t}
            </span>
          ))}
          <span className="cmt1-t">{last.text.split("\n")[0]}</span>
        </div>
      ) : (
        !empty && <p className="help">Inga kommentarer än.</p>
      )}
      {c.list.length > 0 && (
        <button type="button" className="linkish cmt-all" aria-haspopup="dialog" onClick={onAll}>
          Alla {c.list.length} {c.list.length === 1 ? "kommentar" : "kommentarer"}
        </button>
      )}
      <NewComment key={`${c.startId}-${c.draftId}`} id={`nc-${c.startId}`} compact onSave={c.saveDraft} onDelete={c.deleteDraft} onDone={c.nextDraft} />
    </>
  );
}

function CommentItem({ c, horseName, onSave, onDelete, onUndo }: { c: PendingComment; horseName: string; onSave: (text: string) => void; onDelete: () => void; onUndo: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(c.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);
  const fid = `ed-${c.clientId}`;
  return (
    <li className="cmt">
      <span className="when">{commentWhen(c)}</span>
      {c.tags.length > 0 && (
        <div className="tags">
          {c.tags.map((t) => (
            <span key={t} className={`tag${t === "Galopp" || t === "Diskad" ? " bad" : ""}`}>
              {t}
            </span>
          ))}
        </div>
      )}
      {editing ? (
        <div className="field">
          <label className="flbl" htmlFor={fid}>
            Ändra kommentaren
          </label>
          <textarea id={fid} ref={ref} rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
          <div className="inline-btns">
            <button
              type="button"
              className="btn secondary sm"
              onClick={() => {
                if (text.trim() && text !== c.text) onSave(text.trim());
                setEditing(false);
              }}
            >
              Spara
            </button>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                setText(c.text);
                setEditing(false);
              }}
            >
              Avbryt
            </button>
          </div>
        </div>
      ) : (
        c.text && <p>{c.text}</p>
      )}
      {!editing && (
        <div className="inline-btns">
          <button type="button" className="btn ghost sm" onClick={() => setEditing(true)} aria-label={`Redigera kommentaren från ${commentWhen(c)}`}>
            Redigera
          </button>
          <button
            type="button"
            className="btn ghost sm"
            aria-label={`Ta bort kommentaren från ${commentWhen(c)}`}
            onClick={() => {
              onDelete();
              toast({ text: `Kommentaren om ${horseName} är borttagen.`, action: { label: "Ångra", onClick: onUndo } });
            }}
          >
            Ta bort
          </button>
        </div>
      )}
    </li>
  );
}

// Ny kommentar: sparas 1 s efter att Mikael slutat skriva och med Spara.
// Samma clientId tills kommentaren är klar, så att varje sparning bara
// uppdaterar den (PUT är idempotent och slås ihop i utkorgen).
// compact = desktopcellen: två rader och "Följer hästen …" bredvid Spara.
function NewComment({ id, onSave, onDelete, onDone, compact }: { id: string; onSave: (text: string) => void; onDelete: () => void; onDone: () => void; compact?: boolean }) {
  const [text, setText] = useState("");
  const saved = useRef("");
  const latest = useRef({ text: "", onSave, onDelete });
  latest.current = { text, onSave, onDelete };

  const flush = () => {
    const t = latest.current.text.trim();
    if (t === saved.current) return;
    if (t) latest.current.onSave(t);
    else if (saved.current) latest.current.onDelete();
    saved.current = t;
  };

  useEffect(() => {
    if (text.trim() === saved.current) return;
    const timer = window.setTimeout(flush, 1000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // Sparas också när kortet stängs eller hästen byts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => flush(), []);

  return (
    <div className={`field${compact ? " nc-c" : ""}`}>
      <label className="flbl" htmlFor={id}>
        Kommentar inför loppet
      </label>
      <textarea
        id={id}
        rows={compact ? 2 : 3}
        value={text}
        maxLength={4000}
        placeholder="Vad tror du om hästen i dag?"
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => {
          // Mobilen: fältet hamnar mitt på skärmen när tangentbordet visas.
          if (!compact) {
            const el = e.currentTarget;
            window.setTimeout(() => el.scrollIntoView({ block: "center" }), 300);
          }
        }}
      />
      <div className="inline-btns">
        <button
          type="button"
          className="btn secondary sm"
          disabled={!text.trim()}
          onClick={() => {
            flush();
            onDone();
          }}
        >
          Spara
        </button>
        {compact && <span className="help">Följer hästen till kommande omgångar.</span>}
      </div>
    </div>
  );
}
