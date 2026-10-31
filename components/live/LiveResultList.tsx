"use client";

// Resultatlistan i Live (E8 7): ersätter kolumnerna och taggningen när loppets
// resultat är visat. Raderna går inte att klicka på. Renderas bara för visat lopp.

import { forwardRef } from "react";
import { BetTicket, FlapNumber, RadPill } from "@/components/ui/board";
import { legName } from "@/lib/game-type";
import { BAD_TAGS, RESULT_LIST_HELP, type ResultRow } from "@/lib/live-view";

export const LiveResultList = forwardRef<HTMLHeadingElement, { gameType: string; leg: number; rows: ResultRow[] }>(function LiveResultList({ gameType, leg, rows }, ref) {
  const name = `Resultat ${legName(gameType, leg)}`;
  return (
    <section className="lres" aria-labelledby="lres-h">
      <h2 className="sr" id="lres-h" tabIndex={-1} ref={ref}>
        {name}
      </h2>
      <div className="lrh d-only" aria-hidden="true">
        <span>Plac</span>
        <span>Nr</span>
        <span>Häst</span>
        <span>Kusk</span>
        <span>Bet</span>
        <span>Rad</span>
        <span>Taggar</span>
      </div>
      <ul className="lrl" aria-label={name}>
        {rows.map((r, i) => (
          <li key={r.start.id} className={`lrw${r.top3 ? " top" : ""}`}>
            <span className="sr">{r.sr}</span>
            <span className="lp" aria-hidden="true">
              {r.top3 ? <FlapNumber n={r.place as number} placed index={i} /> : <span className={`plc num${r.kind === "disqualified" ? " dq" : ""}`}>{r.placeText}</span>}
            </span>
            <span className="ln" aria-hidden="true">
              <FlapNumber n={r.start.number} size="sm" />
            </span>
            <span className="lh2" aria-hidden="true">
              <span className="pn" title={r.start.horse.name}>
                {r.start.horse.name}
              </span>
              {r.kind === "disqualified" && <span className="tag bad">Diskad</span>}
            </span>
            <span className="ld" aria-hidden="true" title={r.start.driver?.name ?? undefined}>
              {r.start.driver?.name ?? "Kusk saknas"}
            </span>
            <span className="lb" aria-hidden="true">
              {r.bet && <BetTicket odds={r.bet.odds} hit={r.bet.hit} />}
            </span>
            <span className="lq" aria-hidden="true">
              {r.rad && <RadPill hit={r.rad.hit} />}
            </span>
            <span className="lt2" aria-hidden="true" title={r.tags.length ? r.tags.join(", ") : undefined}>
              {r.shownTags.map((t) => (
                <span key={t} className={`tag${BAD_TAGS.includes(t) ? " bad" : ""}`}>
                  {t}
                </span>
              ))}
              {r.moreTags > 0 && <span className="lmore">+{r.moreTags}</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="help lres-help">{RESULT_LIST_HELP}</p>
    </section>
  );
});
