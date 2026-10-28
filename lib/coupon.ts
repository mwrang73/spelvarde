// Raden för omgångens spel, V85 eller V75 (specen 6.5 och S6b): rader,
// kostnad, texten för Kopiera rad och kroppen till PUT. Rena funktioner,
// testade i lib/coupon.test.ts. Raden räknas i klienten (lib/tippa.ts, E6);
// servern sparar kupongen (PUT /api/rounds/[id]/coupon) och kontrollerar den.

import { legsFor } from "@/lib/game-type";
import { stockholmParts } from "@/lib/stockholm-time";
import type { AllgMode, LegRoleDto, LegRoleKind, LegRolesDto, ReasonCode } from "@/lib/types";
import type { Result } from "@/lib/validate";

// Avdelningarna som kupongen kan ha (högst 8). Spelformens antal i lib/game-type.ts.
export const LEGS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const DEFAULT_ROW_PRICE = 0.5;
export const DEFAULT_BUDGET = 100;
export const BUDGET_MIN = 0;
export const BUDGET_MAX = 100_000;
// Reglaget i S6b.
export const BUDGET_SLIDER = { min: 20, max: 1000, step: 10 } as const;

// Valda startnummer per avdelning, { 1: [3, 10], 2: [5], … }.
export type Selections = Record<number, number[]>;

const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

// Rader över spelets avdelningar 1..legs (8 för V85, 7 för V75).
export function rowCount(selections: Selections, legs = 8): number {
  let rows = 1;
  for (let leg = 1; leg <= legs; leg++) rows *= selections[leg]?.length ?? 0;
  return rows;
}

export const couponCost = (rows: number, rowPrice: number) => r2(rows * rowPrice);

// "lör 24 okt 2026" för ett datum "2026-10-24".
export function couponDateLabel(date: string): string {
  const p = stockholmParts(new Date(`${date}T12:00:00Z`));
  return `${p.weekdayShort} ${p.day} ${p.monthShort} ${p.year}`;
}

const krText = (x: number) => `${x.toFixed(2).replace(".", ",")} kr`;

// Texten för Kopiera rad (6.5 och E6 6.5.13). Med opts.allgLeg skrivs
// allgarderingen som "Avd 5: alla (1–12)" (med strukna: "alla (1–12, utom 7)")
// över loppets startnummer i opts.numbersByLeg. Utan opts som före E6, så att
// gamla rader kopieras oförändrade.
export type CouponTextOpts = { allgLeg?: number | null; numbersByLeg?: Record<number, { all: number[]; scratched: number[] }> };

const joinOch = (xs: number[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} och ${xs[xs.length - 1]}`);

export function couponText(round: { trackName: string; date: string; gameType: string }, selections: Selections, rowPrice: number, opts?: CouponTextOpts): string {
  const legs = legsFor(round.gameType);
  const rows = rowCount(selections, legs);
  const lines = [`${round.gameType} ${round.trackName} ${couponDateLabel(round.date)}`];
  for (let leg = 1; leg <= legs; leg++) {
    const nums = [...(selections[leg] ?? [])].sort((a, b) => a - b);
    const info = opts?.numbersByLeg?.[leg];
    if (opts?.allgLeg === leg && info && info.all.length) {
      const all = [...info.all].sort((a, b) => a - b);
      const scr = [...new Set(info.scratched)].filter((n) => all.includes(n)).sort((a, b) => a - b);
      lines.push(`Avd ${leg}: alla (${all[0]}–${all[all.length - 1]}${scr.length ? `, utom ${joinOch(scr)}` : ""})`);
      continue;
    }
    lines.push(`Avd ${leg}: ${nums.length ? nums.join(", ") : "–"}`);
  }
  lines.push(`${rows} ${rows === 1 ? "rad" : "rader"} · ${krText(couponCost(rows, rowPrice))}`);
  return lines.join("\n");
}

// ---- Kroppen till PUT /api/rounds/[id]/coupon -----------------------------------------------

// E6-fälten är frivilliga: undefined = saknas i kroppen (behåll det sparade),
// null = töm. Kontrollerna som kräver omgången (SPIK_MAX, legsFor, låsta
// avdelningar, startnumren i copiedSelections, tiden) görs i saveCoupon.
export type CouponInput = {
  budget: number;
  rowPrice: number | null;
  selections: Selections;
  lockedLegs: number[];
  spikCount?: number | null;
  allgMode?: AllgMode | null;
  allgLeg?: number | null;
  legRoles?: LegRolesDto | null;
  copiedAt?: Date | null;
  copiedSelections?: Selections | null;
};

const COUPON_KEYS = ["budget", "rowPrice", "selections", "lockedLegs", "spikCount", "allgMode", "allgLeg", "legRoles", "copiedAt", "copiedSelections"];
// Spikar i databasen: 0–8 (Coupon_spikCount_check). Spelformens tak i saveCoupon.
export const SPIK_COUNT_DB_MAX = 8;
export const LEG_ROLES_MAX_CHARS = 6000;
export const ALLG_MODE_ERROR = "Allgarderingen ska vara Auto eller en vald avdelning.";
export const LEG_ROLES_ERROR = "Ogiltiga skäl i raden.";
export const COPIED_AT_ERROR = "Ogiltig kopieringstid.";

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function parseSelections(sel: unknown, what: string): Result<Selections> {
  if (!sel || typeof sel !== "object" || Array.isArray(sel)) return fail(`${what} ska vara ett objekt med avdelning som nyckel.`);
  const selections: Selections = {};
  for (const [k, v] of Object.entries(sel as Record<string, unknown>)) {
    const leg = Number(k);
    if (!/^[1-8]$/.test(k)) return fail("Avdelningarna är 1–8.");
    if (!Array.isArray(v) || v.length > 30 || !v.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 30)) return fail(`Ogiltiga startnummer i avd ${leg}.`);
    selections[leg] = [...new Set(v as number[])].sort((a, b) => a - b);
  }
  return { ok: true, value: selections };
}

export function parseCouponBody(body: Record<string, unknown>): Result<CouponInput> {
  const unknown = Object.keys(body).filter((k) => !COUPON_KEYS.includes(k));
  if (unknown.length) return fail("Okänt fält i kupongen.");
  const budget = body.budget;
  if (typeof budget !== "number" || !Number.isInteger(budget) || budget < BUDGET_MIN || budget > BUDGET_MAX) return fail("Budgeten ska vara ett heltal mellan 0 och 100 000 kr.");
  let rowPrice: number | null = null;
  if (body.rowPrice !== undefined && body.rowPrice !== null) {
    if (typeof body.rowPrice !== "number" || !Number.isFinite(body.rowPrice) || body.rowPrice < 0.01 || body.rowPrice > 100) return fail("Radpriset ska ligga mellan 0,01 och 100 kr.");
    rowPrice = r2(body.rowPrice);
  }
  const sel = parseSelections(body.selections, "selections");
  if (!sel.ok) return sel;
  const selections = sel.value;
  const lockedRaw = body.lockedLegs ?? [];
  if (!Array.isArray(lockedRaw) || !lockedRaw.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 8)) return fail("lockedLegs ska vara avdelningar 1–8.");
  const lockedLegs = [...new Set(lockedRaw as number[])].sort((a, b) => a - b);
  const out: CouponInput = { budget, rowPrice, selections, lockedLegs };

  if (body.spikCount !== undefined) {
    const v = body.spikCount;
    if (v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > SPIK_COUNT_DB_MAX)) return fail(`Antalet spikar ska vara ett heltal 0–${SPIK_COUNT_DB_MAX}.`);
    out.spikCount = v as number | null;
  }
  if (body.allgMode !== undefined) {
    const v = body.allgMode;
    if (v !== null && v !== "AUTO" && v !== "CHOSEN") return fail(ALLG_MODE_ERROR);
    out.allgMode = v;
  }
  if (body.allgLeg !== undefined) {
    const v = body.allgLeg;
    if (v !== null && (typeof v !== "number" || !Number.isInteger(v))) return fail(ALLG_MODE_ERROR);
    if (typeof v === "number" && (v < 1 || v > 8)) return fail(`Avd ${v} finns inte i omgången.`);
    out.allgLeg = v as number | null;
  }
  if (body.legRoles !== undefined) {
    if (body.legRoles === null) out.legRoles = null;
    else {
      if (JSON.stringify(body.legRoles).length > LEG_ROLES_MAX_CHARS) return fail(LEG_ROLES_ERROR);
      const roles = asLegRoles(body.legRoles);
      if (!roles) return fail(LEG_ROLES_ERROR);
      out.legRoles = roles;
    }
  }
  if (body.copiedAt !== undefined) {
    const v = body.copiedAt;
    if (v === null) out.copiedAt = null;
    else {
      if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) return fail(COPIED_AT_ERROR);
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return fail(COPIED_AT_ERROR);
      out.copiedAt = d;
    }
  }
  if (body.copiedSelections !== undefined) {
    if (body.copiedSelections === null) out.copiedSelections = null;
    else {
      const c = parseSelections(body.copiedSelections, "copiedSelections");
      if (!c.ok) return c;
      out.copiedSelections = c.value;
    }
  }
  if (out.copiedAt && !out.copiedSelections) return fail("Den kopierade raden saknas.");
  return { ok: true, value: out };
}

// ---- legRoles (E6 8.5) ----------------------------------------------------------------------

const ROLE_KINDS: readonly LegRoleKind[] = ["OPEN", "SPIK", "OWN_SPIK", "OWN", "ALLG", "CANCELLED"];
const REASON_CODES: readonly ReasonCode[] = ["PRE", "T3", "MEL", "SKR", "LOW", "NOMEL", "FEL", "SIG4", "SIG5", "SIG6", "SIG7", "SIG8", "SIG9", "SIG10", "FAV"];
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isNr = (x: unknown) => typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= 30;

// Tolkar legRoles (version 1). null vid fel form: okänd version, avdelning
// utanför 1–8, okänd typ eller kod, eller okända nycklar.
export function asLegRoles(x: unknown): LegRolesDto | null {
  if (!isObj(x) || x.v !== 1 || typeof x.prelim !== "boolean" || typeof x.favLimit !== "number" || !Number.isInteger(x.favLimit) || x.favLimit < 0 || x.favLimit > 8 || !isObj(x.legs)) return null;
  if (Object.keys(x).some((k) => !["v", "prelim", "favLimit", "legs"].includes(k))) return null;
  const legs: Record<string, LegRoleDto> = {};
  for (const [leg, raw] of Object.entries(x.legs)) {
    if (!/^[1-8]$/.test(leg) || !isObj(raw)) return null;
    if (Object.keys(raw).some((k) => !["k", "h", "favOut", "fav"].includes(k))) return null;
    if (!ROLE_KINDS.includes(raw.k as LegRoleKind)) return null;
    const role: LegRoleDto = { k: raw.k as LegRoleKind };
    if (raw.h !== undefined) {
      if (!isObj(raw.h)) return null;
      const h: Record<string, ReasonCode[]> = {};
      for (const [n, codes] of Object.entries(raw.h)) {
        if (!/^\d{1,2}$/.test(n) || !isNr(Number(n))) return null;
        if (!Array.isArray(codes) || codes.length > REASON_CODES.length || !codes.every((c) => REASON_CODES.includes(c as ReasonCode))) return null;
        h[n] = codes as ReasonCode[];
      }
      role.h = h;
    }
    if (raw.favOut !== undefined) {
      if (!isNr(raw.favOut)) return null;
      role.favOut = raw.favOut as number;
    }
    if (raw.fav !== undefined) {
      if (!isNr(raw.fav)) return null;
      role.fav = raw.fav as number;
    }
    legs[leg] = role;
  }
  return { v: 1, prelim: x.prelim, favLimit: x.favLimit, legs };
}

// Tolkar Coupon.selections (JSON) från databasen.
export function asSelections(x: unknown): Selections {
  const out: Selections = {};
  if (!x || typeof x !== "object" || Array.isArray(x)) return out;
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (/^[1-8]$/.test(k) && Array.isArray(v)) out[Number(k)] = v.filter((n): n is number => typeof n === "number" && Number.isInteger(n));
  }
  return out;
}

export const sameNumbers = (a: number[] | undefined, b: number[] | undefined) => {
  const x = [...(a ?? [])].sort((p, q) => p - q);
  const y = [...(b ?? [])].sort((p, q) => p - q);
  return x.length === y.length && x.every((n, i) => n === y[i]);
};
