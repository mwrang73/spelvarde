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
import { INPUT_KEYS, isCalibrated, RECOMMENDED_CALIBRATION, RECOMMENDED_KEY, RECOMMENDED_NO_STRECK, RECOMMENDED_WEIGHTS, STRECK_KEYS, type InputKey } from "@/lib/riktodds";
import { applySettings } from "@/lib/round-overlay";
import { parseTolerance } from "@/lib/odds-ui";
import { TOLERANCE_ERROR } from "@/lib/spelbar";
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
        <NumberSetting
          label="Tolerans för Spelbar"
          help="Hästen föreslås som Spelbar även när Unibet ligger upp till så här mycket under riktoddset. Med 0,10 räcker 2,00 mot riktodds 2,10. Mellan 0,00 och 0,50."
          value={settings?.spelbarTolerance ?? null}
          parse={parseTolerance}
          error={TOLERANCE_ERROR}
          onSave={(v) => save({ spelbarTolerance: v })}
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
  galoppVolt: "Galopp, 5 senaste, vid voltstart",
  pengar: "Intjänat per start",
  barfota: "Barfota runt om",
  vila: "Dagar sedan senaste start",
  tid: "Tid, bara extrema",
  streck: "Streck (marknaden)",
  streckLog: "Streck, samma skala i alla lopp",
};

// Förklaringarna bakom i-knappen (Mikael 2026-10-29). "Rek." läses ur
// RECOMMENDED_WEIGHTS / RECOMMENDED_NO_STRECK så att talen alltid stämmer.
const WEIGHT_HELP: Record<InputKey, string> = {
  plats: "Hur ofta hästen kommit topp 3 i år och i fjol, utjämnat mot snittet när den har få starter. Positiv vikt: bättre platsandel ger högre chans.",
  vinst: "Vinstprocent i år och i fjol, utjämnad på samma sätt. Med strecket i modellen tillför den nästan inget, eftersom marknaden redan räknar in den.",
  form: "Placeringarna i de 5 senaste starterna. Negativ vikt med streck betyder att spelarna överskattar hästar i bra form.",
  spar: "Hur ofta startnumret tagit plats på samma distans och startmetod jämfört med snittet (statistikbasen, 2 år). Med streck är vikten låg, eftersom marknaden redan räknar in spåret.",
  kusk: "Kuskens vinstprocent i år, utjämnad mot snittet.",
  tranare: "Tränarens vinstprocent i år, utjämnad mot snittet.",
  galopp: "Galopper i de 5 senaste starterna. Negativ vikt: fler galopper ger lägre chans.",
  galoppVolt: "Samma som galopp, men bara i voltstart, där galopp är vanligare.",
  pengar: "Intjänat per start: ett mått på hästens klass. Viktigast när strecket saknas.",
  barfota: "Barfota runt om i dag. Positiv vikt: barfota ger högre chans.",
  vila: "Dagar sedan senaste start. Negativ vikt: lång vila ger lägre chans.",
  tid: "Bara extremt bra eller dåliga km-tider räknas.",
  streck: "Marknadens bedömning (V-strecket), omräknad inom varje lopp. Användes till och med v3. Från v1.2 är vikten 0 och strecket räknas i raden under i stället.",
  streckLog: "Marknadens bedömning (V-strecket) utan omräkning per lopp. Väger tyngst från v1.2. Vikten fungerar som en exponent: 0,56 betyder att styrkan följer strecket upphöjt till 0,56, lika i alla lopp. Den gamla omräkningen berodde på hur utspritt strecket var i hela fältet och gav storfavoriterna för låg chans och favoriterna i jämna lopp för hög. Utan den träffar modellen bättre (backtest 28 okt).",
};
const PARAM_HELP: Record<ParamKey, string> = {
  beta: "Hur mycket skillnaderna i styrka slår igenom. Högre: favoriterna får högre chans och outsiders lägre. 1 = som i backtestet.",
  marginal: "Läggs på riktoddset, till exempel 0,10 för att kräva lite extra innan en häst blir spelbar.",
  plattA: "Kalibrering efter backtestet: flyttar alla chanser till topp 3 uppåt (+) eller nedåt (−).",
  plattB: "Kalibrering efter backtestet: under 1 drar höga och låga chanser mot mitten.",
  maxP3: "Tak för chansen till topp 3, så att ingen häst får orimligt lågt riktodds.",
};
const fmtW = (x: number | undefined) => (x === undefined ? "–" : String(x).replace(".", ",").replace("-", "−"));

// i-knappen: visar förklaringen vid tryck (mobil) och som title vid hovring (dator).
function InfoTip({ id, text, label }: { id: string; text: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="itip" aria-expanded={open} aria-controls={id} aria-label={`Förklaring: ${label}`} title={text} onClick={() => setOpen((v) => !v)}>
        i
      </button>
      {open && (
        <small className="itip-t" id={id}>
          {text}
        </small>
      )}
    </>
  );
}

type ParamKey = "beta" | "marginal" | "plattA" | "plattB" | "maxP3";
const PARAM_KEYS: ParamKey[] = ["beta", "marginal", "plattA", "plattB", "maxP3"];
const PARAM_LABELS: Record<ParamKey, { label: string; help: string; min: number; max: number }> = {
  beta: { label: "β (skala på styrkan)", help: "0,01–10", min: 0.01, max: 10 },
  marginal: { label: "Marginal", help: "0–1, läggs på riktoddset", min: 0, max: 1 },
  plattA: { label: "Kalibrering a", help: "−5–5, 0 = ingen ändring", min: -5, max: 5 },
  plattB: { label: "Kalibrering b", help: "0,1–5, 1 = ingen ändring", min: 0.1, max: 5 },
  maxP3: { label: "Högsta chans till topp 3", help: "0,5–1, 1 = ingen gräns", min: 0.5, max: 1 },
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
  // Versionsnamnet när den rekommenderade modellen är ifylld (v3). Nollställs vid egna ändringar.
  const [wantedKey, setWantedKey] = useState<string | null>(null);
  const [params, setParams] = useState<Record<ParamKey, string>>({ beta: "", marginal: "", plattA: "", plattB: "", maxP3: "" });
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "recompute" | null>(null);
  const [result, setResult] = useState<{ tone: "ok" | "err" | "info"; text: string } | null>(null);
  const id = useId();
  const now = new Date();

  const fill = (active: ModelDto | null) => {
    if (!active) return;
    setWeights(Object.fromEntries(INPUT_KEYS.map((k) => [k, numText(active.weights[k])])) as Record<InputKey, string>);
    const ns = active.params.noStreck;
    setNoStreck(Object.fromEntries(INPUT_KEYS.map((k) => [k, ns && !STRECK_KEYS.includes(k) ? numText(ns[k]) : ""])) as Record<InputKey, string>);
    setParams(Object.fromEntries(PARAM_KEYS.map((k) => [k, numText(active.params[k])])) as Record<ParamKey, string>);
  };

  // Fyller i den rekommenderade modellen ur backtestet (sparas först med knappen).
  const fillRecommended = () => {
    setWeights(Object.fromEntries(INPUT_KEYS.map((k) => [k, numText(RECOMMENDED_WEIGHTS[k])])) as Record<InputKey, string>);
    setNoStreck(Object.fromEntries(INPUT_KEYS.map((k) => [k, STRECK_KEYS.includes(k) ? "" : numText(RECOMMENDED_NO_STRECK[k])])) as Record<InputKey, string>);
    setParams({ beta: "1", marginal: "0", plattA: numText(RECOMMENDED_CALIBRATION.plattA), plattB: numText(RECOMMENDED_CALIBRATION.plattB), maxP3: numText(RECOMMENDED_CALIBRATION.maxP3) });
    setFieldErr(null);
    setWantedKey(RECOMMENDED_KEY);
    setResult({ tone: "info", text: `Den rekommenderade modellen (${RECOMMENDED_KEY}) är ifylld. Tryck Spara som ny version för att använda den.` });
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
    r ? `Omgången räknades om med ${r.modelKey}: ${r.computed} starter${r.skippedLegs.length ? `, lopp ${r.skippedLegs.join(", ")} utan riktodds (färre än 4 startande)` : ""}.` : "Ingen omgång att räkna om.";

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
    const nsFilled = INPUT_KEYS.some((k) => !STRECK_KEYS.includes(k) && (noStreck[k] ?? "").trim() !== "");
    const ns: Partial<Record<InputKey, number>> = {};
    if (nsFilled) {
      for (const k of INPUT_KEYS) {
        if (STRECK_KEYS.includes(k)) continue;
        const t = (noStreck[k] ?? "").trim();
        const v = t === "" ? 0 : parseNum(t);
        if (v === null || Math.abs(v) > 10) return setFieldErr(`Vikten utan streck för ${WEIGHT_LABELS[k].toLowerCase()} ska vara ett tal mellan −10 och 10.`);
        ns[k] = v;
      }
    }
    const p: Partial<Record<ParamKey, number>> = {};
    for (const k of PARAM_KEYS) {
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
      const res = await apiRequest<ModelResponse>("PUT", "/api/admin/model", { weights: w, params: p, noStreck: nsFilled ? ns : null, ...(wantedKey ? { key: wantedKey } : {}), ...(roundId ? { roundId } : {}) });
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
            {active && isCalibrated(active.params) ? <span className="tag good">Kalibrerad</span> : <span className="tag okal">Okalibrerad</span>}
            <p>
              Gäller bara plats (topp 3).{" "}
              {active && isCalibrated(active.params)
                ? "Vikterna och kalibreringen kommer från backtestet mot tidigare V-omgångar (docs/backtest/MODELLHISTORIK.md)."
                : "Vikterna är inte kalibrerade mot tidigare omgångar."}
            </p>
          </div>
          <form
            className="mform"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <p className="help wexpl">
              <b>Så fungerar vikterna.</b> Varje häst får en styrka: summan av vikt × hur många standardavvikelser hästen är bättre än snittet i loppet. Styrkan blir sedan chans. En vikt på 0,10 ger ungefär 10 % högre vinstodds per standardavvikelse. Mellan bästa och sämsta häst är det ofta 3 standardavvikelser, så spårvikten 0,03 ger ungefär ×1,09 mellan bästa och sämsta spår, 0,10 ger ×1,35 och 0,20 ger ×1,8. Tryck på <b>i</b> för vad varje indata mäter och vad backtestet rekommenderar.
            </p>
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
                      <InfoTip
                        id={`${id}-h-${k}`}
                        label={WEIGHT_LABELS[k]}
                        text={`${WEIGHT_HELP[k]} Rek.: ${fmtW(RECOMMENDED_WEIGHTS[k])} med streck${STRECK_KEYS.includes(k) ? "" : `, ${fmtW(RECOMMENDED_NO_STRECK[k])} utan`}.`}
                      />
                    </th>
                    <td className="r">
                      <input
                        id={`${id}-${k}`}
                        className="oin"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={weights[k] ?? ""}
                        onChange={(e) => {
                          setWantedKey(null);
                          setWeights((w) => ({ ...w, [k]: e.target.value }));
                        }}
                        aria-describedby={fieldErr ? `${id}-err` : undefined}
                      />
                    </td>
                    <td className="r">
                      {STRECK_KEYS.includes(k) ? (
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
                          onChange={(e) => {
                            setWantedKey(null);
                            setNoStreck((w) => ({ ...w, [k]: e.target.value }));
                          }}
                          aria-describedby={fieldErr ? `${id}-err` : undefined}
                        />
                      )}
                    </td>
                  </tr>
                ))}
                {PARAM_KEYS.map((k) => (
                  <tr key={k} className="ptr">
                    <th scope="row">
                      <label htmlFor={`${id}-${k}`}>{PARAM_LABELS[k].label}</label>
                      <InfoTip id={`${id}-h-${k}`} label={PARAM_LABELS[k].label} text={PARAM_HELP[k]} />
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
                        onChange={(e) => {
                          setWantedKey(null);
                          setParams((p) => ({ ...p, [k]: e.target.value }));
                        }}
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
