"use client";

// /login: inloggning på tavlan. Ingen registrering och inget glömt
// lösenord (specen 15). Efter inloggning: tillbaka dit Mikael var (?next=).

import { useId, useState } from "react";
import { apiRequest } from "@/components/api";
import { IconWarn, IconWheel } from "@/components/ui/icons";

function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/";
}

export function LoginForm({ next }: { next: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  return (
    <div className="auth">
      <main className="auth-card" id="main">
        <div className="auth-head brd">
          <span className="logo" aria-hidden="true">
            <IconWheel />
          </span>
          <h1 className="ah-brand">SPELVÄRDE</h1>
          <p>Travanalys för platsspel och V-spel</p>
        </div>
        <form
          className="auth-form"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            if (!email.trim() || !password) {
              setError("Fyll i e-postadress och lösenord.");
              return;
            }
            setBusy(true);
            try {
              await apiRequest("POST", "/api/auth/login", { email: email.trim(), password });
              window.location.assign(safeNext(next));
            } catch (ex) {
              setError(ex instanceof Error ? ex.message : "Kunde inte logga in.");
              setBusy(false);
            }
          }}
        >
          <div className="field">
            <label className="flbl" htmlFor={`${id}-e`}>
              E-post
            </label>
            <input
              id={`${id}-e`}
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-err` : undefined}
            />
          </div>
          <div className="field">
            <label className="flbl" htmlFor={`${id}-p`}>
              Lösenord
            </label>
            <input
              id={`${id}-p`}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-err` : undefined}
            />
          </div>
          <div aria-live="assertive">
            {error && (
              <p className="err-msg" id={`${id}-err`}>
                <IconWarn />
                {error}
              </p>
            )}
          </div>
          <button type="submit" className="btn primary full" disabled={busy}>
            {busy ? "Loggar in …" : "Logga in"}
          </button>
        </form>
      </main>
    </div>
  );
}
