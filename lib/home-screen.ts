// "Lägg på hemskärmen" (som i Tabellgissningen, lib/home-screen.ts där).
// Ren logik utan React och DOM, så att reglerna går att testa. Kopplingen
// till webbläsaren finns i components/settings/HomeScreen.tsx.

// Vilken väg till hemskärmen enheten har:
//   android     Chrome, Edge, Samsung Internet, Firefox m.fl. på Android
//   ios-safari  Safari på iPhone/iPad - bara via Dela, inte automatiskt
//   ios-chrome  Chrome på iPhone/iPad - via Dela i adressfältet (iOS 16.4+)
//   ios-other   annan webbläsare eller app på iPhone/iPad - be om Safari först
//   none        dator
export type HomeScreenPlatform = "android" | "ios-safari" | "ios-chrome" | "ios-other" | "none";

// Vad som händer när man trycker på knappen.
export type HomeScreenAction = "prompt" | "android-guide" | "ios-guide" | "chrome-guide" | "open-in-safari" | "none";

export const HS_INSTALLED_KEY = "sv-hs-installed";

// Appar och webbläsare på iOS som inte är Safari. Inbyggda webbläsare i appar
// (Messenger, Instagram, Gmail …) saknar dessutom ofta "Safari/" helt.
const IOS_NOT_SAFARI = /CriOS|FxiOS|EdgiOS|OPiOS|FBAN|FBAV|Instagram|GSA\/|Line\//;

// maxTouchPoints behövs för iPad: Safari där utger sig för att vara en Mac.
export function detectPlatform(userAgent: string, maxTouchPoints: number): HomeScreenPlatform {
  const isIPad = /iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (/iPhone|iPod/.test(userAgent) || isIPad) {
    if (/CriOS\//.test(userAgent)) return "ios-chrome";
    return IOS_NOT_SAFARI.test(userAgent) || !/Safari\//.test(userAgent) ? "ios-other" : "ios-safari";
  }
  if (/Android/.test(userAgent)) return "android";
  return "none";
}

// hasPrompt = webbläsaren har erbjudit sin egen installationsdialog
// (beforeinstallprompt). Android utan den får instruktionen.
export function actionFor(platform: HomeScreenPlatform, hasPrompt: boolean): HomeScreenAction {
  if (platform === "android") return hasPrompt ? "prompt" : "android-guide";
  if (platform === "ios-safari") return "ios-guide";
  if (platform === "ios-chrome") return "chrome-guide";
  if (platform === "ios-other") return "open-in-safari";
  return "none";
}
