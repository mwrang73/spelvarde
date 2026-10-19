// Hämta omgång från klienten (specen 10.1): stegen körs i ordning, ett kort
// anrop i taget, och kedjan stannar på första steget som misslyckas så att
// Försök igen kan fortsätta därifrån. Ren logik: anropen skickas in, så att
// kedjan testas utan nät (lib/fetch-chain.test.ts).

import type { FetchGameResponse, ResumePoint } from "@/lib/types";

export type ChainPost = (url: string, body?: unknown) => Promise<{ status: number; data: unknown }>;

export type ChainProgress = {
  step: "GAME" | "RACE" | "STATS";
  // Avdelningen som hämtas just nu (steg RACE).
  leg: number | null;
  gameDone: boolean;
  // Avdelningar som är klara i den här körningen eller tidigare.
  legsDone: number;
  statsDone: boolean;
};

export type ChainResult =
  | { ok: true; roundId: string }
  // ATG har ingen V85 de närmaste 7 dagarna (404 NO_V85).
  | { ok: false; kind: "NO_V85"; message: string; roundId: null; resumeFrom: null }
  // Steg 1 misslyckades (ingen omgång sparad eller ATG nåddes inte).
  | { ok: false; kind: "FAILED"; message: string; roundId: string | null; resumeFrom: ResumePoint }
  // Ett senare steg misslyckades. Det som hämtats är sparat.
  | { ok: false; kind: "PARTIAL"; message: string; roundId: string; resumeFrom: ResumePoint };

const errorOf = (data: unknown): string | null =>
  data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : null;
const codeOf = (data: unknown): string | null =>
  data && typeof data === "object" && typeof (data as { code?: unknown }).code === "string" ? (data as { code: string }).code : null;

export const ATG_UNREACHABLE = "Kunde inte nå ATG. Kontrollera uppkopplingen och försök igen.";

export function stoppedAtRace(leg: number): string {
  return `Hämtningen stannade vid avd ${leg}: ATG svarade inte. Det som redan hämtats är sparat.`;
}
export const STOPPED_AT_STATS = "Hämtningen stannade vid statistiken: travstatistik.se svarade inte. Det som redan hämtats är sparat.";

export async function runFetchChain(
  post: ChainPost,
  opts: { from: ResumePoint; gameId: string | null; roundId: string | null },
  onProgress: (p: ChainProgress) => void = () => {},
): Promise<ChainResult> {
  let roundId = opts.roundId;
  const startLeg = opts.from.step === "RACE" ? opts.from.leg : opts.from.step === "STATS" ? 9 : 1;
  const p: ChainProgress = { step: opts.from.step, leg: null, gameDone: opts.from.step !== "GAME", legsDone: startLeg - 1, statsDone: false };
  const emit = () => onProgress({ ...p });

  // Steg 1: spelet.
  if (opts.from.step === "GAME" || !roundId) {
    p.step = "GAME";
    p.legsDone = 0;
    emit();
    let res: { status: number; data: unknown };
    try {
      res = await post("/api/rounds/fetch", opts.gameId ? { gameId: opts.gameId } : {});
    } catch {
      return { ok: false, kind: "FAILED", message: ATG_UNREACHABLE, roundId, resumeFrom: { step: "GAME" } };
    }
    if (res.status === 404 && codeOf(res.data) === "NO_V85") {
      return { ok: false, kind: "NO_V85", message: errorOf(res.data) ?? "ATG har ingen V85 de närmaste 7 dagarna än. Försök igen senare.", roundId: null, resumeFrom: null };
    }
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, kind: "FAILED", message: res.status >= 500 || res.status === 0 ? ATG_UNREACHABLE : errorOf(res.data) ?? ATG_UNREACHABLE, roundId, resumeFrom: { step: "GAME" } };
    }
    roundId = (res.data as FetchGameResponse).roundId;
    p.gameDone = true;
  }

  // Steg 2–9: avdelningarna.
  for (let leg = opts.from.step === "GAME" ? 1 : startLeg; leg <= 8; leg++) {
    p.step = "RACE";
    p.leg = leg;
    emit();
    let status = 0;
    try {
      status = (await post(`/api/rounds/${roundId}/fetch/races/${leg}`)).status;
    } catch {
      status = 0;
    }
    if (status < 200 || status >= 300) return { ok: false, kind: "PARTIAL", message: stoppedAtRace(leg), roundId: roundId!, resumeFrom: { step: "RACE", leg } };
    p.legsDone = leg;
  }

  // Steg 10: travstatistik.se.
  p.step = "STATS";
  p.leg = null;
  emit();
  let status = 0;
  try {
    status = (await post(`/api/rounds/${roundId}/fetch/stats`)).status;
  } catch {
    status = 0;
  }
  if (status < 200 || status >= 300) return { ok: false, kind: "PARTIAL", message: STOPPED_AT_STATS, roundId: roundId!, resumeFrom: { step: "STATS" } };
  p.statsDone = true;
  emit();
  return { ok: true, roundId: roundId! };
}

// Felmeddelandet för en kedja som stannat tidigare (efter omladdning), från
// omgångens fetch.resumeFrom.
export function resumeMessage(from: ResumePoint): string {
  if (from.step === "GAME") return "Hämtningen av startlistan blev inte klar. Det som redan hämtats är sparat.";
  if (from.step === "RACE") return stoppedAtRace(from.leg);
  return STOPPED_AT_STATS;
}
