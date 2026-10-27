// Testdata för lib/tips/*.test.ts: en omgång med mockupens Bjerke-hästar
// (docs/mockups/efteranalys-tips-mockup.html). Bara för tester.
import type { StartRef } from "@/lib/tips/match";

const s = (leg: number, number: number, name: string, scratched = false): StartRef => ({ startId: `s${leg}_${number}`, leg, number, name, scratched });

export const BJERKE: StartRef[] = [
  s(1, 1, "Moe Odin"),
  s(1, 4, "Dubbel Trubbel"),
  s(1, 9, "Ragnar Rask", true),
  s(1, 10, "Fly Express"),
  s(2, 2, "Gigant Tider"),
  s(2, 5, "Vardø Storm"),
  s(3, 5, "Mellby Harley"),
  s(3, 7, "Kaley D.C. (US)"),
  s(4, 1, "Baron Tilly"),
  s(5, 2, "Peacekeeper"),
  s(6, 3, "Peggy Boko"),
  s(7, 3, "Blizzard Diamant"),
  s(8, 4, "Dubbel Trubbel"),
];
