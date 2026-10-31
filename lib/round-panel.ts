// Rutan "Omgången" på Live: alla lopp med vinnare, rätt eller fel mot den
// inlämnade raden, och värdet på alla rätt. Rena funktioner utan React, testade
// i lib/round-panel.test.ts.
//
// Resultatskyddet gäller: vinnare, rätt/fel och värde läses bara för lopp som är
// visade på enheten. Värdet stiger när hästar faller bort, så ett senare lopps
// värde skulle avslöja en skräll.

import { hhmm } from "@/lib/format";
import { legName, legsFor } from "@/lib/game-type";
import { isShown } from "@/lib/reveal";
import { resultMode } from "@/lib/results-ui";
import { winnerNumbers } from "@/lib/submitted-row";
import type { LegValue, RaceDto, SubmittedRowDto } from "@/lib/types";

export type PanelCell =
  | { kind: "win"; number: number; name: string; hit: boolean | null }
  | { kind: "text"; text: string; running: boolean; struck: boolean };

export type PanelRow = { leg: number; name: string; cell: PanelCell; label: string; current: boolean };

export type PanelVerdict = { tone: "down" | "up" | "plain"; text: string };

export type PanelSummary = {
  rows: PanelRow[];
  // Högsta visade loppet, oavsett om värdet för det har hämtats.
  lastShownLeg: number | null;
  value: { label: string; after: string; value: number; systems: number } | null;
  valueLabel: string;
  // null = ingen inlämnad rad.
  score: { text: string; verdict: PanelVerdict } | null;
};

type PanelRace = Pick<RaceDto, "leg" | "startAt" | "resultAt" | "cancelled" | "started" | "starts">;

function cellOf(race: PanelRace, shown: boolean, running: boolean, row: Pick<SubmittedRowDto, "selections"> | null, now: number): PanelCell {
  const text = (t: string, opts: { running?: boolean; struck?: boolean } = {}): PanelCell => ({ kind: "text", text: t, running: !!opts.running, struck: !!opts.struck });
  const mode = resultMode(race, now);
  if (mode === "cancelled") return text("Inställt", { struck: true });
  if (mode === "before") return text(`Start ${hhmm(race.startAt)}`);
  if (mode === "result") {
    if (!shown) return text("Resultat dolt");
    const nums = winnerNumbers(race);
    if (!nums.length) return text("Ingen vinnare");
    const nameOf = (n: number) => race.starts.find((s) => s.number === n)?.horse.name ?? "";
    // Dött lopp: första vinnaren på brickan, de andra med nummer efter namnet.
    const name = [nameOf(nums[0]), ...nums.slice(1).map((n) => `${n} ${nameOf(n)}`)].join(" · ");
    const inRow = row?.selections[String(race.leg)] ?? [];
    return { kind: "win", number: nums[0], name, hit: row ? nums.some((n) => inRow.includes(n)) : null };
  }
  return running ? text("Pågår", { running: true }) : text("Väntar på resultat");
}

function labelOf(name: string, cell: PanelCell, current: boolean): string {
  const what = cell.kind === "win" ? `vinnare ${cell.number} ${cell.name}${cell.hit === null ? "" : cell.hit ? ", rätt" : ", fel"}` : cell.text.toLowerCase();
  return `${name}, ${what}${current ? ". Visas nu" : ""}`;
}

export function roundPanel(input: {
  gameType: string;
  races: readonly PanelRace[];
  row: Pick<SubmittedRowDto, "selections"> | null;
  shownLegs: readonly number[];
  values: readonly LegValue[];
  selectedLeg: number;
  runningLeg: number | null;
  now: number;
}): PanelSummary {
  const { gameType, races, row, shownLegs, values, selectedLeg, runningLeg, now } = input;
  const rows = races.map((r) => {
    const name = legName(gameType, r.leg);
    const cell = cellOf(r, isShown(r, shownLegs), runningLeg === r.leg, row, now);
    const current = r.leg === selectedLeg;
    return { leg: r.leg, name, cell, label: labelOf(name, cell, current), current };
  });

  const counted = races.filter((r) => !r.cancelled);
  const shown = counted.filter((r) => isShown(r, shownLegs));
  const allShown = counted.length > 0 && shown.length === counted.length;

  // Överhoppat lopp: det högsta visade gäller, så att värdet aldrig går baklänges.
  // Saknas det värdet visas det närmast lägre, och etiketten säger vilket lopp det är.
  const shownDesc = [...shown].sort((a, b) => b.leg - a.leg);
  const lastShownLeg = shownDesc[0]?.leg ?? null;
  const withValue = shownDesc.map((r) => values.find((v) => v.leg === r.leg)).find((v) => !!v) ?? null;
  const valueLabel = `${allShown && withValue?.leg === lastShownLeg ? "Utdelning" : "Värde"} ${legsFor(gameType)} rätt`;
  const value = withValue ? { label: valueLabel, after: `efter ${legName(gameType, withValue.leg)}`, value: withValue.value, systems: withValue.systems } : null;

  let score: PanelSummary["score"] = null;
  if (row) {
    const wins = rows.filter((r): r is PanelRow & { cell: Extract<PanelCell, { kind: "win" }> } => r.cell.kind === "win");
    const hits = wins.filter((r) => r.cell.hit).length;
    const firstMiss = wins.find((r) => !r.cell.hit);
    const verdict: PanelVerdict = firstMiss ? { tone: "down", text: `✗ Spräckt i ${firstMiss.name}` } : allShown ? { tone: "up", text: "✓ Alla rätt" } : { tone: "plain", text: "Alla rätt hittills" };
    score = { text: `${hits} av ${shown.length} rätt`, verdict };
  }
  return { rows, lastShownLeg, value, valueLabel, score };
}
