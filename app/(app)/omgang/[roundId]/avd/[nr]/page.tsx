import { RaceWorkspace } from "@/components/round/RaceWorkspace";

// S2 Avdelningen. Avdelning och häst läses ur adressen i klienten, så att
// byten inte behöver laddas från servern.
export default function RacePage() {
  return <RaceWorkspace />;
}
