// "Unibets odds över tid" i hästkortet (e2.2 S3 5b): kurvan och listan.
// Rena funktioner utan React, testade i lib/odds-history.test.ts.

import { odds } from "@/lib/format";
import { oddsClass, oddsDiff, type OddsClass } from "@/lib/spelbar";
import { stockholmDateString, stockholmParts } from "@/lib/stockholm-time";
import { weekdayTime } from "@/lib/streck-odds";
import type { UnibetHistoryPoint } from "@/lib/types";

export const CHART_W = 340;
export const CHART_H = 124;
const PAD = 28;
const TOP = 12;
const BOT = CHART_H - 22;

export type ChartPoint = { x: number; y: number; v: number; cls: OddsClass | null; label: boolean };

export type HistoryChart = {
  w: number;
  h: number;
  count: number;
  from: string;
  points: ChartPoint[];
  // Gröna fält: över riktoddset (TOP–riktY) och nära (riktY–nearY). null utan riktodds.
  band: { x: number; w: number; top: number; riktY: number; nearY: number } | null;
  ticks: { v: number; y: number }[];
  days: { x: number; label: string }[];
  aria: string;
};

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

// null när det finns färre än två hämtningar med platsodds.
export function historyChart(history: UnibetHistoryPoint[], rikt: number | null, tolerance: number, horseName: string): HistoryChart | null {
  const pts = history.filter((h): h is UnibetHistoryPoint & { place: number } => h.place !== null);
  if (pts.length < 2) return null;
  const vals = pts.map((p) => p.place);
  const all = rikt === null ? vals : [...vals, rikt, rikt - tolerance];
  let lo = Math.floor((Math.min(...all) - 0.05) * 20) / 20;
  let hi = Math.ceil((Math.max(...all) + 0.05) * 20) / 20;
  if (hi - lo < 0.2) {
    const mid = (hi + lo) / 2;
    lo = r2(mid - 0.1);
    hi = r2(mid + 0.1);
  }
  const clamp = (y: number) => Math.min(BOT, Math.max(TOP, y));
  const Y = (v: number) => r1(BOT - ((v - lo) / (hi - lo)) * (BOT - TOP));
  const X = (i: number) => r1(PAD + i * ((CHART_W - PAD - 10) / (pts.length - 1)));
  const many = pts.length > 8;
  const points = pts.map((p, i) => ({ x: X(i), y: Y(p.place), v: p.place, cls: oddsClass(p.place, rikt, tolerance), label: !many || i === 0 || i === pts.length - 1 }));
  const days: HistoryChart["days"] = [];
  pts.forEach((p, i) => {
    const d = stockholmDateString(new Date(p.at));
    if (i === 0 || d !== stockholmDateString(new Date(pts[i - 1].at))) days.push({ x: X(i), label: stockholmParts(new Date(p.at)).weekdayShort.toUpperCase() });
  });
  const mid = r2((lo + hi) / 2);
  const over = points.filter((p) => p.cls === "over").length;
  const near = points.filter((p) => p.cls === "near").length;
  const list = pts.map((p) => `${weekdayTime(p.at)} ${odds(p.place)}`).join(", ");
  const aria = `Unibets platsodds för ${horseName}: ${list}.${rikt !== null ? ` Riktodds ${odds(rikt)}. Spelbar i ${over + near} av ${pts.length} hämtningar, nära i ${near}.` : ""}`;
  return {
    w: CHART_W,
    h: CHART_H,
    count: pts.length,
    from: weekdayTime(pts[0].at),
    points,
    band: rikt === null ? null : { x: PAD, w: CHART_W - PAD, top: TOP, riktY: clamp(Y(rikt)), nearY: clamp(Y(rikt - tolerance)) },
    // Bara nedre och mittersta värdet: det översta krockar med punkternas värden.
    ticks: [lo, mid].map((v) => ({ v, y: Y(v) })),
    days,
    aria,
  };
}

export type HistoryRow = { key: string; when: string; place: number | null; win: number | null; diff: number | null; cls: OddsClass | null; tags: string[] };

// Listan, senaste först. "Första" på den första hämtningen med odds och
// "Bet 2,25" på den senaste hämtningen före Bet.
export function historyRows(history: UnibetHistoryPoint[], rikt: number | null, tolerance: number, bet: { at: string; odds: number | null } | null): HistoryRow[] {
  const firstIdx = history.findIndex((h) => h.place !== null);
  let betIdx = -1;
  if (bet) history.forEach((h, i) => Date.parse(h.at) <= Date.parse(bet.at) && (betIdx = i));
  return history
    .map((h, i) => ({
      key: h.fetchId,
      when: weekdayTime(h.at),
      place: h.place,
      win: h.place === null ? null : h.win,
      diff: oddsDiff(h.place, rikt),
      cls: oddsClass(h.place, rikt, tolerance),
      tags: [i === firstIdx ? "Första" : "", i === betIdx && bet ? (bet.odds !== null ? `Bet ${odds(bet.odds)}` : "Bet") : ""].filter(Boolean),
    }))
    .reverse();
}
