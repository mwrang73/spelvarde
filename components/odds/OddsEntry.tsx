"use client";

// S4 Unibets platsodds (specen S4, beslut 4B): egen knappsats, en häst i
// taget. Kön byggs en gång när vyn öppnas (lib/odds-keypad.ts), så att en
// häst inte flyttar sig i kön när den får odds. Varje odds sparas direkt och
// optimistiskt via utkorgen, och Spelbar räknas om direkt (6.1). När kön är
// slut öppnas sammanfattningsarket, som går att stänga direkt.
//
// X-faktorn (E2.1, 6.8): knappen i hästkortet och tangenten X stegar läget.
// Den rör inte siffrorna. Trycks den under 350 ms-fönstret avbryts hoppet
// (hold), oddset står kvar sparat och Nästa krävs.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DESKTOP_QUERY, useIsDesktop, useNow, useOnline } from "@/components/hooks";
import { useOutbox } from "@/components/outbox/OutboxProvider";
import { raceStarted, useRound } from "@/components/round/RoundProvider";
import { AppHeader } from "@/components/shell/AppHeader";
import { RiktShort } from "@/components/round/parts";
import { XCycleButton, xLockReason } from "@/components/round/XFactor";
import { Banner, EmptyState, FlapNumber, Skeleton, XBadge } from "@/components/ui/board";
import { IconCheckThin, IconFlag, IconWarn } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { hhmm, odds } from "@/lib/format";
import { AUTO_ADVANCE_MS, digitsToOdds, displayDigits, isValidOdds } from "@/lib/odds-input";
import { buildOddsQueue, guidelineTag, initialKeypad, isDone, keyFromKeyboard, keypadReduce, keypadVerdict, type KeypadAction, type KeypadKey, type KeypadState } from "@/lib/odds-keypad";
import { oddsDiff } from "@/lib/spelbar";
import { xFactorsOf } from "@/lib/round-overlay";
import type { RaceDto, RoundResponse, StartDto } from "@/lib/types";
import { nextXFactor, X_LABEL, type XFactorSettings } from "@/lib/xfactor";
import { riktX, xOf } from "@/lib/xfactor-ui";
import { StreckRefresh } from "@/components/round/StreckRefresh";

type Item = { race: RaceDto; start: StartDto };

export function OddsEntry() {
  const { data, load, roundId } = useRound();
  const back = { href: `/omgang/${roundId}`, label: "Tillbaka till omgången" };
  if (!data)
    return (
      <>
        <AppHeader title="Unibets platsodds" sub="Laddar …" back={back} />
        <main className="page" id="main">
          {load.error && !load.loading ? (
            <Banner tone={load.notFound ? "info" : "err"} className="m10" actions={load.notFound ? <Link href="/">Till aktuell omgång</Link> : undefined}>
              {load.notFound ? "Omgången finns inte." : load.error}
            </Banner>
          ) : (
            <div className="kpw" aria-busy="true" aria-label="Laddar">
              <div className="kcard">
                <FlapNumber n="–" size="lg" />
                <div className="sk-block">
                  <Skeleton width="60%" height={20} />
                  <Skeleton width="40%" />
                </div>
              </div>
            </div>
          )}
        </main>
      </>
    );
  return <OddsQueue data={data} />;
}

function OddsQueue({ data }: { data: RoundResponse }) {
  const roundId = data.round.id;
  const base = `/omgang/${roundId}`;
  // Kön fryses när vyn öppnas.
  const [ids] = useState(() => buildOddsQueue(data.races, Date.now()));
  const byId = useMemo(() => {
    const m = new Map<string, Item>();
    for (const race of data.races) for (const start of race.starts) m.set(start.id, { race, start });
    return m;
  }, [data.races]);
  const items = useMemo(() => ids.map((id) => byId.get(id)).filter((x): x is Item => !!x), [ids, byId]);
  const anyMarked = data.races.some((r) => r.starts.some((s) => s.mark?.interesting || s.mark?.bet));

  if (!items.length) {
    return (
      <>
        <AppHeader title="Unibets platsodds" sub={`${data.round.gameType} · ${data.round.trackName}`} back={{ href: base, label: "Tillbaka till omgången" }} />
        <main className="page" id="main">
          {anyMarked ? (
            <EmptyState icon={<IconFlag />} title="Inga odds att fylla i" text="Loppen för dina intressanta hästar har startat, eller hästarna är strukna.">
              <Link className="btn primary" href={base}>
                Till omgången
              </Link>
            </EmptyState>
          ) : (
            <EmptyState icon={<IconFlag />} title="Inga intressanta hästar än" text="Markera Intressant i avdelningarna först.">
              <Link className="btn primary" href={`${base}/avd/1`}>
                Till avd 1
              </Link>
            </EmptyState>
          )}
        </main>
      </>
    );
  }
  return <Keypad data={data} items={items} />;
}

function Keypad({ data, items }: { data: RoundResponse; items: Item[] }) {
  const { setOdds, setSpelbar, setXFactor } = useRound();
  const router = useRouter();
  const online = useOnline();
  const { queue } = useOutbox();
  const isDesktop = useIsDesktop();
  const now = useNow(30_000).getTime();
  const roundId = data.round.id;
  const base = `/omgang/${roundId}`;
  const guideline = data.settings?.spelbarGuideline ?? 2;
  const factors = xFactorsOf(data.settings);
  const total = items.length;

  const [st, setSt] = useState<KeypadState>(() => initialKeypad(total));
  const stRef = useRef(st);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [sheetOpen, setSheetOpen] = useState(false);
  const padRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const dispatch = useCallback(
    (action: KeypadAction) => {
      const cur = stRef.current;
      const item = itemsRef.current[cur.index];
      const locked = item ? raceStarted(item.race) || item.start.scratched : false;
      if (locked && action.type === "key" && action.key !== "prev" && action.key !== "skip" && action.key !== "next") return;
      const { state, effect } = keypadReduce(cur, action, { savedOdds: item?.start.mark?.unibetOdds ?? null });
      stRef.current = state;
      setSt(state);
      if (effect && item) {
        const target = itemsRef.current[effect.index];
        if (target) setOdds(target.race, target.start, effect.type === "save" ? effect.odds : null);
      }
    },
    [setOdds],
  );
  const press = useCallback((key: KeypadKey) => dispatch({ type: "key", key }), [dispatch]);

  // X-faktorn för hästen som visas. Uppläsningen sker i resultatradens aria-live.
  const [xSay, setXSay] = useState("");
  const cycleX = useCallback(
    (backwards: boolean) => {
      const cur = stRef.current;
      const item = itemsRef.current[cur.index];
      if (!item || cur.confirmDelete) return;
      const locked = xLockReason(item.race, item.start);
      if (locked) {
        setXSay(locked);
        return;
      }
      const next = nextXFactor(xOf(item.start.mark), backwards);
      // Ett tryck under 350 ms-fönstret avbryter hoppet; Nästa krävs.
      dispatch({ type: "hold" });
      setXFactor(item.race, item.start, next);
      setXSay(`X-faktor för ${item.start.horse.name}: ${X_LABEL[next]}`);
    },
    [dispatch, setXFactor],
  );
  // Tryck med musen på desktop: fokus tillbaka till knappsatsen, så att Tab
  // (Hoppa över) och Enter fortsätter att gälla.
  const tap = (key: KeypadKey) => {
    press(key);
    if (window.matchMedia(DESKTOP_QUERY).matches) padRef.current?.focus({ preventScroll: true });
  };

  // Automatiskt hopp 350 ms efter tre siffror. Ett nytt tryck byter token.
  useEffect(() => {
    if (st.advance === null) return;
    const token = st.advance;
    const t = window.setTimeout(() => dispatch({ type: "advance", token }), AUTO_ADVANCE_MS);
    return () => window.clearTimeout(t);
  }, [st.advance, dispatch]);

  // Kön är slut: sammanfattningen.
  const done = isDone(st);
  useEffect(() => {
    if (done) setSheetOpen(true);
  }, [done]);

  useEffect(() => {
    if (st.confirmDelete) confirmRef.current?.focus();
  }, [st.confirmDelete]);

  // Desktop: knappsatsen får fokus, så att tangentbordet fungerar direkt.
  useEffect(() => {
    if (isDesktop) padRef.current?.focus({ preventScroll: true });
  }, [isDesktop]);

  // Tangentbordet: siffror, Backsteg, Enter (Nästa), ← (Föregående) och Tab
  // (Hoppa över, bara när fokus står på knappsatsen). Komma och punkt ignoreras.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (document.querySelector("dialog[open]")) return;
      if (stRef.current.confirmDelete) {
        if (e.key === "Escape") {
          e.preventDefault();
          dispatch({ type: "confirm", yes: false });
        }
        return;
      }
      if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        cycleX(e.shiftKey);
        return;
      }
      const key = keyFromKeyboard(e);
      if (!key) return;
      const onPad = t === padRef.current;
      const onControl = t instanceof HTMLElement && (t.tagName === "BUTTON" || t.tagName === "A");
      if (key === "skip" && !onPad) return;
      // Enter på en knapp eller länk trycker på den som vanligt.
      if (key === "next" && onControl) return;
      e.preventDefault();
      if (key !== "ignore") press(key);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dispatch, press, cycleX]);

  const cur = done ? null : items[st.index];
  const curX = cur ? xOf(cur.start.mark) : "NONE";
  const curRx = cur ? riktX(cur.start, factors) : null;
  const withX = !!cur && curX !== "NONE" && cur.start.riktodds !== null && curRx !== null;
  // Uppläsningen gäller bara hästen den gjordes för.
  const curId = cur?.start.id;
  useEffect(() => {
    setXSay("");
  }, [curId]);
  const saved = cur?.start.mark?.unibetOdds ?? null;
  const typed = st.digits ? digitsToOdds(st.digits) : null;
  const shown = st.digits ? (typed !== null && isValidOdds(typed) ? typed : null) : saved;
  const locked = cur ? (raceStarted(cur.race, now) ? "Loppet har startat. Oddset kan inte ändras." : cur.start.scratched ? "Hästen är struken." : null) : null;
  const pending = queue.length;
  const position = done ? total : st.index + 1;

  return (
    <>
      <AppHeader title="Unibets platsodds" sub={done ? `Alla ${total} genomgångna` : `Häst ${position} av ${total}`} back={{ href: base, label: "Tillbaka till omgången" }} />
      <main className="page odds-page" id="main">
        <div className="prog" role="progressbar" aria-label="Förlopp" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done ? total : st.index} aria-valuetext={done ? `Alla ${total} hästar genomgångna` : `Häst ${position} av ${total}`}>
          <i style={{ width: `${((done ? total : st.index) / total) * 100}%` }} />
        </div>
        <StreckRefresh data={data} />
        {!online && (
          <Banner tone="warn" icon="offline" className="m10">
            Sparas när du är uppkopplad igen.{pending > 0 && <> {pending} {pending === 1 ? "ändring" : "ändringar"} i kö.</>}
          </Banner>
        )}
        {cur ? (
          <div className="kpw" ref={padRef} tabIndex={0} role="group" aria-label={`Oddsinmatning för ${cur.start.number} ${cur.start.horse.name}`}>
            <div className="kcard x">
              <FlapNumber n={cur.start.number} size="lg" />
              <div>
                <div className="km">
                  Avd {cur.race.leg} · {hhmm(cur.race.startAt)}
                </div>
                <h2 className="kn">{cur.start.horse.name}</h2>
                <div className="km">{cur.start.driver?.name ?? "Kusk saknas"}</div>
              </div>
              <XCycleButton
                x={curX}
                horseName={cur.start.horse.name}
                locked={!!xLockReason(cur.race, cur.start, now)}
                onCycle={(e) => {
                  cycleX(false);
                  // Musklick på desktop: fokus tillbaka till knappsatsen. Enter på knappen behåller fokus.
                  if (e.detail > 0 && window.matchMedia(DESKTOP_QUERY).matches) padRef.current?.focus({ preventScroll: true });
                }}
              />
            </div>
            <div className="kcmp">
              <div className="brd">
                <span className="k">{withX ? "Riktodds med X" : "Riktodds"}</span>
                <span className="rv num">
                  {odds(withX ? curRx : cur.start.riktodds)}
                  {cur.start.uncertain && cur.start.riktodds !== null && <sup aria-label="osäkert">*</sup>}
                </span>
                {withX && <span className="rv0 num">utan X {odds(cur.start.riktodds)}</span>}
              </div>
              <div className="brd">
                <span className="k">Unibet plats{!st.digits && saved !== null ? " · sparat" : ""}</span>
                <span className={`kdisp num${!st.digits && saved === null ? " empty" : ""}${!st.digits && saved !== null ? " saved" : ""}`} aria-live="polite">
                  {st.digits ? displayDigits(st.digits) : saved !== null ? odds(saved) : "–,––"}
                </span>
              </div>
            </div>
            <div className="kres" aria-live="polite">
              {xSay && <span className="sr">{xSay}. </span>}
              {st.confirmDelete ? (
                <div className="kconfirm" role="group" aria-labelledby="kc-q">
                  <p id="kc-q">Ta bort oddset för {cur.start.horse.name}?</p>
                  <div className="inline-btns">
                    <button type="button" className="btn secondary sm" onClick={() => dispatch({ type: "confirm", yes: true })}>
                      Ja
                    </button>
                    <button type="button" ref={confirmRef} className="btn ghost sm" onClick={() => dispatch({ type: "confirm", yes: false })}>
                      Avbryt
                    </button>
                  </div>
                </div>
              ) : locked ? (
                <Banner tone="info">{locked}</Banner>
              ) : st.error ? (
                <p className="err-msg">
                  <IconWarn />
                  {st.error}
                </p>
              ) : st.digits && shown === null ? (
                <p className="help">Fortsätt skriva …</p>
              ) : (
                <ResultLine odds={shown} start={cur.start} guideline={guideline} factors={factors} />
              )}
            </div>
            <div className="knav">
              <button type="button" className="btn ghost" disabled={st.index === 0} onClick={() => tap("prev")}>
                ‹ Föregående
              </button>
              <button type="button" className="btn ghost" onClick={() => tap("skip")}>
                Hoppa över
              </button>
            </div>
            <div className="kp" role="group" aria-label="Sifferknappar">
              {(["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map((k) => (
                <button key={k} type="button" aria-disabled={!!locked || undefined} onClick={() => tap(k)}>
                  {k}
                </button>
              ))}
              <button type="button" className="del" aria-label="Radera" aria-disabled={!!locked || undefined} onClick={() => tap("del")}>
                ⌫ Radera
              </button>
              <button type="button" aria-disabled={!!locked || undefined} onClick={() => tap("0")}>
                0
              </button>
              <button type="button" className="go" onClick={() => tap("next")}>
                Nästa ›
              </button>
            </div>
            <p className="help kkeys d-only">Tangentbord: siffror, Backsteg, Enter = Nästa, ← = Föregående, Tab = Hoppa över och X = X-faktor. Komma och punkt behövs inte.</p>
          </div>
        ) : (
          <section className="kend" aria-labelledby="kend-h">
            <h2 id="kend-h">Alla {total} hästar är genomgångna</h2>
            <p className="help">Förslagen på Spelbar gäller redan. Du kan ändra dem i sammanfattningen, i Spelförslag eller i hästkortet.</p>
            <div className="vfoot">
              <button type="button" className="btn secondary" onClick={() => setSheetOpen(true)}>
                Visa sammanfattningen
              </button>
              <Link className="btn secondary" href={`${base}/spel?flik=plats`}>
                Till spelförslag
              </Link>
              <button type="button" className="btn ghost" onClick={() => press("prev")}>
                ‹ Föregående
              </button>
            </div>
          </section>
        )}
      </main>
      <Summary
        open={sheetOpen}
        items={items}
        guideline={guideline}
        factors={factors}
        now={now}
        onClose={() => setSheetOpen(false)}
        onDone={() => {
          setSheetOpen(false);
          router.push(base);
        }}
        onSpelbar={(it, on) => setSpelbar(it.race, it.start, on ? "on" : "off")}
      />
    </>
  );
}

function ResultLine({ odds: value, start, guideline, factors }: { odds: number | null; start: StartDto; guideline: number; factors: XFactorSettings }) {
  const m = start.mark;
  // Med X-faktor jämförs mot riktoddset med X-faktor (6.8).
  const withX = xOf(m) !== "NONE" && start.riktodds !== null;
  const v = keypadVerdict({ odds: value, riktodds: riktX(start, factors), interesting: !!m?.interesting, override: m?.spelbarOverride ?? "NONE", guideline, ref: withX ? "riktoddset med X" : undefined });
  if (v.tone === "help") return <p className="help">{v.text}</p>;
  return (
    <div className="kverd">
      <Banner tone={v.tone === "ok" ? "ok" : v.tone === "warn" ? "warn" : "info"} icon={v.tone === "ok" ? "check" : v.tone === "warn" ? "warn" : "info"}>
        {v.text}
      </Banner>
      {v.below && <span className="tag gl">{guidelineTag(guideline)} (riktlinje)</span>}
    </div>
  );
}

function diffText(d: number | null): string {
  if (d === null) return "–";
  return `${d > 0 ? "+" : d < 0 ? "−" : "±"}${odds(Math.abs(d))}`;
}

// Sammanfattningsarket (ersätter 4C): ingen bekräftelse, förslagen gäller redan.
function Summary({
  open,
  items,
  guideline,
  factors,
  now,
  onClose,
  onDone,
  onSpelbar,
}: {
  open: boolean;
  items: Item[];
  guideline: number;
  factors: XFactorSettings;
  now: number;
  onClose: () => void;
  onDone: () => void;
  onSpelbar: (it: Item, on: boolean) => void;
}) {
  const filled = items.filter((i) => i.start.mark?.unibetOdds != null).length;
  const sorted = [...items].sort((a, b) => a.race.leg - b.race.leg || a.start.number - b.start.number);
  const yes = sorted.filter((i) => i.start.mark?.spelbar);
  const no = sorted.filter((i) => !i.start.mark?.spelbar);
  const row = (it: Item, spelbar: boolean) => {
    const m = it.start.mark;
    const x = xOf(m);
    const rx = riktX(it.start, factors);
    // Skillnaden räknas mot riktoddset med X-faktor (6.8).
    const d = oddsDiff(m?.unibetOdds ?? null, rx);
    const locked = raceStarted(it.race, now) || it.start.scratched;
    return (
      <li key={it.start.id} className="prow">
        <FlapNumber n={it.start.number} size="sm" />
        <div className="pmain">
          <div className="pn">
            {it.start.horse.name}
            <XBadge x={x} />
            {m?.belowGuideline && <span className="tag gl">{guidelineTag(guideline)}</span>}
          </div>
          <div className="pm">
            Avd {it.race.leg} · Unibet <b>{odds(m?.unibetOdds ?? null)}</b> · <RiktShort riktodds={it.start.riktodds} x={x} rx={rx} /> · <span className={`diff ${d !== null && d > 0 ? "up" : "dn"}`}>{diffText(d)}</span>
          </div>
        </div>
        {!locked &&
          (spelbar ? (
            <button type="button" className="btn secondary sm" onClick={() => onSpelbar(it, false)} aria-label={`Ta bort Spelbar för ${it.start.horse.name}`}>
              Ta bort Spelbar
            </button>
          ) : (
            <button type="button" className="btn ghost sm" onClick={() => onSpelbar(it, true)} aria-label={`Gör ${it.start.horse.name} spelbar`}>
              Gör spelbar
            </button>
          ))}
      </li>
    );
  };
  return (
    <Sheet open={open} onClose={onClose} title={`Klart – ${filled} odds ifyllda`} sub="Förslagen gäller redan. Ändra det du inte håller med om.">
      <h3 className="sl tight">Spelbara ({yes.length})</h3>
      {yes.length ? <ul className="plist">{yes.map((i) => row(i, true))}</ul> : <p className="help">Ingen häst är spelbar.</p>}
      <h3 className="sl">Inte spelbara ({no.length})</h3>
      {no.length ? <ul className="plist">{no.map((i) => row(i, false))}</ul> : <p className="help">Alla är spelbara.</p>}
      <div className="vfoot">
        <button type="button" className="btn primary full" onClick={onDone}>
          <IconCheckThin /> Klar
        </button>
      </div>
    </Sheet>
  );
}
