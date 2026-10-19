"use client";

// S6a Platsspel (specen S6a): Bet på det som spelas hos Unibet och rättning
// av oddset. Mobil: rader på 60 px. Desktop: tabellen Nr, Häst, Rikt,
// Unibet (fält), Skillnad och Bet.
//
// Gruppen "Spelbara" fryses när vyn öppnas (och fylls på med nya), så att en
// häst vars odds rättas under riktoddset ligger kvar med varningen i stället
// för att försvinna ur listan.

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useIsDesktop } from "@/components/hooks";
import { raceStarted, useRound } from "@/components/round/RoundProvider";
import { Badge, BetToggle, FlapNumber } from "@/components/ui/board";
import { IconChev, IconWarn } from "@/components/ui/icons";
import { hhmm, odds } from "@/lib/format";
import { guidelineTag } from "@/lib/odds-keypad";
import { parseOddsText } from "@/lib/odds-input";
import { oddsDiff } from "@/lib/spelbar";
import type { RaceDto, RoundResponse, StartDto } from "@/lib/types";

type Item = { race: RaceDto; start: StartDto };

const byLeg = (a: Item, b: Item) => a.race.leg - b.race.leg || a.start.number - b.start.number;

export function PlatsPanel({ data, now }: { data: RoundResponse; now: number }) {
  const isDesktop = useIsDesktop();
  const base = `/omgang/${data.round.id}`;
  const all = useMemo(() => data.races.flatMap((race) => race.starts.map((start) => ({ race, start }))), [data.races]);
  const [frozen, setFrozen] = useState<Set<string>>(() => new Set(all.filter((i) => i.start.mark?.spelbar).map((i) => i.start.id)));
  useEffect(() => {
    const add = all.filter((i) => i.start.mark?.spelbar && !frozen.has(i.start.id));
    if (add.length) setFrozen((f) => new Set([...f, ...add.map((i) => i.start.id)]));
  }, [all, frozen]);

  const spelbara = all.filter((i) => frozen.has(i.start.id)).sort(byLeg);
  const betOnly = all.filter((i) => i.start.mark?.bet && !frozen.has(i.start.id)).sort(byLeg);
  const rest = all.filter((i) => i.start.mark?.interesting && !i.start.mark.spelbar && !i.start.mark.bet && !frozen.has(i.start.id)).sort(byLeg);
  const betCount = spelbara.filter((i) => i.start.mark?.bet).length;
  const guideline = data.settings?.spelbarGuideline ?? 2;

  const group = (title: string, items: Item[], right?: string) =>
    items.length > 0 &&
    (isDesktop ? (
      <div className="twrap">
        <table className="tbl ptbl">
          <caption className="cap">
            <span>{title}</span>
            {right && <span>{right}</span>}
          </caption>
          <thead>
            <tr>
              <th scope="col">Nr</th>
              <th scope="col">Häst</th>
              <th scope="col" className="r">
                Rikt
              </th>
              <th scope="col" className="r">
                Unibet
              </th>
              <th scope="col" className="r">
                Skillnad
              </th>
              <th scope="col" className="c">
                Bet
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <PlatsRow key={i.start.id} item={i} now={now} guideline={guideline} desk />
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <>
        <h3 className="sl">
          <span>{title}</span>
          {right && <span>{right}</span>}
        </h3>
        <ul className="plist">
          {items.map((i) => (
            <PlatsRow key={i.start.id} item={i} now={now} guideline={guideline} />
          ))}
        </ul>
      </>
    ));

  return (
    <>
      <div className="dsec-h">
        <h2 id="h-plats">Platsspel hos Unibet</h2>
        {isDesktop && <span className="help">{spelbara.length ? `Bet ${betCount} av ${spelbara.length} spelbara` : ""}</span>}
      </div>
      <p className="help spel-help">Markera Bet på det du spelar hos Unibet. Rätta oddset om det har ändrats.</p>
      {spelbara.length === 0 && betOnly.length === 0 ? (
        <p className="stat-empty spel-empty">
          Inga spelbara hästar än. Spelbar föreslås när Unibets platsodds är högre än riktoddset.{" "}
          <Link href={`${base}/odds`}>Fyll i Unibets odds</Link>
        </p>
      ) : (
        group(`Spelbara (${spelbara.length})`, spelbara, `Bet ${betCount}`)
      )}
      {group(`Med Bet men inte spelbara (${betOnly.length})`, betOnly)}
      {rest.length > 0 && (
        <>
          <h3 className="sl">Intressant men inte spelbara ({rest.length})</h3>
          <Link className="rest" href={`${base}/odds`}>
            <span>{rest.map((i) => i.start.horse.name).join(", ")}</span>
            <IconChev />
          </Link>
        </>
      )}
    </>
  );
}

function PlatsRow({ item, now, guideline, desk }: { item: Item; now: number; guideline: number; desk?: boolean }) {
  const { setBet } = useRound();
  const { race, start } = item;
  const m = start.mark;
  const started = raceStarted(race, now);
  const locked = started ? "Loppet har startat" : start.scratched ? "Hästen är struken" : null;
  const unibet = m?.unibetOdds ?? null;
  const d = oddsDiff(unibet, start.riktodds);
  const under = d !== null && d <= 0;
  const changed = m?.unibetOddsPrev != null && m.unibetOddsAt ? `Ändrat från ${odds(m.unibetOddsPrev)} kl. ${hhmm(m.unibetOddsAt)}` : null;
  const name = (
    <span className="hl">
      <span className="hn">{start.horse.name}</span>
      {m?.spelbar && <Badge kind="s" />}
      {m?.bet && <Badge kind="b" />}
      {m?.belowGuideline && <span className="tag gl">{guidelineTag(guideline)}</span>}
      {started && <span className="tag">Startat</span>}
      {start.scratched && <span className="tag scr-tag">Struken</span>}
    </span>
  );
  const notes = (
    <>
      {under && (
        <span className="note bad">
          {m?.spelbar ? "Under riktoddset nu · Spelbar satt av dig" : "Under riktoddset nu, inte längre föreslagen"}
        </span>
      )}
      {changed && <span className="note">{changed}</span>}
      {!under && m?.spelbarOverride === "ON" && <span className="note">Spelbar satt av dig</span>}
    </>
  );
  const bet = <BetToggle on={!!m?.bet} horseName={start.horse.name} disabledReason={started || (start.scratched && !m?.bet) ? locked : null} onToggle={() => setBet(race, start, !m?.bet)} />;

  if (desk)
    return (
      <tr className={start.scratched ? "scr" : undefined}>
        <td>
          <FlapNumber n={start.number} />
        </td>
        <td>
          {name}
          <span className="kt">
            Avd {race.leg} · {hhmm(race.startAt)}
          </span>
          <span className="notes">{notes}</span>
        </td>
        <td className="r num">{odds(start.riktodds)}</td>
        <td className="r">
          <OddsField item={item} disabled={!!locked} />
        </td>
        <td className="r">
          <span className={`diff ${d !== null && d > 0 ? "up" : "dn"}`}>{d === null ? "–" : `${d > 0 ? "+" : d < 0 ? "−" : "±"}${odds(Math.abs(d))}`}</span>
        </td>
        <td className="c">{bet}</td>
      </tr>
    );
  return (
    <li className={`brow${start.scratched ? " scr" : ""}`}>
      <FlapNumber n={start.number} size="sm" />
      <div className="pmain">
        {name}
        <span className="pm">
          Avd {race.leg} · rikt <b>{odds(start.riktodds)}</b>
        </span>
        {notes}
      </div>
      <OddsField item={item} disabled={!!locked} />
      {bet}
    </li>
  );
}

// Fältet för Unibet-odds: samma tolkning som knappsatsen. Sparas vid blur
// eller Enter. Tomt fält ändrar inget (oddset tas bort i S4).
function OddsField({ item, disabled }: { item: Item; disabled: boolean }) {
  const { setOdds } = useRound();
  const { race, start } = item;
  const saved = start.mark?.unibetOdds ?? null;
  const [text, setText] = useState(saved === null ? "" : odds(saved));
  const [error, setError] = useState<string | null>(null);
  const editing = useRef(false);
  const id = useId();

  // Nytt värde utifrån (sparat på annat ställe): visa det om fältet inte redigeras.
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

  return (
    <span className="ofield">
      <input
        className="oin"
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="–,––"
        value={text}
        disabled={disabled}
        aria-label={`Unibet platsodds för ${start.horse.name}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-e` : undefined}
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
      {error && (
        <span className="err-msg ofield-e" id={`${id}-e`} role="alert">
          <IconWarn />
          {error}
        </span>
      )}
    </span>
  );
}
