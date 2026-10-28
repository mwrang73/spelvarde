"use client";

// Granska tips (E5 S8, mockupskärm 3 och desktopskärmen). Mobil: kort per
// tips med citatet bredvid tolkningen och fältet "Godkänn n tips" längst
// ned. Desktop: en tabell per artikel med rörligt fokus och tangenterna G
// (godkänn), R (rätta), Delete (ta bort) och Ctrl/Cmd + Z (ångra).
//
// Ett tips som godkänns eller rättas ligger kvar på sin plats med "Godkänd"
// och Ångra tills vyn lämnas. Ett borttaget tips försvinner.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOnline } from "@/components/hooks";
import { loadRound } from "@/components/round/roundStore";
import { useRoundData } from "@/components/round/RoundProvider";
import { RoleTag, Quote } from "@/components/tips/RoleTag";
import { EmptyState, FlapNumber, Skeleton, Banner } from "@/components/ui/board";
import { IconDoc, IconExt, IconOkCircle, IconTriangle, IconFlag } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import { relTime } from "@/lib/format";
import { dayAbs, dayTimeAbs, isCurrentApproved, isSure, roleLabel, stageLabel, tipHorse, tipOrder, unsureLine } from "@/lib/tips-ui";
import type { TipArticleDto, TipDto } from "@/lib/types";
import { errText, TipEditSheet } from "./TipEditSheet";
import { loadTips, tipActions, useTips } from "./tipsStore";

type Act = { ids: string[] };

// I granskningsgruppen: väntar (också låsta, som visas med låstexten) eller
// åtgärdat i den här vyn.
const inGroup = (t: TipDto, stay: Set<string>) => (t.review === "PENDING" && !t.superseded) || (stay.has(t.id) && t.review === "APPROVED" && !t.superseded);
const articleTime = (a: TipArticleDto) => Date.parse(a.publishedAt ?? a.firstSeenAt);

export function TipReview({ roundId, desktop }: { roundId: string; desktop: boolean }) {
  const entry = useTips(roundId);
  const round = useRoundData(roundId);
  const online = useOnline();
  const toast = useToast();
  const [stay, setStay] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<TipDto | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const [hit, setHit] = useState<string | null>(null);
  const [approvedOpen, setApprovedOpen] = useState(false);
  const undoStack = useRef<Act[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!entry.data && !entry.loading) void loadTips(roundId);
  }, [roundId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Rätta behöver omgångens hästar.
  useEffect(() => {
    if (!round) void loadRound(roundId).catch(() => {});
  }, [roundId, round]);

  const data = entry.data;
  const tips = useMemo(() => data?.tips ?? [], [data]);
  const groups = useMemo(() => {
    if (!data) return [];
    return [...data.articles]
      .sort((a, b) => articleTime(b) - articleTime(a))
      .map((a) => ({ article: a, tips: tips.filter((t) => t.articleId === a.id && inGroup(t, stay)).sort(tipOrder) }))
      .filter((g) => g.tips.length > 0);
  }, [data, tips, stay]);
  const earlier = useMemo(() => {
    if (!data) return [];
    const inGroups = new Set(groups.map((g) => g.article.id));
    return [...data.articles].filter((a) => !inGroups.has(a.id)).sort((a, b) => articleTime(b) - articleTime(a));
  }, [data, groups]);
  const approved = useMemo(() => tips.filter((t) => isCurrentApproved(t) && !stay.has(t.id)).sort(tipOrder), [tips, stay]);
  const pending = useMemo(() => tips.filter((t) => t.review === "PENDING" && !t.superseded && !t.locked), [tips]);
  const sureIds = (list: TipDto[]) => list.filter((t) => t.review === "PENDING" && !t.superseded && !t.locked && isSure(t)).map((t) => t.id);

  // /kallor/granska?start=<id>: skrolla till och markera tipsen för starten.
  const startParam = useRef<string | null>(null);
  useEffect(() => {
    const m = /[?&]start=([\w-]+)/.exec(window.location.search);
    startParam.current = m ? m[1] : null;
  }, []);
  const didHit = useRef(false);
  useEffect(() => {
    const id = startParam.current;
    if (!data || !id || didHit.current) return;
    didHit.current = true;
    if (tips.some((t) => t.startId === id && isCurrentApproved(t)) && !tips.some((t) => t.startId === id && t.review === "PENDING")) setApprovedOpen(true);
    setHit(id);
    window.setTimeout(() => {
      const el = rootRef.current?.querySelector<HTMLElement>(`[data-start="${id}"]`);
      if (el) {
        el.scrollIntoView({ block: "center" });
        el.focus({ preventScroll: true });
      }
    }, 80);
  }, [data, tips]);

  const say = (text: string) => {
    setLive("");
    window.setTimeout(() => setLive(text), 30);
  };
  const focusLater = (fn: () => HTMLElement | null | undefined) => window.setTimeout(() => fn()?.focus(), 40);
  const keep = (ids: string[]) => setStay((s) => new Set([...s, ...ids]));

  // Nästa väntande rad eller kort efter id (för fokus efter G och Delete).
  const nextPendingEl = (afterId: string): HTMLElement | null => {
    const all = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-tip][data-pending='1']") ?? [])];
    const idx = all.findIndex((el) => el.dataset.tip === afterId);
    return all.slice(idx + 1).find((el) => el.dataset.tip !== afterId) ?? all.slice(0, Math.max(0, idx)).reverse()[0] ?? null;
  };

  const approve = useCallback(
    async (t: TipDto, from: "button" | "key") => {
      keep([t.id]);
      const next = from === "key" ? nextPendingEl(t.id) : null;
      try {
        const res = t.startId ? await tipActions.approve(roundId, t) : t.suggestion ? await tipActions.edit(roundId, t, { startId: t.suggestion.startId }) : null;
        if (!res) return;
        undoStack.current.push({ ids: [t.id] });
        if (res.message) toast({ text: res.message });
        if (from === "key") {
          if (next) {
            setSel(next.dataset.tip ?? null);
            focusLater(() => next);
          }
        } else focusLater(() => document.getElementById(`undo-${t.id}`));
      } catch (e) {
        toast({ text: errText(e, "Kunde inte godkänna tipset.") });
      }
    },
    [roundId, toast], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const remove = useCallback(
    async (t: TipDto) => {
      const next = nextPendingEl(t.id) ?? rootRef.current?.querySelector<HTMLElement>(`[data-tip]:not([data-tip="${t.id}"])`) ?? null;
      try {
        await tipActions.remove(roundId, t);
        undoStack.current.push({ ids: [t.id] });
        toast({ text: `Tipset om ${tipHorse(t)} är borttaget.`, action: { label: "Ångra", onClick: () => void undo([t.id]) } });
        if (next) {
          setSel(next.dataset.tip ?? null);
          focusLater(() => next);
        } else focusLater(() => headRef.current);
      } catch (e) {
        toast({ text: errText(e, "Kunde inte ta bort tipset.") });
      }
    },
    [roundId, toast], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const undo = useCallback(
    async (ids: string[]) => {
      try {
        await tipActions.undo(roundId, ids);
        undoStack.current = undoStack.current.filter((a) => !a.ids.every((id) => ids.includes(id)));
        say(ids.length === 1 ? "Ångrat." : `${ids.length} tips ångrade.`);
      } catch (e) {
        toast({ text: errText(e, "Kunde inte ångra.") });
      }
    },
    [roundId, toast],
  );

  const approveAll = async (ids: string[], articleId: string | null) => {
    if (!ids.length) return;
    keep(ids);
    try {
      const res = await tipActions.approveSure(roundId, ids, articleId);
      const done = res.tips.map((t) => t.id);
      keep(done);
      undoStack.current.push({ ids: done });
      toast({ text: `${done.length} tips godkända.`, action: { label: "Ångra", onClick: () => void undo(done) } });
    } catch (e) {
      toast({ text: errText(e, "Kunde inte godkänna tipsen.") });
    }
  };

  // Ctrl/Cmd + Z ångrar senaste åtgärden i vyn (desktop, inte i fält, ark eller dialog).
  useEffect(() => {
    if (!desktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true'], dialog")) return;
      if (document.querySelector("dialog[open]")) return;
      const last = undoStack.current[undoStack.current.length - 1];
      if (!last) {
        say("Det finns inget att ångra.");
        return;
      }
      e.preventDefault();
      void undo(last.ids);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [desktop, undo]);

  const rowsKey = (e: React.KeyboardEvent<HTMLTableRowElement>, t: TipDto) => {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select")) return;
    const rows = [...(rootRef.current?.querySelectorAll<HTMLElement>("tr[data-tip]") ?? [])];
    const i = rows.findIndex((r) => r.dataset.tip === t.id);
    const move = (to: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (!r) return;
      setSel(r.dataset.tip ?? null);
      r.focus();
    };
    const k = e.key;
    if (k === "ArrowDown") move(i + 1);
    else if (k === "ArrowUp") move(i - 1);
    else if (k === "Home" && target === e.currentTarget) move(0);
    else if (k === "End" && target === e.currentTarget) move(rows.length - 1);
    else if ((k === "g" || k === "G" || k === "r" || k === "R" || k === "Delete" || k === "Backspace") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (t.locked) {
        say("Loppet har startat");
      } else if (!online) {
        say("Ingen uppkoppling");
      } else if (k === "g" || k === "G") {
        if (t.review === "PENDING") {
          if (t.startId || t.suggestion) void approve(t, "key");
          else setEditing(t);
        }
      } else if (k === "r" || k === "R") setEditing(t);
      else void remove(t);
    } else return;
    e.preventDefault();
  };

  if (!data) {
    if (entry.error)
      return (
        <Banner tone="err" className="m10" actions={<button type="button" className="btn secondary sm" onClick={() => void loadTips(roundId)}>Försök igen</button>}>
          {entry.error}
        </Banner>
      );
    return (
      <div className="pad" aria-busy="true" aria-label="Laddar tipsen">
        <Skeleton width="40%" height={16} />
        <Skeleton width="85%" />
        <Skeleton width="70%" />
        <Skeleton width="80%" />
      </div>
    );
  }

  const groupTotal = groups.reduce((s, g) => s + g.tips.filter((t) => !t.locked).length, 0);
  const allSure = sureIds(pending);
  const unsure = pending.filter((t) => !isSure(t));
  const firstRow = groups[0]?.tips[0]?.id ?? null;
  const selId = sel && groups.some((g) => g.tips.some((t) => t.id === sel)) ? sel : firstRow;

  const cardProps = { stay, online, hit, onApprove: (t: TipDto) => void approve(t, "button"), onEdit: setEditing, onRemove: (t: TipDto) => void remove(t), onUndo: (t: TipDto) => void undo([t.id]) };

  return (
    <div className={`rv${desktop ? " rv-d" : ""}${!desktop && allSure.length ? " has-bar" : ""}`} ref={rootRef}>
      {desktop && (
        <h2 className="dsec" id="rv-h" ref={headRef} tabIndex={-1}>
          Att granska {groupTotal > 0 && <small>{pending.length} av {groupTotal} kvar</small>}
        </h2>
      )}
      {!desktop && <h2 className="sr" ref={headRef} tabIndex={-1}>Tips att granska</h2>}
      {groups.length > 0 && <p className="help rv-help">Kontrollera att varje tips har hamnat på rätt häst och har rätt roll. Först när du har godkänt ett tips syns det i hästkortet och räknas i källstödet.</p>}

      {groups.map((g) => {
        const ids = sureIds(g.tips);
        const unsureHere = g.tips.filter((t) => t.review === "PENDING" && !t.locked && !isSure(t));
        return (
          <section key={g.article.id} className="rv-g" aria-label={g.article.title}>
            <ArticleCard a={g.article} flat={desktop} count={g.tips.length} />
            {desktop ? (
              <>
                <table className="tbl rvt">
                  <caption className="sr">Tips att granska, {g.article.title}</caption>
                  <colgroup>
                    <col style={{ width: 52 }} />
                    <col style={{ width: 48 }} />
                    <col style={{ width: 180 }} />
                    <col style={{ width: 104 }} />
                    <col />
                    <col style={{ width: 184 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">Avd</th>
                      <th scope="col">Nr</th>
                      <th scope="col">Häst</th>
                      <th scope="col">Roll</th>
                      <th scope="col">Citat</th>
                      <th scope="col">Åtgärd</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.tips.map((t) => (
                      <TipRow key={t.id} t={t} selected={t.id === selId} onFocusRow={() => setSel(t.id)} onKeyDown={(e) => rowsKey(e, t)} {...cardProps} />
                    ))}
                  </tbody>
                </table>
                {ids.length > 0 && (
                  <div className="rv-foot">
                    <p className="help">
                      {unsureLine(unsureHere) ? `${unsureLine(unsureHere)!.replace(/\.$/, "")}. ` : ""}Tangenter: G godkänn · R rätta · Delete ta bort
                    </p>
                    <button type="button" className="btn primary" disabled={!online} title={!online ? "Ingen uppkoppling" : undefined} onClick={() => void approveAll(ids, g.article.id)}>
                      Godkänn {ids.length} tips
                    </button>
                  </div>
                )}
                {!ids.length && <p className="help rv-keys">Tangenter: G godkänn · R rätta · Delete ta bort · Ctrl + Z ångra</p>}
              </>
            ) : (
              <ul className="tipl" aria-label={`Tips från ${g.article.title}`}>
                {g.tips.map((t) => (
                  <TipCard key={t.id} t={t} {...cardProps} />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {!groups.length &&
        (desktop ? (
          <p className="help rv-help">Inget att granska. Tryck Hämta tips när Travstugan har publicerat nya tips.</p>
        ) : (
          <EmptyState icon={<IconFlag />} title="Inget att granska" text="Tryck Hämta tips i Källor när Travstugan har publicerat nya tips.">
            <Link className="btn secondary" href="/kallor">
              Till Källor
            </Link>
          </EmptyState>
        ))}

      {approved.length > 0 && (
        <details className="rv-more" open={approvedOpen} onToggle={(e) => setApprovedOpen((e.target as HTMLDetailsElement).open)}>
          <summary>Godkända ({approved.length})</summary>
          <ul className="tipl">
            {approved.map((t) => (
              <TipCard key={t.id} t={t} {...cardProps} />
            ))}
          </ul>
        </details>
      )}

      {earlier.length > 0 && (
        <details className="rv-more">
          <summary>Tidigare artiklar ({earlier.length})</summary>
          {earlier.map((a) => {
            const old = tips.filter((t) => t.articleId === a.id && t.superseded).sort(tipOrder);
            return (
              <div key={a.id} className="rv-old">
                <ArticleCard a={a} flat count={a.tipCount ?? 0} />
                {old.length > 0 && (
                  <ul className="tipl">
                    {old.map((t) => (
                      <li key={t.id} className="tipc old">
                        <div className="th">
                          <span className="av">Avd {t.startLeg ?? t.leg ?? "–"}</span>
                          {t.startNumber !== null && <FlapNumber n={t.startNumber} size="sm" />}
                          <span className="pn">{tipHorse(t)}</span>
                          <RoleTag role={t.role} struck />
                        </div>
                        <p className="hist">
                          <span aria-hidden="true">Ersatt av {roleLabel(t.superseded!.role)} ({dayAbs(t.superseded!.at)})</span>
                          <span className="sr">
                            {roleLabel(t.role)} ersattes av {roleLabel(t.superseded!.role)} från {dayAbs(t.superseded!.at)}
                          </span>
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </details>
      )}

      {!desktop && allSure.length > 0 && (
        <div className="revbar">
          <button type="button" className="btn primary full" disabled={!online} title={!online ? "Ingen uppkoppling" : undefined} onClick={() => void approveAll(allSure, null)}>
            Godkänn {allSure.length} tips
          </button>
          {unsureLine(unsure) && <p className="help">{unsureLine(unsure)}</p>}
        </div>
      )}

      <p className="sr" aria-live="polite">
        {live}
      </p>

      <TipEditSheet
        roundId={roundId}
        tip={editing}
        races={round?.races ?? null}
        onClose={() => setEditing(null)}
        onSaved={(t) => {
          keep([t.id]);
          undoStack.current.push({ ids: [t.id] });
          focusLater(() => document.getElementById(`undo-${t.id}`) ?? rootRef.current?.querySelector<HTMLElement>(`[data-tip="${t.id}"]`));
        }}
        onRemoved={(t) => {
          undoStack.current.push({ ids: [t.id] });
          focusLater(() => nextPendingEl(t.id) ?? headRef.current);
        }}
      />
    </div>
  );
}

function ArticleCard({ a, flat, count }: { a: TipArticleDto; flat?: boolean; count: number }) {
  const now = new Date();
  return (
    <div className={`art${flat ? " flat" : ""}`}>
      <span className="ak">
        <IconDoc />
        {a.sourceName} · {stageLabel(a.stage)}
      </span>
      <h2>{a.title}</h2>
      <p>
        {a.publishedAt ? `Publicerad ${dayTimeAbs(a.publishedAt)}` : "Publiceringstid saknas"}
        {a.interpretedAt && ` · läst ${relTime(a.interpretedAt, now)}`} · {count} tips
      </p>
      <a href={a.url} target="_blank" rel="noopener noreferrer" aria-label={`Öppna artikeln ${a.title} (öppnas i ny flik)`}>
        Öppna artikeln <IconExt />
      </a>
    </div>
  );
}

type CardProps = {
  t: TipDto;
  stay: Set<string>;
  online: boolean;
  hit: string | null;
  onApprove: (t: TipDto) => void;
  onEdit: (t: TipDto) => void;
  onRemove: (t: TipDto) => void;
  onUndo: (t: TipDto) => void;
};

function Actions({ t, stay, online, onApprove, onEdit, onRemove, onUndo }: Omit<CardProps, "hit">) {
  const name = tipHorse(t);
  const off = !online;
  const title = off ? "Ingen uppkoppling" : undefined;
  if (t.locked) return null;
  if (stay.has(t.id) && t.review === "APPROVED")
    return (
      <>
        <span className="okl">
          <IconOkCircle />
          Godkänd
        </span>
        {t.canUndo && (
          <button type="button" id={`undo-${t.id}`} className="btn ghost sm" disabled={off} title={title} onClick={() => onUndo(t)} aria-label={`Ångra godkännandet av ${name}`}>
            Ångra
          </button>
        )}
      </>
    );
  const edit = (
    <button type="button" className="btn secondary sm" disabled={off} title={title} onClick={() => onEdit(t)} aria-label={`Rätta tipset om ${name}`}>
      Rätta
    </button>
  );
  const del = (
    <button type="button" className="btn ghost sm" disabled={off} title={title} onClick={() => onRemove(t)} aria-label={`Ta bort tipset om ${name}`}>
      Ta bort
    </button>
  );
  if (t.review === "APPROVED")
    return (
      <>
        {edit}
        {del}
      </>
    );
  if (!t.startId)
    return (
      <>
        {t.suggestion ? (
          <>
            <button type="button" className="btn secondary sm" disabled={off} title={title} onClick={() => onApprove(t)}>
              Välj {t.suggestion.number} {t.suggestion.name}
            </button>
            <button type="button" className="btn secondary sm" disabled={off} title={title} onClick={() => onEdit(t)} aria-label={`Välj annan häst för tipset om ${name}`}>
              Välj annan
            </button>
          </>
        ) : (
          <button type="button" className="btn secondary sm" disabled={off} title={title} onClick={() => onEdit(t)} aria-label={`Välj häst för tipset om ${name}`}>
            Välj häst
          </button>
        )}
        {del}
      </>
    );
  return (
    <>
      {!isSure(t) && (
        <button type="button" className="btn secondary sm" disabled={off} title={title} onClick={() => onApprove(t)} aria-label={`Godkänn tipset om ${name}`}>
          Godkänn
        </button>
      )}
      {edit}
      {del}
    </>
  );
}

function Replaces({ t }: { t: TipDto }) {
  if (!t.replaces || t.review !== "PENDING") return null;
  const r = t.replaces;
  return (
    <p className="hist">
      <span aria-hidden="true">
        Ersätter {stageLabel(r.stage)}: <s>{roleLabel(r.role)}</s> ({dayAbs(r.at)})
      </span>
      <span className="sr">
        Ersätter {roleLabel(r.role)} från {dayAbs(r.at)}
      </span>
    </p>
  );
}

function lockText(t: TipDto) {
  return t.review === "PENDING" ? "Loppet har startat. Tipset granskades inte och räknas inte." : "Loppet har startat. Tipset kan inte ändras, och källstödet är fryst.";
}

function TipCard(p: CardProps) {
  const { t, hit } = p;
  const unlinked = !t.startId;
  const flagged = !!t.flagText && t.review === "PENDING";
  return (
    <li
      className={`tipc${flagged ? (unlinked ? " err" : " flag") : ""}${hit && t.startId === hit ? " hit" : ""}`}
      data-tip={t.id}
      data-start={t.startId ?? undefined}
      data-pending={t.review === "PENDING" && !t.locked ? "1" : undefined}
      tabIndex={-1}
    >
      <div className="th">
        <span className="av">Avd {t.startLeg ?? t.leg ?? "–"}</span>
        {t.startNumber !== null && <FlapNumber n={t.startNumber} size="sm" />}
        <span className="pn">
          {unlinked ? `“${t.rawHorseName}”` : t.horseName}
          {t.startNumber !== null && <span className="sr">, nr {t.startNumber}</span>}
        </span>
        <RoleTag role={t.role} />
      </div>
      {flagged && (
        <p className="flg">
          <IconTriangle />
          {t.flagText}
        </p>
      )}
      <Replaces t={t} />
      <Quote quote={t.quote} word={t.roleWord} />
      {t.locked ? (
        <p className="help">{lockText(t)}</p>
      ) : (
        <div className="ta">
          <Actions {...p} />
        </div>
      )}
    </li>
  );
}

function TipRow(p: CardProps & { selected: boolean; onFocusRow: () => void; onKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>) => void }) {
  const { t, hit, selected } = p;
  const unlinked = !t.startId;
  const flagged = !!t.flagText && t.review === "PENDING";
  return (
    <tr
      className={`${flagged ? (unlinked ? "rerr " : "rflag ") : ""}${hit && t.startId === hit ? "hit " : ""}${selected ? "rsel" : ""}`}
      data-tip={t.id}
      data-start={t.startId ?? undefined}
      data-pending={t.review === "PENDING" && !t.locked ? "1" : undefined}
      tabIndex={selected ? 0 : -1}
      aria-selected={selected}
      onFocus={(e) => {
        if (e.target === e.currentTarget) p.onFocusRow();
      }}
      onKeyDown={p.onKeyDown}
    >
      <td className="num">{t.startLeg ?? t.leg ?? "–"}</td>
      <td>{t.startNumber !== null && <FlapNumber n={t.startNumber} size="sm" />}</td>
      <td>
        <span className="hn">
          {unlinked ? `“${t.rawHorseName}”` : t.horseName}
          {t.startNumber !== null && <span className="sr">, nr {t.startNumber}</span>}
        </span>
        {flagged && t.flagShort && <span className="fshort">{t.flagShort}</span>}
        {flagged && <span className="sr">. {t.flagText}</span>}
        <ReplacesShort t={t} />
      </td>
      <td>
        <RoleTag role={t.role} />
      </td>
      <td>
        <Quote quote={t.quote} word={t.roleWord} plain />
      </td>
      <td>
        {t.locked ? (
          <span className="help">{t.review === "PENDING" ? "Startat · räknas inte" : "Startat · låst"}</span>
        ) : (
          <span className="rv-acts">
            <Actions {...p} />
          </span>
        )}
      </td>
    </tr>
  );
}

function ReplacesShort({ t }: { t: TipDto }) {
  if (!t.replaces || t.review !== "PENDING") return null;
  return (
    <span className="hist">
      <span aria-hidden="true">
        Ersätter <s>{roleLabel(t.replaces.role)}</s>
      </span>
      <span className="sr">. Ersätter {roleLabel(t.replaces.role)} från {dayAbs(t.replaces.at)}</span>
    </span>
  );
}
