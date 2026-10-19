import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import "../styles/tokens.css";
import "../styles/app.css";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

// Typsnitt enligt DESIGN.md. Doto (logotypen) finns inte i next/font/google
// i Next 14, så woff2-filen från Google Fonts (latin, variabel vikt 600–800)
// ligger i app/fonts och laddas med next/font/local. Reserven står i
// --f-display i styles/tokens.css.
const doto = localFont({ src: "./fonts/doto-latin.woff2", weight: "600 800", display: "swap", variable: "--font-doto", fallback: ["Courier New", "ui-monospace", "monospace"] });
const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-barlow" });
const barlowCondensed = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], display: "swap", variable: "--font-barlow-condensed" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["500", "700"], display: "swap", variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "Spelvärde",
  description: "V85-analys för platsspel.",
  appleWebApp: { capable: true, title: "Spelvärde", statusBarStyle: "black" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Temat sätts som attribut på <html> av skriptet i <head> innan något
    // ritas; servern skickar alltid samma HTML, därav suppressHydrationWarning.
    <html lang="sv" className={`${doto.variable} ${barlow.variable} ${barlowCondensed.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <a className="skip" href="#main">
          Till innehållet
        </a>
        {children}
      </body>
    </html>
  );
}
