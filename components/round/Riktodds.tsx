"use client";

// RiktoddsBox och WhyList i hästkortet (specen S3 punkt 4, 7.4). Riktoddset,
// Unibet-oddset och läget kommer ur omgångens cache och syns direkt;
// "Talar för/emot" och beräkningsraden kommer med hästkortet
// (GET /api/starts/[id]).

import { Skeleton } from "@/components/ui/board";
import { IconDown, IconUp } from "@/components/ui/icons";
import { MIN_STARTERS } from "@/lib/riktodds";
import { odds } from "@/lib/format";
import { guidelineTag, riktoddsSentence } from "@/lib/odds-keypad";
import type { RaceDto, RiktoddsDetailDto, StartDto, WhyRowDto } from "@/lib/types";
import { calcLineWithX, factorText, X_LABEL, type XFactorSettings } from "@/lib/xfactor";
import { riktX, xOf } from "@/lib/xfactor-ui";

// "v3, kalibrerad" eller "v1, okalibrerad".
export const modelLabel = (key: string | null | undefined, calibrated = false) => `${key ?? "v1"}, ${calibrated ? "kalibrerad" : "okalibrerad"}`;

function missingReason(race: RaceDto, start: StartDto): string {
  if (start.scratched) return "Struken häst får inget riktodds.";
  if (race.counts.starters < MIN_STARTERS) return `Lopp med färre än ${MIN_STARTERS} startande får inget riktodds.`;
  return "Riktodds saknas – hämta omgången igen.";
}

// "Spelbar: Unibet ger …" med ordet före kolon i fetstil.
function Sentence({ text }: { text: string }) {
  const i = text.indexOf(": ");
  if (i < 0) return <>{text}</>;
  return (
    <>
      <b>{text.slice(0, i + 1)}</b> {text.slice(i + 2)}
    </>
  );
}

export function RiktoddsBox({
  race,
  start,
  detail,
  detailLoading,
  modelKey,
  calibrated,
  guideline,
  factors,
}: {
  race: RaceDto;
  start: StartDto;
  detail: RiktoddsDetailDto | null;
  detailLoading: boolean;
  modelKey: string | null;
  calibrated?: boolean;
  guideline: number;
  factors: XFactorSettings;
}) {
  const m = start.mark;
  const unibet = m?.unibetOdds ?? null;
  const rikt = start.riktodds;
  // Med X-faktor (6.8): stora siffran är riktoddset med X-faktor, och meningen jämför mot det.
  const x = xOf(m);
  const rx = riktX(start, factors);
  const withX = x !== "NONE" && rikt !== null && rx !== null;
  const below = unibet !== null && unibet < guideline;
  const sentence =
    rikt === null
      ? missingReason(race, start)
      : riktoddsSentence({
          unibetOdds: unibet,
          riktodds: withX ? rx : rikt,
          interesting: !!m?.interesting,
          spelbar: !!m?.spelbar,
          override: m?.spelbarOverride ?? "NONE",
          ref: withX ? "riktoddset med X-faktor" : undefined,
        });
  const unc = start.uncertain && rikt !== null;
  const hid = `rk-${start.id}`;
  return (
    <section className="hk-sec" aria-labelledby={hid}>
      <h3 id={hid}>
        Riktodds plats <span className="mver">{modelLabel(detail?.modelKey ?? modelKey, calibrated)}</span>
      </h3>
      {detail?.uncertainLine && <p className="unc">{detail.uncertainLine}</p>}
      {detail?.noteLine && <p className="help">{detail.noteLine}</p>}
      {!detail && start.uncertain && rikt !== null && <p className="unc">Osäkert riktodds</p>}
      <div className={`rbox brd${withX ? " x" : ""}`}>
        <div>
          <span className="k">{withX ? "Med X-faktor" : "Riktodds"}</span>
          <div className="big num">
            {odds(withX ? rx : rikt)}
            {unc && (
              <sup aria-hidden="true" title="Osäkert">
                *
              </sup>
            )}
            {unc && <span className="sr"> (osäkert)</span>}
          </div>
        </div>
        {withX && (
          <div>
            <span className="k">Riktodds</span>
            <div className="mid num">{odds(rikt)}</div>
          </div>
        )}
        <div>
          <span className="k">Unibet</span>
          <div className="mid num">{odds(unibet)}</div>
        </div>
        <div className="rb-tags">{below && <span className="tag gl">{guidelineTag(guideline)}</span>}</div>
        <p className="verdict">
          <Sentence text={sentence} />
        </p>
      </div>
      {withX && (
        <p className="help xunder">
          <span className="num">{factorText(x, factors)}</span> · {X_LABEL[x]}
        </p>
      )}
      {rikt !== null && (detail ? <WhyList pros={detail.pros} cons={detail.cons} /> : detailLoading ? <div className="sk-block"><Skeleton width="80%" /><Skeleton width="70%" /><Skeleton width="75%" /></div> : null)}
      {detail && <p className="formula num">{calcLineWithX(detail.calcLine, rikt, x, factors)}</p>}
    </section>
  );
}

export function WhyList({ pros, cons }: { pros: WhyRowDto[]; cons: WhyRowDto[] }) {
  if (!pros.length && !cons.length) return <p className="help why-none">Inga enskilda faktorer väger tungt för hästen.</p>;
  return (
    <div className="why2">
      {pros.length > 0 && (
        <div className="pro">
          <h4>Talar för · sänker riktoddset</h4>
          <ul>
            {pros.slice(0, 3).map((r) => (
              <li key={r.key}>
                <IconDown />
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {cons.length > 0 && (
        <div className="con">
          <h4>Talar emot · höjer riktoddset</h4>
          <ul>
            {cons.slice(0, 3).map((r) => (
              <li key={r.key}>
                <IconUp />
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
