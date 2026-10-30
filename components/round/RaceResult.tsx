"use client";

// Resultatvyn i S2 (specen e4a, "Resultatvyn"): summeringen på tavlan,
// placering 1–4, "5 eller sämre", Nästa och lägena (väntar, inte kommit,
// kunde inte hämtas, inställt, offline och laddar). Utseendet följer skärm
// 7b i flödesmockupen (.sumb, .rrow, .hit, .plc och .rest). Märken och träff
// läses från de frysta värdena (StartDto.outcome), aldrig från dagens Mark.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useOnline } from "@/components/hooks";
import { Banner, EmptyState, FlapNumber, Skeleton, TrollBadge } from "@/components/ui/board";
import { IconCheck, IconClock, IconFlag, IconX } from "@/components/ui/icons";
import { hhmm } from "@/lib/format";
import { nextCard, raceResultView, type BetVerdict, type OtherItem } from "@/lib/results-view";
import { checkedLine, hasAnyMarks, latestIso, placedRowSr, marksSr, resultAnnouncement, resultMode, summaryBoxes, summarySr } from "@/lib/results-ui";
import type { OutcomeSummary, RaceDto, RoundResponse, StartDto } from "@/lib/types";
import { OutcomeBadges } from "./parts";
import { syncResults, useResultSync } from "./resultsStore";
import { legName } from "@/lib/game-type";

type Props = {
  data: RoundResponse;
  race: RaceDto;
  now: number;
  selectedId: string | null;
  hrefFor: (s: StartDto) => string;
  onOpen: (s: StartDto) => void;
  // Nästa-kortets knapp inom S2 (byter avdelning utan omladdning).
  onLeg: (leg: number) => void;
};

export function RaceResult({ data, race, now, selectedId, hrefFor, onOpen, onLeg }: Props) {
  const roundId = data.round.id;
  const mode = resultMode(race, now);
  const view = raceResultView(race);

  // Uppläsningen en gång när resultatet kommer medan vyn är öppen.
  const [announce, setAnnounce] = useState("");
  const prev = useRef<{ leg: number; resultAt: string | null }>({ leg: race.leg, resultAt: race.resultAt });
  useEffect(() => {
    const p = prev.current;
    if (p.leg === race.leg && !p.resultAt && race.resultAt) setAnnounce(resultAnnouncement(data.round.gameType, race.leg, view.placed, race.summary));
    else if (p.leg !== race.leg) setAnnounce("");
    prev.current = { leg: race.leg, resultAt: race.resultAt };
    // view härleds ur race.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [race.leg, race.resultAt]);

  const next = nextCard(data.round.gameType, race, data.races, roundId, now, data.results?.summary ?? null);
  const nextLeg = data.races.find((r) => r.leg === race.leg + 1) ? race.leg + 1 : null;

  return (
    <section className="rres" aria-label={`Resultat ${legName(data.round.gameType, race.leg)}`}>
      <p className="sr" aria-live="polite">
        {announce}
      </p>
      {mode === "waiting" || mode === "late" ? (
        <Pending roundId={roundId} race={race} late={mode === "late"} syncedAt={data.results?.syncedAt ?? null} />
      ) : mode === "cancelled" ? (
        <EmptyState icon={<IconFlag />} title="Loppet är inställt" text="ATG har ställt in loppet. Det räknas inte i statistiken." />
      ) : mode === "result" ? (
        <>
          <Summary summary={race.summary ?? null} leg={race.leg} label={`Summering ${legName(data.round.gameType, race.leg)}`} />
          <h2 className="sl rsl">Placering</h2>
          <ul className="rlist" aria-label={`Placering ${legName(data.round.gameType, race.leg)}`}>
            {view.placed.map((p, i) => (
              <li key={p.start.id}>
                <a
                  className={`rrow${p.outcome?.bet ? " is-b" : ""}${p.start.id === selectedId ? " sel" : ""}`}
                  data-start={p.start.id}
                  href={hrefFor(p.start)}
                  aria-label={placedRowSr(p)}
                  aria-current={p.start.id === selectedId ? "true" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    onOpen(p.start);
                  }}
                >
                  <FlapNumber n={p.place} placed index={i} />
                  <FlapNumber n={p.start.number} size="sm" index={i} />
                  <span className="rmid">
                    <span className="pn">{p.start.horse.name}</span>
                    <span className="pm">
                      <span className="pd">{p.start.driver?.name ?? "Kusk saknas"}</span>
                      {p.galloped && <span className="tag bad">Galopp</span>}
                    </span>
                  </span>
                  <span className="rr">
                    <OutcomeBadges o={p.outcome} betOdds={p.start.mark?.betOdds} />
                    <Verdict v={p.bet} />
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {(view.betMisses.length > 0 || view.others.length > 0) && <h2 className="sl rsl">5 eller sämre</h2>}
          {view.betMisses.length > 0 && (
            <ul className="rlist" aria-label="Bet som missade">
              {view.betMisses.map((b) => (
                <li key={b.start.id}>
                  <a
                    className={`rrow is-b${b.start.id === selectedId ? " sel" : ""}`}
                    data-start={b.start.id}
                    href={hrefFor(b.start)}
                    aria-label={`${b.disqualified ? "Diskad" : "5:e eller sämre"}, nummer ${b.start.number}, ${b.start.horse.name}${b.galloped ? ", galopp" : ""}. ${marksSr(b.outcome, "miss")}`}
                    aria-current={b.start.id === selectedId ? "true" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      onOpen(b.start);
                    }}
                  >
                    <span className="plc num">{b.label}</span>
                    <FlapNumber n={b.start.number} size="sm" />
                    <span className="rmid">
                      <span className="pn">{b.start.horse.name}</span>
                      <span className="pm">
                        <span className="pd">{b.start.driver?.name ?? "Kusk saknas"}</span>
                        {b.galloped && <span className="tag bad">Galopp</span>}
                        {b.disqualified && <span className="tag bad">Diskad</span>}
                      </span>
                    </span>
                    <span className="rr">
                      <OutcomeBadges o={{ ...b.outcome, xFactor: "NONE" }} betOdds={b.start.mark?.betOdds} />
                      <Verdict v="miss" />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          {view.others.length > 0 && <Others items={view.others} />}
        </>
      ) : null}
      {mode !== "before" && (
        <section className="next" aria-labelledby="rnext-h">
          <span className="lbl">Nästa</span>
          <h2 id="rnext-h">{next.title}</h2>
          <p>{next.text}</p>
          {nextLeg !== null && next.href.endsWith(`/avd/${nextLeg}`) ? (
            <a
              className="btn secondary"
              href={next.href}
              onClick={(e) => {
                e.preventDefault();
                onLeg(nextLeg);
              }}
            >
              {next.label}
            </a>
          ) : (
            <Link className="btn secondary" href={next.href}>
              {next.label}
            </Link>
          )}
        </section>
      )}
    </section>
  );
}

// "Träff ✓" och "Miss ✗": text och ikon, inte bara färg.
function Verdict({ v }: { v: BetVerdict }) {
  if (v === "hit")
    return (
      <span className="hit y" aria-hidden="true">
        <IconCheck />
        Träff
      </span>
    );
  if (v === "miss")
    return (
      <span className="hit n" aria-hidden="true">
        <IconX />
        Miss
      </span>
    );
  return null;
}

// Övriga på en rad i startnummerordning: "1 Laredo Boko · 6 Boscha Diablo I · 9 Harpy (diskad)".
function Others({ items }: { items: OtherItem[] }) {
  return (
    <p className="rest-line">
      <span className="sr">Övriga: </span>
      {items.map((i, k) => (
        <span key={i.number} className="ro">
          {k > 0 && <span aria-hidden="true"> · </span>}
          <span className="num">{i.number}</span> {i.name}
          {i.badge && (
            <>
              {" "}
              <b aria-hidden="true">{i.badge}</b>
              <span className="sr"> {i.badge === "S" ? "Spelbar" : "Intressant"}</span>
            </>
          )}
          {i.trollspotRank !== null && (
            <>
              {" "}
              <TrollBadge />
            </>
          )}
          {i.disqualified && " (diskad)"}
        </span>
      ))}
    </p>
  );
}

// Summeringen på tavlan (.sumb). Utan markeringar: en hjälprad i stället.
export function Summary({ summary, leg, label, heading }: { summary: OutcomeSummary | null; leg?: number; label?: string; heading?: string }) {
  if (!hasAnyMarks(summary)) return leg !== undefined ? <p className="help rnone">Inga markeringar i loppet.</p> : null;
  const s = summary!;
  const boxes = summaryBoxes(s);
  return (
    <div className="sumw">
      {heading && <h2 className="sl">{heading}</h2>}
      <div className={`sumb brd n${boxes.length}`} role="group" aria-label={label ?? "Summering"}>
        <span className="sr">{summarySr(s)}</span>
        {boxes.map((b) => (
          <div key={b.key} aria-hidden="true" className={b.key === "trollspot" ? "tsum" : undefined}>
            <small>{b.label}</small>
            <b className="num">{b.value}</b>
            <span>{b.unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Väntar på resultat, eller "Resultatet har inte kommit än" efter 30 min.
function Pending({ roundId, race, late, syncedAt }: { roundId: string; race: RaceDto; late: boolean; syncedAt: string | null }) {
  const sync = useResultSync(roundId);
  const online = useOnline();
  const busy = sync.running;
  const retry = () => void syncResults(roundId, true);
  const checked = checkedLine(latestIso(sync.syncedAt, syncedAt), late ? null : sync.nextAt);
  return (
    <>
      {!online && (
        <Banner tone="warn" icon="offline" className="m10">
          Ingen uppkoppling. Resultatet hämtas när du är uppkopplad igen.
        </Banner>
      )}
      {online && sync.failed && (
        <Banner
          tone="err"
          role="alert"
          className="m10"
          actions={
            <button type="button" className="btn secondary sm" disabled={busy || !online} onClick={retry}>
              {busy ? "Hämtar …" : "Försök igen"}
            </button>
          }
        >
          <b>Resultatet kunde inte hämtas.</b> ATG svarade inte. Försök igen om en stund.
        </Banner>
      )}
      {late ? (
        <EmptyState icon={<IconClock />} title="Resultatet har inte kommit än" text="ATG har inte publicerat placeringen. Den hämtas också i kväll.">
          {checked && <p className="help">{checked}</p>}
          <button type="button" className="btn secondary" disabled={busy || !online} onClick={retry}>
            {busy ? "Hämtar …" : "Hämta resultat"}
          </button>
        </EmptyState>
      ) : (
        <EmptyState icon={<IconClock />} title="Väntar på resultat …" text={`Loppet startade ${hhmm(race.startAt)}. Placeringen hämtas automatiskt från ATG.`}>
          <p className="help" aria-live="polite">
            {checked ?? "Kollar ATG …"}
          </p>
        </EmptyState>
      )}
    </>
  );
}

// Laddar: tavelruta och 4 rader.
export function ResultSkeleton() {
  return (
    <div className="rres" aria-busy="true" aria-label="Laddar resultatet">
      <div className="sumb brd n3 sk-sum" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <small>&nbsp;</small>
            <b>&nbsp;</b>
            <span>&nbsp;</span>
          </div>
        ))}
      </div>
      <ul className="rlist" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <li key={n} className="rrow sk-row">
            <FlapNumber n={n} placed />
            <Skeleton width="24px" height={28} />
            <span className="rmid">
              <Skeleton width="70%" height={14} />
              <Skeleton width="45%" height={10} />
            </span>
            <span />
          </li>
        ))}
      </ul>
    </div>
  );
}
