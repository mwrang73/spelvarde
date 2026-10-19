"use client";

// S3 Hästkortet (specen 5, S3) utan tips (E5). Det som finns i omgångens
// cache (namn, kusk, form, galopp, Intressant, Spelbar, Bet, riktodds) visas
// direkt. Tidigare starter, statistik, kommentarer och riktoddsets skäl
// hämtas med GET /api/starts/[id] när kortet öppnas (förhandsladdas för
// grannhästarna).

import { forwardRef, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { rawPost } from "@/components/api";
import { addToOutbox } from "@/components/outbox/outbox-client";
import { useOutbox } from "@/components/outbox/OutboxProvider";
import { Badge, Banner, BetToggle, FlapNumber, LampToggle, Skeleton, SpelbarToggle } from "@/components/ui/board";
import { useToast } from "@/components/ui/Toast";
import { ageSex, distShort, odds, ordinal, pct, placeChar, placeLabel, relTime, shortDay } from "@/lib/format";
import { applyPendingComments, type CommentBody, type PendingComment } from "@/lib/round-overlay";
import type { CommentDto, RaceDto, RoundResponse, StartDetailResponse, StartDto, YearStatsDto } from "@/lib/types";
import { RiktoddsBox } from "./Riktodds";
import { raceStarted, useRound } from "./RoundProvider";
import { getDetail, loadDetail, subscribeDetails } from "./roundStore";

export function useDetail(startId: string) {
  return useSyncExternalStore(
    subscribeDetails,
    () => getDetail(startId),
    () => getDetail(""),
  );
}

export function newClientId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

type Props = {
  data: RoundResponse;
  race: RaceDto;
  start: StartDto;
  onToggle: (value: boolean) => void;
};

export const HorseCard = forwardRef<HTMLHeadingElement, Props>(function HorseCard({ data, race, start, onToggle }, headingRef) {
  const detail = useDetail(start.id);
  const now = new Date();

  useEffect(() => {
    loadDetail(start.id);
  }, [start.id]);

  const d = detail.data;
  const warning = start.form.warning;
  const started = raceStarted(race, now.getTime());
  const locked = started ? "Loppet har startat" : start.scratched ? "Hästen är struken" : null;
  const on = !!start.mark?.interesting;
  const { setSpelbar, setBet } = useRound();
  const mark = start.mark;
  const override = mark?.spelbarOverride ?? "NONE";
  const isSpelbar = !!mark?.spelbar;

  return (
    <article className="hk" aria-labelledby={`hk-${start.id}`}>
      <div className="hk-hero brd">
        <FlapNumber n={start.number} size="lg" />
        <div>
          <h2 id={`hk-${start.id}`} ref={headingRef} tabIndex={-1} className="hk-name">
            {start.horse.name}
          </h2>
          <p>
            {[ageSex(start.horse.age, start.horse.sex), start.horse.record ? `rekord ${start.horse.record}` : null].filter(Boolean).join(" · ")}
            <br />
            {start.driver?.name ?? "Kusk saknas"}
            {start.trainer && ` · tr ${start.trainer.name}`}
          </p>
          {start.prevDriver && (
            <p className="hk-change">
              ↻ Ny kusk: {start.driver?.name ?? "–"} (förut {start.prevDriver.name})
            </p>
          )}
        </div>
        {warning && (
          <div className={`galwarn${warning.kind === "GD" ? " gd" : ""}`}>
            <Badge kind={warning.kind === "GD" ? "gd" : "g"} />
            <span>
              <b>Galoppvarning:</b> {warning.text.replace(/^Galopp/, "galopp")}
            </span>
          </div>
        )}
      </div>

      {start.scratched && (
        <Banner tone="warn" className="m10">
          <b>Struken{start.scratchedAt ? ` ${relTime(start.scratchedAt, now)}` : ""}.</b> Hästen startar inte.
        </Banner>
      )}

      <div className="acts-row">
        <LampToggle labeled on={on} horseName={start.horse.name} disabledReason={locked} onToggle={() => onToggle(!on)} />
        <SpelbarToggle id={`sp-${start.id}`} on={isSpelbar} override={override} disabledReason={locked} onToggle={() => setSpelbar(race, start, isSpelbar ? "off" : "on")} />
        <span className="sp-wrap">
          <BetToggle labeled on={!!mark?.bet} horseName={start.horse.name} disabledReason={started || (start.scratched && !mark?.bet) ? locked : null} onToggle={() => setBet(race, start, !mark?.bet)} />
          <span className="sp-orig">{mark?.bet ? (mark.betOdds !== null ? `Odds ${odds(mark.betOdds)}` : "Utan odds") : "Inte spelad"}</span>
        </span>
      </div>
      {override !== "NONE" && !locked && (
        <p className="acts-sub">
          <button type="button" className="linkish" onClick={() => setSpelbar(race, start, "auto")}>
            Återställ till förslag
          </button>
        </p>
      )}
      {started && <p className="acts-sub help">Loppet har startat. Intressant, Spelbar och Bet är låsta.</p>}

      <RiktoddsBox race={race} start={start} detail={d?.riktodds ?? null} detailLoading={!d && !detail.error} modelKey={data.model?.key ?? null} guideline={data.settings?.spelbarGuideline ?? 2} />

      <section className="hk-sec" aria-labelledby={`st-${start.id}`}>
        <h3 id={`st-${start.id}`}>Statistik</h3>
        {d ? <StatsBlock d={d} race={race} /> : <SkeletonBlock rows={4} />}
      </section>

      <section className="hk-sec" aria-labelledby={`rec-${start.id}`}>
        <h3 id={`rec-${start.id}`}>5 senaste starter</h3>
        <Records d={d} error={detail.error} race={race} start={start} roundId={data.round.id} />
      </section>

      <Comments data={data} race={race} start={start} detail={d} />
    </article>
  );
});

function SkeletonBlock({ rows }: { rows: number }) {
  return (
    <div className="sk-block" aria-busy="true" aria-label="Laddar">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} width={`${85 - i * 9}%`} />
      ))}
    </div>
  );
}

function yearLine(y: YearStatsDto | null, what: "win" | "place"): string {
  if (!y || !y.starts) return "–";
  return `${pct(what === "win" ? y.winPct : y.placePct)}`;
}

function StatsBlock({ d, race }: { d: StartDetailResponse; race: RaceDto }) {
  const h = d.stats.horse;
  return (
    <dl className="kv">
      <dt>Vinst % i år{h.thisYear ? ` (${h.thisYear.starts} starter)` : ""}</dt>
      <dd>{yearLine(h.thisYear, "win")}</dd>
      <dt>Plats % i år</dt>
      <dd>{yearLine(h.thisYear, "place")}</dd>
      <dt>Vinst % i fjol{h.lastYear ? ` (${h.lastYear.starts} starter)` : ""}</dt>
      <dd>{yearLine(h.lastYear, "win")}</dd>
      <dt>Plats % i fjol</dt>
      <dd>{yearLine(h.lastYear, "place")}</dd>
      <dt>
        Spår {d.start.number} på {race.distance} m {race.startMethod === "VOLTE" ? "volte" : "auto"}
      </dt>
      <dd>{d.stats.post ? pct(d.stats.post.pct) : "–"}</dd>
      <dt>Kusken vinner i år</dt>
      <dd>{yearLine(d.stats.driver, "win")}</dd>
      <dt>Tränaren vinner i år</dt>
      <dd>{yearLine(d.stats.trainer, "win")}</dd>
    </dl>
  );
}

function Records({ d, error, race, start, roundId }: { d: StartDetailResponse | null; error: string | null; race: RaceDto; start: StartDto; roundId: string }) {
  const [all, setAll] = useState(false);
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
  const rows = all ? d.records : d.records.slice(0, 5);
  return (
    <>
      <div className="tscroll">
        <table className="starts">
          <caption className="sr">Senaste starter för {start.horse.name}, nyast först</caption>
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
              const cls = r.galloped ? "plc g" : ch === "1" ? "plc w" : "plc";
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
      <p className="help">
        0 = oplacerad, g = galopp, d = diskad.
        {d.recordsTotal > 5 && (
          <>
            {" "}
            <button type="button" className="linkish" aria-expanded={all} onClick={() => setAll((v) => !v)}>
              {all ? "Visa färre" : "Visa fler"}
            </button>
          </>
        )}
      </p>
    </>
  );
}

// ---- Kommentarer -----------------------------------------------------------------------

function commentWhen(c: CommentDto): string {
  const parts: string[] = [shortDay((c.round?.date ?? c.createdAt).slice(0, 10))];
  if (c.round) parts.push(`V85 ${c.round.trackName}`);
  if (c.leg) parts.push(`avd ${c.leg}`);
  if (c.result) parts.push(c.result.disqualified ? "diskad" : c.result.place && c.result.place >= 1 ? ordinal(c.result.place) : "oplacerad");
  return parts.join(" · ");
}

function Comments({ data, race, start, detail }: { data: RoundResponse; race: RaceDto; start: StartDto; detail: StartDetailResponse | null }) {
  const { queue, status } = useOutbox();
  const [draftId, setDraftId] = useState(() => newClientId());
  const horseId = start.horse.id;
  const list = useMemo(() => (detail ? applyPendingComments(detail.comments, queue, horseId).filter((c) => c.clientId !== draftId) : []), [detail, queue, horseId, draftId]);
  const ctx = { round: { id: data.round.id, date: data.round.date, trackName: data.round.trackName }, leg: race.leg };
  const save = (clientId: string, body: CommentBody) =>
    addToOutbox({ method: "PUT", url: `/api/comments/${clientId}`, body, meta: { kind: "comment", horseId, horseName: start.horse.name, clientId, ...ctx } });
  const body = (text: string, from?: CommentDto): CommentBody => ({
    horseId,
    startId: from ? from.startId : start.id,
    roundId: from ? from.roundId : data.round.id,
    kind: from ? from.kind : "NOTE",
    tags: from ? from.tags : [],
    text,
  });
  const pendingHere = queue.some((q) => (q.meta as { horseId?: string } | undefined)?.horseId === horseId) || status.kind === "paused";
  // Efter första ändringen visas utkorgens status ("Sparas …", "I kö (n)", "Sparat").
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (pendingHere) setTouched(true);
  }, [pendingHere]);
  const showStatus = pendingHere || touched;

  return (
    <>
      <section className="hk-sec" aria-labelledby={`cm-${start.id}`}>
        <h3 id={`cm-${start.id}`}>Mina kommentarer</h3>
        {!detail ? (
          <SkeletonBlock rows={2} />
        ) : list.length ? (
          <ul className="cmts">
            {list.map((c) => (
              <CommentItem key={c.clientId} c={c} horseName={start.horse.name} onSave={(text) => save(c.clientId, body(text, c))} onDelete={() => addToOutbox({ method: "DELETE", url: `/api/comments/${c.clientId}`, meta: { kind: "comment-delete", horseId, horseName: start.horse.name, clientId: c.clientId } })} onUndo={() => save(c.clientId, body(c.text, c))} />
            ))}
          </ul>
        ) : (
          <p className="help">Inga kommentarer om hästen än.</p>
        )}
      </section>
      <section className="hk-sec">
        <NewComment
          key={`${start.id}-${draftId}`}
          id={`nc-${start.id}`}
          onSave={(text) => save(draftId, body(text))}
          onDelete={() => addToOutbox({ method: "DELETE", url: `/api/comments/${draftId}`, meta: { kind: "comment-delete", horseId, horseName: start.horse.name, clientId: draftId } })}
          onDone={() => setDraftId(newClientId())}
        />
        <p className="help status" aria-live="polite">
          {showStatus ? status.text : "Följer hästen till kommande omgångar."}
        </p>
      </section>
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
function NewComment({ id, onSave, onDelete, onDone }: { id: string; onSave: (text: string) => void; onDelete: () => void; onDone: () => void }) {
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
    <div className="field">
      <label className="flbl" htmlFor={id}>
        Kommentar inför loppet
      </label>
      <textarea id={id} rows={3} value={text} maxLength={4000} placeholder="Vad tror du om hästen i dag?" onChange={(e) => setText(e.target.value)} />
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
      </div>
    </div>
  );
}
