// Rolltaggen (E5 6.11, .role), den lilla taggen i avdelningens underrad
// (S2, .tipt) och citatet med rollordet markerat. Ordet bär informationen,
// inte färgen.

import { markWord, ROLE_CLASS, roleLabel } from "@/lib/tips-ui";
import type { StartTipDto, TipRole } from "@/lib/types";

export function RoleTag({ role, struck }: { role: TipRole; struck?: boolean }) {
  return <span className={`role ${ROLE_CLASS[role]}`}>{struck ? <s>{roleLabel(role)}</s> : roleLabel(role)}</span>;
}

// "Spik" / "Spik · 2". Struken häst: ingen tagg.
export function TipTag({ tip }: { tip: StartTipDto | null | undefined }) {
  if (!tip) return null;
  const label = roleLabel(tip.role);
  return (
    <span className="tipt" role="img" aria-label={tip.sources > 1 ? `Tips: ${label}, från ${tip.sources} källor` : `Tips: ${label}`}>
      {label}
      {tip.sources > 1 && ` · ${tip.sources}`}
    </span>
  );
}

export function Quote({ quote, word, plain, className }: { quote: string; word: string | null; plain?: boolean; className?: string }) {
  const parts = markWord(quote, word);
  return (
    <blockquote className={`quote${plain ? " qflat" : ""}${className ? ` ${className}` : ""}`}>
      <span className="sr">Citat: </span>
      {parts ? (
        <>
          {parts[0]}
          <mark>{parts[1]}</mark>
          {parts[2]}
        </>
      ) : (
        quote
      )}
    </blockquote>
  );
}
