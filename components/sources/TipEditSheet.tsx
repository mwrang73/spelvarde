"use client";

// Rätta tips (E5 S8, mockupskärm 4): välj häst och roll, Spara och godkänn
// eller Ta bort tipset. Bottenark i mobilen och dialog (480 px) på desktop.
// Öppnas från granskningen, Godkända och hästkortets Tips (S3).

import { useEffect, useId, useRef, useState } from "react";
import { ApiFailure } from "@/components/api";
import { useOnline } from "@/components/hooks";
import { Quote } from "@/components/tips/RoleTag";
import { IconWarn } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { hhmm, shortRaceName } from "@/lib/format";
import { tipHorse } from "@/lib/tips-ui";
import { ROLE_LABEL, TIP_ROLES } from "@/lib/tips/roles";
import type { RaceDto, TipActionResponse, TipDto, TipRole } from "@/lib/types";
import { tipActions } from "./tipsStore";

const startedRace = (r: RaceDto) => r.started || Date.parse(r.startAt) <= Date.now();

export function errText(e: unknown, fallback: string): string {
  if (e instanceof ApiFailure && e.code === "RACE_STARTED") return "Loppet har startat. Tipset kan inte ändras.";
  return e instanceof Error ? e.message : fallback;
}

export function TipEditSheet({
  roundId,
  tip,
  races,
  onClose,
  onSaved,
  onRemoved,
}: {
  roundId: string;
  tip: TipDto | null;
  races: RaceDto[] | null;
  onClose: () => void;
  onSaved?: (tip: TipDto, res: TipActionResponse) => void;
  onRemoved?: (tip: TipDto) => void;
}) {
  return (
    <Sheet open={!!tip} onClose={onClose} title="Rätta tips" className="narrow">
      {tip && <EditForm key={tip.id} roundId={roundId} tip={tip} races={races} onClose={onClose} onSaved={onSaved} onRemoved={onRemoved} />}
    </Sheet>
  );
}

function EditForm({
  roundId,
  tip,
  races,
  onClose,
  onSaved,
  onRemoved,
}: {
  roundId: string;
  tip: TipDto;
  races: RaceDto[] | null;
  onClose: () => void;
  onSaved?: (tip: TipDto, res: TipActionResponse) => void;
  onRemoved?: (tip: TipDto) => void;
}) {
  const [startId, setStartId] = useState<string>(tip.startId ?? tip.suggestion?.startId ?? "");
  const [role, setRole] = useState<TipRole>(tip.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const online = useOnline();
  const toast = useToast();
  const selRef = useRef<HTMLSelectElement>(null);
  const roleRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const fid = useId();

  useEffect(() => {
    const t = window.setTimeout(() => selRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, []);

  const horseName = (() => {
    for (const r of races ?? []) for (const s of r.starts) if (s.id === startId) return s.horse.name;
    return tipHorse(tip);
  })();

  const save = async () => {
    if (!startId) return;
    setBusy(true);
    setError(null);
    try {
      const body: { startId?: string; role?: TipRole } = { role };
      if (startId !== tip.startId) body.startId = startId;
      const res = await tipActions.edit(roundId, tip, body);
      onClose();
      onSaved?.(tip, res);
      toast({
        text: res.message ?? `Tipset om ${horseName} är rättat och godkänt.`,
        action: { label: "Ångra", onClick: () => void tipActions.undo(roundId, [tip.id]).catch((e: unknown) => toast({ text: errText(e, "Kunde inte ångra.") })) },
      });
    } catch (e) {
      setError(errText(e, "Kunde inte spara tipset."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await tipActions.remove(roundId, tip);
      onClose();
      onRemoved?.(tip);
      toast({
        text: `Tipset om ${tipHorse(tip)} är borttaget.`,
        action: { label: "Ångra", onClick: () => void tipActions.undo(roundId, [tip.id]).catch((e: unknown) => toast({ text: errText(e, "Kunde inte ångra.") })) },
      });
    } catch (e) {
      setError(errText(e, "Kunde inte ta bort tipset."));
    } finally {
      setBusy(false);
    }
  };

  const onRoleKey = (e: React.KeyboardEvent) => {
    const i = TIP_ROLES.indexOf(role);
    let to: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") to = (i + 1) % TIP_ROLES.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") to = (i + TIP_ROLES.length - 1) % TIP_ROLES.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = TIP_ROLES.length - 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    setRole(TIP_ROLES[to]);
    roleRefs.current[to]?.focus();
  };

  const missing = !startId;
  return (
    <div className="tedit">
      <div className="field">
        <label className="flbl" htmlFor={`${fid}-h`}>
          Häst
        </label>
        <span className="tsel-w">
          <select
            id={`${fid}-h`}
            ref={selRef}
            className="tsel"
            value={startId}
            onChange={(e) => setStartId(e.target.value)}
            aria-invalid={missing ? true : undefined}
            aria-describedby={missing ? `${fid}-he` : undefined}
          >
            <option value="">Välj häst</option>
            {(races ?? []).map((r) => {
              const started = startedRace(r);
              return (
                <optgroup key={r.id} label={`Avd ${r.leg} · ${hhmm(r.startAt)} · ${r.classLabel ?? shortRaceName(r.name)}`}>
                  {r.starts.map((s) => (
                    <option key={s.id} value={s.id} disabled={started}>
                      {s.number} {s.horse.name}
                      {s.scratched ? " (struken)" : ""}
                      {started ? " (startat)" : ""}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </span>
        {missing && (
          <span className="err-msg" id={`${fid}-he`}>
            <IconWarn />
            Välj vilken häst tipset gäller.
          </span>
        )}
      </div>
      <div className="field">
        <span className="flbl" id={`${fid}-r`}>
          Roll
        </span>
        <div className="rolepick" role="radiogroup" aria-labelledby={`${fid}-r`} onKeyDown={onRoleKey}>
          {TIP_ROLES.map((r, i) => (
            <button
              key={r}
              ref={(el) => {
                roleRefs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={r === role}
              tabIndex={r === role ? 0 : -1}
              onClick={() => setRole(r)}
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="flbl">Citat från artikeln</span>
        <Quote quote={tip.quote} word={tip.roleWord} />
      </div>
      <div className="shbtns">
        <button type="button" className="btn primary" disabled={missing || busy || !online} title={!online ? "Ingen uppkoppling" : undefined} onClick={() => void save()}>
          {busy ? "Sparar …" : "Spara och godkänn"}
        </button>
        <button type="button" className="btn ghost" disabled={busy || !online} title={!online ? "Ingen uppkoppling" : undefined} onClick={() => void remove()}>
          Ta bort tipset
        </button>
      </div>
      {error && (
        <p className="err-msg" role="alert">
          <IconWarn />
          {error}
        </p>
      )}
    </div>
  );
}
