"use client";

// S2b Loppstatistik (specen 5, S2b): vinst % per startnummer, favoriter
// och kusk- och tränarform. Bottenark i mobilen, utfällbar panel på desktop.

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/board";
import { methodLabel, ordinal, pct, relTime } from "@/lib/format";
import type { PersonFormDto, RaceDto, RaceStatsResponse, StatsBlockMeta } from "@/lib/types";
import { refetchStats, useFetchChain } from "./fetchChain";
import { loadRaceStats, useRaceStats } from "./raceStatsStore";

const MISSING = new Set(["Sidan visar en annan omgång", "Statistiken är inte hämtad"]);

function Src({ meta, now }: { meta: StatsBlockMeta; now: Date }) {
  return (
    <p className="src">
      {meta.source}
      {meta.fetchedAt ? ` · hämtat ${relTime(meta.fetchedAt, now)}` : ""}
    </p>
  );
}

export function RaceStatsContent({ roundId, race, trackName }: { roundId: string; race: RaceDto; trackName: string }) {
  const entry = useRaceStats(roundId, race.leg);
  const [scope, setScope] = useState<"all" | "track">("all");
  const chain = useFetchChain();
  const now = new Date();

  useEffect(() => {
    loadRaceStats(roundId, race.leg);
  }, [roundId, race.leg]);

  const d = entry.data;
  if (!d) {
    if (entry.error)
      return (
        <div className="stat-empty">
          <p>Kunde inte hämta statistiken.</p>
          <button type="button" className="btn secondary sm" onClick={() => loadRaceStats(roundId, race.leg, true)}>
            Försök igen
          </button>
        </div>
      );
    return (
      <div className="stat-sk" aria-busy="true" aria-label="Laddar statistiken">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} width={`${90 - i * 6}%`} />
        ))}
      </div>
    );
  }

  const running = chain.kind === "running";
  const retry = (
    <button type="button" className="btn secondary sm" disabled={running} onClick={() => void refetchStats(roundId)}>
      {running ? "Hämtar …" : "Hämta igen"}
    </button>
  );

  // Saknas travstatistik.se helt räcker ett meddelande och en knapp.
  const allMissing = !d.startnr.ok && !d.favorites.ok;

  return (
    <div className="rstats">
      <div className="seg" role="group" aria-label="Urval">
        <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>
          Alla banor
        </button>
        <button type="button" aria-pressed={scope === "track"} onClick={() => setScope("track")}>
          {trackName}
        </button>
      </div>
      {allMissing ? (
        <>
          <h3 className="sl tight">Vinst % per startnummer och favoriter</h3>
          <Missing meta={d.startnr} retry={retry} />
        </>
      ) : (
        <StartnrBlock d={d} scope={scope} now={now} retry={retry} />
      )}

      {!allMissing && <h3 className="sl tight">Favoriter</h3>}
      {allMissing ? null : d.favorites.ok ? (
        <>
          <dl className="kv">
            <dt>Mest streckade vinner i V85{d.favorites.msRank ? ` (loppets favoritläge ${d.favorites.msRank} av 8)` : ""}</dt>
            <dd>{pct(d.favorites.favoriteWinPct)}</dd>
            <dt>Favoriten vinner, alla V85/V75-lopp sedan 2016</dt>
            <dd>{pct(d.favorites.overallWinPct)}</dd>
          </dl>
          <Src meta={d.favorites} now={now} />
        </>
      ) : (
        <Missing meta={d.favorites} retry={retry} />
      )}

      <h3 className="sl tight">Kuskform</h3>
      <People rows={d.drivers.rows} meta={d.drivers} kind="driver" now={now} />
      <h3 className="sl tight">Tränarform</h3>
      <People rows={d.trainers.rows} meta={d.trainers} kind="trainer" now={now} />
    </div>
  );
}

function Missing({ meta, retry }: { meta: StatsBlockMeta; retry: React.ReactNode }) {
  const missing = !meta.error || MISSING.has(meta.error);
  return (
    <div className="stat-empty">
      <p>{missing ? "Statistik saknas just nu" : "Kunde inte hämta statistiken"}</p>
      {meta.error && meta.error !== "Statistiken är inte hämtad" && <p className="help">{meta.error}.</p>}
      {retry}
    </div>
  );
}

function StartnrBlock({ d, scope, now, retry }: { d: RaceStatsResponse; scope: "all" | "track"; now: Date; retry: React.ReactNode }) {
  const s = d.startnr;
  const title = `Vinst % per startnummer, ${d.distance} m ${methodLabel(d.startMethod)}`;
  if (scope === "track") {
    return (
      <>
        <h3 className="sl tight">{title}</h3>
        <p className="help">travstatistik.se delar inte upp vinst % per startnummer på bana. Urvalet {d.trackName} finns därför inte än.</p>
      </>
    );
  }
  if (!s.ok)
    return (
      <>
        <h3 className="sl tight">{title}</h3>
        <Missing meta={s} retry={retry} />
      </>
    );
  const src = s.leg ?? s.group;
  if (!src || !src.byNumber.length)
    return (
      <>
        <h3 className="sl tight">{title}</h3>
        <p className="stat-empty">Ingen statistik för den här distansen</p>
      </>
    );
  const inRace = new Set(s.numbers);
  const max = Math.max(...src.byNumber.map((b) => b.pct ?? 0), 1);
  return (
    <>
      <h3 className="sl tight">{title}</h3>
      <p className="help">
        {s.leg ? `Loppets klass (${s.leg.classCode})` : "Alla klasser"} · {src.races} lopp. Starternas nummer är markerade.
      </p>
      <ul className="bars" aria-label={title}>
        {src.byNumber.map((b) => {
          const hi = inRace.has(b.n);
          return (
            <li key={b.n} className={`bar-r${hi ? " hi" : " out"}`}>
              <span className="num bn">{b.n}</span>
              <span className="tr" aria-hidden="true">
                <i style={{ width: `${((b.pct ?? 0) / max) * 100}%` }} />
              </span>
              <span className="v">
                {pct(b.pct)}
                <span className="sr">{hi ? ", startar i loppet" : ""}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <Src meta={s} now={now} />
    </>
  );
}

function People({ rows, meta, kind, now }: { rows: PersonFormDto[]; meta: StatsBlockMeta; kind: "driver" | "trainer"; now: Date }) {
  if (!rows.length) return <p className="stat-empty">Inga {kind === "driver" ? "kuskar" : "tränare"} i loppet.</p>;
  const sorted = [...rows].sort((a, b) => (b.year?.winPct ?? -1) - (a.year?.winPct ?? -1));
  return (
    <>
      <ul className="people">
        {sorted.map((p) => (
          <li key={p.personId}>
            <span className="pp-name">
              <span className="num pp-nr">{p.startNumbers.join(", ")}</span>
              {p.linked ? p.name : p.shortName ?? p.name}
              {!p.linked && <span className="tag">ej kopplad</span>}
            </span>
            <span className="pp-vals">
              <span>
                <span className="k">I år</span> <b className="num">{pct(p.year?.winPct ?? null)}</b>
              </span>
              {p.league && (
                <span>
                  <span className="k">V85-ligan</span> <b className="num">{ordinal(p.league.rank)}</b> · {p.league.wins} segrar
                </span>
              )}
              {p.form && (
                <span>
                  <span className="k">Formtoppen</span> <b className="num">{ordinal(p.form.rank)}</b>
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="src">
        ATG (vinst % i år){meta.ok ? ` · ${meta.source}${meta.fetchedAt ? ` · hämtat ${relTime(meta.fetchedAt, now)}` : ""}` : " · V85-ligan saknas just nu"}
      </p>
    </>
  );
}
