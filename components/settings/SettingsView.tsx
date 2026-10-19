"use client";

// S10 Inställningar: tema (System, Ljust, Mörkt), riktlinje och radpris
// (E2), riktoddsmodellen (E2, bara ADMIN) och konto (byt lösenord, logga
// ut). Temat gäller direkt och sparas både i webbläsaren (sv-theme, för att
// inte blinka) och i kontot (PUT /api/settings).

import { useEffect, useId, useState } from "react";
import { apiGet, apiRequest } from "@/components/api";
import { AppHeader } from "@/components/shell/AppHeader";
import { applyTheme, readThemeChoice } from "@/components/shell/theme-client";
import { IconCheckThin, IconWarn } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import { GameSettings, ModelAdmin } from "./GameSettings";
import type { ThemeChoice } from "@/lib/theme";
import type { MeResponse, SettingsDto } from "@/lib/types";

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Ljust" },
  { value: "dark", label: "Mörkt" },
];

export function SettingsView() {
  const [theme, setTheme] = useState<ThemeChoice | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const toast = useToast();

  useEffect(() => {
    const local = readThemeChoice();
    setTheme(local);
    apiGet<MeResponse>("/api/auth/me").then(setMe).catch(() => setMe(null));
    // Har webbläsaren inget eget val gäller kontots.
    apiGet<SettingsDto>("/api/settings")
      .then((s) => {
        setSettings(s);
        if (local === "system" && s.theme !== "system") {
          applyTheme(s.theme);
          setTheme(s.theme);
        }
      })
      .catch(() => {});
  }, []);

  const choose = (t: ThemeChoice) => {
    setTheme(t);
    applyTheme(t);
    apiRequest<SettingsDto>("PUT", "/api/settings", { theme: t }).catch(() => toast({ text: "Temat gäller i den här webbläsaren men kunde inte sparas i kontot." }));
  };

  const logout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } finally {
      window.location.assign("/login");
    }
  };

  return (
    <>
      <AppHeader title="Inställningar" sub="Tema, spel och konto" back={{ href: "/", label: "Tillbaka till omgången" }} />
      <main className="page" id="main">
        <section className="set-sec" aria-labelledby="h-tema">
          <h2 id="h-tema" className="sl">
            Tema
          </h2>
          <div className="seg full" role="group" aria-labelledby="h-tema">
            {THEMES.map((t) => (
              <button key={t.value} type="button" aria-pressed={theme === t.value} onClick={() => choose(t.value)}>
                {theme === t.value && <IconCheckThin />}
                {t.label}
              </button>
            ))}
          </div>
          <p className="help">System följer telefonens eller datorns inställning.</p>
        </section>

        <GameSettings settings={settings} onChange={setSettings} />

        {me?.role === "ADMIN" && <ModelAdmin />}

        <section className="set-sec" aria-labelledby="h-konto">
          <h2 id="h-konto" className="sl">
            Konto
          </h2>
          {me && (
            <p className="acct">
              <b>{me.name}</b>
              <br />
              <span className="help">{me.email}</span>
            </p>
          )}
          <PasswordForm />
          <button type="button" className="btn secondary full" onClick={() => void logout()}>
            Logga ut
          </button>
        </section>
      </main>
    </>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<{ field: "current" | "next" | "confirm"; text: string } | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const err = (f: "current" | "next" | "confirm") => (error?.field === f ? { "aria-invalid": true as const, "aria-describedby": `${id}-${f}-e` } : {});
  const msg = (f: "current" | "next" | "confirm") =>
    error?.field === f ? (
      <span className="err-msg" id={`${id}-${f}-e`}>
        <IconWarn />
        {error.text}
      </span>
    ) : null;

  return (
    <form
      className="pw"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setDone(false);
        if (!current) return setError({ field: "current", text: "Skriv ditt nuvarande lösenord." });
        if (next.length < 10) return setError({ field: "next", text: "Det nya lösenordet måste vara minst 10 tecken." });
        if (next !== confirm) return setError({ field: "confirm", text: "Lösenorden är inte likadana." });
        setBusy(true);
        try {
          await apiRequest("POST", "/api/auth/password", { currentPassword: current, newPassword: next });
          setDone(true);
          setCurrent("");
          setNext("");
          setConfirm("");
        } catch (ex) {
          const text = ex instanceof Error ? ex.message : "Kunde inte byta lösenord.";
          setError({ field: /nuvarande/i.test(text) ? "current" : "next", text });
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="sub-h">Byt lösenord</h3>
      <div className="field">
        <label className="flbl" htmlFor={`${id}-c`}>
          Nuvarande lösenord
        </label>
        <input id={`${id}-c`} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} {...err("current")} />
        {msg("current")}
      </div>
      <div className="field">
        <label className="flbl" htmlFor={`${id}-n`}>
          Nytt lösenord
        </label>
        <input id={`${id}-n`} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} aria-describedby={error?.field === "next" ? `${id}-next-e` : `${id}-n-h`} aria-invalid={error?.field === "next" ? true : undefined} />
        <span className="help" id={`${id}-n-h`}>
          Minst 10 tecken.
        </span>
        {msg("next")}
      </div>
      <div className="field">
        <label className="flbl" htmlFor={`${id}-r`}>
          Upprepa nytt lösenord
        </label>
        <input id={`${id}-r`} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} {...err("confirm")} />
        {msg("confirm")}
      </div>
      <div role="status" aria-live="polite">
        {done && (
          <p className="ok-msg">
            <IconCheckThin /> Lösenordet är bytt.
          </p>
        )}
      </div>
      <button type="submit" className="btn secondary" disabled={busy}>
        {busy ? "Byter …" : "Byt lösenord"}
      </button>
    </form>
  );
}
