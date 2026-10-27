import { RoundAnalysisView } from "@/components/analysis/RoundAnalysisView";

// Efteranalysen för omgången (mockupen efteranalys-tips, del 1 A).
export default function AnalysPage({ params }: { params: { roundId: string } }) {
  return <RoundAnalysisView roundId={params.roundId} />;
}
