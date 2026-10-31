// Kopian per lopp efter spelstopp (E8 11): enkla kort med fällbladsnummer, namn och
// "Struken". Visar den inlämnade raden som den sparades.

import { FlapNumber } from "@/components/ui/board";
import { legName } from "@/lib/game-type";
import type { RaceDto, SubmittedRowDto } from "@/lib/types";

export function SubmittedRowLegs({ gameType, races, row }: { gameType: string; races: RaceDto[]; row: SubmittedRowDto }) {
  return (
    <div className="slegs">
      {races.map((r) => {
        const nums = row.selections[String(r.leg)] ?? [];
        return (
          <article key={r.id} className="sleg" aria-label={legName(gameType, r.leg)}>
            <div className="sleg-h">
              <h3>{legName(gameType, r.leg)}</h3>
              <span className="num">{nums.length} st</span>
            </div>
            <ul className="sleg-l">
              {nums.map((n) => {
                const s = r.starts.find((x) => x.number === n);
                return (
                  <li key={n} className={s?.scratched ? "scr" : undefined}>
                    <FlapNumber n={n} size="sm" />
                    <span className="sleg-n">{s?.horse.name ?? `Nummer ${n}`}</span>
                    {s?.scratched && <span className="tag">Struken</span>}
                  </li>
                );
              })}
            </ul>
          </article>
        );
      })}
    </div>
  );
}
