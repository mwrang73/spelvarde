"use client";

// Riktoddset i hästkortet (specen S3 punkt 4, 7.4, och analysvy-layout 4.1):
// nyckeltalen på tavlan (RiktKeys), detaljerna (RiktDetail) och WhyList.
// Riktoddset, Unibet-oddset och läget kommer ur omgångens cache och syns
// direkt; "Talar för/emot" och beräkningsraden kommer med hästkortet
// (GET /api/starts/[id]).

import { Skeleton } from "@/components/ui/board";
import { IconDown, IconUp } from "@/components/ui/icons";
import { MIN_STARTERS } from "@/lib/riktodds";
import { odds } from "@/lib/format";
import { guidelineTag, riktoddsSentence } from "@/lib/odds-keypad";
import type { RaceDto, RiktoddsDetailDto, StartDto, WhyRowDto } from "@/lib/types";
import { boxVerdict, scratchedAtUnibet } from "@/lib/odds-ui";
import { weekdayTime } from "@/lib/streck-odds";
import { oddsClass } from "@/lib/spelbar";
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

export type RiktView = ReturnType<typeof useRiktView>;

// Beräkningarna bakom nyckeltalen (RiktKeys) och detaljerna (RiktDetail),
// samma som i dagens riktoddsruta (analysvy-layout 4.1).
export function useRiktView({ race, start, factors, tolerance, guideline }: { race: RaceDto; start: StartDto; factors: XFactorSettings; tolerance: number; guideline: number }) {
  const m = start.mark;
  const unibet = m?.unibetOdds ?? null;
  const rikt = start.riktodds;
  // Med X-faktor (6.8): stora siffran är riktoddset med X-faktor, och meningen jämför mot det.
  const x = xOf(m);
  const rx = riktX(start, factors);
  const withX = x !== "NONE" && rikt !== null && rx !== null;
  const below = unibet !== null && unibet < guideline;
  const scrU = scratchedAtUnibet(m);
  const sentence =
    rikt === null
      ? missingReason(race, start)
      : scrU && !start.scratched
        ? "Struken hos Unibet, inte hos ATG än. Hästen föreslås inte som Spelbar."
        : riktoddsSentence({
            unibetOdds: unibet,
            riktodds: withX ? rx : rikt,
            interesting: !!m?.interesting,
            spelbar: !!m?.spelbar,
            override: m?.spelbarOverride ?? "NONE",
            ref: withX ? "riktoddset med X-faktor" : undefined,
          });
  // Grön markering (e2.2 5b) för över och nära.
  const ref = withX ? rx : rikt;
  const cls = oddsClass(unibet, ref, tolerance);
  const green = rikt === null ? null : boxVerdict({ unibetOdds: unibet, riktodds: ref, interesting: !!m?.interesting, spelbar: !!m?.spelbar, override: m?.spelbarOverride ?? "NONE", tolerance, withX });
  const source = unibet === null ? null : m?.unibetOddsSource === "UNIBET" ? `Hämtat ${m.unibetOddsAt ? weekdayTime(m.unibetOddsAt) : ""}.`.replace(" .", ".") : "Eget odds.";
  const win = start.unibet && !scrU ? start.unibet.win : null;
  const unc = start.uncertain && rikt !== null;
  return { unibet, rikt, x, rx, withX, below, scrU, sentence, cls, green, source, win, unc, guideline, factors, scratched: start.scratched, signals: start.signals?.count ?? null };
}

// Nyckeltalen på tavlan: desktop (Riktodds, Unibet plats, Vinnare och
// Signaler) och mobilen (Riktodds, Unibet plats och Signaler).
export function RiktKeys({ v, variant }: { v: RiktView; variant: "desk" | "mobile" }) {
  const main = v.scratched ? null : v.withX ? v.rx : v.rikt;
  const unibetText = v.scrU || v.scratched ? "–" : odds(v.unibet);
  const over = !v.scratched && !v.scrU && v.cls === "over";
  const near = !v.scratched && !v.scrU && v.cls === "near";
  const label = v.withX ? "Med X-faktor" : variant === "desk" ? "Riktodds plats" : "Riktodds";
  const keys: { k: string; cls: string; body: React.ReactNode; sr: string }[] = [
    {
      k: label,
      cls: "big",
      body: (
        <>
          {odds(main)}
          {v.unc && !v.scratched && (
            <sup aria-hidden="true" title="Osäkert">
              *
            </sup>
          )}
        </>
      ),
      sr: `${label} ${main === null ? "saknas" : odds(main)}${v.unc && !v.scratched ? " (osäkert)" : ""}`,
    },
    {
      k: "Unibet plats",
      cls: over ? "up" : "",
      body: (
        <>
          {unibetText}
          {over && <span className="k-up"> ▲</span>}
          {near && <span className="k-near"> NÄRA</span>}
        </>
      ),
      sr: `Unibet plats ${unibetText === "–" ? "saknas" : unibetText}${over ? ", över riktoddset" : near ? ", nära riktoddset" : ""}`,
    },
  ];
  if (variant === "desk") keys.push({ k: "Vinnare", cls: "", body: odds(v.scratched ? null : v.win), sr: `Vinnare ${v.win === null || v.scratched ? "saknas" : odds(v.win)}` });
  keys.push({ k: "Signaler", cls: "", body: v.signals === null ? "–" : `${v.signals}/10`, sr: v.signals === null ? "Signaler saknas" : `Signaler ${v.signals} av 10` });
  return (
    <div className={variant === "desk" ? "keys" : "mkeys-k"} role="list" aria-label="Nyckeltal">
      {keys.map((k) => (
        <div key={k.k} className="key" role="listitem">
          <small aria-hidden="true">{k.k}</small>
          <b className={`num${k.cls ? ` ${k.cls}` : ""}`} aria-hidden="true">
            {k.body}
          </b>
          <span className="sr">{k.sr}</span>
        </div>
      ))}
    </div>
  );
}

// Meningen, taggarna, X-raden, skälen och beräkningen (R1 K1 och mobilens sektion Riktodds).
export function RiktDetail({ v, detail, detailLoading, error, onRetry }: { v: RiktView; detail: RiktoddsDetailDto | null; detailLoading: boolean; error?: string | null; onRetry?: () => void }) {
  return (
    <>
      {detail?.uncertainLine && <p className="unc">{detail.uncertainLine}</p>}
      {detail?.noteLine && <p className="help">{detail.noteLine}</p>}
      {!detail && v.unc && <p className="unc">Osäkert riktodds</p>}
      <p className="verdict">
        {v.green ? (
          <>
            <span className={`hsv${v.green.cls === "near" ? " near" : ""}`}>
              {v.green.diff}
              {v.green.cls === "near" && " NÄRA"}
            </span>
            <span className="sr">{v.green.cls === "over" ? " över riktoddset" : " under riktoddset, nära"}</span> {v.green.lead && <b className="hsv-l">{v.green.lead}</b>}
            {v.green.text}
          </>
        ) : (
          <Sentence text={v.sentence} />
        )}
        {v.source && <span className="vsrc"> {v.source}</span>}
      </p>
      {(v.below || v.scrU) && (
        <p className="rd-tags">
          {v.below && <span className="tag gl">{guidelineTag(v.guideline)}</span>}
          {v.scrU && <span className="tag gl">Struken hos Unibet</span>}
        </p>
      )}
      {v.withX && (
        <p className="help xunder">
          Riktodds utan X <b className="num">{odds(v.rikt)}</b> · <span className="num">{factorText(v.x, v.factors)}</span> {X_LABEL[v.x]}
        </p>
      )}
      {v.rikt !== null &&
        (detail ? (
          <WhyList pros={detail.pros} cons={detail.cons} />
        ) : detailLoading ? (
          <div className="sk-block" aria-busy="true" aria-label="Laddar">
            <Skeleton width="80%" />
            <Skeleton width="70%" />
            <Skeleton width="75%" />
          </div>
        ) : error ? (
          <div className="stat-empty">
            <p>Kunde inte hämta</p>
            {onRetry && (
              <button type="button" className="btn secondary sm" onClick={onRetry}>
                Försök igen
              </button>
            )}
          </div>
        ) : null)}
      {detail && <p className="formula num">{calcLineWithX(detail.calcLine, v.rikt, v.x, v.factors)}</p>}
    </>
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
