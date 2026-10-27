"use client";

// S6a Platsspel (specen S6a och e2.2 S6) och raderna i S4 Unibets odds
// (e2.2 S4). Bet på det som spelas hos Unibet och rättning av oddset.
// Mobil: rader på minst 60 px. Desktop: en tabell per grupp.
//
// Gruppen "Spelbara" fryses när vyn öppnas (och fylls på med nya), så att en
// häst vars odds rättas under riktoddset ligger kvar med varningen i stället
// för att försvinna ur listan. Spelbara sorteras per lopp och startnummer. Gruppen "Nära gränsen" finns inte längre: det
// finns bara en regel för "nära", toleransen i 6.1. Sist kommer "Inte
// markerade (n)" med Intressant-lampan: Trollspöt-hästar först med märket,
// sedan spelbara odds (e4a avsnitt 18). En Trollspöt-häst utan odds visar
// "minst X" under fältet.
//
// Grön markering (variant 1 · Ram): oddsfältet får klassen over/near och
// skillnaden `sv` står under fältet (desktop: i kolumnen Skillnad).

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useIsDesktop } from "@/components/hooks";
import { MovementCell, Sv, TrendCell } from "@/components/odds/OddsMark";
import { raceStarted, useRound } from "@/components/round/RoundProvider";
import { RiktCell, RiktShort } from "@/components/round/parts";
import { useUndoReplaced } from "@/components/round/streckOddsStore";
import { Badge, BetToggle, FlapNumber, LampToggle, LowStreckTag, signalsSr, TrollBadge, XBadge } from "@/components/ui/board";
import { IconChev, IconWarn } from "@/components/ui/icons";
import { hhmm, odds, relTime } from "@/lib/format";
import { guidelineTag } from "@/lib/odds-keypad";
import { parseOddsText } from "@/lib/odds-input";
import { byLegNumber, classOf, diffOf, replacedNote, scratchedAtUnibet, UNMARKED_HELP_TEXT, unmarkedItems } from "@/lib/odds-ui";
import { toleranceOf } from "@/lib/round-overlay";
import { signalTags } from "@/lib/signals";
import type { OddsClass } from "@/lib/spelbar";
import type { RaceDto, RoundResponse, StartDto } from "@/lib/types";
import { riktX, xOf } from "@/lib/xfactor-ui";

// troll = hästen är i Trollspöt (gruppen "Inte markerade", e4a 18).
export type Item = { race: RaceDto; start: StartDto; troll?: { rank: number; minOdds: number } | null };

const byLeg = byLegNumber<Item>;

// De uppfyllda positiva signalerna som korta taggar (lib/positive-signals.ts).
function Signals({ item }: { item: Item }) {
  const { start } = item;
  const chips = start.signals ? signalTags(start.signals) : [];
  if (!chips.length) return null;
  return (
    <span className="sigs" aria-label="Signaler">
      {chips.map((c) => (
        <span key={c.key} className="tag good">
          {c.text}
        </span>
      ))}
    </span>
  );
}

export const UNMARKED_HELP = UNMARKED_HELP_TEXT;

// "Inte markerade (n)" (e4a avsnitt 18, tidigare "Inte markerade men spelbara odds").
export const unmarkedTitle = (n: number) => `Inte markerade (${n})`;

export function PlatsPanel({ data, now }: { data: RoundResponse; now: number }) {
  const isDesktop = useIsDesktop();
  const base = `/omgang/${data.round.id}`;
  const tolerance = toleranceOf(data.settings);
  const all = useMemo(() => data.races.flatMap((race) => race.starts.map((start) => ({ race, start }))), [data.races]);
  const [frozen, setFrozen] = useState<Set<string>>(() => new Set(all.filter((i) => i.start.mark?.spelbar).map((i) => i.start.id)));
  useEffect(() => {
    const add = all.filter((i) => i.start.mark?.spelbar && !frozen.has(i.start.id));
    if (add.length) setFrozen((f) => new Set([...f, ...add.map((i) => i.start.id)]));
  }, [all, frozen]);

  const spelbara = all.filter((i) => frozen.has(i.start.id)).sort(byLeg);
  const betOnly = all.filter((i) => i.start.mark?.bet && !frozen.has(i.start.id)).sort(byLeg);
  const rest = all.filter((i) => i.start.mark?.interesting && !i.start.mark.spelbar && !i.start.mark.bet && !frozen.has(i.start.id) && !i.start.scratched).sort(byLeg);
  const unmarked = unmarkedItems(data.races, now, tolerance);
  const betCount = spelbara.filter((i) => i.start.mark?.bet).length;
  const guideline = data.settings?.spelbarGuideline ?? 2;
  const common = { now, guideline, tolerance, desk: isDesktop, variant: "spel" as const, latestFetchId: data.latestOdds?.fetchId ?? null };

  return (
    <>
      <div className="dsec-h">
        <h2 id="h-plats">Platsspel hos Unibet</h2>
        {isDesktop && <span className="help">{spelbara.length ? `Bet ${betCount} av ${spelbara.length} spelbara` : ""}</span>}
      </div>
      <p className="help spel-help">Markera Bet på det du spelar hos Unibet. Rätta oddset om det har ändrats.</p>
      {spelbara.length === 0 && betOnly.length === 0 ? (
        <p className="stat-empty spel-empty">
          Inga spelbara hästar än. Spelbar föreslås när Unibets platsodds når riktoddset eller ligger högst {odds(tolerance)} under det. <Link href={`${base}/odds`}>Till Unibets odds</Link>
        </p>
      ) : (
        <PlatsGroup title={`Spelbara (${spelbara.length})`} items={spelbara} right={`Bet ${betCount}`} {...common} />
      )}
      <PlatsGroup title={`Med Bet men inte spelbara (${betOnly.length})`} items={betOnly} {...common} />
      {rest.length > 0 && (
        <>
          <h3 className="sl">Intressant men inte spelbara ({rest.length})</h3>
          <Link className="rest" href={`${base}/odds`}>
            <span>{rest.map((i) => i.start.horse.name).join(", ")}</span>
            <IconChev />
          </Link>
        </>
      )}
      {unmarked.length > 0 &&
        (isDesktop ? (
          <p className="help unm-line">
            {unmarkedTitle(unmarked.length)}: {unmarked.map((i) => i.start.horse.name).join(", ")}.{" "}
            <Link className="linkish" href={`${base}/odds#omarkerade`}>
              Visa
            </Link>
          </p>
        ) : (
          <PlatsGroup title={unmarkedTitle(unmarked.length)} help={UNMARKED_HELP} items={unmarked} unmarked {...common} />
        ))}
    </>
  );
}

type GroupProps = {
  title: string;
  items: Item[];
  right?: string;
  help?: string;
  now: number;
  guideline: number;
  tolerance: number;
  desk: boolean;
  // odds = S4 (rörelse, vinnarodds på desktop), spel = S6.
  variant: "odds" | "spel";
  // Gruppen "Inte markerade (n)": Intressant-lampan i stället för Bet.
  unmarked?: boolean;
  // Hästar som blev Spelbara vid den senaste hämtningen (taggen "Ny", S4).
  newIds?: ReadonlySet<string>;
  latestFetchId: string | null;
  // id på gruppen (S4: "omarkerade" för länken "Visa n omarkerade").
  id?: string;
};

const ODDS_COLS = [56, 0, 66, 92, 96, 118, 70, 56];
const SPEL_COLS = [56, 0, 66, 92, 96, 56];

// En grupp rader: tabell på desktop, lista i mobilen. Används också av listan
// i Unibets odds (components/odds/OddsList.tsx).
export function PlatsGroup(props: GroupProps) {
  const { title, items, right, help, desk, variant, unmarked, id } = props;
  if (!items.length) return null;
  if (desk) {
    const cols = variant === "odds" ? ODDS_COLS : SPEL_COLS;
    return (
      <div className="twrap" id={id}>
        <table className={`tbl ptbl ${variant}`}>
          <caption className="cap" tabIndex={id ? -1 : undefined}>
            <span>{title}</span>
            {right && <span>{right}</span>}
            {help && <span className="cap-help">{help}</span>}
          </caption>
          <colgroup>
            {cols.map((w, i) => (
              <col key={i} style={w ? { width: w } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Nr</th>
              <th scope="col">Häst</th>
              <th scope="col" className="r">
                Rikt
              </th>
              <th scope="col" className="r">
                Unibet
                {variant === "odds" && <span className="thsub">plats</span>}
              </th>
              <th scope="col" className="r">
                Skillnad
                {variant === "odds" && <span className="thsub">mot rikt</span>}
              </th>
              {variant === "odds" && (
                <>
                  <th scope="col">
                    Sedan första
                    <span className="thsub">hämtningen</span>
                  </th>
                  <th scope="col" className="r">
                    Vinnare
                  </th>
                </>
              )}
              <th scope="col" className="c">
                {unmarked ? <abbr title="Intressant">Intr.</abbr> : "Bet"}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <PlatsRow key={i.start.id} item={i} {...props} />
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <section className="pgroup" id={id} aria-label={id ? title : undefined}>
      <h3 className="sl" tabIndex={id ? -1 : undefined}>
        <span>{title}</span>
        {right && <span>{right}</span>}
      </h3>
      {help && <p className="help spel-help">{help}</p>}
      <ul className="plist">
        {items.map((i) => (
          <PlatsRow key={i.start.id} item={i} {...props} />
        ))}
      </ul>
    </section>
  );
}

function PlatsRow({ item, now, guideline, tolerance, desk, variant, unmarked, newIds, latestFetchId }: GroupProps & { item: Item }) {
  const { setBet, setInteresting, roundId } = useRound();
  const { race, start } = item;
  const troll = item.troll ?? null;
  const m = start.mark;
  const started = raceStarted(race, now);
  const scrUnibet = scratchedAtUnibet(m);
  const locked = started ? "Loppet har startat" : start.scratched ? "Hästen är struken" : null;
  const x = xOf(m);
  const rx = riktX(start);
  const cls = classOf(start, tolerance);
  const d = diffOf(start);
  const odds4 = variant === "odds";
  const replaced = !unmarked && !started ? replacedNote(start, latestFetchId, tolerance) : null;
  const manual = (m?.unibetOddsSource ?? "MANUAL") === "MANUAL";
  const changed = manual && m?.unibetOddsPrev != null && m.unibetOddsAt ? `Ändrat från ${odds(m.unibetOddsPrev)} kl. ${hhmm(m.unibetOddsAt)}` : null;
  const betNote = m?.bet && m.betOdds !== null && m.betOdds !== m.unibetOdds ? `Bet till ${odds(m.betOdds)} · ändras inte` : null;
  const name = (
    <span className="hl">
      <Link className="hn tlink" href={`/omgang/${roundId}/avd/${race.leg}/hast/${start.id}`}>
        {start.horse.name} ›
      </Link>
      {troll && <TrollBadge />}
      {!odds4 && <span className="sr">{signalsSr(start.signals?.count)}</span>}
      {!odds4 && start.signals?.lowStreck && <LowStreckTag />}
      {m?.spelbar && <Badge kind="s" />}
      {m?.bet && <Badge kind="b" />}
      <XBadge x={x} />
      {odds4 && newIds?.has(start.id) && <span className="tag new">Ny</span>}
      {m?.belowGuideline && <span className="tag gl">{guidelineTag(guideline)}</span>}
      {scrUnibet && <span className="tag scr-u">Struken hos Unibet</span>}
      {started && <span className="tag">Startat</span>}
      {start.scratched && <span className="tag scr-tag">Struken</span>}
    </span>
  );
  const notes = unmarked ? null : (
    <>
      {replaced && <ReplacedNote name={start.horse.name} from={replaced.from} lost={replaced.lostForslag} startId={start.id} fetchId={latestFetchId!} />}
      {!odds4 && cls === "under" && <span className="note bad">{m?.spelbar ? "Under riktoddset nu · Spelbar satt av dig" : "Under riktoddset nu, inte längre föreslagen"}</span>}
      {!odds4 && cls === "near" && m?.spelbar && <span className="note">Spelbar: högst {odds(tolerance)} under riktoddset</span>}
      {betNote && <span className="note">{betNote}</span>}
      {scrUnibet && !start.scratched && <span className="note">Struken hos Unibet, inte hos ATG än.</span>}
      {changed && <span className="note">{changed}</span>}
      {!odds4 && cls !== "under" && m?.spelbarOverride === "ON" && <span className="note">Spelbar satt av dig</span>}
    </>
  );
  const toggle = unmarked ? (
    <LampToggle on={!!m?.interesting} horseName={start.horse.name} disabledReason={locked} onToggle={() => setInteresting(race, start, !m?.interesting)} />
  ) : (
    <BetToggle on={!!m?.bet} horseName={start.horse.name} disabledReason={started || (start.scratched && !m?.bet) ? locked : null} onToggle={() => setBet(race, start, !m?.bet)} />
  );
  const fieldOff = !!locked || scrUnibet;
  // Trollspöt-häst utan odds: "minst 2,40" under fältet (e4a 18).
  const minHint = troll && m?.unibetOdds == null ? `minst ${odds(troll.minOdds)}` : null;
  const sv = minHint ? <span className="sv tmin-h">{minHint}</span> : <Sv diff={d} cls={cls} />;
  const win = start.unibet && !scrUnibet ? start.unibet.win : null;

  if (desk)
    return (
      <tr className={start.scratched ? "scr" : undefined}>
        <td>
          <FlapNumber n={start.number} signals={odds4 ? undefined : start.signals?.count} />
        </td>
        <td>
          {name}
          <span className="kt">
            {odds4 ? (unmarked ? `Avd ${race.leg} · ${start.driver?.name ?? "Kusk saknas"}` : start.driver?.name ?? "Kusk saknas") : `Avd ${race.leg} · ${hhmm(race.startAt)} · ${start.driver?.name ?? "Kusk saknas"}`}
          </span>
          {!odds4 && <Signals item={item} />}
          <span className="notes">{notes}</span>
        </td>
        <td className="r">
          <RiktCell s={start} className="rk num dk" two />
        </td>
        <td className="r">
          <OddsField item={item} disabled={fieldOff} cls={cls} hint={minHint} />
        </td>
        <td className="r">
          <Sv diff={d} cls={cls} />
        </td>
        {odds4 && (
          <>
            <td>
              <TrendCell start={start} rikt={rx} firstLabel={(iso) => relTime(iso, new Date(now))} />
            </td>
            <td className="r num dim">{odds(win)}</td>
          </>
        )}
        <td className="c">{toggle}</td>
      </tr>
    );
  return (
    <li className={`brow ${odds4 ? "xb" : "xa"}${start.scratched ? " scr" : ""}`}>
      <FlapNumber n={start.number} size="sm" signals={odds4 ? undefined : start.signals?.count} />
      <div className="pmain">
        {name}
        <span className="pm">
          Avd {race.leg} · <RiktShort riktodds={start.riktodds} x={x} rx={rx} />
          {unmarked && " · inte markerad"}
        </span>
        {!odds4 && <Signals item={item} />}
        {notes}
      </div>
      {odds4 && <MovementCell start={start} rikt={rx} />}
      <OddsField item={item} disabled={fieldOff} cls={cls} sv={sv} hint={minHint} />
      {toggle}
    </li>
  );
}

// "Ersatte ditt 3,10, inte längre föreslagen · Ångra" (e2.2 S4).
function ReplacedNote({ name, from, lost, startId, fetchId }: { name: string; from: number; lost: boolean; startId: string; fetchId: string }) {
  const { roundId } = useRound();
  const undo = useUndoReplaced(roundId);
  return (
    <span className="note bad">
      Ersatte ditt {odds(from)}
      {lost && ", inte längre föreslagen"} ·{" "}
      <button type="button" className="linkish" onClick={() => undo(fetchId, startId)} aria-label={`Ångra: ditt odds ${odds(from)} tillbaka för ${name}`}>
        Ångra
      </button>
    </span>
  );
}

// Fältet för Unibet-odds: samma tolkning som knappsatsen. Sparas vid blur
// eller Enter. Tomt fält ändrar inget (oddset tas bort i S4). cls = grön ram
// (over: heldragen, near: streckad). sv = skillnaden under fältet (mobil).
// hint = "minst 2,40" för en Trollspöt-häst utan odds: under fältet, och
// kopplad till fältet med aria-describedby.
function OddsField({ item, disabled, cls, sv, hint }: { item: Item; disabled: boolean; cls: OddsClass | null; sv?: React.ReactNode; hint?: string | null }) {
  const { setOdds } = useRound();
  const { race, start } = item;
  const saved = start.mark?.unibetOdds ?? null;
  const [text, setText] = useState(saved === null ? "" : odds(saved));
  const [error, setError] = useState<string | null>(null);
  const editing = useRef(false);
  const id = useId();

  // Nytt värde utifrån (sparat på annat ställe eller hämtat): visa det om fältet inte redigeras.
  useEffect(() => {
    if (!editing.current) setText(saved === null ? "" : odds(saved));
  }, [saved]);

  const commit = () => {
    editing.current = false;
    const t = text.trim();
    if (!t) {
      setText(saved === null ? "" : odds(saved));
      setError(null);
      return;
    }
    const r = parseOddsText(t);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    setText(odds(r.value));
    if (r.value !== saved) setOdds(race, start, r.value);
  };

  const input = (
    <input
      className={`oin${cls === "over" || cls === "near" ? ` ${cls}` : ""}`}
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder="–,––"
      value={disabled && saved === null ? "" : text}
      disabled={disabled}
      aria-label={`Unibet platsodds för ${start.horse.name}`}
      aria-invalid={error ? true : undefined}
      aria-describedby={[error ? `${id}-e` : null, hint ? `${id}-h` : null].filter(Boolean).join(" ") || undefined}
      onFocus={() => (editing.current = true)}
      onChange={(e) => {
        editing.current = true;
        setText(e.target.value);
        if (error) setError(null);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          editing.current = false;
          setText(saved === null ? "" : odds(saved));
          setError(null);
        }
      }}
    />
  );
  const err = error && (
    <span className="err-msg ofield-e" id={`${id}-e`} role="alert">
      <IconWarn />
      {error}
    </span>
  );
  if (sv)
    return (
      <>
        <span className="ofc">
          {input}
          {hint ? (
            <span className="sv tmin-h" id={`${id}-h`}>
              {hint}
            </span>
          ) : (
            sv
          )}
        </span>
        {err}
      </>
    );
  return (
    <span className="ofield">
      {input}
      {hint && (
        <span className="sv tmin-h" id={`${id}-h`}>
          {hint}
        </span>
      )}
      {err}
    </span>
  );
}
