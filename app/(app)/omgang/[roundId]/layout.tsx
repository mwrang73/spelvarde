import { RoundProvider } from "@/components/round/RoundProvider";

// Omgångens cache delas av S1, S2 och S3 för samma omgång och ligger kvar
// när Mikael byter avdelning och häst.
export default function RoundLayout({ params, children }: { params: { roundId: string }; children: React.ReactNode }) {
  return <RoundProvider roundId={params.roundId}>{children}</RoundProvider>;
}
