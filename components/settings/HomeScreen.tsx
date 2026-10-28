"use client";

// "Lägg på hemskärmen" i Inställningar, som i Tabellgissningen: Android får
// webbläsarens egen installationsdialog när den finns, iPhone en guide för
// Dela-menyn. Reglerna finns i lib/home-screen.ts.

import { useEffect, useState, useSyncExternalStore } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { actionFor, detectPlatform, HS_INSTALLED_KEY, type HomeScreenAction, type HomeScreenPlatform } from "@/lib/home-screen";

// Androids installationsdialog. Händelsen kommer när webbläsaren själv tycker
// att sidan går att installera, ofta en stund efter att sidan laddats, och
// måste fångas direkt, därför på modulnivå.
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferredPrompt: InstallPromptEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function store(fn: (s: Storage) => void) {
  try {
    fn(window.localStorage);
  } catch {
    // Privat läge e.d.
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as InstallPromptEvent;
    // Chrome erbjuder bara installation när appen inte redan är installerad.
    store((s) => s.removeItem(HS_INSTALLED_KEY));
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installedNow = true;
    store((s) => s.setItem(HS_INSTALLED_KEY, "1"));
    emit();
  });
}

function isStandalone(): boolean {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

type Guide = Exclude<HomeScreenAction, "prompt" | "none">;

export function HomeScreenSection() {
  const [platform, setPlatform] = useState<HomeScreenPlatform | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [guide, setGuide] = useState<Guide | null>(null);
  const hasPrompt = useSyncExternalStore(subscribe, () => deferredPrompt !== null, () => false);
  const justInstalled = useSyncExternalStore(subscribe, () => installedNow, () => false);

  useEffect(() => {
    setPlatform(detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0));
    setStandalone(isStandalone());
  }, []);

  if (!platform) return null;

  async function start() {
    const action = actionFor(platform!, hasPrompt);
    if (action === "none") return;
    if (action === "prompt") {
      const ev = deferredPrompt;
      if (!ev) return;
      await ev.prompt();
      // Händelsen går bara att använda en gång; Chrome skickar en ny senare.
      deferredPrompt = null;
      emit();
      return;
    }
    setGuide(action);
  }

  return (
    <section className="set-sec" aria-labelledby="h-hem">
      <h2 id="h-hem" className="sl">
        Hemskärmen
      </h2>
      {standalone || justInstalled ? (
        <p className="help hs-done" role="status">
          <b>Spelvärde ligger på hemskärmen.</b> Öppna den därifrån, så startar den som en vanlig app.
        </p>
      ) : platform === "none" ? (
        <p className="help">Öppna Spelvärde i mobilens webbläsare för att lägga den på hemskärmen. Då startar den med ett tryck, som en vanlig app.</p>
      ) : (
        <>
          <button type="button" className="btn secondary full" onClick={() => void start()}>
            <PhoneIcon />
            Lägg på hemskärmen
          </button>
          <p className="help">Då öppnar du Spelvärde med ett tryck, i helskärm som en vanlig app.</p>
        </>
      )}
      <HomeScreenSheet kind={guide} onClose={() => setGuide(null)} />
    </section>
  );
}

function HomeScreenSheet({ kind, onClose }: { kind: Guide | null; onClose: () => void }) {
  const [copied, setCopied] = useState<"" | "ok" | "fail">("");
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
  }
  const login = (
    <p className="help hs-note">
      Första gången du öppnar Spelvärde från hemskärmen behöver du <b>logga in en gång till</b>. Sedan är du inloggad där.
    </p>
  );
  const ok = (
    <button type="button" className="btn primary full" onClick={onClose}>
      Okej
    </button>
  );
  return (
    <Sheet open={kind !== null} onClose={onClose} title={kind === "open-in-safari" ? "Öppna i Safari först" : "Lägg på hemskärmen"}>
      <div className="hs-body">
        {kind === "ios-guide" && (
          <>
            <p>iPhone gör det inte automatiskt, men det tar bara tre steg i Safari.</p>
            <ol className="hs-steps">
              <li>
                Tryck på{" "}
                <span className="hs-key">
                  <ShareIcon />
                  Dela
                </span>{" "}
                i Safaris verktygsfält.
                <small>
                  Ser du den inte? Tryck först på <b>···</b> nere till höger.
                </small>
              </li>
              <li>
                Skrolla ner och välj{" "}
                <span className="hs-key">
                  <AddSquareIcon />
                  Lägg till på hemskärmen
                </span>
                .
                <small>
                  Står den inte där? Tryck på <b>Visa fler</b> längst ner.
                </small>
              </li>
              <li>
                Tryck på <span className="hs-key">Lägg till</span> uppe till höger.
              </li>
            </ol>
            {login}
            {ok}
          </>
        )}
        {kind === "chrome-guide" && (
          <>
            <p>Det tar bara tre steg i Chrome.</p>
            <ol className="hs-steps">
              <li>
                Tryck på{" "}
                <span className="hs-key">
                  <ShareIcon />
                  Dela
                </span>{" "}
                i adressfältet uppe till höger.
              </li>
              <li>
                Välj{" "}
                <span className="hs-key">
                  <AddSquareIcon />
                  Lägg till på hemskärmen
                </span>
                .<small>Står den inte där? Skrolla ner eller tryck på Visa fler. Saknas den helt: använd Safari.</small>
              </li>
              <li>
                Tryck på <span className="hs-key">Lägg till</span>.
              </li>
            </ol>
            {login}
            {ok}
          </>
        )}
        {kind === "android-guide" && (
          <>
            <ol className="hs-steps">
              <li>
                Tryck på menyn <span className="hs-key">⋮</span> i webbläsaren.
                <small>Den sitter oftast uppe eller nere till höger.</small>
              </li>
              <li>
                Välj <span className="hs-key">Installera app</span> eller <span className="hs-key">Lägg till på startskärmen</span>.
              </li>
            </ol>
            {ok}
          </>
        )}
        {kind === "open-in-safari" && (
          <>
            <p>Det går bara att lägga Spelvärde på hemskärmen från Safari. Kopiera adressen, öppna Safari och klistra in den. Gå sedan till Inställningar och tryck på Lägg på hemskärmen igen.</p>
            <button type="button" className="btn primary full" onClick={() => void copyAddress()}>
              Kopiera adressen
            </button>
            <button type="button" className="btn secondary full" onClick={onClose}>
              Stäng
            </button>
            <p className="help" role="status">
              {copied === "ok" && "Adressen är kopierad."}
              {copied === "fail" && `Kunde inte kopiera. Adressen är ${window.location.host}`}
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8.5v6M9 11.5h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3v11M8 7l4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function AddSquareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3.5" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8.5v7M8.5 12h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
