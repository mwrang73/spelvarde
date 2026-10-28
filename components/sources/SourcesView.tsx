"use client";

// S8 Källor (specen 5 S8 och E5 S8): Hämta tips, källorna (lägg till, byt
// namn, slå på och av, Provläs, ta bort med Ångra) och granskningen.
// - Mobil: /kallor visar Hämta tips, kortet Att granska och källorna.
//   /kallor/granska är en egen vy (TipReview) med tillbaka till Källor.
// - Desktop (≥ 1024 px): båda rutterna visar två kolumner, källorna till
//   vänster och granskningen till höger.
// Källor sparas direkt mot API:t (de ingår inte i utkorgen, specen 9.3).

import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { ApiFailure, apiGet, apiRequest } from "@/components/api";
import { useIsDesktop, useOnline } from "@/components/hooks";
import { getCurrent, loadCurrent, subscribeRounds } from "@/components/round/roundStore";
import { AppHeader } from "@/components/shell/AppHeader";
import { Banner, EmptyState, Skeleton } from "@/components/ui/board";
import { IconLink, IconWarn } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import { dayDate, plural, relTime } from "@/lib/format";
import { countTips, isPending, sourcesSub } from "@/lib/tips-ui";
import type { CurrentRoundResponse, QuotaDto, SourceDto, SourceResponse, SourcesResponse } from "@/lib/types";
import { FetchTips } from "./FetchTips";
import { SourcePreviewSheet } from "./SourcePreviewSheet";
import { TipReview } from "./TipReview";
import { loadTips, useTips } from "./tipsStore";
import { clearTipsBanners, startTipsChain, stopTipsChain, useTipsChain } from "./useTipsChain";

export const roundLabelOf = (c: CurrentRoundResponse | null) => (c?.round ? `${c.round.gameType} ${c.round.trackName} ${dayDate(c.round.date)}` : null);

// Alla lopp har startat (eller omgången är klar): tips kan inte längre hämtas.
export function roundClosed(c: CurrentRoundResponse | null, now: number): boolean {
  if (!c?.round) return false;
  if (c.phase === "KLART") return true;
  return c.legs.length > 0 && c.legs.every((l) => l.started || Date.parse(l.startAt) <= now);
}

export function SourcesView({ review = false }: { review?: boolean }) {
  const [sources, setSources] = useState<SourceDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SourceDto | null>(null);
  const [liveQuota, setLiveQuota] = useState<QuotaDto | null>(null);
  const toast = useToast();
  const isDesktop = useIsDesktop();
  const current = useSyncExternalStore(subscribeRounds, getCurrent, () => null);
  const [currentError, setCurrentError] = useState(false);
  const roundId = current?.round?.id ?? null;
  const tips = useTips(roundId);
  const chain = useTipsChain();

  const load = () => {
    setError(null);
    apiGet<SourcesResponse>("/api/sources")
      .then((r) => setSources(r.sources))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Kunde inte hämta källorna."));
  };
  useEffect(load, []);
  useEffect(() => {
    loadCurrent().catch(() => setCurrentError(true));
    // Lämnas vyn: inga nya anrop i kedjan, och banderollen försvinner.
    return () => {
      stopTipsChain();
      clearTipsBanners();
    };
  }, []);
  useEffect(() => {
    if (roundId) void loadTips(roundId);
  }, [roundId]);
  // Efter körningen: källornas status (Läst, fel) och dygnsgränsen.
  const doneSeq = chain.kind === "done" ? chain.seq : 0;
  useEffect(() => {
    if (!doneSeq) return;
    load();
    setLiveQuota(null);
  }, [doneSeq]);

  const replace = (s: SourceDto) => setSources((list) => (list ? list.map((x) => (x.id === s.id ? s : x)) : list));

  const remove = async (s: SourceDto) => {
    setSources((list) => (list ? list.filter((x) => x.id !== s.id) : list));
    try {
      const res = await apiRequest<SourceResponse>("DELETE", `/api/sources/${s.id}`);
      toast({
        text: `${res.source.name} är borttagen.`,
        action: {
          label: "Ångra",
          onClick: () => {
            apiRequest<SourceResponse>("POST", "/api/sources", { url: res.source.url, name: res.source.name, enabled: res.source.enabled })
              .then((r) => setSources((list) => (list ? [...list, r.source] : [r.source])))
              .catch((e: unknown) => toast({ text: e instanceof Error ? e.message : "Kunde inte ångra." }));
          },
        },
      });
    } catch (e) {
      setSources((list) => (list ? [...list, s].sort((a, b) => a.sortOrder - b.sortOrder) : list));
      toast({ text: e instanceof Error ? e.message : "Kunde inte ta bort källan." });
    }
  };

  const count = sources?.length ?? 0;
  const enabled = sources?.filter((s) => s.enabled) ?? [];
  const roundLabel = roundLabelOf(current);
  const data = tips.data;
  const quota = liveQuota ?? data?.quota ?? null;
  const counts = data ? countTips(data.tips) : null;
  const reading = chain.kind === "running" ? chain.reading : [];
  const sub = !sources ? "Källor" : count ? sourcesSub(enabled.length, roundLabel) : "Källor · länkar som läses av Hämta tips";

  const runChain = (only?: SourceDto[], articleId?: string) => {
    if (!roundId || !roundLabel) return;
    void startTipsChain({ roundId, roundLabel, sources: only ?? enabled, onlyArticleId: articleId, onQuota: setLiveQuota });
  };

  // Mobil /kallor/granska: egen vy.
  if (review && !isDesktop) {
    const pendingTips = data?.tips.filter(isPending) ?? [];
    const names = [...new Set(pendingTips.map((t) => t.sourceName))];
    const rsub = !data ? "Laddar …" : `${names.length > 1 ? `${names.length} källor` : names[0] ?? data.articles[0]?.sourceName ?? "Tips"} · ${pendingTips.length} att granska`;
    return (
      <>
        <AppHeader title="Granska tips" sub={rsub} back={{ href: "/kallor", label: "Tillbaka till Källor" }} />
        <main className="page rv-page" id="main">
          {roundId ? <TipReview roundId={roundId} desktop={false} /> : <ReviewNoRound loading={!current && !currentError} />}
        </main>
      </>
    );
  }

  const left = (
    <>
      {error && (
        <Banner tone="err" className="m10" actions={<button type="button" className="btn secondary sm" onClick={load}>Försök igen</button>}>
          {error}
        </Banner>
      )}
      {!sources && !error && (
        <div className="pad" aria-busy="true" aria-label="Laddar källorna">
          <Skeleton width="60%" height={16} />
          <Skeleton width="80%" />
          <Skeleton width="40%" />
        </div>
      )}
      {sources && count === 0 && (
        <EmptyState icon={<IconLink />} title="Inga källor än" text="Lägg till länkar till travsajter du litar på. Hämta tips läser dem, och du granskar tipsen innan de räknas i källstödet." />
      )}
      {sources && (
        <>
          {count > 0 && (
            <FetchTips
              roundId={roundId}
              roundLabel={roundLabel}
              noRound={!!current && !current.round}
              closed={roundClosed(current, Date.now())}
              enabled={enabled}
              quota={quota}
              secondary={!!counts?.pending}
              onRun={() => runChain()}
              onRetryArticle={(id) => runChain([], id)}
            />
          )}
          {!isDesktop && data && counts && <ReviewCard data={data} counts={counts} />}
          {count > 0 && (
            <>
              <h2 className="sl">Källor</h2>
              <ul className="srclist">
                {sources.map((s) => (
                  <SourceRow
                    key={s.id}
                    s={s}
                    reading={reading.includes(s.id)}
                    canRead={!!roundId && chain.kind !== "running"}
                    hasRound={!!roundId}
                    onRetry={() => runChain([s])}
                    onPreview={() => setPreview(s)}
                    onChange={replace}
                    onRemove={() => void remove(s)}
                  />
                ))}
              </ul>
            </>
          )}
          <AddSource onAdded={(s) => setSources((list) => [...(list ?? []), s])} />
        </>
      )}
      <SourcePreviewSheet source={preview} onClose={() => setPreview(null)} />
    </>
  );

  return (
    <>
      <AppHeader brand title="Källor" sub={sub} />
      <main className="page kpage" id="main">
        {isDesktop ? (
          <div className="kgrid">
            <aside aria-label="Källor och Hämta tips">{left}</aside>
            <section className="kright" aria-labelledby="rv-h">
              {roundId ? <TipReview roundId={roundId} desktop /> : <ReviewNoRound loading={!current && !currentError} desktop />}
            </section>
          </div>
        ) : (
          left
        )}
      </main>
    </>
  );
}

function ReviewNoRound({ loading, desktop }: { loading: boolean; desktop?: boolean }) {
  if (loading)
    return (
      <div className="pad" aria-busy="true" aria-label="Laddar">
        <Skeleton width="50%" height={16} />
        <Skeleton width="80%" />
      </div>
    );
  return (
    <>
      {desktop && (
        <h2 className="dsec" id="rv-h">
          Att granska
        </h2>
      )}
      <p className="help rv-help">Ingen omgång hämtad. Tips läses för en omgång i taget.</p>
    </>
  );
}

// Kortet Att granska (mobil), eller raden med godkända tips.
function ReviewCard({ data, counts }: { data: NonNullable<ReturnType<typeof useTips>["data"]>; counts: ReturnType<typeof countTips> }) {
  if (counts.pending) {
    const pend = data.tips.filter(isPending);
    const arts = [...new Set(pend.map((t) => t.articleId))];
    const from = arts.length === 1 ? `Från "${data.articles.find((a) => a.id === arts[0])?.title ?? pend[0].article.title}"` : `Från ${arts.length} artiklar`;
    return (
      <section className="next" aria-labelledby="rv-card">
        <span className="lbl">Att granska</span>
        <h2 id="rv-card">{counts.pending} tips väntar</h2>
        <p>
          {from}
          {counts.pendingUnsure ? ` · ${counts.pendingUnsure} ${counts.pendingUnsure === 1 ? "osäkert" : "osäkra"}.` : "."}
        </p>
        <Link className="btn primary" href="/kallor/granska">
          Granska {counts.pending} tips
        </Link>
      </section>
    );
  }
  if (counts.approved)
    return (
      <p className="fetchline rv-line">
        {plural(counts.approved, "godkänt tips", "godkända tips")} på {plural(counts.approvedHorses, "häst", "hästar")} ·{" "}
        <Link className="linkish" href="/kallor/granska">
          Visa
        </Link>
      </p>
    );
  return null;
}

function SourceRow({
  s,
  reading,
  canRead,
  hasRound,
  onRetry,
  onPreview,
  onChange,
  onRemove,
}: {
  s: SourceDto;
  reading: boolean;
  canRead: boolean;
  hasRound: boolean;
  onRetry: () => void;
  onPreview: () => void;
  onChange: (s: SourceDto) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const fid = useId();
  const online = useOnline();
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const patch = async (body: { name?: string; enabled?: boolean }) => {
    setBusy(true);
    try {
      const r = await apiRequest<SourceResponse>("PATCH", `/api/sources/${s.id}`, body);
      onChange(r.source);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Kunde inte spara.";
      if (body.name !== undefined) setError(msg);
      else toast({ text: msg });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const bad = s.enabled && !reading && !!s.lastError;
  let status: string;
  if (!s.enabled) status = "Avstängd · läses inte av Hämta tips";
  else if (reading) status = "Läser nu …";
  else if (s.lastError) status = `Kunde inte läsas: ${s.lastError}`;
  else if (!s.lastReadAt) status = "Inte läst än";
  else {
    const when = `Läst ${relTime(s.lastReadAt, new Date())}`;
    if (s.lastArticleCount === 0) status = `${when} · inga tips för omgången ännu`;
    else if (s.lastArticleCount) status = `${when} · ${plural(s.lastArticleCount, "artikel", "artiklar")}${s.lastFactCount !== null ? ` · ${s.lastFactCount} tips` : ""}`;
    else status = when;
  }
  const offTitle = !online ? "Ingen uppkoppling" : !hasRound ? "Hämta omgången först" : undefined;

  return (
    <li className={`srcrow${s.enabled ? "" : " off"}`}>
      <div className="src-main">
        {editing ? (
          <form
            className="field"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              if (!name.trim()) {
                setError("Skriv ett namn.");
                return;
              }
              if (await patch({ name: name.trim() })) setEditing(false);
            }}
          >
            <label className="flbl" htmlFor={fid}>
              Namn på källan
            </label>
            <input id={fid} ref={ref} type="text" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? `${fid}-e` : undefined} />
            {error && (
              <span className="err-msg" id={`${fid}-e`}>
                <IconWarn />
                {error}
              </span>
            )}
            <div className="inline-btns">
              <button type="submit" className="btn secondary sm" disabled={busy || !online}>
                Spara
              </button>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  setName(s.name);
                  setError(null);
                  setEditing(false);
                }}
              >
                Avbryt
              </button>
            </div>
          </form>
        ) : (
          <>
            <span className="sn">{s.name}</span>
            <span className="su">{s.url}</span>
          </>
        )}
        <span className={`ss${bad ? " bad" : ""}`}>{status}</span>
        {bad && (
          <span>
            <button type="button" className="btn secondary sm" onClick={onRetry} disabled={!online || !canRead} title={offTitle} aria-label={`Försök läsa ${s.name} igen`}>
              Försök igen
            </button>
          </span>
        )}
      </div>
      {!editing && (
        <div className="src-acts">
          <button type="button" className="switch" aria-pressed={s.enabled} disabled={busy || !online} onClick={() => void patch({ enabled: !s.enabled })} aria-label={`Läs ${s.name} vid Hämta tips`}>
            <span className="sw-track" aria-hidden="true">
              <span className="sw-dot" />
            </span>
            <span className="sw-txt" aria-hidden="true">
              {s.enabled ? "På" : "Av"}
            </span>
          </button>
          <button type="button" className="btn ghost sm" onClick={onPreview} disabled={!online || !hasRound} title={offTitle} aria-label={`Provläs ${s.name}`}>
            Provläs
          </button>
          <button type="button" className="btn ghost sm" onClick={() => setEditing(true)} aria-label={`Byt namn på ${s.name}`}>
            Byt namn
          </button>
          <button type="button" className="btn ghost sm" onClick={onRemove} disabled={!online} aria-label={`Ta bort ${s.name}`}>
            Ta bort
          </button>
        </div>
      )}
    </li>
  );
}

function AddSource({ onAdded }: { onAdded: (s: SourceDto) => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  const fid = useId();
  return (
    <form
      className="field add-src"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const v = url.trim();
        if (!/^https:\/\/[^\s/]+\.[^\s]+/i.test(v)) {
          setError("Det här ser inte ut som en webbadress. Den ska börja med https://.");
          return;
        }
        setBusy(true);
        try {
          const r = await apiRequest<SourceResponse>("POST", "/api/sources", { url: v });
          onAdded(r.source);
          setUrl("");
        } catch (err) {
          setError(err instanceof ApiFailure && err.status === 409 ? "Källan finns redan." : err instanceof Error ? err.message : "Kunde inte lägga till källan.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="flbl" htmlFor={fid}>
        Lägg till källa
      </label>
      <div className="inline">
        <input
          id={fid}
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="Klistra in en länk, t.ex. https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fid}-e` : undefined}
        />
        <button type="submit" className="btn secondary" disabled={busy || !online}>
          {busy ? "Lägger till …" : "Lägg till"}
        </button>
      </div>
      {error && (
        <span className="err-msg" id={`${fid}-e`} role="alert">
          <IconWarn />
          {error}
        </span>
      )}
    </form>
  );
}
