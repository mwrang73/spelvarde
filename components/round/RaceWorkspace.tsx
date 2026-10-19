"use client";

// S2 Avdelningen och S3 Hästkortet (specen 5, S2/S3, och 4 och 9.1).
//
// Samma komponent visar /omgang/[id]/avd/[nr] och …/avd/[nr]/hast/[startId].
// Vilken avdelning och häst som visas läses ur adressen (usePathname). Byte
// av avdelning (flik, svep, ←/→) och av häst görs med history.replaceState /
// pushState, som Next 14 synkar med usePathname utan att hämta något från
// servern. All data kommer ur omgångens cache (RoundProvider), så bytet gör
// inget nätverksanrop.
//
// Mobil: listan, eller hästkortet som helsida. Desktop (≥ 1024 px): tre
// kolumner med avdelningar, startlistan och hästkortet för vald rad.
// Layouten växlar med CSS, så att sidan inte blinkar vid första ritningen.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DESKTOP_QUERY, useIsDesktop } from "@/components/hooks";
import { AppHeader } from "@/components/shell/AppHeader";
import { Banner, FlapNumber, FormStrip, GallopBadge, LampToggle, Skeleton } from "@/components/ui/board";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { ageSex, dayDate, hhmm, kr, methodLabel, pct, shortRaceName } from "@/lib/format";
import { PHASE_LABELS } from "@/lib/phase";
import type { RaceDto, RoundResponse, StartDto } from "@/lib/types";
import { nextXFactor } from "@/lib/xfactor";
import { xOf } from "@/lib/xfactor-ui";
import { refetchStats, useFetchChain } from "./fetchChain";
import { HorseCard } from "./HorseCard";
import { Counts, MarkBadges, PhaseRail, RaceTabs, RiktCell, RoundLinks, firstTodoLeg } from "./parts";
import { RaceStatsContent } from "./RaceStats";
import { loadRaceStats, useRaceStats } from "./raceStatsStore";
import { useRound } from "./RoundProvider";
import { prefetchDetails } from "./roundStore";
import { xLockReason } from "./XFactor";

const PATH_RE = /^\/omgang\/([^/]+)\/avd\/(\d+)(?:\/hast\/([^/]+))?\/?$/;

export function parseRacePath(pathname: string): { leg: number; startId: string | null } {
  const m = PATH_RE.exec(pathname);
  return { leg: m ? Math.max(1, Math.min(8, parseInt(m[2], 10))) : 1, startId: m?.[3] ?? null };
}

function go(url: string, mode: "push" | "replace") {
  if (window.location.pathname === url) return;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

export function RaceWorkspace() {
  const { data, load, roundId, setInteresting, setReviewed, setXFactor } = useRound();
  const pathname = usePathname() ?? "";
  const { leg, startId } = parseRacePath(pathname);

  if (!data) return <WorkspaceSkeleton leg={leg} roundId={roundId} error={load.loading ? null : load.error} notFound={load.notFound} />;
  const race = data.races.find((r) => r.leg === leg);
  if (!race)
    return (
      <>
        <AppHeader title={`Avd ${leg}`} back={{ href: `/omgang/${roundId}`, label: "Tillbaka till omgången" }} />
        <main className="page" id="main">
          <Banner tone="info" className="m10">
            Avdelningen finns inte i omgången.
          </Banner>
        </main>
      </>
    );
  return <Workspace data={data} race={race} startId={startId} setInteresting={setInteresting} setReviewed={setReviewed} setXFactor={setXFactor} />;
}

function Workspace({
  data,
  race,
  startId,
  setInteresting,
  setReviewed,
  setXFactor,
}: {
  data: RoundResponse;
  race: RaceDto;
  startId: string | null;
  setInteresting: (race: RaceDto, start: StartDto, v: boolean) => void;
  setReviewed: (race: RaceDto, v: boolean) => void;
  setXFactor: ReturnType<typeof useRound>["setXFactor"];
}) {
  const roundId = data.round.id;
  const leg = race.leg;
  const isDesktop = useIsDesktop();
  const toast = useToast();
  const chain = useFetchChain();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pushed = useRef(false);
  const lastOpened = useRef<string | null>(null);
  const listScroll = useRef(0);
  const [statsOpen, setStatsOpen] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const start = useMemo(() => (startId ? race.starts.find((s) => s.id === startId) ?? null : null), [race, startId]);
  const view: "list" | "horse" = start ? "horse" : "list";
  const base = `/omgang/${roundId}`;
  const avdUrl = useCallback((n: number) => `${base}/avd/${n}`, [base]);
  const hastUrl = useCallback((n: number, sid: string) => `${base}/avd/${n}/hast/${sid}`, [base]);

  const selectLeg = useCallback(
    (n: number) => {
      const to = Math.max(1, Math.min(data.races.length, n));
      if (to === leg && !startId) return;
      pushed.current = false;
      go(avdUrl(to), "replace");
      if (!window.matchMedia(DESKTOP_QUERY).matches) window.scrollTo(0, 0);
    },
    [avdUrl, data.races.length, leg, startId],
  );

  const openHorse = useCallback(
    (s: StartDto) => {
      if (window.matchMedia(DESKTOP_QUERY).matches) {
        go(hastUrl(leg, s.id), "replace");
        return;
      }
      listScroll.current = window.scrollY;
      lastOpened.current = s.id;
      pushed.current = true;
      go(hastUrl(leg, s.id), "push");
      window.scrollTo(0, 0);
    },
    [hastUrl, leg],
  );

  const backToList = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else go(avdUrl(leg), "replace");
  }, [avdUrl, leg]);

  const toggle = useCallback(
    (s: StartDto, value: boolean) => {
      if (race.started) {
        toast({ text: "Loppet har startat. Intressant går inte att ändra." });
        return;
      }
      if (s.scratched) return;
      setInteresting(race, s, value);
    },
    [race, setInteresting, toast],
  );

  // Tangenten X (Shift + X baklänges) stegar X-faktorn (6.8). Låst häst:
  // ingenting ändras, och toasten (role="status") läser upp varför.
  const stepX = useCallback(
    (s: StartDto, backwards: boolean) => {
      const locked = xLockReason(race, s);
      if (locked) {
        toast({ text: `${locked}. X-faktorn går inte att ändra.` });
        return;
      }
      setXFactor(race, s, nextXFactor(xOf(s.mark), backwards));
    },
    [race, setXFactor, toast],
  );

  // Fokus: rubriken i hästkortet när det öppnas i mobilen, och tillbaka till
  // raden när listan visas igen.
  const prevView = useRef(view);
  useEffect(() => {
    const changed = prevView.current !== view;
    prevView.current = view;
    if (isDesktop || !changed) return;
    if (view === "horse") {
      headingRef.current?.focus({ preventScroll: true });
    } else if (lastOpened.current) {
      const id = lastOpened.current;
      lastOpened.current = null;
      window.scrollTo(0, listScroll.current);
      document.querySelector<HTMLElement>(`.mlist [data-start="${id}"] .who`)?.focus({ preventScroll: true });
    }
  }, [view, isDesktop]);

  // Förhandsladda grannhästarnas hästkort när en häst är vald.
  useEffect(() => {
    if (!start) return;
    const i = race.starts.findIndex((s) => s.id === start.id);
    prefetchDetails([race.starts[i + 1]?.id, race.starts[i - 1]?.id, race.starts[i + 2]?.id].filter((x): x is string => !!x));
  }, [start, race.starts]);

  // Desktop: statistikrutorna behöver loppstatistiken. Den hämtas för alla
  // avdelningar en gång, så att avdelningsbyte inte går mot nätet.
  useEffect(() => {
    if (!isDesktop) return;
    data.races.forEach((r) => loadRaceStats(roundId, r.leg));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop, roundId]);

  // Tangentbord: ←/→ avdelning, X för X-faktorn i hästkortet (S3, och vald
  // rad på desktop), och på desktop ↑/↓ vald rad, Enter hästkortet och I för
  // Intressant.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
    if (document.querySelector("dialog[open]")) return;
    const inTabs = e.target instanceof Element && !!e.target.closest('[role="tablist"]');
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !inTabs) {
      e.preventDefault();
      selectLeg(leg + (e.key === "ArrowRight" ? 1 : -1));
      return;
    }
    if ((e.key === "x" || e.key === "X") && start) {
      e.preventDefault();
      stepX(start, e.shiftKey);
      return;
    }
    if (!window.matchMedia(DESKTOP_QUERY).matches) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const i = start ? race.starts.findIndex((s) => s.id === start.id) : -1;
      const next = race.starts[Math.max(0, Math.min(race.starts.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) {
        go(hastUrl(leg, next.id), "replace");
        document.querySelector(`.tbl [data-start="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
      }
      return;
    }
    const onButton = e.target instanceof HTMLElement && (e.target.tagName === "BUTTON" || e.target.tagName === "A");
    if (e.key === "Enter" && start && !onButton) {
      e.preventDefault();
      headingRef.current?.focus();
      return;
    }
    if ((e.key === "i" || e.key === "I") && start) {
      e.preventDefault();
      toggle(start, !start.mark?.interesting);
    }
  };
  useEffect(() => {
    const fn = (e: KeyboardEvent) => keys.current(e);
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, []);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touch.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current;
    const t = e.changedTouches[0];
    touch.current = null;
    if (!s || !t) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5) selectLeg(leg + (dx < 0 ? 1 : -1));
  };

  const title = start ? `${start.number} ${start.horse.name}` : `Avd ${leg} · ${hhmm(race.startAt)}`;
  const sub = start ? `Avd ${leg} · ${hhmm(race.startAt)} · ${race.distance} m ${methodLabel(race.startMethod)}` : shortRaceName(race.name);
  const statsBusy = chain.kind === "running";
  const missingStats = (
    <>
      <span>Statistik saknas just nu</span>
      <button type="button" className="btn ghost sm" disabled={statsBusy} onClick={() => void refetchStats(roundId)}>
        {statsBusy ? "Hämtar …" : "Hämta igen"}
      </button>
    </>
  );

  return (
    <>
      <div className={`stick${view === "horse" ? " is-horse" : ""}`}>
        <AppHeader
          title={title}
          sub={sub}
          back={
            view === "horse"
              ? {
                  href: avdUrl(leg),
                  label: `Tillbaka till avd ${leg}`,
                  onClick: (e) => {
                    e.preventDefault();
                    backToList();
                  },
                }
              : { href: base, label: "Tillbaka till omgången" }
          }
          deskTitle={false}
          deskMeta={
            <>
              V85 · {data.round.trackName} · {dayDate(data.round.date)} {data.round.date.slice(0, 4)}
              <br />
              Fas: {PHASE_LABELS[data.phase].toLowerCase()}
            </>
          }
        />
        {view === "list" && (
          <div className="m-only">
            <RaceTabs races={data.races} selected={leg} onSelect={selectLeg} panelId="avd-panel" />
            <div className="strip brd">
              <div className="chips">
                <span className="chip num">{race.distance} m</span>
                <span className={`chip ${race.startMethod === "VOLTE" ? "chip-volte" : "chip-auto"}`}>{race.startMethod === "VOLTE" ? "Volte" : "Auto"}</span>
                {race.classLabel && (
                  <span className="chip chip-k" title={race.classLabel}>
                    {race.classLabel}
                  </span>
                )}
                <button type="button" className="chip chip-btn" aria-haspopup="dialog" onClick={() => setStatsOpen(true)}>
                  Loppstatistik ›
                </button>
              </div>
              <div className="statline">
                {race.statsLine.ok ? (
                  <>
                    {race.statsLine.bestNumber && (
                      <span>
                        Spår {race.statsLine.bestNumber.number} vinner <b>{pct(race.statsLine.bestNumber.pct)}</b>
                      </span>
                    )}
                    <span>
                      Spår 1 <b>{pct(race.statsLine.number1Pct)}</b>
                    </span>
                    <span>
                      Favorit vinner <b>{pct(race.statsLine.favoriteWinPct)}</b>
                    </span>
                  </>
                ) : (
                  missingStats
                )}
              </div>
            </div>
            <div className="cols g-an" aria-hidden="true">
              <span>Nr</span>
              <span>Häst · kusk</span>
              <span className="c">Form</span>
              <span className="r">Rikt</span>
              <span className="c">Intr.</span>
            </div>
          </div>
        )}
      </div>

      <main className="ws" data-view={view} id="main">
        <nav className="dside d-only" aria-label="Avdelningar">
          <PhaseRail steps={data.phaseRail} analysHref={`${base}/avd/${firstTodoLeg(data.races)}`} oddsHref={`${base}/odds`} className="rail-side" />
          <ul className="vlist">
            {data.races.map((r) => (
              <li key={r.id}>
                <a
                  className="vt"
                  href={avdUrl(r.leg)}
                  aria-current={r.leg === leg ? "page" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    selectLeg(r.leg);
                  }}
                >
                  <span className="an num">{r.leg}</span>
                  <span className="aname">
                    {shortRaceName(r.name)}
                    <small>
                      {hhmm(r.startAt)} · {r.distance} {methodLabel(r.startMethod)}
                    </small>
                  </span>
                  {r.reviewed ? <Counts interesting={r.counts.interesting} spelbar={r.counts.spelbar} bet={r.counts.bet} /> : <span className="todo sm">Ej genomg.</span>}
                </a>
              </li>
            ))}
          </ul>
          <RoundLinks roundId={roundId} className="side" />
        </nav>

        <div className="dmain" id="avd-panel" role="tabpanel" aria-labelledby={`tab-${leg}`}>
          {/* Mobil: täta rader. */}
          <ul className="list mlist m-only" aria-label={`Startlista avdelning ${leg}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            {race.starts.map((s, i) => (
              <StartRow key={s.id} s={s} index={i} started={race.started} href={hastUrl(leg, s.id)} onOpen={openHorse} onToggle={toggle} />
            ))}
          </ul>

          {/* Desktop: loppet på tavlan och tabellen. */}
          <section className="drace brd d-only" aria-labelledby="race-h">
            <span className="k">
              Avd {leg} · start {hhmm(race.startAt)} · {race.counts.starters} hästar
              {race.counts.scratched > 0 && ` · ${race.counts.scratched} strukna`}
            </span>
            <h1 id="race-h" title={race.name}>
              {shortRaceName(race.name)}
            </h1>
            <div className="chips">
              <span className="chip num">{race.distance} m</span>
              <span className={`chip ${race.startMethod === "VOLTE" ? "chip-volte" : "chip-auto"}`}>{race.startMethod === "VOLTE" ? "Volte" : "Auto"}</span>
              {race.classLabel && <span className="chip chip-k">{race.classLabel}</span>}
              {race.prize !== null && <span className="chip num">1:a pris {kr(race.prize)}</span>}
              <button type="button" className="chip chip-btn" aria-expanded={statsOpen} aria-controls="dstats-panel" onClick={() => setStatsOpen((v) => !v)}>
                Loppstatistik {statsOpen ? "‹" : "›"}
              </button>
            </div>
            {race.statsLine.ok ? <DeskStats race={race} roundId={roundId} /> : <div className="statline d-miss">{missingStats}</div>}
          </section>
          {isDesktop && statsOpen && (
            <section className="dpanel d-only" id="dstats-panel" aria-label="Loppstatistik">
              <RaceStatsContent roundId={roundId} race={race} trackName={data.round.trackName} />
            </section>
          )}
          <div className="twrap d-only">
            <table className="tbl">
              <caption className="sr">
                Startlista avdelning {leg}. Välj rad med pil upp och ned, Enter öppnar hästkortet, I växlar Intressant och X stegar X-faktorn.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Nr</th>
                  <th scope="col">Häst</th>
                  <th scope="col">Kusk / tränare</th>
                  <th scope="col" className="c">
                    Form
                  </th>
                  <th scope="col" className="r">
                    Vinst
                  </th>
                  <th scope="col" className="r">
                    Plats
                  </th>
                  <th scope="col" className="r">
                    Spår %
                  </th>
                  <th scope="col" className="r">
                    Rikt
                  </th>
                  <th scope="col" className="c">
                    <abbr title="Intressant">Intr.</abbr>
                  </th>
                </tr>
              </thead>
              <tbody>
                {race.starts.map((s, i) => (
                  <DeskRow key={s.id} s={s} index={i} selected={s.id === start?.id} started={race.started} href={hastUrl(leg, s.id)} onOpen={openHorse} onToggle={toggle} />
                ))}
              </tbody>
            </table>
            <p className="help">
              Vinst och plats: hela karriären (ATG). Spår %: startnumrets vinst % på distansen och startmetoden (travstatistik.se). Rikt: riktodds för plats, modell {data.model?.key ?? "v1"}, okalibrerad. Med X-faktor står riktoddset med X överst och det vanliga under. * = osäkert.
            </p>
          </div>

          <ReviewBar race={race} setReviewed={setReviewed} />
        </div>

        <aside className="daside" aria-label="Vald häst">
          {start ? (
            <HorseCard ref={headingRef} data={data} race={race} start={start} onToggle={(v) => toggle(start, v)} />
          ) : (
            <div className="pick d-only">
              <p>Välj en häst i listan för att se hästkortet.</p>
              <p className="help">Pil upp och ned väljer rad, Enter går till hästkortet, I växlar Intressant och X stegar X-faktorn (Shift + X baklänges).</p>
            </div>
          )}
        </aside>
      </main>

      <Sheet open={statsOpen && !isDesktop} onClose={() => setStatsOpen(false)} title="Loppstatistik" sub={`Avd ${leg} · ${race.distance} m ${methodLabel(race.startMethod)} · ${data.round.trackName}`}>
        <RaceStatsContent roundId={roundId} race={race} trackName={data.round.trackName} />
      </Sheet>
    </>
  );
}

// ---- Rader -----------------------------------------------------------------------------

type RowProps = { s: StartDto; index: number; started: boolean; href: string; onOpen: (s: StartDto) => void; onToggle: (s: StartDto, v: boolean) => void };

function Driver({ s }: { s: StartDto }) {
  if (s.prevDriver) return <span className="kt chg">↻ Ny: {s.driver?.name ?? "–"}</span>;
  return <span className="kt">{s.driver?.name ?? "Kusk saknas"}</span>;
}

function StartRow({ s, index, started, href, onOpen, onToggle }: RowProps) {
  const on = !!s.mark?.interesting;
  return (
    <li className={`row g-an${on ? " is-i" : ""}${s.scratched ? " scr" : ""}`} data-start={s.id}>
      <FlapNumber n={s.number} index={index} />
      <a
        className="who"
        href={href}
        onClick={(e) => {
          e.preventDefault();
          onOpen(s);
        }}
      >
        <span className="hl">
          <span className="sr">Nr {s.number}, </span>
          <span className="hn">{s.horse.name}</span>
          <MarkBadges s={s} />
          {!s.scratched && <GallopBadge flag={s.form.gallop} />}
          {s.scratched && <span className="tag scr-tag">Struken</span>}
        </span>
        <Driver s={s} />
      </a>
      <FormStrip boxes={s.form.boxes} ariaLabel={s.form.ariaLabel} />
      <RiktCell s={s} />
      <LampToggle on={on} horseName={s.horse.name} disabledReason={started ? "Loppet har startat" : s.scratched ? "Hästen är struken" : null} onToggle={() => onToggle(s, !on)} />
    </li>
  );
}

function DeskRow({ s, index, selected, started, href, onOpen, onToggle }: RowProps & { selected: boolean }) {
  const on = !!s.mark?.interesting;
  return (
    <tr className={`${on ? "is-i " : ""}${selected ? "sel " : ""}${s.scratched ? "scr" : ""}`} data-start={s.id} onClick={() => onOpen(s)} aria-current={selected ? "true" : undefined}>
      <td>
        <FlapNumber n={s.number} index={index} />
      </td>
      <td>
        <a
          className="who"
          href={href}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpen(s);
          }}
        >
          <span className="hl">
            <span className="sr">Nr {s.number}, </span>
            <span className="hn">{s.horse.name}</span>
            <MarkBadges s={s} />
            {!s.scratched && <GallopBadge flag={s.form.gallop} />}
            {s.scratched && <span className="tag scr-tag">Struken</span>}
          </span>
          <span className="kt">{[ageSex(s.horse.age, s.horse.sex), s.horse.record].filter(Boolean).join(" · ")}</span>
        </a>
      </td>
      <td>
        {s.prevDriver ? <span className="chg">↻ Ny: {s.driver?.name ?? "–"}</span> : <span>{s.driver?.name ?? "–"}</span>}
        <br />
        <span className="kt">{s.trainer ? `tr ${s.trainer.name}` : ""}</span>
      </td>
      <td className="c">
        <FormStrip boxes={s.form.boxes} ariaLabel={s.form.ariaLabel} />
      </td>
      <td className="r num">{pct(s.quick.winPct, 0)}</td>
      <td className="r num">{pct(s.quick.placePct, 0)}</td>
      <td className="r num">{pct(s.quick.postPct)}</td>
      <td className="r">
        <RiktCell s={s} className="rk num dk" two />
      </td>
      <td className="c">
        <LampToggle on={on} horseName={s.horse.name} disabledReason={started ? "Loppet har startat" : s.scratched ? "Hästen är struken" : null} onToggle={() => onToggle(s, !on)} />
      </td>
    </tr>
  );
}

function DeskStats({ race, roundId }: { race: RaceDto; roundId: string }) {
  const stats = useRaceStats(roundId, race.leg);
  const line = race.statsLine;
  const top = stats.data?.drivers.rows.filter((r) => r.league).sort((a, b) => (b.league?.wins ?? 0) - (a.league?.wins ?? 0))[0] ?? null;
  const m = `${race.distance} ${methodLabel(race.startMethod)}`;
  return (
    <div className="dstats">
      <div>
        <small>{line.bestNumber ? `Spår ${line.bestNumber.number} · ${m}` : `Bästa spår · ${m}`}</small>
        <b className="num">{pct(line.bestNumber?.pct ?? null)}</b>
        <span>bästa spåret</span>
      </div>
      <div>
        <small>Spår 1 · {m}</small>
        <b className="num">{pct(line.number1Pct)}</b>
        <span>vinst</span>
      </div>
      <div>
        <small>Favorit vinner</small>
        <b className="num">{pct(line.favoriteWinPct)}</b>
        <span>av V85-loppen</span>
      </div>
      <div>
        <small>Kuskligan V85</small>
        <b className="num">{top?.league ? top.league.wins : "–"}</b>
        <span>{top ? top.rawName ?? top.name : stats.loading ? "hämtar …" : "ingen i ligan"}</span>
      </div>
    </div>
  );
}

function ReviewBar({ race, setReviewed }: { race: RaceDto; setReviewed: (race: RaceDto, v: boolean) => void }) {
  if (race.review?.noneInteresting && race.counts.interesting === 0)
    return (
      <p className="review done" role="status">
        <span>Genomgången</span>
        {" · "}
        <button type="button" className="linkish" onClick={() => setReviewed(race, false)}>
          Ångra
        </button>
      </p>
    );
  if (race.counts.interesting > 0 || race.review) return null;
  return (
    <div className="review">
      <button type="button" className="btn secondary full" onClick={() => setReviewed(race, true)}>
        Inga intressanta här
      </button>
    </div>
  );
}

// ---- Laddar ------------------------------------------------------------------------------

function WorkspaceSkeleton({ leg, roundId, error, notFound }: { leg: number; roundId: string; error: string | null; notFound: boolean }) {
  return (
    <>
      <div className="stick">
        <AppHeader title={`Avd ${leg}`} sub="Laddar …" back={{ href: `/omgang/${roundId}`, label: "Tillbaka till omgången" }} deskTitle={false} />
        <div className="avd brd m-only" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="avd-t" aria-selected={i + 1 === leg}>
              {i + 1}
            </span>
          ))}
        </div>
      </div>
      <main className="page" id="main">
        {error ? (
          <Banner tone={notFound ? "info" : "err"} className="m10" actions={notFound ? <Link href="/">Till aktuell omgång</Link> : undefined}>
            {notFound ? "Omgången finns inte." : error}
          </Banner>
        ) : (
          <ul className="list" aria-busy="true" aria-label="Laddar startlistan">
            {Array.from({ length: 12 }, (_, i) => (
              <li key={i} className="row g-an sk-row">
                <FlapNumber n={i + 1} />
                <span className="who">
                  <Skeleton width="70%" height={14} />
                  <Skeleton width="45%" height={10} />
                </span>
                <Skeleton width="48px" height={18} />
                <span />
                <span />
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
