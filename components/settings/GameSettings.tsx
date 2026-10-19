"use client";

// S10, E2-delen: riktlinjen för Unibet-odds och radpriset (alla), och
// riktoddsmodellen med vikter, versioner och "Räkna om omgången" (bara ADMIN).

import { useEffect, useId, useState } from "react";
import { apiGet, apiRequest } from "@/components/api";
import { clearDetails, getCurrentId, loadRound, patchRound } from "@/components/round/roundStore";
import { Banner } from "@/components/ui/board";
import { IconCheckThin, IconWarn } from "@/components/ui/icons";
import { GUIDELINE_ERROR, parseGuideline, parseRowPrice, ROW_PRICE_ERROR } from "@/lib/coupon-ui";
import { odds, relTime } from "@/lib/format";
import { INPUT_KEYS, type InputKey } from "@/lib/riktodds";
import type { CurrentRoundResponse, ModelDto, ModelResponse, RiktoddsStepResponse, SettingsDto } from "@/lib/types";

// ---- Riktlinje och radpris ------------------------------------------------------------------

function refreshCurrentRound(s: SettingsDto) {
  const id = getCurrentId();
  if (!id) return;
  patchRound(id, (r) => ({ ...r, settings: { spelbarGuideline: s.spelbarGuideline, rowPrice: s.rowPrice } }));
  // Taggen "Under 2,00" räknas på servern: hämta omgången i bakgrunden.
  loadRound(id).catch(() => {});
}

function NumberSetting({
  label,
  help,
  value,
  unit,
  parse,
  error,
  onSave,
}: {
  label: string;
  help: string;
  value: number | null;
  unit?: string;
  parse: (t: string) => number | null;
  error: string;
  onSave: (v: number) => Promise<void>;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  useEffect(() => {
    if (value !== null) setText(odds(value));
  }, [value]);
  const commit = async () => {
    const v = parse(text);
    if (v === null) return setErr(error);
    setErr(null);
    setText(odds(v));
    if (v === value) return;
    setState("saving");
    try {
      await onSave(v);
      setState("saved");
    } catch (e) {
      setState("idle");
      setErr(e instanceof Error ? e.message : "Kunde inte spara.");
    }
  };
  return (
    <div className="field set-num">
      <label className="flbl" htmlFor={id}>
        {label}
      </label>
      <div className="inline-field">
        <input
          id={id}
          className="oin"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          disabled={value === null}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? `${id}-e` : `${id}-h`}
          onChange={(e) => {
            setText(e.target.value);
            setState("idle");
            if (err) setErr(null);
          }}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            }
          }}
        />
        {unit && <span className="unit">{unit}</span>}
        <span className="help" role="status">
          {state === "saving" ? "Sparas …" : state === "saved" ? "Sparat" : ""}
        </span>
      </div>
      {err ? (
        <span className="err-msg" id={`${id}-e`}>
          <IconWarn />
          {err}
        </span>
      ) : (
        <span className="help" id={`${id}-h`}>
          {help}
        </span>
      )}
    </div>
  );
}

export function GameSettings({ settings, onChange }: { settings: SettingsDto | null; onChange: (s: SettingsDto) => void }) {
  const save = async (body: Partial<SettingsDto>) => {
    const s = await apiRequest<SettingsDto>("PUT", "/api/settings", body);
    onChange(s);
    refreshCurrentRound(s);
  };
  return (
    <section className="set-sec" aria-labelledby="h-spel">
      <h2 id="h-spel" className="sl">
        Odds och V85-rad
      </h2>
      <NumberSetting
        label="Riktlinje för Unibet-odds"
        help={`Odds under riktlinjen får taggen "Under ${odds(settings?.spelbarGuideline ?? 2)}". Ingenting blockeras, och förslaget på Spelbar påverkas inte.`}
        value={settings?.spelbarGuideline ?? null}
        parse={parseGuideline}
        error={GUIDELINE_ERROR}
        onSave={(v) => save({ spelbarGuideline: v })}
      />
      <NumberSetting label="Radpris V85" help="Används för kostnaden i V85-raden." value={settings?.rowPrice ?? null} unit="kr" parse={parseRowPrice} error={ROW_PRICE_ERROR} onSave={(v) => save({ rowPrice: v })} />
    </section>
  );
}

// ---- Riktoddsmodellen (ADMIN) ------------------------------------------------------------

const WEIGHT_LABELS: Record<InputKey, string> = {
  plats: "Platsandel i år och i fjol",
  vinst: "Vinstandel i år och i fjol",
  form: "Form, 5 senaste",
  spar: "Spår på distansen",
  kusk: "Kuskens vinstandel",
  tranare: "Tränarens vinstandel",
  galopp: "Galopp, 5 senaste",
  streck: "Streck (marknaden)",
};

type ParamKey = "beta" | "marginal";
const PARAM_LABELS: Record<ParamKey, { label: string; help: string; min: number; max: number }> = {
  beta: { label: "β (skala på styrkan)", help: "0,01–10", min: 0.01, max: 10 },
  marginal: { label: "Marginal", help: "0–1, läggs på riktoddset", min: 0, max: 1 },
};

const numText = (x: number) => String(x).replace(".", ",").replace("-", "−");
function parseNum(t: string): number | null {
  const s = t.trim().replace(/\s/g, "").replace(",", ".").replace("−", "-");
  if (!/^-?\d{1,3}(\.\d{1,4})?$/.test(s)) return null;
  return Number(s);
}

async function currentRoundId(): Promise<string | null> {
  const cached = getCurrentId();
  if (cached) return cached;
  try {
    return (await apiGet<CurrentRoundResponse>("/api/rounds/current")).round?.id ?? null;
  } catch {
    return null;
  }
}

export function ModelAdmin() {
  const [model, setModel] = useState<ModelResponse | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [weights, setWeights] = useState<Record<InputKey, string>>({} as Record<InputKey, string>);
  const [params, setParams] = useState<Record<ParamKey, string>>({ beta: "", marginal: "" });
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "recompute" | null>(null);
  const [result, setResult] = useState<{ tone: "ok" | "err" | "info"; text: string } | null>(null);
  const id = useId();
  const now = new Date();

  const fill = (active: ModelDto | null) => {
    if (!active) return;
    setWeights(Object.fromEntries(INPUT_KEYS.map((k) => [k, numText(active.weights[k])])) as Record<InputKey, string>);
    setParams({ beta: numText(active.params.beta), marginal: numText(active.params.marginal) });
  };

  useEffect(() => {
    apiGet<ModelResponse>("/api/admin/model")
      .then((m) => {
        setModel(m);
        fill(m.active);
      })
      .catch((e: unknown) => setLoadErr(e instanceof Error ? e.message : "Kunde inte hämta modellen."));
  }, []);

  const recomputed = (r: RiktoddsStepResponse | null | undefined) =>
    r ? `Omgången räknades om med ${r.modelKey}: ${r.computed} starter${r.skippedLegs.length ? `, avd ${r.skippedLegs.join(", ")} utan riktodds (färre än 4 startande)` : ""}.` : "Ingen omgång att räkna om.";

  const afterRecompute = async (roundId: string | null) => {
    clearDetails();
    if (roundId) await loadRound(roundId).catch(() => {});
  };

  const save = async () => {
    setResult(null);
    const w: Partial<Record<InputKey, number>> = {};
    for (const k of INPUT_KEYS) {
      const v = parseNum(weights[k] ?? "");
      if (v === null || Math.abs(v) > 10) return setFieldErr(`Vikten för ${WEIGHT_LABELS[k].toLowerCase()} ska vara ett tal mellan −10 och 10.`);
      w[k] = v;
    }
    const p: Partial<Record<ParamKey, number>> = {};
    for (const k of ["beta", "marginal"] as const) {
      const v = parseNum(params[k]);
      const lim = PARAM_LABELS[k];
      if (v === null || v < lim.min || v > lim.max) return setFieldErr(`${lim.label} ska ligga mellan ${numText(lim.min)} och ${numText(lim.max)}.`);
      p[k] = v;
    }
    setFieldErr(null);
    setBusy("save");
    const roundId = await currentRoundId();
    try {
      const before = model?.active?.key;
      const res = await apiRequest<ModelResponse>("PUT", "/api/admin/model", { weights: w, params: p, ...(roundId ? { roundId } : {}) });
      setModel(res);
      fill(res.active);
      const key = res.active?.key ?? "";
      setResult({ tone: "ok", text: `${key === before ? `Vikterna är oförändrade, ${key} är fortfarande aktiv.` : `Version ${key} är sparad och aktiv.`} ${recomputed(res.recomputed)}` });
      await afterRecompute(roundId);
    } catch (e) {
      setResult({ tone: "err", text: e instanceof Error ? e.message : "Kunde inte spara modellen." });
    } finally {
      setBusy(null);
    }
  };

  const recompute = async () => {
    setResult(null);
    setBusy("recompute");
    const roundId = await currentRoundId();
    if (!roundId) {
      setBusy(null);
      return setResult({ tone: "info", text: "Ingen omgång är hämtad än." });
    }
    try {
      const r = await apiRequest<RiktoddsStepResponse>("POST", `/api/rounds/${roundId}/riktodds`);
      setResult({ tone: "ok", text: recomputed(r) });
      await afterRecompute(roundId);
    } catch (e) {
      setResult({ tone: "err", text: e instanceof Error ? e.message : "Kunde inte räkna om omgången." });
    } finally {
      setBusy(null);
    }
  };

  const active = model?.active ?? null;
  return (
    <section className="set-sec" aria-labelledby="h-model">
      <h2 id="h-model" className="sl">
        Riktoddsmodell
      </h2>
      {loadErr ? (
        <Banner tone="err">{loadErr}</Banner>
      ) : !model ? (
        <p className="help">Hämtar modellen …</p>
      ) : (
        <>
          <div className="mbox brd">
            <span className="k">Aktiv version</span>
            <b className="num">{active?.key ?? "–"}</b>
            <span className="tag okal">Okalibrerad</span>
            <p>Gäller bara plats (topp 3). Vikterna är inte kalibrerade mot tidigare omgångar än.</p>
          </div>
          <form
            className="mform"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <table className="wtbl">
              <caption>Vikter och parametrar för {active?.key ?? "modellen"}</caption>
              <thead>
                <tr>
                  <th scope="col">Indata</th>
                  <th scope="col" className="r">
                    Vikt
                  </th>
                </tr>
              </thead>
              <tbody>
                {INPUT_KEYS.map((k) => (
                  <tr key={k}>
                    <th scope="row">
                      <label htmlFor={`${id}-${k}`}>{WEIGHT_LABELS[k]}</label>
                    </th>
                    <td className="r">
                      <input
                        id={`${id}-${k}`}
                        className="oin"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={weights[k] ?? ""}
                        onChange={(e) => setWeights((w) => ({ ...w, [k]: e.target.value }))}
                        aria-describedby={fieldErr ? `${id}-err` : undefined}
                      />
                    </td>
                  </tr>
                ))}
                {(["beta", "marginal"] as const).map((k) => (
                  <tr key={k} className="ptr">
                    <th scope="row">
                      <label htmlFor={`${id}-${k}`}>{PARAM_LABELS[k].label}</label>
                      <small>{PARAM_LABELS[k].help}</small>
                    </th>
                    <td className="r">
                      <input
                        id={`${id}-${k}`}
                        className="oin"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={params[k]}
                        onChange={(e) => setParams((p) => ({ ...p, [k]: e.target.value }))}
                        aria-describedby={fieldErr ? `${id}-err` : undefined}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {fieldErr && (
              <p className="err-msg" id={`${id}-err`} role="alert">
                <IconWarn />
                {fieldErr}
              </p>
            )}
            <p className="help">Att spara skapar en ny version (v1.1 och så vidare) som blir aktiv, och räknar om aktuell omgång. Gamla versioner finns kvar.</p>
            <div className="inline-btns">
              <button type="submit" className="btn primary" disabled={busy !== null}>
                {busy === "save" ? "Sparar …" : "Spara som ny version"}
              </button>
              <button type="button" className="btn secondary" disabled={busy !== null} onClick={() => void recompute()}>
                {busy === "recompute" ? "Räknar …" : "Räkna om omgången"}
              </button>
            </div>
          </form>
          <div role="status" aria-live="polite">
            {result && (
              <Banner tone={result.tone} icon={result.tone === "ok" ? "check" : undefined}>
                {result.text}
              </Banner>
            )}
          </div>
          <h3 className="sub-h">Versioner</h3>
          <ul className="vers">
            {model.versions.map((v) => (
              <li key={v.id}>
                <b className="num">{v.key}</b>
                <span className="help">skapad {relTime(v.createdAt, now)}</span>
                {v.active ? (
                  <span className="tag good">
                    <IconCheckThin /> Aktiv
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
