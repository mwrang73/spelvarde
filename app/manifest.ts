import type { MetadataRoute } from "next";

// Installera som app (Lägg till på hemskärmen): helskärm utan adressfält.
// Ikonerna i public/icons är ritade från app/icon.svg.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Spelvärde",
    short_name: "Spelvärde",
    description: "Travanalys för platsspel och V-spel.",
    lang: "sv",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#101317",
    theme_color: "#101317",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
