"use client";

// Fliken Resultat när resultatet finns men är dolt (E8 8.3). Inget annat visas.

import { EmptyState } from "@/components/ui/board";
import { IconFlag } from "@/components/ui/icons";
import { legName } from "@/lib/game-type";

export function ResultGate({ gameType, leg, onReveal }: { gameType: string; leg: number; onReveal: () => void }) {
  return (
    <EmptyState icon={<IconFlag />} title={`Resultatet för ${legName(gameType, leg)} är dolt.`} text="Tryck på Visa resultat när du är redo. Det ligger sedan kvar tills du trycker Dölj resultat.">
      <button type="button" className="btn primary" onClick={onReveal}>
        Visa resultat
      </button>
    </EmptyState>
  );
}
