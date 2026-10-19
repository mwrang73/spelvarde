"use client";

// S8 Källor, E1-delen (specen 5, S8): lista, lägg till, byt namn, slå på
// och av, ta bort med Ångra. Hämta tips är avstängd till E5.
// Källor sparas direkt mot API:t (de ingår inte i utkorgen, specen 9.3).

import { useEffect, useId, useRef, useState } from "react";
import { ApiFailure, apiGet, apiRequest } from "@/components/api";
import { useOnline } from "@/components/hooks";
import { AppHeader } from "@/components/shell/AppHeader";
import { Banner, EmptyState, Skeleton } from "@/components/ui/board";
import { IconLink, IconWarn } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import { relTime } from "@/lib/format";
import type { SourceDto, SourceResponse, SourcesResponse } from "@/lib/types";

export function SourcesView() {
  const [sources, setSources] = useState<SourceDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const load = () => {
    setError(null);
    apiGet<SourcesResponse>("/api/sources")
      .then((r) => setSources(r.sources))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Kunde inte hämta källorna."));
  };
  useEffect(load, []);

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
  return (
    <>
      <AppHeader brand title="Källor" sub={sources ? (count ? `Källor · ${count} ${count === 1 ? "länk" : "länkar"}` : "Källor · länkar som läses av Hämta tips") : "Källor"} />
      <main className="page" id="main">
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
          <EmptyState icon={<IconLink />} title="Inga källor än" text="Lägg till länkar till travsajter du litar på. Hämta tips läser dem och lägger fakta på hästarna i omgången." />
        )}
        {sources && (
          <>
            <FetchTips />
            {count > 0 && (
              <>
                <h2 className="sl">Källor</h2>
                <ul className="srclist">
                  {sources.map((s) => (
                    <SourceRow key={s.id} s={s} onChange={replace} onRemove={() => void remove(s)} />
                  ))}
                </ul>
              </>
            )}
            <AddSource onAdded={(s) => setSources((list) => [...(list ?? []), s])} />
          </>
        )}
      </main>
    </>
  );
}

function FetchTips() {
  const id = useId();
  return (
    <div className="tips-box">
      <button type="button" className="btn primary full" disabled aria-describedby={id}>
        Hämta tips
      </button>
      <span className="help" id={id}>
        Läsning av tips kommer i en senare version.
      </span>
    </div>
  );
}

function SourceRow({ s, onChange, onRemove }: { s: SourceDto; onChange: (s: SourceDto) => void; onRemove: () => void }) {
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

  const status = s.lastError ? `Kunde inte läsas: ${s.lastError}` : s.lastReadAt ? `Läst ${relTime(s.lastReadAt, new Date())}${s.lastFactCount !== null ? ` · ${s.lastFactCount} fakta` : ""}` : "Inte läst än";
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
        <span className={`ss${s.lastError ? " bad" : ""}`}>{s.enabled ? status : "Avstängd · läses inte av Hämta tips"}</span>
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
