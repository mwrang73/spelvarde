"use client";

// Live (E8, docs/specs/e8-live.md 5–8 och 14): se loppet, tagga direkt och i
// efterhand, och visa resultatet per lopp. Från 1100 px bredd en kolumn per häst,
// under det en häst i taget. Sidan laddar aldrig om vid byte av lopp eller häst.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMediaQuery, useNow, useOnline } from "@/components/hooks";
import { DeskHeader } from "@/components/shell/AppHeader";
import { isShown, concealLeg, revealLeg, useShownLegs } from "@/components/round/revealStore";
import { syncResults, useResultSync } from "@/components/round/resultsStore";
import { PhaseRail, RaceTabs } from "@/components/round/parts";
import { raceStarted, useRound } from "@/components/round/RoundProvider";
import { loadRaceTags, toggleRaceTag, undoRaceTag, useRaceTags, type TagCtx } from "@/components/round/tagStore";
import { Banner, EmptyState, Skeleton } from "@/components/ui/board";
import { IconBack, IconClock, IconFlag } from "@/components/ui/icons";
import { dayDate, shortRaceName } from "@/lib/format";
import { legName } from "@/lib/game-type";
import {
  BEFORE_TEXT,
  beforeTitle,
  CANCELLED_TEXT,
  CANCELLED_TITLE,
  defaultLiveLeg,
  digitStep,
  flushDigit,
  LIVE_DIGIT_WAIT_MS,
  LIVE_READ_WAIT_MS,
  liveResultList,
  newlyStartedLeg,
  parseLegParam,
  raceFacts,
  raceLine,
  rowNumbers,
  runnersOf,
  runningLeg,
  sayHidden,
  sayLeg,
  sayResultCame,
  sayShown,
  sayStarted,
  startsInOrder,
  taggedCount,
  WAITING_TEXT,
} from "@/lib/live-view";
import { QUICK_TAGS, quickTagForKey } from "@/lib/quick-tags";
import { resultMode, type ResultMode } from "@/lib/results-ui";
import { SUBMITTED_ROW_NONE, winnersInRow } from "@/lib/submitted-row";
import type { RaceDto, RoundResponse, StartDto } from "@/lib/types";
import { LiveBanners } from "./LiveBanners";
import { fritextIndex, LiveColumns, tagButtonId } from "./LiveColumns";
import { LiveResultList } from "./LiveResultList";
import { LiveSingle, LiveStrip } from "./LiveSingle";
import { LiveStatus } from "./LiveStatus";
import { useLiveTags } from "./useLiveTags";

const COLUMNS_QUERY = "(min-width: 1100px)";

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

function Shell({ columns, children, deskMeta }: { columns: boolean; children: React.ReactNode; deskMeta?: React.ReactNode }) {
  return (
    <div className={`lv ${columns ? "lv-cols" : "lv-one"}`}>
      <DeskHeader meta={deskMeta} />
      {children}
    </div>
  );
}

export function LivePage() {
  const { data, load, roundId, refresh } = useRound();
  const columns = useMediaQuery(COLUMNS_QUERY);
  const back = (
    <header className="ah brd m-only">
      <Link className="btn icon" href={`/omgang/${roundId}`} aria-label="Tillbaka till omgången">
        <IconBack />
      </Link>
      <div className="ah-t">
        <h1 className="ah-title">Live</h1>
      </div>
    </header>
  );
  if (!data) {
    if (load.error && !load.loading)
      return (
        <Shell columns={columns}>
          {back}
          <main className="lv-main" id="main">
            {load.notFound ? (
              <Banner tone="info" className="m10" actions={<Link href="/">Till aktuell omgång</Link>}>
                Omgången finns inte.
              </Banner>
            ) : (
              <Banner
                tone="err"
                className="m10"
                actions={
                  <button type="button" className="btn secondary sm" onClick={() => void refresh()}>
                    Försök igen
                  </button>
                }
              >
                {load.error}
              </Banner>
            )}
          </main>
        </Shell>
      );
    return (
      <Shell columns={columns}>
        {back}
        <LiveSkeleton columns={columns} />
      </Shell>
    );
  }
  if (!data.races.length)
    return (
      <Shell columns={columns}>
        {back}
        <main className="lv-main" id="main">
          <EmptyState icon={<IconFlag />} title="Inga lopp än" text="Startlistan är inte hämtad.">
            <Link className="btn secondary" href={`/omgang/${roundId}`}>
              Till omgången
            </Link>
          </EmptyState>
        </main>
      </Shell>
    );
  return <Live key={data.round.id} data={data} columns={columns} />;
}

function LiveSkeleton({ columns }: { columns: boolean }) {
  return (
    <main className="lv-main" id="main" aria-busy="true" aria-label="Laddar Live">
      <div className={columns ? "lband brd" : "mavs brd"} aria-hidden="true">
        <Skeleton width="100%" height={columns ? 52 : 44} />
      </div>
      <div className="lv-sk" aria-hidden="true">
        {Array.from({ length: columns ? 10 : 4 }, (_, i) => (
          <Skeleton key={i} width="100%" height={columns ? 420 : 46} />
        ))}
      </div>
    </main>
  );
}

function Live({ data, columns }: { data: RoundResponse; columns: boolean }) {
  const roundId = data.round.id;
  const races = data.races;
  const nowDate = useNow(15_000);
  const now = nowDate.getTime();
  const tagInfo = useLiveTags(roundId, races, now);

  // Loppet väljs en gång när sidan öppnas, aldrig igen medan Mikael är kvar (3.2).
  const [{ leg: wantLeg, hast }] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return { leg: parseLegParam(q.get("avd"), races), hast: q.get("hast") };
  });
  const [leg, setLeg] = useState<number | null>(wantLeg);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (leg !== null) return;
    const t = window.setTimeout(() => setWaited(true), LIVE_READ_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [leg]);
  useEffect(() => {
    if (leg === null) setLeg(defaultLiveLeg(races, tagInfo.taggedOf, Date.now(), waited));
  }, [leg, races, tagInfo, waited]);

  if (leg === null)
    return (
      <Shell columns={columns}>
        <LiveSkeleton columns={columns} />
      </Shell>
    );
  const race = races.find((r) => r.leg === leg) ?? races[0];
  return <LiveRace data={data} race={race} columns={columns} now={now} tagged={tagInfo.tagged} initialHast={hast} onLeg={setLeg} />;
}

type RaceProps = {
  data: RoundResponse;
  race: RaceDto;
  columns: boolean;
  now: number;
  tagged: ReturnType<typeof useLiveTags>["tagged"];
  initialHast: string | null;
  onLeg: (leg: number) => void;
};

function LiveRace({ data, race, columns, now, tagged, initialHast, onLeg }: RaceProps) {
  const { round, races, phaseRail } = data;
  const roundId = round.id;
  const gameType = round.gameType;
  const leg = race.leg;
  const base = `/omgang/${roundId}`;
  const name = legName(gameType, leg);
  const hoverKeys = useMediaQuery("(hover: hover)");
  const online = useOnline();
  const sync = useResultSync(roundId);

  const tags = useRaceTags(roundId, leg);
  const shownLegs = useShownLegs(roundId, races);
  const shown = isShown(race, shownLegs);
  const mode: ResultMode = resultMode(race, now);
  const started = !race.cancelled && raceStarted(race, now);
  const running = runningLeg(races, now) === leg;
  const line = raceLine(race, mode, shown, running);
  const read: "loaded" | "loading" | "failed" = tags.loaded ? "loaded" : tags.error ? "failed" : "loading";
  const ready = tags.loaded && started;
  const submitted = data.submittedRow ?? null;
  const inRow = useMemo(() => rowNumbers(submitted, leg), [submitted, leg]);
  const starts = useMemo(() => startsInOrder(race), [race]);
  const runners = useMemo(() => runnersOf(race), [race]);
  const scratched = useMemo(() => starts.filter((s) => s.scratched).map((s) => ({ start: s, inRow: inRow.includes(s.number) })), [starts, inRow]);

  const [activeId, setActiveId] = useState<string | null>(() => (initialHast && race.starts.some((s) => s.id === initialHast && !s.scratched) ? initialHast : null));
  const [focusIndex, setFocusIndex] = useState(0);
  const [fritextFor, setFritextFor] = useState<string | null>(null);
  const [fritextSignal, setFritextSignal] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [arrivedLeg, setArrivedLeg] = useState<number | null>(null);
  const cur = runners.find((s) => s.id === activeId) ?? runners[0] ?? null;
  const curIdx = cur ? runners.indexOf(cur) : -1;
  const prev = curIdx > 0 ? runners[curIdx - 1] : null;
  const next = curIdx >= 0 && curIdx < runners.length - 1 ? runners[curIdx + 1] : null;
  const say = useCallback((t: string) => setAnnounce((p) => (p === t ? `${t} ` : t)), []);

  const ctx = useMemo<TagCtx>(() => ({ roundId, roundDate: round.date, trackName: round.trackName, gameType, race }), [roundId, round.date, round.trackName, gameType, race]);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  // Adressen: `hast` försvinner vid första byte av häst eller lopp (3.1).
  const clearHast = useCallback(
    (toLeg: number) => {
      window.history.replaceState(null, "", `${base}/live?avd=${toLeg}`);
    },
    [base],
  );

  const headRef = useRef<HTMLHeadingElement>(null);
  const listHeadRef = useRef<HTMLHeadingElement>(null);
  const revealBtn = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<"list" | "button" | "horse" | null>(null);

  const selectHorse = useCallback(
    (id: string, focusHeading = false) => {
      setActiveId(id);
      clearHast(leg);
      if (focusHeading) pendingFocus.current = "horse";
    },
    [clearHast, leg],
  );

  const onActivate = useCallback((id: string) => selectHorse(id), [selectHorse]);
  const onToggle = useCallback((start: StartDto, tag: string, index: number) => {
    setActiveId(start.id);
    setFocusIndex(index);
    if (toggleRaceTag(ctxRef.current, start, tag)) navigator.vibrate?.(10);
  }, []);

  const openedAt = useRef(Date.now());
  const startedLeg = newlyStartedLeg(races, openedAt.current, now, leg, dismissed);

  const changeLeg = useCallback(
    (to: number) => {
      const clamped = Math.max(races[0]?.leg ?? 1, Math.min(races[races.length - 1]?.leg ?? 1, to));
      if (clamped === leg) return;
      const target = races.find((r) => r.leg === clamped);
      if (!target) return;
      onLeg(clamped);
      setActiveId(null);
      setFocusIndex(0);
      setFritextFor(null);
      setArrivedLeg(null);
      setDismissed((d) => (startedLeg !== null && !d.includes(startedLeg) ? [...d, startedLeg] : d));
      clearHast(clamped);
      say(sayLeg(gameType, target));
    },
    [races, leg, onLeg, clearHast, say, gameType, startedLeg],
  );

  // Resultatet kommer medan loppet är öppet: läses upp utan namn.
  const prevResult = useRef({ leg, resultAt: race.resultAt });
  useEffect(() => {
    const p = prevResult.current;
    if (p.leg === leg && !p.resultAt && race.resultAt && !shown) {
      setArrivedLeg(leg);
      say(sayResultCame(gameType, leg));
    }
    prevResult.current = { leg, resultAt: race.resultAt };
  }, [leg, race.resultAt, shown, gameType, say]);

  const announcedStart = useRef<number | null>(null);
  useEffect(() => {
    if (startedLeg === null || announcedStart.current === startedLeg) return;
    announcedStart.current = startedLeg;
    say(sayStarted(gameType, startedLeg, leg));
  }, [startedLeg, gameType, leg, say]);

  const reveal = useCallback(() => {
    pendingFocus.current = "list";
    revealLeg(roundId, leg);
    setArrivedLeg(null);
    say(sayShown(gameType, leg));
  }, [roundId, leg, gameType, say]);
  const hide = useCallback(() => {
    pendingFocus.current = "button";
    concealLeg(roundId, leg);
    say(sayHidden(gameType, leg));
  }, [roundId, leg, gameType, say]);

  useEffect(() => {
    const p = pendingFocus.current;
    if (!p) return;
    pendingFocus.current = null;
    if (p === "list") listHeadRef.current?.focus({ preventScroll: true });
    else if (p === "button") revealBtn.current?.focus();
    else headRef.current?.focus({ preventScroll: true });
  });

  const legStep = (delta: number) => {
    const i = races.findIndex((r) => r.leg === leg);
    const t = races[Math.max(0, Math.min(races.length - 1, i + delta))];
    if (t) changeLeg(t.leg);
  };

  // ---- Tangenter (14.3) ----
  const digit = useRef<{ pending: string | null; timer: number | null }>({ pending: null, timer: null });
  const numbers = useMemo(() => runners.map((s) => s.number), [runners]);
  const pickNumber = useCallback(
    (n: number | null) => {
      if (n === null) return null;
      const s = runners.find((x) => x.number === n);
      if (s) selectHorse(s.id, !columns);
      return s ?? null;
    },
    [runners, selectHorse, columns],
  );
  const clearDigit = () => {
    if (digit.current.timer !== null) window.clearTimeout(digit.current.timer);
    digit.current = { pending: null, timer: null };
  };
  const listOpen = shown;

  useEffect(() => {
    const focusTag = (startId: string, i: number) =>
      window.requestAnimationFrame(() => {
        document.getElementById(tagButtonId(startId, i))?.focus();
      });
    const inTags = () => document.activeElement instanceof HTMLElement && !!document.activeElement.closest(".tbn, .qc button");
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || document.querySelector("dialog[open]")) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;
      if (mod && (k === "z" || k === "Z") && !listOpen) {
        e.preventDefault();
        undoRaceTag();
        return;
      }
      if (mod || e.altKey) return;
      if (k === "?") {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      if (k === "Escape") {
        setHelpOpen(false);
        setFritextFor(null);
        return;
      }
      if (k === "PageUp" || k === "PageDown") {
        e.preventDefault();
        legStep(k === "PageDown" ? 1 : -1);
        return;
      }
      if (listOpen || !started) return;
      if (/^[0-9]$/.test(k)) {
        if (e.repeat) return;
        e.preventDefault();
        const step = digitStep(digit.current.pending, k, numbers);
        clearDigit();
        pickNumber(step.pick);
        if (step.pending) {
          const first = step.pending;
          digit.current = {
            pending: first,
            timer: window.setTimeout(() => {
              digit.current = { pending: null, timer: null };
              pickNumber(flushDigit(first, numbers));
            }, LIVE_DIGIT_WAIT_MS),
          };
        }
        return;
      }
      // Regeln mot fel häst: väntande siffra gäller direkt, innan tangenten utförs.
      const flushed = pickNumber(flushDigit(digit.current.pending, numbers));
      clearDigit();
      const target = flushed ?? cur;
      if (k === "+") {
        e.preventDefault();
        if (!ready || !target) return;
        if (columns) setFritextFor(target.id);
        else setFritextSignal((x) => x + 1);
        return;
      }
      if (k === "z" || k === "Z") {
        e.preventDefault();
        if (!e.repeat) undoRaceTag();
        return;
      }
      if (k === "ArrowLeft" || k === "ArrowRight") {
        const to = k === "ArrowLeft" ? prev : next;
        e.preventDefault();
        if (!to) return;
        const moveFocus = inTags();
        selectHorse(to.id, !columns && !moveFocus);
        if (moveFocus) focusTag(to.id, focusIndex);
        return;
      }
      if (k === "ArrowUp" || k === "ArrowDown") {
        if (!target) return;
        e.preventDefault();
        const max = columns ? fritextIndex : QUICK_TAGS.length - 1;
        const i = inTags() ? Math.max(0, Math.min(max, focusIndex + (k === "ArrowDown" ? 1 : -1))) : focusIndex;
        setFocusIndex(i);
        focusTag(target.id, i);
        return;
      }
      if (k.length !== 1 || e.repeat) return;
      const tag = quickTagForKey(k);
      if (!tag || !target || !ready) return;
      e.preventDefault();
      if (toggleRaceTag(ctxRef.current, target, tag)) navigator.vibrate?.(10);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => clearDigit, []);

  // ---- Delar ----
  const rows = useMemo(() => (shown ? liveResultList(race, submitted, (id) => tags.byStart[id]?.tags ?? []) : []), [shown, race, submitted, tags.byStart]);
  const score = shown ? winnersInRow(submitted, races, shownLegs).text : null;
  const count = taggedCount(runners, tags.byStart);
  const fetchBusy = sync.running;
  const fetchResult = () => void syncResults(roundId, true);

  const control = (compact: boolean) => {
    if (mode === "waiting") return <span className="rh">Väntar på resultat</span>;
    if (mode === "late")
      return (
        <>
          {!compact && <span className="rh">Resultatet har inte kommit än</span>}
          <button type="button" className={`btn ${compact ? "ghost" : "secondary"} sm lv-cb`} disabled={fetchBusy || !online} onClick={fetchResult}>
            {fetchBusy ? "Hämtar …" : "Hämta resultat"}
          </button>
        </>
      );
    if (mode !== "result") return null;
    if (shown)
      return (
        <button type="button" className={`btn ${compact ? "ghost" : "secondary"} sm lv-cb`} onClick={hide}>
          Dölj resultat
        </button>
      );
    return (
      <>
        {!compact && <span className="rh">Resultatet är dolt</span>}
        <button ref={revealBtn} type="button" className={`btn ${compact ? "ghost" : "secondary"} sm lv-cb`} onClick={reveal}>
          Visa resultat
        </button>
      </>
    );
  };

  const banners = (
    <LiveBanners
      roundId={roundId}
      gameType={gameType}
      race={race}
      mode={mode}
      shown={shown}
      arrived={arrivedLeg === leg}
      onReveal={reveal}
      startedLeg={startedLeg}
      onLeg={changeLeg}
      readFailed={started && read === "failed"}
      onRetryRead={() => loadRaceTags(roundId, leg, true)}
    />
  );
  const before = (
    <EmptyState icon={<IconClock />} title={beforeTitle(gameType, race)} text={BEFORE_TEXT}>
      <Link className="btn secondary" href={`${base}/avd/${leg}`}>
        Till analysen
      </Link>
    </EmptyState>
  );
  const cancelled = <EmptyState icon={<IconFlag />} title={CANCELLED_TITLE} text={CANCELLED_TEXT} />;
  const list = <LiveResultList ref={listHeadRef} gameType={gameType} leg={leg} rows={rows} />;
  const earlier = !data.isCurrent && data.currentRoundId;
  const help = helpOpen && (
    <aside className="kbh" aria-label="Tangenter">
      <h2>Tangenter</h2>
      <kbd>1</kbd>–<kbd>15</kbd> väljer häst · bokstäverna taggar
      <br />
      <kbd>←</kbd> <kbd>→</kbd> häst · <kbd>↑</kbd> <kbd>↓</kbd> tagg
      <br />
      <kbd>+</kbd> fritext · <kbd>Z</kbd> ångra
      <br />
      <kbd>PgUp</kbd> <kbd>PgDn</kbd> byter lopp
      <br />
      <kbd>?</kbd> visar hjälpen · <kbd>Esc</kbd> stänger
    </aside>
  );
  const helpBtn = (cls: string) => (
    <button type="button" className={cls} aria-label="Tangenter" aria-expanded={helpOpen} onClick={() => setHelpOpen((v) => !v)}>
      ?
    </button>
  );
  const live = (
    <p className="sr" aria-live="polite">
      {announce}
    </p>
  );
  const tabs = <RaceTabs gameType={gameType} races={races} selected={leg} onSelect={changeLeg} panelId="live-panel" variant="live" tagged={tagged} now={now} compact={!columns} />;

  // ---- Kolumner, från 1100 px ----
  if (columns) {
    const showGrid = mode !== "cancelled" && !shown;
    return (
      <Shell
        columns
        deskMeta={
          <>
            {gameType} · {round.trackName} · {dayDate(round.date)}
            {earlier && (
              <>
                <br />
                Det här är en tidigare omgång. <Link href="/">Till aktuell omgång</Link>
              </>
            )}
          </>
        }
      >
        <nav className="lband brd" aria-label="Lopp och faser">
          {tabs}
          <PhaseRail steps={phaseRail} analysHref={`${base}/avd/${leg}`} oddsHref={`${base}/odds`} liveHref={`${base}/live`} activePage="LIVE" variant="seg" />
        </nav>
        <div className="rbar brd">
          <div className="rt">
            <h1 title={race.name}>
              {name} · {shortRaceName(race.name)}
            </h1>
            <span className="rbs" title={mode === "waiting" && !running ? WAITING_TEXT : line.text}>
              {raceFacts(race)} · {line.pulse && <i className="pulse" aria-hidden="true" />}
              {line.text}
            </span>
          </div>
          <div className="rc">{control(false)}</div>
          {score && <span className="score">{score}</span>}
          {started && !shown ? <LiveStatus roundId={roundId} read={read} /> : <span className="lv-sp" />}
          {started && !shown && !submitted && <span className="rh">{SUBMITTED_ROW_NONE}</span>}
          {started && !shown && (
            <span className="tcnt">
              <b className="num">{count}</b> av {runners.length} taggade
            </span>
          )}
          {helpBtn("btn icon lv-q")}
        </div>
        <main className="dmain" id="live-panel" role="tabpanel" aria-labelledby={`tab-${leg}`}>
          {banners}
          {showGrid && (
            <LiveColumns race={race} starts={starts} byStart={tags.byStart} rowNumbers={inRow} activeId={cur?.id ?? null} focusIndex={focusIndex} ready={ready} showTags={started} fritextFor={fritextFor} ctx={ctx} onActivate={onActivate} onToggle={onToggle} onFritext={setFritextFor} />
          )}
          {mode === "before" && before}
          {mode === "cancelled" && cancelled}
          {shown && list}
        </main>
        {help}
        {live}
      </Shell>
    );
  }

  // ---- En häst i taget, under 1100 px ----
  const showSingle = started && !shown && !!cur;
  return (
    <Shell
      columns={false}
      deskMeta={
        <>
          {gameType} · {round.trackName} · {dayDate(round.date)}
        </>
      }
    >
      <header className="ah brd">
        <Link className="btn icon" href={base} aria-label="Tillbaka till omgången">
          <IconBack />
        </Link>
        <div className="ah-t">
          <h1 className="ah-title">Live · {name}</h1>
          <span className="ah-sub">
            {line.pulse && <i className="pulse" aria-hidden="true" />}
            {line.text}
          </span>
        </div>
        <div className="rc">{mode === "waiting" ? null : control(true)}</div>
        {hoverKeys && helpBtn("btn icon lv-q")}
      </header>
      <div className="lv-top">
        {tabs}
        {showSingle && <LiveStrip legLabel={name} runners={runners} byStart={tags.byStart} rowNumbers={inRow} currentId={cur.id} onSelect={(id) => selectHorse(id, true)} />}
        {shown && score && (
          <div className="tstrip-h brd">
            <span className="score">{score}</span>
          </div>
        )}
      </div>
      <main className="lv-body" id="live-panel" role="tabpanel" aria-labelledby={`tab-${leg}`}>
        {earlier && (
          <div className="ban thin">
            <p>
              Det här är en tidigare omgång. <Link href="/">Till aktuell omgång</Link>
            </p>
          </div>
        )}
        {banners}
        {mode === "before" && before}
        {mode === "cancelled" && cancelled}
        {shown && list}
        {showSingle && (
          <LiveSingle key={cur.id} ref={headRef} race={race} ctx={ctx} start={cur} mine={tags.byStart[cur.id]} inRow={inRow.includes(cur.number)} ready={ready} scratched={scratched} focusIndex={focusIndex} onToggle={onToggle} fritextSignal={fritextSignal}>
            <LiveStatus roundId={roundId} read={read} />
            <p className="tstat lv-cnt">
              <span className="tcnt">
                <b className="num">{count}</b> av {runners.length} taggade
              </span>
              {!submitted && <span className="help">{SUBMITTED_ROW_NONE}</span>}
            </p>
            {mode === "waiting" && !running && <p className="help lv-scr">{WAITING_TEXT}</p>}
          </LiveSingle>
        )}
      </main>
      {showSingle && (
        <div className="tnav">
          <button type="button" className="btn secondary" disabled={!prev} onClick={() => prev && selectHorse(prev.id, true)} aria-label={prev ? `Föregående häst: ${prev.number} ${prev.horse.name}` : "Ingen föregående häst"}>
            ‹ {prev && <span className="tn">{prev.number} {prev.horse.name}</span>}
          </button>
          <button type="button" className="btn primary nx" disabled={!next} onClick={() => next && selectHorse(next.id, true)} aria-label={next ? `Nästa häst: ${next.number} ${next.horse.name}` : "Ingen nästa häst"}>
            {next && <span className="tn">{next.number} {next.horse.name}</span>} ›
          </button>
        </div>
      )}
      {help}
      {live}
    </Shell>
  );
}
