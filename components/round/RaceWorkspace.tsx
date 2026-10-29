"use client";

// S2 Avdelningen och S3 Hästkortet (specen 5, S2/S3, och 4 och 9.1, och
// docs/specs/analysvy-layout.md).
//
// Samma komponent visar /omgang/[id]/avd/[nr] och …/avd/[nr]/hast/[startId].
// Vilken avdelning och häst som visas läses ur adressen (usePathname). Byte
// av avdelning (flik, svep, ←/→) och av häst görs med history.replaceState /
// pushState, som Next 14 synkar med usePathname utan att hämta något från
// servern. All data kommer ur omgångens cache (RoundProvider), så bytet gör
// inget nätverksanrop.
//
// Desktop (≥ 1024 px): rutnätet med zonraden (Avdelning, Fas, Verktyg),
// loppet och hästkortet. Sidan skrollar inte. Mobil: listan, eller
// hästkortet som en lång sida.
//
// Historiken i mobilen (7.3): kortet öppnas med pushState({ sv: "hast" }), och
// ← kör history.back() när posten är appens egen. Next 14.2 behåller eget
// state i pushState/replaceState (copyNextJsInternalHistoryState lägger bara
// till sina egna fält, och HistoryUpdater bevarar window.history.state när
// preserveCustomHistoryState är satt), så `sv` i history.state används och
// ingen modulvariabel behövs. Det är provat i webbläsaren, även efter omladdning.

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DESKTOP_QUERY, useIsDesktop, useMediaQuery, useNow } from "@/components/hooks";
import { AppHeader, type HorseNav } from "@/components/shell/AppHeader";
import { Banner, FlapNumber, FormStrip, GallopBadge, LampToggle, LowStreckTag, signalsSr, Skeleton } from "@/components/ui/board";
import { TipTag } from "@/components/tips/RoleTag";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { ageSex, dayDate, hhmm, kr, methodLabel, money, pct, shortRaceName } from "@/lib/format";
import { FEATURES } from "@/lib/features";
import { PHASE_LABELS } from "@/lib/phase";
import { resultMode, showsResultToggle } from "@/lib/results-ui";
import { unibetRaceUrl } from "@/lib/odds-ui";
import type { RaceDto, RoundResponse, StartDto } from "@/lib/types";
import { nextXFactor } from "@/lib/xfactor";
import { xOf } from "@/lib/xfactor-ui";
import { modelLabel } from "./Riktodds";
import { refetchStats, useFetchChain } from "./fetchChain";
import { HK_SECTIONS, HorseCard, type HkSection } from "./HorseCard";
import { MarkBadges, RaceTabs, RiktCell } from "./parts";
import { RaceResult, ResultSkeleton } from "./RaceResult";
import { RaceStatsContent } from "./RaceStats";
import { loadRaceStats, useRaceStats } from "./raceStatsStore";
import { RoundBand } from "./RoundBand";
import { raceStarted, useRound } from "./RoundProvider";
import { TagCta, TagRace } from "./TagRace";
import { prefetchDetails } from "./roundStore";
import { xLockReason } from "./XFactor";
import { pctSignal, signalClass, signalSr } from "@/lib/signals";
import { RefreshBanner, RefreshBoardButton } from "./StreckOdds";

const PATH_RE = /^\/omgang\/([^/]+)\/avd\/(\d+)(?:\/hast\/([^/]+))?\/?$/;

export function parseRacePath(pathname: string): { leg: number; startId: string | null } {
  const m = PATH_RE.exec(pathname);
  return { leg: m ? Math.max(1, Math.min(8, parseInt(m[2], 10))) : 1, startId: m?.[3] ?? null };
}

// Appens egna historikposter i mobilen (7.3).
type Sv = "hast" | "avd";
const svOf = (): Sv | undefined => (window.history.state as { sv?: Sv } | null)?.sv;

// url kan ha en sökdel (?vy=resultat, E4a). sv = state för posten. Utan sv
// behåller replace postens nuvarande sv (byte av häst och ?vy=resultat).
function go(url: string, mode: "push" | "replace", sv?: Sv | null) {
  if (window.location.pathname + window.location.search === url) return;
  const keep = mode === "replace" ? svOf() : undefined;
  const value = sv === undefined ? keep : sv ?? undefined;
  const state = value ? { sv: value } : null;
  if (mode === "push") window.history.pushState(state, "", url);
  else window.history.replaceState(state, "", url);
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

const WIDE_QUERY = "(min-width: 1800px)";
const TABLE_KEY = "sv-tabell";
const SECTION_KEY = "sv-hk-sek";

export function RaceWorkspace() {
  const { data, load, roundId, setInteresting, setReviewed, setXFactor } = useRound();
  const pathname = usePathname() ?? "";
  const { leg, startId } = parseRacePath(pathname);
  const wantsResult = useSearchParams()?.get("vy") === "resultat";

  if (!data) return <WorkspaceSkeleton leg={leg} roundId={roundId} error={load.loading ? null : load.error} notFound={load.notFound} result={wantsResult} />;
  const race = data.races.find((r) => r.leg === leg);
  if (!race)
    return (
      <>
        <AppHeader title={`Avd ${leg}`} back={{ href: `/omgang/${roundId}`, label: "Tillbaka till omgången", text: "Omgång" }} />
        <main className="page" id="main">
          <Banner tone="info" className="m10">
            Avdelningen finns inte i omgången.
          </Banner>
        </main>
      </>
    );
  return <Workspace data={data} race={race} startId={startId} setInteresting={setInteresting} setReviewed={setReviewed} setXFactor={setXFactor} />;
}

// Flest positiva signaler först, sedan startnummer. Strukna sist.
function sortBySignals(starts: StartDto[]): StartDto[] {
  return [...starts].sort((a, b) => Number(a.scratched) - Number(b.scratched) || (b.signals?.count ?? -1) - (a.signals?.count ?? -1) || a.number - b.number);
}

function readStore(storage: "local" | "session", key: string): string | null {
  try {
    return (storage === "local" ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
}
function writeStore(storage: "local" | "session", key: string, value: string) {
  try {
    (storage === "local" ? localStorage : sessionStorage).setItem(key, value);
  } catch {
    // Blockerad lagring: valet gäller bara den här sidvisningen.
  }
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
  const isWide = useMediaQuery(WIDE_QUERY);
  const toast = useToast();
  const chain = useFetchChain();
  const deskHeading = useRef<HTMLHeadingElement>(null);
  const mobHeading = useRef<HTMLHeadingElement>(null);
  const lastOpened = useRef<string | null>(null);
  const listScroll = useRef(0);
  const [statsOpen, setStatsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [announce, setAnnounce] = useState("");
  // Sortering på antal positiva signaler (Nr-rubriken). Sparas i webbläsaren.
  const [bySignals, setBySignals] = useState(false);
  // Tabell (3.6): bred tabell under 1800 px. Sparas i webbläsaren.
  const [tableMode, setTableMode] = useState(false);
  // Mobilens hästkort: vald sektion (5.3). Sparas för sessionen.
  const [section, setSectionState] = useState<HkSection>("top");
  useEffect(() => {
    setBySignals(readStore("local", SORT_KEY) === "signaler");
    setTableMode(readStore("local", TABLE_KEY) === "1");
    const s = readStore("session", SECTION_KEY);
    if (s && HK_SECTIONS.some((x) => x.id === s)) setSectionState(s as HkSection);
  }, []);
  const setSection = useCallback((s: HkSection) => {
    setSectionState(s);
    writeStore("session", SECTION_KEY, s);
  }, []);
  const toggleSort = () =>
    setBySignals((v) => {
      writeStore("local", SORT_KEY, v ? "nr" : "signaler");
      return !v;
    });
  const toggleTable = () =>
    setTableMode((v) => {
      writeStore("local", TABLE_KEY, v ? "0" : "1");
      return !v;
    });
  const touch = useRef<{ x: number; y: number } | null>(null);

  const start = useMemo(() => (startId ? race.starts.find((s) => s.id === startId) ?? null : null), [race, startId]);
  const orderOf = useCallback((r: RaceDto) => (bySignals ? sortBySignals(r.starts) : r.starts), [bySignals]);
  // Raderna i visningsordning: startnummer, eller flest signaler först (strukna sist).
  const ordered = useMemo(() => orderOf(race), [race, orderOf]);
  const view: "list" | "horse" = start ? "horse" : "list";
  const base = `/omgang/${roundId}`;
  const wide = isWide || tableMode;

  // E4a: segmentkontrollen "Startlista | Resultat" när loppet har startat
  // eller är inställt. Resultat är förvalt; valet står kvar vid byte till en
  // annan avdelning som också har startat. URL:en visar valet (?vy=resultat).
  const now = useNow(15_000).getTime();
  const [listChosen, setListChosen] = useState(false);
  const canResult = showsResultToggle(race, now);
  const showResult = canResult && !listChosen;
  const vy = showResult ? "?vy=resultat" : "";
  // Rutan Streck · odds behövs inte när avdelningen har startat.
  const oddsOpen = !race.cancelled && !raceStarted(race, now);
  const avdUrl = useCallback((n: number, q = "") => `${base}/avd/${n}${q}`, [base]);
  const hastUrl = useCallback((n: number, sid: string, q = "") => `${base}/avd/${n}/hast/${sid}${q}`, [base]);

  // Adressen följer valet (router-fritt, som flikarna: ingen omladdning).
  useEffect(() => {
    const path = window.location.pathname;
    const has = new URLSearchParams(window.location.search).get("vy") === "resultat";
    if (has !== showResult) go(path + (showResult ? "?vy=resultat" : ""), "replace");
  }, [showResult, leg, startId]);

  // Desktop (3.8): /avd/N utan häst väljer den första hästen i listans
  // ordning, så att hästkortet aldrig är tomt. Mobilen visar listan.
  const firstId = ordered[0]?.id;
  useEffect(() => {
    if (isDesktop && !startId && firstId) go(hastUrl(leg, firstId, vy), "replace");
  }, [isDesktop, startId, firstId, leg, vy, hastUrl]);

  // Mobilen (7.3): direktlänk eller omladdning på hästkortets adress. Listan
  // läggs in bakom kortet en gång, så att både ← och telefonens bakåt går dit.
  const historyFixed = useRef(false);
  useEffect(() => {
    if (historyFixed.current || isDesktop || view !== "horse" || !start) return;
    historyFixed.current = true;
    if (svOf()) return;
    const here = window.location.pathname + window.location.search;
    window.history.replaceState({ sv: "avd" }, "", avdUrl(leg, vy));
    window.history.pushState({ sv: "hast" }, "", here);
  }, [isDesktop, view, start, avdUrl, leg, vy]);

  const horseLabel = (s: StartDto) => `${s.number} ${s.horse.name}`;
  const say = (text: string) => setAnnounce((prev) => (prev === text ? `${text} ` : text));

  // Byte av häst med ↑/↓ och ‹ › (replace i historiken). Läses upp, fokus flyttas inte.
  const selectHorse = useCallback(
    (s: StartDto, speak: boolean) => {
      go(hastUrl(leg, s.id, vy), "replace");
      if (speak) {
        const i = ordered.findIndex((x) => x.id === s.id);
        say(`Häst ${i + 1} av ${ordered.length}: ${s.horse.name}`);
      }
    },
    [hastUrl, leg, vy, ordered],
  );

  const selectLeg = useCallback(
    (n: number) => {
      const to = Math.max(1, Math.min(data.races.length, n));
      if (to === leg && (startId || !window.matchMedia(DESKTOP_QUERY).matches)) return;
      const target = data.races.find((r) => r.leg === to);
      if (!target) return;
      const result = showsResultToggle(target, Date.now()) && !listChosen;
      const q = result ? "?vy=resultat" : "";
      if (window.matchMedia(DESKTOP_QUERY).matches) {
        const first = orderOf(target)[0];
        go(first ? hastUrl(to, first.id, q) : avdUrl(to, q), "replace");
      } else {
        go(avdUrl(to, q), "replace");
        window.scrollTo(0, 0);
      }
      if (to !== leg) say(`Avdelning ${to}, ${shortRaceName(target.name)}, ${target.counts.starters} hästar`);
    },
    [avdUrl, hastUrl, data.races, leg, startId, listChosen, orderOf],
  );

  const openHorse = useCallback(
    (s: StartDto) => {
      if (window.matchMedia(DESKTOP_QUERY).matches) {
        go(hastUrl(leg, s.id, vy), "replace");
        return;
      }
      listScroll.current = window.scrollY;
      lastOpened.current = s.id;
      // Öppna från listan: alltid överst i kortet (5.3).
      setSection("top");
      go(hastUrl(leg, s.id, vy), "push", "hast");
      window.scrollTo(0, 0);
    },
    [hastUrl, leg, vy, setSection],
  );

  // ← i hästkortet (7.3): appens egen post backas, annars ersätts den med listan.
  const backToList = useCallback(() => {
    if (svOf() === "hast") window.history.back();
    else go(avdUrl(leg, vy), "replace", "avd");
  }, [avdUrl, leg, vy]);

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
      mobHeading.current?.focus({ preventScroll: true });
    } else if (lastOpened.current) {
      const id = lastOpened.current;
      lastOpened.current = null;
      window.scrollTo(0, listScroll.current);
      document.querySelector<HTMLElement>(`.mlist [data-start="${id}"] .who, .rres [data-start="${id}"]`)?.focus({ preventScroll: true });
    }
  }, [view, isDesktop]);

  // Förhandsladda grannhästarnas hästkort när en häst är vald.
  const index = start ? ordered.findIndex((s) => s.id === start.id) : -1;
  useEffect(() => {
    if (index < 0) return;
    prefetchDetails([ordered[index + 1]?.id, ordered[index - 1]?.id, ordered[index + 2]?.id].filter((x): x is string => !!x));
  }, [index, ordered]);

  // Desktop: statistikraden behöver loppstatistiken (kuskligan). Den hämtas
  // för alla avdelningar en gång, så att avdelningsbyte inte går mot nätet.
  useEffect(() => {
    if (!isDesktop) return;
    data.races.forEach((r) => loadRaceStats(roundId, r.leg));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop, roundId]);

  // Tangentbord (6): ←/→ avdelning, X för X-faktorn, R för Startlista och
  // Resultat, och på desktop ↑/↓ och Home/End häst, Enter hästkortet och I
  // för Intressant.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
    if (document.querySelector("dialog[open]")) return;
    const inGroup = e.target instanceof Element && !!e.target.closest('[role="tablist"], [role="radiogroup"]');
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !inGroup) {
      e.preventDefault();
      selectLeg(leg + (e.key === "ArrowRight" ? 1 : -1));
      return;
    }
    // R växlar Startlista och Resultat när segmentkontrollen visas (E4a).
    if ((e.key === "r" || e.key === "R") && canResult && !e.shiftKey) {
      e.preventDefault();
      setListChosen(showResult);
      return;
    }
    if ((e.key === "x" || e.key === "X") && start) {
      e.preventDefault();
      stepX(start, e.shiftKey);
      return;
    }
    if (!window.matchMedia(DESKTOP_QUERY).matches) return;
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    const edge = !inGroup && (e.key === "Home" || e.key === "End");
    if ((step || edge) && !showResult && ordered.length) {
      e.preventDefault();
      const i = start ? ordered.findIndex((s) => s.id === start.id) : -1;
      const to = edge ? (e.key === "Home" ? 0 : ordered.length - 1) : Math.max(0, Math.min(ordered.length - 1, i + step));
      const next = ordered[to];
      if (next && next.id !== start?.id) {
        selectHorse(next, true);
        document.querySelector(`.av [data-start="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
      }
      return;
    }
    const onButton = e.target instanceof HTMLElement && (e.target.tagName === "BUTTON" || e.target.tagName === "A");
    if (e.key === "Enter" && start && !onButton) {
      e.preventDefault();
      deskHeading.current?.focus();
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

  // ‹ › i hästkortets rubrik (desktop och mobil).
  const prev = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;
  const horseNav: HorseNav = {
    prev: prev ? { label: horseLabel(prev), onGo: () => selectHorse(prev, true) } : null,
    next: next ? { label: horseLabel(next), onGo: () => selectHorse(next, true) } : null,
  };
  const cardNav = { index: Math.max(0, index), total: ordered.length, nav: horseNav };

  const mode = resultMode(race, now);
  const segmented = canResult ? (
    <div className="seg rsegc" role="group" aria-label="Visa avdelningen" title="R växlar">
      <button type="button" aria-pressed={!showResult} onClick={() => setListChosen(true)}>
        Startlista
      </button>
      <button type="button" aria-pressed={showResult} onClick={() => setListChosen(false)}>
        Resultat
      </button>
    </div>
  ) : null;
  const statsBusy = chain.kind === "running";
  const missingStats = (
    <>
      <span>Statistik saknas just nu</span>
      <button type="button" className="linkish" disabled={statsBusy} onClick={() => void refetchStats(roundId)}>
        {statsBusy ? "Hämtar …" : "Hämta igen"}
      </button>
    </>
  );
  const chips = (
    <span className="chips">
      <span className="chip num">{race.distance} m</span>
      <span className={`chip ${race.startMethod === "VOLTE" ? "chip-volte" : "chip-auto"}`}>{race.startMethod === "VOLTE" ? "Volte" : "Auto"}</span>
      {race.classLabel && (
        <span className="chip chip-c" title={race.classLabel}>
          {race.classLabel}
        </span>
      )}
    </span>
  );
  const raceInfo = `Avd ${leg} · start ${hhmm(race.startAt)} · ${race.counts.starters} hästar${race.counts.scratched > 0 ? ` · ${race.counts.scratched} ${race.counts.scratched === 1 ? "struken" : "strukna"}` : ""}${race.prize !== null ? ` · 1:a pris ${kr(race.prize)}` : ""}`;
  const deskMeta = (
    <>
      {data.round.gameType} · {data.round.trackName} · {dayDate(data.round.date)} {data.round.date.slice(0, 4)}
      <br />
      Fas: {PHASE_LABELS[data.phase].toLowerCase()}
    </>
  );
  const live = (
    <p className="sr" aria-live="polite">
      {announce}
    </p>
  );
  const sheets = (
    <>
      <TagRace data={data} race={race} />
      <Sheet open={statsOpen} onClose={() => setStatsOpen(false)} title="Loppstatistik" sub={`Avd ${leg} · ${race.distance} m ${methodLabel(race.startMethod)} · ${data.round.trackName}`}>
        <RaceStatsContent roundId={roundId} race={race} trackName={data.round.trackName} gameType={data.round.gameType} />
      </Sheet>
      <Sheet open={helpOpen} onClose={() => setHelpOpen(false)} title="Kolumnerna i startlistan">
        <p className="help hsheet">
          Vinst och plats: i år och i fjol (ATG). Intjänat: total vinstsumma och per start. Spår v.: startnumrets vinst % på distansen och startmetoden (ATG 2 år). Siffran på startnumret: antal positiva signaler av 10. Rikt: riktodds för plats, modell {modelLabel(data.model?.key, !!data.model?.calibrated)}. Med X-faktor står riktoddset med X överst och det vanliga under. * = osäkert.
        </p>
        <h3 className="hsheet-h">Tangenter</h3>
        <p className="help hsheet">← → byter avdelning. ↑ ↓ byter häst, Home och End går till första och sista. Enter går till hästkortet. I växlar Intressant. X stegar X-faktorn (Shift + X baklänges). R växlar Startlista och Resultat.</p>
      </Sheet>
    </>
  );

  // ---- Desktop ----------------------------------------------------------------------------
  if (isDesktop) {
    const list = showResult ? (
      <div className="rwrap">
        <TagCta data={data} race={race} now={now} />
        <RaceResult data={data} race={race} now={now} selectedId={start?.id ?? null} hrefFor={(s) => hastUrl(leg, s.id, vy)} onOpen={openHorse} onLeg={selectLeg} />
      </div>
    ) : wide ? (
      <div className="twrap">
        <table className="tbl stbl">
          <caption className="sr">
            Startlista avdelning {leg}, {race.counts.starters} hästar. Pil upp och ned väljer häst, Enter går till hästkortet, I växlar Intressant och X stegar X-faktorn.
          </caption>
          <colgroup>
            <col style={{ width: 56 }} />
            <col />
            <col style={{ width: 118 }} />
            <col style={{ width: 62 }} />
            <col style={{ width: 46 }} />
            <col style={{ width: 46 }} />
            <col style={{ width: 62 }} />
            <col style={{ width: 44 }} />
            <col style={{ width: 58 }} />
            <col style={{ width: 52 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" aria-sort={bySignals ? "descending" : "ascending"}>
                <SortButton bySignals={bySignals} onToggle={toggleSort} />
              </th>
              <th scope="col">Häst</th>
              <th scope="col">Kusk / tränare</th>
              <th scope="col" className="c">
                Form
              </th>
              <th scope="col" className="r">
                <abbr title="Vinst % i år och i fjol">Vinst</abbr>
                <small className="thsub">år+fjol</small>
              </th>
              <th scope="col" className="r">
                <abbr title="Plats % (topp 3) i år och i fjol">Plats</abbr>
                <small className="thsub">år+fjol</small>
              </th>
              <th scope="col" className="r">
                <abbr title="Hästens totala vinstsumma och per start">Intjänat</abbr>
                <small className="thsub">tot · /start</small>
              </th>
              <th scope="col" className="r">
                <abbr title="Startnumrets vinst % på distansen och startmetoden">Spår</abbr>
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
            {ordered.map((s, i) => (
              <DeskRow key={s.id} s={s} index={i} selected={s.id === start?.id} started={race.started} href={hastUrl(leg, s.id)} onOpen={openHorse} onToggle={toggle} />
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="twrap">
        <div className="cols g-an">
          <SortButton bySignals={bySignals} onToggle={toggleSort} />
          <span aria-hidden="true">Häst · kusk</span>
          <span className="c" aria-hidden="true">
            Form
          </span>
          <span className="r" aria-hidden="true">
            Rikt
          </span>
          <span className="c" aria-hidden="true">
            Intr.
          </span>
        </div>
        <ul className="list mlist" aria-label={`Startlista avdelning ${leg}`}>
          {ordered.map((s, i) => (
            <StartRow key={s.id} s={s} index={i} started={race.started} selected={s.id === start?.id} href={hastUrl(leg, s.id)} onOpen={openHorse} onToggle={toggle} />
          ))}
        </ul>
        <ReviewBar race={race} setReviewed={setReviewed} />
      </div>
    );
    return (
      <>
        <div className="stick">
          <AppHeader title={`Avd ${leg}`} deskTitle={false} refresh={oddsOpen ? <RefreshBoardButton data={data} /> : undefined} deskMeta={deskMeta} />
        </div>
        <main className="av" id="main" data-list={wide ? "wide" : "narrow"} data-table={tableMode && !isWide ? "on" : undefined}>
          <RoundBand data={data} leg={leg} onSelect={selectLeg} />
          <section className="pn race" id="avd-panel" role="tabpanel" aria-labelledby={`tab-${leg}`}>
            <div className="pn-h">
              {wide ? (
                <span className="rh-t">{raceInfo}</span>
              ) : (
                <>
                  <h1 id="race-h" className="rh-n" title={race.name}>
                    {shortRaceName(race.name)}
                  </h1>
                  {chips}
                </>
              )}
              <span className="end">
                <button type="button" className="btn secondary xs" aria-haspopup="dialog" onClick={() => setStatsOpen(true)}>
                  {wide ? "Loppstatistik ›" : "Statistik ›"}
                </button>
                {wide && <UnibetChip race={race} />}
                {!isWide && (
                  <button type="button" className="btn secondary xs" aria-pressed={tableMode} onClick={toggleTable}>
                    Tabell
                  </button>
                )}
                <button type="button" className="btn secondary xs ic" aria-label="Förklaring av kolumnerna" aria-haspopup="dialog" onClick={() => setHelpOpen(true)}>
                  ?
                </button>
              </span>
            </div>
            {wide ? (
              <div className="rb brd">
                <div className="rb-t">
                  <h1 id="race-h" title={race.name}>
                    {shortRaceName(race.name)}
                  </h1>
                  {chips}
                  {segmented}
                </div>
                <div className="statl">
                  {race.cancelled ? <span>Inställt</span> : race.statsLine.ok ? <StatLine race={race} roundId={roundId} gameType={data.round.gameType} /> : missingStats}
                  {!showResult && <ReviewBar race={race} setReviewed={setReviewed} inline />}
                </div>
              </div>
            ) : (
              segmented && <div className="rsegw">{segmented}</div>
            )}
            {oddsOpen && <RefreshBanner data={data} className="m10" />}
            {list}
          </section>
          {start ? <HorseCard ref={deskHeading} data={data} race={race} start={start} onToggle={(v) => toggle(start, v)} layout="desk" nav={cardNav} /> : <CardSkeleton />}
          {live}
        </main>
        {sheets}
      </>
    );
  }

  // ---- Mobil ------------------------------------------------------------------------------
  const listTitle = showResult ? `Avd ${leg} · resultat` : `Avd ${leg} · ${shortRaceName(race.name)}`;
  const listSub = !showResult
    ? `${data.round.gameType} · ${data.round.trackName} · start ${hhmm(race.startAt)} · ${race.counts.starters} hästar`
    : mode === "result" && race.resultAt
      ? `Hämtat från ATG ${hhmm(race.resultAt)}`
      : mode === "cancelled"
        ? "Inställt"
        : `Startade ${hhmm(race.startAt)}`;
  return (
    <>
      <div className={`stick${view === "horse" ? " is-horse" : ""}`}>
        {view === "horse" && start ? (
          <AppHeader
            ref={mobHeading}
            title={start.horse.name}
            lead={<FlapNumber n={start.number} signals={start.signals?.count} />}
            sub={`${index + 1} av ${ordered.length} · ${start.driver?.name ?? "Kusk saknas"}`}
            back={{
              href: avdUrl(leg),
              label: `Tillbaka till avd ${leg}`,
              text: `Avd ${leg}`,
              onClick: (e) => {
                e.preventDefault();
                backToList();
              },
            }}
            horseNav={horseNav}
            deskTitle={false}
          />
        ) : (
          <AppHeader title={listTitle} sub={listSub} back={{ href: base, label: "Tillbaka till omgången", text: "Omgång" }} deskTitle={false} refresh={oddsOpen ? <RefreshBoardButton data={data} /> : undefined} />
        )}
        {view === "list" && (
          <>
            <RaceTabs races={data.races} selected={leg} onSelect={selectLeg} panelId="avd-panel" variant="scroll" />
            <div className="strip brd">
              <div className="chips">
                <span className="chip num">{race.distance} m</span>
                <span className={`chip ${race.startMethod === "VOLTE" ? "chip-volte" : "chip-auto"}`}>{race.startMethod === "VOLTE" ? "Volte" : "Auto"}</span>
                {race.classLabel && (
                  <span className="chip chip-c" title={race.classLabel}>
                    {race.classLabel}
                  </span>
                )}
                <button type="button" className="chip chip-btn" aria-haspopup="dialog" onClick={() => setStatsOpen(true)}>
                  Loppstatistik ›
                </button>
                <UnibetChip race={race} chip />
              </div>
              <div className="statline">
                {race.statsLine.ok ? (
                  <>
                    {race.statsLine.bestNumber && (
                      <span>
                        Spår {race.statsLine.bestNumber.number} vinner <b>{pct(race.statsLine.bestNumber.pct)}</b>
                      </span>
                    )}
                    {race.statsLine.bestPlace && (
                      <span>
                        Spår {race.statsLine.bestPlace.number} plats <b>{pct(race.statsLine.bestPlace.pct)}</b>
                      </span>
                    )}
                    {!race.statsLine.bestPlace && (
                      <span>
                        Spår 1 <b>{pct(race.statsLine.number1Pct)}</b>
                      </span>
                    )}
                    <span>
                      Favorit vinner <b>{pct(race.statsLine.favoriteWinPct)}</b>
                    </span>
                  </>
                ) : (
                  missingStats
                )}
                <span>
                  <b>{race.counts.interesting}</b> {race.counts.interesting === 1 ? "intressant" : "intressanta"}
                </span>
              </div>
            </div>
            {segmented && <div className="segw rseg">{segmented}</div>}
            <div className="cols g-an" hidden={showResult}>
              <SortButton bySignals={bySignals} onToggle={toggleSort} />
              <span aria-hidden="true">Häst · kusk</span>
              <span className="c" aria-hidden="true">
                Form
              </span>
              <span className="r" aria-hidden="true">
                Rikt
              </span>
              <span className="c" aria-hidden="true">
                Intr.
              </span>
            </div>
          </>
        )}
      </div>

      <main className="ws" data-view={view} id="main">
        {view === "list" ? (
          <div className="dmain" id="avd-panel" role="tabpanel" aria-labelledby={`tab-${leg}`}>
            {oddsOpen && <RefreshBanner data={data} className="m10" />}
            <TagCta data={data} race={race} now={now} />
            {showResult && (
              <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
                <RaceResult data={data} race={race} now={now} selectedId={null} hrefFor={(s) => hastUrl(leg, s.id, vy)} onOpen={openHorse} onLeg={selectLeg} />
              </div>
            )}
            <ul className="list mlist" hidden={showResult} aria-label={`Startlista avdelning ${leg}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
              {ordered.map((s, i) => (
                <StartRow key={s.id} s={s} index={i} started={race.started} href={hastUrl(leg, s.id)} onOpen={openHorse} onToggle={toggle} />
              ))}
            </ul>
            {!showResult && <ReviewBar race={race} setReviewed={setReviewed} />}
          </div>
        ) : (
          start && (
            <HorseCard
              data={data}
              race={race}
              start={start}
              onToggle={(v) => toggle(start, v)}
              layout="mobile"
              nav={cardNav}
              section={section}
              onSection={setSection}
              before={oddsOpen ? <RefreshBanner data={data} className="m10" /> : undefined}
            />
          )
        )}
        {live}
      </main>
      {sheets}
    </>
  );
}

// ---- Rader -----------------------------------------------------------------------------

type RowProps = { s: StartDto; index: number; started: boolean; href: string; onOpen: (s: StartDto) => void; onToggle: (s: StartDto, v: boolean) => void };

// Kusken och hästens totala vinstsumma sist (summan kortas aldrig, namnet först).
function Driver({ s }: { s: StartDto }) {
  const earn = s.horse.earnings !== null ? <b className="kt-earn">{money(s.horse.earnings)}</b> : null;
  // E5 S2: rolltaggen efter kusken. Kusknamnet kortas, aldrig taggen.
  const tip = FEATURES.tips && !s.scratched ? <TipTag tip={s.tip ?? null} /> : null;
  if (s.prevDriver)
    return (
      <span className="kt kt2">
        <span className="chg">↻ Ny: {s.driver?.name ?? "–"}</span>
        {tip}
        {earn}
      </span>
    );
  return (
    <span className="kt kt2">
      <span>{s.driver?.name ?? "Kusk saknas"}</span>
      {tip}
      {earn}
    </span>
  );
}

// Öppnar loppet hos Unibet i en ny flik (Unibet går inte att bädda in).
function UnibetChip({ race, chip }: { race: RaceDto; chip?: boolean }) {
  return (
    <a className={chip ? "chip chip-btn chip-u" : "btn secondary xs"} href={unibetRaceUrl(race)} target="_blank" rel="noopener noreferrer" aria-label={`Avd ${race.leg} hos Unibet (öppnas i ny flik)`}>
      Unibet ↗
    </a>
  );
}

const SORT_KEY = "sv-sort";

// Nr-rubriken: växlar mellan startnummer och antal positiva signaler.
function SortButton({ bySignals, onToggle }: { bySignals: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="sortb" onClick={onToggle} aria-label={bySignals ? "Sorterat på positiva signaler. Sortera på startnummer" : "Sorterat på startnummer. Sortera på positiva signaler"}>
      {bySignals ? "Sig" : "Nr"}
      <span aria-hidden="true">{bySignals ? "▼" : "↕"}</span>
    </button>
  );
}

function StartRow({ s, index, started, href, onOpen, onToggle, selected }: RowProps & { selected?: boolean }) {
  const on = !!s.mark?.interesting;
  return (
    <li className={`row g-an${on ? " is-i" : ""}${s.mark?.bet ? " is-b" : ""}${s.scratched ? " scr" : ""}${selected ? " sel" : ""}`} data-start={s.id} aria-current={selected ? "true" : undefined}>
      <FlapNumber n={s.number} index={index} signals={s.signals?.count} />
      <a
        className="who"
        href={href}
        onClick={(e) => {
          e.preventDefault();
          onOpen(s);
        }}
      >
        <span className="hl">
          <span className="sr">
            Nr {s.number}
            {signalsSr(s.signals?.count)},{" "}
          </span>
          <span className="hn">{s.horse.name}</span>
          <MarkBadges s={s} />
          {s.signals?.lowStreck && <LowStreckTag />}
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
    <tr className={`${on ? "is-i " : ""}${s.mark?.bet ? "is-b " : ""}${selected ? "sel " : ""}${s.scratched ? "scr" : ""}`} data-start={s.id} onClick={() => onOpen(s)} aria-current={selected ? "true" : undefined}>
      <td>
        <FlapNumber n={s.number} index={index} signals={s.signals?.count} />
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
            <span className="sr">
              Nr {s.number}
              {signalsSr(s.signals?.count)},{" "}
            </span>
            <span className="hn">{s.horse.name}</span>
            <MarkBadges s={s} />
            {!s.scratched && <GallopBadge flag={s.form.gallop} />}
            {s.scratched && <span className="tag scr-tag">Struken</span>}
          </span>
          <span className="kt kt2">
            {s.signals?.lowStreck && <LowStreckTag />}
            <span>{[ageSex(s.horse.age, s.horse.sex), s.horse.record].filter(Boolean).join(" · ")}</span>
            {FEATURES.tips && !s.scratched && <TipTag tip={s.tip ?? null} />}
          </span>
        </a>
      </td>
      <td className="kus">
        {s.prevDriver ? <span className="chg">↻ Ny: {s.driver?.name ?? "–"}</span> : <span>{s.driver?.name ?? "–"}</span>}
        <span className="kt">{s.trainer ? `tr ${s.trainer.name}` : ""}</span>
      </td>
      <td className="c">
        <FormStrip boxes={s.form.boxes} ariaLabel={s.form.ariaLabel} />
      </td>
      <QuickPct kind="win" v={s.quick.winPct} starts={s.quick.starts} />
      <QuickPct kind="place" v={s.quick.placePct} starts={s.quick.starts} />
      <td className="r num earn">
        {money(s.horse.earnings)}
        {s.horse.earnings !== null && s.quick.lifeStarts ? <small>{money(s.horse.earnings / s.quick.lifeStarts)}</small> : null}
      </td>
      <td className="r num">{pct(s.quick.postPct, 0)}</td>
      <td className="r">
        <RiktCell s={s} className="rk num dk" two />
      </td>
      <td className="c">
        <LampToggle on={on} horseName={s.horse.name} disabledReason={started ? "Loppet har startat" : s.scratched ? "Hästen är struken" : null} onToggle={() => onToggle(s, !on)} />
      </td>
    </tr>
  );
}

// Vinst % och plats % i livet, gröna över gränserna (lib/signals.ts).
function QuickPct({ kind, v, starts }: { kind: "win" | "place"; v: number | null; starts: number | null }) {
  const sg = pctSignal(kind, v, starts);
  return (
    <td className="r num">
      <span className={signalClass(sg)}>{pct(v, 0)}</span>
      <span className="sr">{signalSr(sg)}</span>
    </td>
  );
}

// Statistikraden i loppets tavla (3.3 rad 2): bästa spår för vinst och plats,
// favoriten och ledaren i kuskligan.
function StatLine({ race, roundId, gameType }: { race: RaceDto; roundId: string; gameType: string }) {
  const stats = useRaceStats(roundId, race.leg);
  const line = race.statsLine;
  const top = stats.data?.drivers.rows.filter((r) => r.league).sort((a, b) => (b.league?.wins ?? 0) - (a.league?.wins ?? 0))[0] ?? null;
  return (
    <>
      {line.bestNumber && (
        <span>
          Spår {line.bestNumber.number} vinner <b>{pct(line.bestNumber.pct)}</b>
        </span>
      )}
      {line.bestPlace ? (
        <span>
          Spår {line.bestPlace.number} plats <b>{pct(line.bestPlace.pct)}</b>
        </span>
      ) : (
        <span>
          Spår 1 <b>{pct(line.number1Pct)}</b>
        </span>
      )}
      <span>
        Favorit vinner <b>{pct(line.favoriteWinPct)}</b>
      </span>
      <span title={top ? (top.rawName ?? top.name) : undefined}>
        Kuskligan {gameType} <b>{top?.league ? top.league.wins : "–"}</b>
        {top && <span className="sl-n"> {top.rawName ?? top.name}</span>}
      </span>
    </>
  );
}

// "Inga intressanta här" eller "Genomgången · Ångra". inline = textlänk i
// loppets tavla (bred tabell); annars knappen under listan.
function ReviewBar({ race, setReviewed, inline }: { race: RaceDto; setReviewed: (race: RaceDto, v: boolean) => void; inline?: boolean }) {
  if (race.review?.noneInteresting && race.counts.interesting === 0)
    return (
      <p className={inline ? "rv-i done" : "review done"} role="status">
        <span>Genomgången</span>
        {" · "}
        <button type="button" className="linkish" onClick={() => setReviewed(race, false)}>
          Ångra
        </button>
      </p>
    );
  if (race.counts.interesting > 0 || race.review || race.cancelled) return null;
  if (inline)
    return (
      <span className="rv-i">
        <button type="button" className="linkish" onClick={() => setReviewed(race, true)}>
          Inga intressanta här
        </button>
      </span>
    );
  return (
    <div className="review">
      <button type="button" className="btn secondary full" onClick={() => setReviewed(race, true)}>
        Inga intressanta här
      </button>
    </div>
  );
}

// ---- Laddar ------------------------------------------------------------------------------

function SkBlock({ rows }: { rows: number }) {
  return (
    <div className="sk-block" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} width={`${85 - i * 9}%`} />
      ))}
    </div>
  );
}

// Hästkortets ram med skelett i varje del, så att layouten inte hoppar.
function CardSkeleton() {
  return (
    <div className="pn hc" aria-hidden="true">
      <div className="pn-h">
        <span>Hästkortet</span>
      </div>
      <div className="hb brd">
        <FlapNumber n="–" />
        <div className="hb-id">
          <Skeleton width="50%" height={20} />
        </div>
      </div>
      <div className="vr" />
      <div className="hc-secs">
        {["Riktodds plats", "Positiva signaler", "Statistik", "Unibets odds över tid", "Tips och kommentarer", "5 senaste starter"].map((t, i) => (
          <section key={t} className={`cell${i > 2 ? " r2" : ""}`}>
            <div className="pn-h">
              <span>{t}</span>
            </div>
            <div className="pn-b">
              <SkBlock rows={3} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function WorkspaceSkeleton({ leg, roundId, error, notFound, result }: { leg: number; roundId: string; error: string | null; notFound: boolean; result: boolean }) {
  const banner = error ? (
    <Banner tone={notFound ? "info" : "err"} className="m10" actions={notFound ? <Link href="/">Till aktuell omgång</Link> : undefined}>
      {notFound ? "Omgången finns inte." : error}
    </Banner>
  ) : null;
  return (
    <>
      <div className="stick">
        <AppHeader title={`Avd ${leg}`} sub="Laddar …" back={{ href: `/omgang/${roundId}`, label: "Tillbaka till omgången", text: "Omgång" }} deskTitle={false} />
        <div className="mavs brd m-only" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="mavs-sk" aria-selected={i + 1 === leg}>
              <span className="nr sm">
                <b>{i + 1}</b>
              </span>
            </span>
          ))}
        </div>
      </div>
      <main className="av sk d-only" id="main" aria-busy="true">
        {banner ?? (
          <>
            <div className="pn bandp band-avd" aria-hidden="true">
              <span className="bl">Avdelning</span>
              <div className="seg nav avt">
                {Array.from({ length: 8 }, (_, i) => (
                  <span key={i} aria-selected={i + 1 === leg}>
                    <span className="nr sm">
                      <b>{i + 1}</b>
                    </span>
                  </span>
                ))}
              </div>
            </div>
            <div className="pn bandp band-fas" aria-hidden="true">
              <span className="bl">Fas</span>
            </div>
            <div className="pn bandp band-tool" aria-hidden="true">
              <span className="bl">Verktyg</span>
            </div>
            <div className="pn race" aria-label="Laddar startlistan">
              <div className="pn-h">
                <span>Avd {leg}</span>
              </div>
              <div className="rb brd" />
              <div className="twrap">
                <ul className="list">
                  {Array.from({ length: 15 }, (_, i) => (
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
              </div>
            </div>
            <CardSkeleton />
          </>
        )}
      </main>
      <div className="page m-only">
        {banner ??
          (result ? (
            <ResultSkeleton />
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
          ))}
      </div>
    </>
  );
}
