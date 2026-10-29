// Fixturen Bjerke (docs/specs/e6-v85-rad.md, 14): V85 Bjerke lör 31 okt 2026,
// samma omgång som mockupen docs/mockups/v85-rad-mockup.html. Regler: budget
// 288 (576 rader = 288 kr exakt, mockupens rad), radpris 0,50, 4 spikar, allgardering Auto, egen spik 1 Baron Tilly i avd 4.
// Taket (E6b) är Alla (maxPerLeg null), så att raden är den från före E6b.
//
// Märken: S = Spelbar (och Intressant), I = Intressant, X/X+ = X-faktor (och
// Intressant), B = Bet. Ej nämnda: inga märken, 0 signaler.

import type { TippaLeg, TippaRules, TippaStart } from "@/lib/tippa";

type Row = [number, string, number, number, number?, string?, number?];

const start = ([number, name, streck, riktX, signals = 0, marks = "", betOdds]: Row): TippaStart => {
  const m = marks.split(" ").filter(Boolean);
  const x = m.includes("X+") ? "STARK" : m.includes("X") ? "TROR" : "NONE";
  return {
    number,
    name,
    scratched: false,
    streck,
    riktX,
    signals,
    spelbar: m.includes("S"),
    interesting: m.includes("S") || m.includes("I") || x !== "NONE",
    bet: m.includes("B"),
    betOdds: m.includes("B") ? (betOdds ?? null) : null,
    xFactor: x,
  };
};

const h = (n: number) => `Häst ${n}`;
// Avd 1 16:20 … avd 8 19:15 (CET, UTC+1).
const at = (leg: number) => new Date(Date.UTC(2026, 9, 31, 15, 20) + (leg - 1) * 25 * 60_000).toISOString();

const LEGS: Row[][] = [
  // 1 (12)
  [
    [3, "Lannem Lyn", 31.0, 2.1, 2],
    [7, "Rälsen Rask", 22.4, 1.75, 4, "S"],
    [5, "Hagmyren Kid", 12.0, 2.6, 1],
    [10, "Fly Express", 9.8, 2.1, 2, "I X"],
    [12, "Kaptein Sabeltann", 3.1, 5.6, 5, "I"],
    [1, h(1), 6.0, 4.5],
    [2, h(2), 5.2, 5.0, 1],
    [4, h(4), 3.5, 7.0],
    [6, h(6), 2.5, 8.0],
    [8, h(8), 2.0, 9.0],
    [9, h(9), 1.5, 10.0],
    [11, h(11), 1.0, 12.0],
  ],
  // 2 (11)
  [
    [2, "Gigant Tider", 52.3, 1.22, 6, "S"],
    [1, h(1), 12.0, 3.0],
    [3, h(3), 9.0, 3.5],
    [4, h(4), 7.0, 4.0],
    [5, h(5), 5.0, 5.0],
    [6, h(6), 4.0, 6.0],
    [7, h(7), 3.5, 7.0],
    [8, h(8), 2.8, 8.0],
    [9, h(9), 2.0, 9.0],
    [10, h(10), 1.5, 10.0],
    [11, h(11), 0.9, 12.0],
  ],
  // 3 (14)
  [
    [5, "Mellby Harley", 27.5, 1.8, 4, "S B", 2.4],
    [2, "Tekla Vind", 18.0, 2.5, 1],
    [7, "Röde Orm", 14.0, 3.0],
    [9, "Hulda Hall", 11.2, 2.1, 4],
    [1, "Järvsö Elina", 7.6, 2.7, 2, "I"],
    [13, "Admiral Kåre", 2.4, 7.2, 1, "X"],
    [3, h(3), 5.0, 6.0],
    [4, h(4), 4.0, 7.0],
    [6, h(6), 3.0, 8.0],
    [8, h(8), 2.0, 9.0],
    [10, h(10), 1.8, 10.0],
    [11, h(11), 1.5, 11.0],
    [12, h(12), 1.2, 12.0],
    [14, h(14), 0.8, 14.0],
  ],
  // 4 (12)
  [
    [1, "Baron Tilly", 44.8, 1.5, 5, "S B", 2.15],
    ...[15.0, 10.0, 7.0, 5.5, 4.5, 3.8, 3.2, 2.5, 1.8, 1.2, 0.7].map((s, i): Row => [i + 2, h(i + 2), s, [2.5, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12][i]]),
  ],
  // 5 (12)
  [
    [6, "Tekno Odin", 14.2, 2.4],
    [2, h(2), 13.5, 2.5],
    [9, h(9), 12.8, 2.6],
    [1, h(1), 11.0, 2.8],
    [4, h(4), 10.4, 3.0],
    [11, h(11), 9.6, 3.2],
    [7, h(7), 8.0, 3.5],
    [3, h(3), 4.5, 5.0],
    [5, h(5), 4.2, 5.5],
    [8, h(8), 4.0, 6.0],
    [10, h(10), 3.9, 6.5],
    [12, h(12), 3.9, 7.0],
  ],
  // 6 (13)
  [
    [7, "Dreamliner Sund", 29.0, 1.9, 4, "S"],
    [3, "Peggy Boko", 24.1, 1.38, 5, "I X+"],
    [1, "Grisle Tora", 12.8, 2.6],
    [9, "Hallsta Lotus", 7.1, 3.5, 5],
    [12, "Mustang Sally", 3.4, 5.5, 1, "I"],
    [2, h(2), 6.0, 4.5],
    [4, h(4), 5.0, 5.0],
    [5, h(5), 4.0, 6.0],
    [6, h(6), 3.0, 7.0],
    [8, h(8), 2.2, 8.0],
    [10, h(10), 1.6, 9.0],
    [11, h(11), 1.0, 10.0],
    [13, h(13), 0.8, 12.0],
  ],
  // 7 (15)
  [
    [6, "Vardø Storm", 33.2, 2.2, 2],
    [3, "Blizzard Diamant", 18.6, 1.45, 4, "X"],
    [11, "Tangen Haap", 8.9, 2.3, 3, "S"],
    [4, "Stoltheim Prinsen", 6.2, 2.8, 4],
    [14, "Ble Rapp", 1.9, 6.5, 4],
    [2, "Svart Pil", 5.5, 5.0],
    [5, "Odd Herakles", 5.0, 4.5],
    [1, h(1), 2.0, 9.0],
    [7, h(7), 4.5, 6.0],
    [8, "Stål Viking", 3.6, 7.0],
    [9, h(9), 3.0, 8.0],
    [10, h(10), 2.5, 9.0],
    [12, h(12), 2.0, 10.0],
    [13, h(13), 1.8, 11.0],
    [15, h(15), 1.3, 13.0],
  ],
  // 8 (10)
  [
    [1, "Moe Tjalve", 33.5, 1.85, 2],
    [4, "Bokli Viktor", 26.7, 1.3, 5],
    [2, h(2), 12.0, 2.8],
    [3, h(3), 9.0, 3.2],
    [5, h(5), 6.0, 4.0],
    [6, h(6), 4.5, 5.0],
    [7, h(7), 3.5, 6.0],
    [8, h(8), 2.5, 7.0],
    [9, h(9), 1.5, 8.0],
    [10, h(10), 0.8, 10.0],
  ],
];

// En ny kopia varje gång, så att testerna kan ändra fritt.
export function bjerkeLegs(): TippaLeg[] {
  return LEGS.map((rows, i) => ({ leg: i + 1, startAt: at(i + 1), cancelled: false, starts: rows.map(start).sort((a, b) => a.number - b.number) }));
}

export const BJERKE_ROUND = { trackName: "Bjerke", date: "2026-10-31", gameType: "V85" } as const;

export function bjerkeRules(over: Partial<TippaRules> = {}): TippaRules {
  return { gameType: "V85", budget: 288, rowPrice: 0.5, spikCount: 4, allgMode: "AUTO", allgLeg: null, maxPerLeg: null, locked: { 4: [1] }, ...over };
}

// Hjälp för testerna: ändra en häst i fixturen.
export function withStart(legs: TippaLeg[], leg: number, number: number, change: Partial<TippaStart>): TippaLeg[] {
  return legs.map((l) => (l.leg !== leg ? l : { ...l, starts: l.starts.map((s) => (s.number === number ? { ...s, ...change } : s)) }));
}
