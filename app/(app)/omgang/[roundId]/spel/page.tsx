import { Spelforslag } from "@/components/spel/Spelforslag";

// S6 Spelförslag: Platsspel | V85-rad (?flik=plats|rad). Fliken byts sedan i
// klienten utan omladdning.
export default function SpelPage({ searchParams }: { searchParams: { flik?: string } }) {
  return <Spelforslag initialTab={searchParams.flik === "rad" ? "rad" : "plats"} />;
}
