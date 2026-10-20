import { Spelforslag } from "@/components/spel/Spelforslag";

// S6 Spelförslag: Trollspöt | Platsspel | V85-rad (?flik=trollspot|plats|rad).
// Fliken byts sedan i klienten utan omladdning.
export default function SpelPage({ searchParams }: { searchParams: { flik?: string } }) {
  const f = searchParams.flik;
  return <Spelforslag initialTab={f === "rad" ? "rad" : f === "trollspot" ? "trollspot" : "plats"} />;
}
