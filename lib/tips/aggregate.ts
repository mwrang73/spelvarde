// Vilket tips som gäller, och summeringarna för avdelningen och omgången
// (E5 6.11 "Ersatt roll" och "Källstöd"). Ren modul.
//
// - Per (användare, omgång, källa, start) gäller högst ett godkänt tips: det
//   från den senaste artikeln. Övriga godkända har supersededById (historik).
// - Ordningen: artikelns publishedAt, annars firstSeenAt. Inom samma artikel
//   (eller samma tid) avgör Tip.createdAt, och sist id för en stabil ordning.
import { countsAsSupport, roleStrength, type TipRole } from "@/lib/tips/roles";

export type OrderInput = { id: string; createdAt: Date; articlePublishedAt: Date | null; articleFirstSeenAt: Date };

export function orderKey(t: OrderInput): [number, number, string] {
  return [(t.articlePublishedAt ?? t.articleFirstSeenAt).getTime(), t.createdAt.getTime(), t.id];
}

// > 0 när a är nyare än b.
export function compareOrder(a: OrderInput, b: OrderInput): number {
  const x = orderKey(a);
  const y = orderKey(b);
  return x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0);
}

// När T godkänns och U är det gällande godkända tipset från samma källa på samma start.
export type SupersedeDecision = { kind: "none" } | { kind: "replaces"; supersededId: string } | { kind: "older"; currentId: string };

export function resolveSupersede(t: OrderInput, current: OrderInput | null): SupersedeDecision {
  if (!current || current.id === t.id) return { kind: "none" };
  return compareOrder(t, current) > 0 ? { kind: "replaces", supersededId: current.id } : { kind: "older", currentId: current.id };
}

export type SummaryTip = { sourceId: string; role: TipRole; review: string; supersededById: string | null; startId: string | null; sourceEnabled: boolean };
export type StartTipSummary = { role: TipRole; sources: number; support: number };

const isCurrent = (t: SummaryTip) => t.review === "APPROVED" && t.supersededById === null && t.startId !== null;

// Starkaste rollen, antal källor och källstödet för en start. Bara godkända,
// gällande tips från påslagna källor. null när inga finns.
export function startTipSummary(tips: SummaryTip[]): StartTipSummary | null {
  const live = tips.filter((t) => isCurrent(t) && t.sourceEnabled);
  if (!live.length) return null;
  const role = live.map((t) => t.role).sort((a, b) => roleStrength(a) - roleStrength(b))[0];
  const sources = new Set(live.map((t) => t.sourceId)).size;
  const support = new Set(live.filter((t) => countsAsSupport(t.role)).map((t) => t.sourceId)).size;
  return { role, sources, support };
}

export type CountTip = { review: string; match: string; startId: string | null; supersededById: string | null; locked: boolean; sourceEnabled?: boolean };
export type RoundTipCounts = { pending: number; pendingSure: number; pendingUnsure: number; approved: number; approvedHorses: number };

// Att granska = väntande, inte ersatta och inte låsta. Godkända = gällande.
export function roundTipCounts(tips: CountTip[]): RoundTipCounts {
  const pending = tips.filter((t) => t.review === "PENDING" && t.supersededById === null && !t.locked);
  const sure = pending.filter((t) => t.match === "SURE" && t.startId !== null);
  const approved = tips.filter((t) => t.review === "APPROVED" && t.supersededById === null && t.startId !== null && t.sourceEnabled !== false);
  return {
    pending: pending.length,
    pendingSure: sure.length,
    pendingUnsure: pending.length - sure.length,
    approved: approved.length,
    approvedHorses: new Set(approved.map((t) => t.startId)).size,
  };
}
