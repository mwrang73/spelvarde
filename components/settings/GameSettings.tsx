"use client";

// S10, E2-delen: riktlinjen för Unibet-odds och radpriset (alla), från E2.1
// X-faktorerna Tror på och Stark känsla (6.8), och riktoddsmodellen med
// vikter, versioner och "Räkna om omgången" (bara ADMIN).

import { useEffect, useId, useState } from "react";
import { apiGet, apiRequest } from "@/components/api";
import { clearDetails, getCurrentId, loadRound, patchRound } from "@/components/round/roundStore";
import { Banner } from "@/components/ui/board";
import { IconCheckThin, IconWarn } from "@/components/ui/icons";
import { GAME_TYPES } from "@/lib/game-type";
import { GUIDELINE_ERROR, parseGuideline, parseRowPrice, ROW_PRICE_ERROR } from "@/lib/coupon-ui";
import { odds, relTime } from "@/lib/format";
import { INPUT_KEYS, RECOMMENDED_NO_STRECK, RECOMMENDED_WEIGHTS, type InputKey } from "@/lib/riktodds";
import { applySettings } from "@/lib/round-overlay";
import { X_FACTOR_ORDER_ERROR, X_FACTOR_RANGE_ERROR } from "@/lib/xfactor";
import { parseFactorText } from "@/lib/xfactor-ui";
import type { CurrentRoundResponse, ModelDto, ModelResponse, RiktoddsStepResponse, SettingsDto } from "@/lib/types";

// ---- Riktlinje och radpris ------------------------------------------------------------------

function refreshCurrentRound(s: SettingsDto) {
  const id = getCurrentId();
  if (!id) return;
  // Riktlinje, radpris och X-faktorer in i cachen; förslagen räknas om direkt.
  patchRound(id, (r) => applySettings(r, s));
  // Hämta omgången i bakgrunden ändå, så att allt stämmer med servern.
  loadRound(id).catch(() => {});
}

function NumberSetting({
  label,
  help,
  value,
  unit,
  parse,
  error,
  validate,
  onSave,
}: {
  label: string;
  help: string;
  value: number | null;
  unit?: string;
  parse: (t: string) => number | null;
  error: string;
  // Kontroll mot andra inställningar (t.ex. Stark känsla > Tror på). Ger felet eller null.
  validate?: (v: number) => string | null;
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
    setText(odds(v));
    const bad = validate?.(v) ?? null;
    if (bad) return setErr(bad);
    setErr(null);
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
    <>
      <section className="set-sec" aria-labelledby="h-form">
        <h2 id="h-form" className="sl">
          Spelform
        </h2>
        <div className="seg full" role="group" aria-labelledby="h-form">
          {GAME_TYPES.map((t) => (
            <button key={t} type="button" aria-pressed={settings?.gameType === t} disabled={!settings} onClick={() => void save({ gameType: t }).catch(() => {})}>
              {settings?.gameType === t && <IconCheckThin />}
              {t}
            </button>
          ))}
        </div>
        <p className="help">Hämta omgång letar efter nästa spel av den här formen. V85 ersätts av V75 i slutet av november. Hämtade omgångar behåller sin spelform.</p>
      </section>
      <section className="set-sec" aria-labelledby="h-spel">
        <h2 id="h-spel" className="sl">
          Odds och rad
        </h2>
        <NumberSetting
          label="Riktlinje för Unibet-odds"
          help={`Odds under riktlinjen får taggen "Under ${odds(settings?.spelbarGuideline ?? 2)}". Ingenting blockeras, och förslaget på Spelbar påverkas inte.`}
          value={settings?.spelbarGuideline ?? null}
          parse={parseGuideline}
          error={GUIDELINE_ERROR}
          onSave={(v) => save({ spelbarGuideline: v })}
        />
        <NumberSetting label="Radpris" help="Används för kostnaden i raden." value={settings?.rowPrice ?? null} unit="kr" parse={parseRowPrice} error={ROW_PRICE_ERROR} onSave={(v) => save({ rowPrice: v })} />
        <NumberSetting
          label="X-faktor Tror på"
          help="Riktoddset delas med faktorn. 1,25 gör 3,00 till 2,40. Mellan 1,05 och 3,00."
          value={settings?.xFactorTror ?? null}
          parse={parseFactorText}
          error={X_FACTOR_RANGE_ERROR}
          validate={(v) => (settings && !(settings.xFactorStark > v) ? X_FACTOR_ORDER_ERROR : null)}
          onSave={(v) => save({ xFactorTror: v })}
        />
        <NumberSetting
          label="X-faktor Stark känsla"
          help="Riktoddset delas med faktorn. 1,50 gör 3,00 till 2,00. Mellan 1,05 och 3,00 och större än Tror på."
          value={settings?.xFactorStark ?? null}
          parse={parseFactorText}
          error={X_FACTOR_RANGE_ERROR}
          validate={(v) => (settings && !(v > settings.xFactorTror) ? X_FACTOR_ORDER_ERROR : null)}
          onSave={(v) => save({ xFactorStark: v })}
        />
      </section>
    </>
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
  pengar: "Intjänat per start",
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
  // Vikterna utan streck (används när loppet saknar streck). Alla tomma = inga.
  const [noStreck, setNoStreck] = useState<Record<InputKey, string>>({} as Record<InputKey, string>);
  const [params, setParams] = useState<Record<ParamKey, string>>({ beta: "", marginal: "" });
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "recompute" | null>(null);
  const [result, setResult] = useState<{ tone: "ok" | "err" | "info"; text: string } | null>(null);
  const id = useId();
  const now = new Date();

  const fill = (active: ModelDto | null) => {
    if (!active) return;
    setWeights(Object.fromEntries(INPUT_KEYS.map((k) => [k, numText(active.weights[k])])) as Record<InputKey, string>);
    const ns = active.params.noStreck;
    setNoStreck(Object.fromEntries(INPUT_KEYS.map((k) => [k, ns && k !== "streck" ? numText(ns[k]) : ""])) as Record<InputKey, string>);
    setParams({ beta: numText(active.params.beta), marginal: numText(active.params.marginal) });
  };

  // Fyller i den rekommenderade modellen ur backtestet (sparas först med knappen).
  const fillRecommended = () => {
    setWeights(Object.fromEntries(INPUT_KEYS.map((k) => [k, numText(RECOMMENDED_WEIGHTS[k])])) as Record<InputKey, string>);
    setNoStreck(Object.fromEntries(INPUT_KEYS.map((k) => [k, k === "streck" ? "" : numText(RECOMMENDED_NO_STRECK[k])])) as Record<InputKey, string>);
    setParams({ beta: "1", marginal: "0" });
    setFieldErr(null);
    setResult({ tone: "info", text: "Den rekommenderade modellen är ifylld. Tryck Spara som ny version för att använda den." });
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
    const nsFilled = INPUT_KEYS.some((k) => k !== "streck" && (noStreck[k] ?? "").trim() !== "");
    const ns: Partial<Record<InputKey, number>> = {};
    if (nsFilled) {
      for (const k of INPUT_KEYS) {
        if (k === "streck") continue;
        const t = (noStreck[k] ?? "").trim();
        const v = t === "" ? 0 : parseNum(t);
        if (v === null || Math.abs(v) > 10) return setFieldErr(`Vikten utan streck för ${WEIGHT_LABELS[k].toLowerCase()} ska vara ett tal mellan −10 och 10.`);
        ns[k] = v;
      }
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
      const res = await apiRequest<ModelResponse>("PUT", "/api/admin/model", { weights: w, params: p, noStreck: nsFilled ? ns : null, ...(roundId ? { roundId } : {}) });
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
                  <th scope="col" className="r">
                    <abbr title="Används i lopp där ingen häst har streck än">Utan streck</abbr>
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
                    <td className="r">
                      {k === "streck" ? (
                        <span className="help">–</span>
                      ) : (
                        <input
                          id={`${id}-ns-${k}`}
                          className="oin"
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          aria-label={`${WEIGHT_LABELS[k]}, utan streck`}
                          value={noStreck[k] ?? ""}
                          onChange={(e) => setNoStreck((w) => ({ ...w, [k]: e.target.value }))}
                          aria-describedby={fieldErr ? `${id}-err` : undefined}
                        />
                      )}
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
                    <td />
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
            <p className="help">
              Att spara skapar en ny version (v1.1 och så vidare) som blir aktiv, och räknar om aktuell omgång. Gamla versioner finns kvar. Kolumnen Utan streck används i lopp där ingen häst har streck än, om vikten för streck inte är 0. Lämna den tom för att alltid använda Vikt.
            </p>
            <button type="button" className="btn ghost" disabled={busy !== null} onClick={fillRecommended}>
              Fyll i rekommenderad modell
            </button>
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
