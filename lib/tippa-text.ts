// Texterna för V85-raden (docs/specs/e6-v85-rad.md, S6b, Lägen och Texter).
// Rena funktioner över TippaResult från lib/tippa.ts, testade i
// lib/tippa-text.test.ts.
//
// Fetstil markeras med **…** i texterna. boldParts delar upp en text i delar
// som gränssnittet visar med <b>.

import { sameNumbers } from "@/lib/coupon";
import { relTime } from "@/lib/format";
import type { ReasonCode } from "@/lib/types";
import type { LegKind, TippaHorse, TippaLegResult, TippaResult, TippaSuggestion } from "@/lib/tippa";

// ---- Format ------------------------------------------------------------------------------------

const dec = (x: number, d: number) => x.toFixed(d).replace(".", ",");
// "288,00 kr"
export const krText = (x: number) => `${dec(x, 2)} kr`;
// "288,00 kronor" (skärmläsaren)
const kronor = (x: number) => `${dec(x, 2)} kronor`;
// Hela kronor: "300 kr", "1 000 kr"
export const wholeKr = (x: number) => `${String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} kr`;
// "31,0 %"
export const pctText = (x: number | null) => (x === null ? "–" : `${dec(x, 1)} %`);
// "1,22"
export const riktText = (x: number | null) => (x === null ? "–" : dec(x, 2));
// "2, 8 och 6"
export function joinSv(items: (string | number)[]): string {
  const s = items.map(String);
  if (s.length <= 1) return s.join("");
  return `${s.slice(0, -1).join(", ")} och ${s[s.length - 1]}`;
}
const horseName = (h: { number: number; name: string }) => `${h.number} ${h.name}`;
const rowsText = (n: number) => `${n} ${n === 1 ? "rad" : "rader"}`;

export type BoldPart = { text: string; bold: boolean };
export function boldParts(text: string): BoldPart[] {
  return text
    .split("**")
    .map((t, i) => ({ text: t, bold: i % 2 === 1 }))
    .filter((p) => p.text);
}

// ---- Skälen ------------------------------------------------------------------------------------

export function reasonLabel(code: ReasonCode): string {
  switch (code) {
    case "PRE":
      return "Prel.";
    case "T3":
      return "Topp 3";
    case "MEL":
      return "Mellan";
    case "SKR":
      return "Skräll";
    case "LOW":
      return "Ingen under 5 %";
    case "NOMEL":
      return "Ingen mellan";
    case "FEL":
      return "Felstreckad";
    case "FAV":
      return "Favorit";
    default:
      return `${code.slice(3)} signaler`;
  }
}

// Klassen på taggen: .rs.pre, .rs.t3, .rs.mel, .rs.skr, .rs.wrn, .rs.fel, .rs.sig, .rs.fav.
export function reasonClass(code: ReasonCode): string {
  if (code === "PRE") return "pre";
  if (code === "T3") return "t3";
  if (code === "MEL") return "mel";
  if (code === "SKR") return "skr";
  if (code === "LOW" || code === "NOMEL") return "wrn";
  if (code === "FEL") return "fel";
  if (code === "FAV") return "fav";
  return "sig";
}

// ---- Regler för raden: Spikar ------------------------------------------------------------------

export function spikHelp(r: TippaResult): string {
  if (r.noRikt) return "Riktodds saknas, så appen väljer inga spikar. Du kan välja egna.";
  let t: string;
  if (r.spikEffective === 0) t = "Inga spikar. Alla lopp utom allgarderingen får minst 3 hästar.";
  else if (r.appSpikes === 0) t = r.ownSpikes === 1 ? "Spiken är din egen." : `Alla ${r.ownSpikes} är dina egna.`;
  else if (r.appSpikes === 1) t = `Appen väljer 1, i loppet där modellen är säkrast: avd ${r.spikLegs[0]}.`;
  else t = `Appen väljer ${r.appSpikes}, i de lopp där modellen är säkrast: avd ${joinSv(r.spikLegs)}.`;
  if (r.skippedSpik.length) {
    const many = r.skippedSpik.length > 1;
    t += ` Avd ${joinSv(r.skippedSpik)} hoppades över: ${many ? "spikarna där vore favoriten" : "spiken där vore favoriten"}, och favoritspärren är full.`;
  }
  if (r.spikMax < r.spikCap) t += ` Högst ${r.spikMax} ${r.spikMax === 1 ? "spik" : "spikar"} nu: övriga lopp är dina egna val, allgarderingen, inställda eller saknar riktodds.`;
  return t;
}

// "1 av 4"
export const ownSpikValue = (r: TippaResult) => `${r.ownSpikes} av ${r.spikEffective}`;

// ---- Allgardering ------------------------------------------------------------------------------

const legOf = (r: TippaResult, leg: number | null) => (leg === null ? undefined : r.legs.find((l) => l.leg === leg));

export function allgHelp(r: TippaResult): string {
  const l = legOf(r, r.allgLeg);
  if (!l) return "Ingen avdelning kan allgarderas: alla är dina egna val eller inställda.";
  if (r.allgFallback && r.allgRequested !== null) {
    const why = r.allgFallback === "LOCKED" ? "är låst" : r.allgFallback === "CANCELLED" ? "är inställd" : "kan inte allgarderas";
    return `Din valda avd ${r.allgRequested} ${why}, så appen valde avd ${l.leg}.`;
  }
  const fav = l.favorite;
  if (r.allgAuto) {
    if (l.prelim || !fav) return `Avd ${l.leg}, mest öppna loppet enligt modellen.`;
    return `Avd ${l.leg}, mest öppna loppet. Favoriten har **${pctText(fav.streck)}**.`;
  }
  if (!fav) return `Avd ${l.leg}, ditt val.`;
  return `Avd ${l.leg}, ditt val. Favoriten har **${pctText(l.prelim ? fav.share : fav.streck)}**${l.prelim ? " enligt modellen" : ""}.`;
}

// ---- Favoritspärren ----------------------------------------------------------------------------

export const favOverLimit = (r: TippaResult) => r.favCount > r.favLimit;

// "4 av 8" eller "5 av 8 · över"
export const favValue = (r: TippaResult) => `${r.favCount} av ${r.legCount}${favOverLimit(r) ? " · över" : ""}`;

export function favHelp(r: TippaResult): string {
  const n = Math.max(r.favCount, r.forcedFav);
  if (r.favOver === "SPIKES") return `Spikarna kräver favoriten i ${n} lopp, över spärren på ${r.favLimit}. Välj färre spikar för att hålla spärren.`;
  if (r.favOver === "OWN") return `Dina egna val har favoriten i ${n} lopp, över spärren på ${r.favLimit}. Inget blockeras.`;
  const base = `Favoriten (mest streckad) får vara med i högst **${r.favLimit} lopp på ${r.gameType}**.`;
  if (!r.favBanned.length) return base;
  return `${base} Bortvald i avd ${joinSv(r.favBanned)}, där modellen tror minst på den.`;
}

export type FavCell = { leg: number; state: "on" | "out" | "none" | "cancelled"; small: string };

// Remsan .favs: en ruta per avdelning.
export function favStrip(r: TippaResult): FavCell[] {
  return r.legs.map((l) => {
    if (l.kind === "CANCELLED") return { leg: l.leg, state: "cancelled", small: "inst" };
    if (l.favorite && l.selection.includes(l.favorite.number)) return { leg: l.leg, state: "on", small: "✓ fav" };
    if (l.favBanned) return { leg: l.leg, state: "out", small: "spärr" };
    return { leg: l.leg, state: "none", small: "–" };
  });
}

export function favStripLabel(r: TippaResult): string {
  const cells = favStrip(r);
  const on = cells.filter((c) => c.state === "on").map((c) => c.leg);
  const out = cells.filter((c) => c.state === "out").map((c) => c.leg);
  const parts: string[] = [];
  parts.push(on.length ? `Favoriten är med i avdelning ${joinSv(on)}.` : "Favoriten är inte med i någon avdelning.");
  if (out.length) parts.push(`Bortvald av spärren i avdelning ${joinSv(out)}.`);
  parts.push(`Högst ${r.favLimit} på ${r.gameType}.`);
  return parts.join(" ");
}

// ---- Avdelningskortet --------------------------------------------------------------------------

// Typtaggen .lr. started = efter spelstopp.
export function legTypeLabel(l: TippaLegResult, started = false): string {
  if (started) return "Startat";
  switch (l.kind) {
    case "SPIK":
      return "Spik";
    case "OWN_SPIK":
      return "Egen spik";
    case "OWN":
      return "Eget val";
    case "ALLG":
      return `Alla ${l.selection.length}`;
    case "CANCELLED":
      return "Inställt";
    case "NO_STARTERS":
      return "0 hästar";
    default:
      return l.selection.length === 1 ? "1 häst" : `${l.selection.length} hästar`;
  }
}

// Raden under rubriken: "12 startande · fav 31,0 %".
export function legSubline(l: TippaLegResult): string {
  if (l.kind === "CANCELLED") return "Inställt";
  const n = `${l.field.length} startande`;
  if (l.prelim) return `${n} · streck saknas`;
  return l.favorite ? `${n} · fav ${pctText(l.favorite.streck)}` : n;
}

export function legWhy(r: TippaResult, leg: number): string | null {
  const l = legOf(r, leg);
  if (!l) return null;
  const fav = l.favorite;
  switch (l.kind) {
    case "SPIK": {
      const h = l.horses[0];
      let t = l.spikRank === 0 ? `Säkrast enligt modellen: rikt **${riktText(h.riktX)}**, lägst av loppen som kunde bli spik.` : `Säkrast enligt modellen: rikt **${riktText(h.riktX)}**.`;
      if (fav && fav.number !== h.number) t += ` Favoriten ${horseName(fav)} har rikt **${riktText(fav.riktX)}** (${pctText(l.prelim ? fav.share : fav.streck)}).`;
      return t;
    }
    case "OWN_SPIK":
      return "Din spik. Avdelningen är låst och räknas inte om.";
    case "OWN":
      return "Ditt val. Avdelningen är låst och räknas inte om.";
    case "ALLG": {
      if (!fav) return null;
      const v = pctText(l.prelim ? fav.share : fav.streck);
      if (!r.allgAuto) return `Ditt val av allgardering. Favoriten **${horseName(fav)}** har **${v}**${l.prelim ? " enligt modellen" : ""}.`;
      const wide = l.field.filter((h) => h.v >= 5 - 1e-9).length;
      return `Mest öppna loppet${l.prelim ? " enligt modellen" : ""}: favoriten **${horseName(fav)}** har **${v}**, lägst av omgångens favoriter. ${wide} ${wide === 1 ? "häst har" : "hästar har"} minst 5 %.`;
    }
    case "CANCELLED":
      return "Loppet är inställt. Hos ATG räknas alla hästar som vinnare, så en häst räcker.";
    case "OPEN":
      if (!l.few) return null;
      if (l.field.length === 1) return "Bara 1 startande. Den är med.";
      if (l.field.length === 2) return "Bara 2 startande. Båda är med.";
      return `Bara ${l.field.length} startande. Alla är med.`;
    default:
      return null;
  }
}

// Varför-raden efter spelstopp, ur den sparade typen (legRoles).
export function legWhyStarted(kind: LegKind | undefined): string | null {
  if (kind === "SPIK") return "Spik vid spelstopp.";
  if (kind === "OWN_SPIK") return "Egen spik vid spelstopp.";
  if (kind === "ALLG") return "Allgardering vid spelstopp.";
  return null;
}

// Spärrraden .lg-x (bara när favoriten är spärrad i en öppen avdelning).
export function favOutText(r: TippaResult, leg: number): string | null {
  const l = legOf(r, leg);
  if (!l || !l.favBanned || !l.favorite) return null;
  const f = l.favorite;
  const who = l.prelim ? `**${horseName(f)}**, favorit enligt modellen.` : `**${horseName(f)}**, favorit ${pctText(f.streck)}.`;
  return `Ej med: ${who} Favoritspärren: modellen tror minst på den jämfört med strecket (rikt **${riktText(f.riktX)}**).`;
}

// "27 hästar · 576 rader"
export const listSummary = (r: TippaResult) => `${r.horses} ${r.horses === 1 ? "häst" : "hästar"} · ${rowsText(r.rows)}`;

// Desktop: "27 hästar · spikar i avd 2, 4, 6 och 8 · allgardering i avd 5 · favoriten bortvald i avd 1 och 7".
export function desktopSummary(r: TippaResult): string {
  const parts = [`${r.horses} ${r.horses === 1 ? "häst" : "hästar"}`];
  const spikes = [...r.spikLegs, ...r.ownSpikLegs].sort((a, b) => a - b);
  if (spikes.length) parts.push(`${spikes.length === 1 ? "spik" : "spikar"} i avd ${joinSv(spikes)}`);
  if (r.allgLeg !== null) parts.push(`allgardering i avd ${r.allgLeg}`);
  if (r.favBanned.length) parts.push(`favoriten bortvald i avd ${joinSv(r.favBanned)}`);
  return parts.join(" · ");
}

// ---- Budgeten ----------------------------------------------------------------------------------

export function rulesDontFitText(r: TippaResult): string {
  const spik = r.spikEffective === 0 ? "Inga spikar" : r.spikEffective === 1 ? "1 spik" : `${r.spikEffective} spikar`;
  const parts = [spik];
  const allg = legOf(r, r.allgLeg);
  if (allg) parts.push(`allgardering av avd ${allg.leg} (${allg.selection.length} hästar)`);
  for (const l of r.legs.filter((x) => x.kind === "OWN")) parts.push(`ditt eget val i avd ${l.leg} (${l.selection.length} hästar)`);
  const open = r.legs.filter((l) => l.kind === "OPEN");
  let head: string;
  if (open.length) {
    const los = open.map((l) => l.lo);
    const lo = Math.min(...los) === Math.max(...los) ? `${los[0]}` : `${Math.min(...los)}–${Math.max(...los)}`;
    const where = open.length === 1 ? "i det andra loppet" : `i de ${open.length} andra loppen`;
    head = `${parts.join(", ")} och minst ${lo} ${lo === "1" ? "häst" : "hästar"} ${where}`;
  } else {
    head = parts.join(", ");
  }
  return `**Reglerna ryms inte i ${wholeKr(r.budget)}.** ${head} ger minst ${rowsText(r.minRows)}, alltså ${krText(r.minCost)}. Ingen ny rad föreslås förrän det ryms.`;
}

export function ownOverText(r: TippaResult): string {
  const own = r.legs.filter((l) => l.kind === "OWN").sort((a, b) => b.selection.length - a.selection.length || a.leg - b.leg);
  const head =
    own.length === 1
      ? `**Avd ${own[0].leg} med ${own[0].selection.length} hästar ryms inte.**`
      : `**Dina egna val i avd ${joinSv(own.map((l) => l.leg).sort((a, b) => a - b))} ryms inte.**`;
  return `${head} Även när de andra loppen har minsta antal blir raden ${rowsText(r.rows)} · ${krText(r.cost)}. Ingenting blockeras, men raden är över budget.`;
}

// Budgetrutans "Behövs minst" och raden under: "Reglerna kräver minst 324 rader".
export const minRowsLine = (r: TippaResult) => `Reglerna kräver minst ${rowsText(r.minRows)}`;
// Kvar (positivt) eller över budget (negativt), i kronor med två decimaler.
export const leftOf = (r: Pick<TippaResult, "budget" | "cost">) => Math.round((r.budget - r.cost) * 100) / 100;

export function suggestionLabel(s: TippaSuggestion): string {
  if (s.kind === "BUDGET") return `Höj till ${wholeKr(s.budget)}`;
  if (s.kind === "SPIKES") return `${s.spikCount} spikar · minst ${krText(s.minCost)}`;
  return `Ändra avd ${s.leg}`;
}

export function suggestionToast(s: TippaSuggestion): string | null {
  if (s.kind === "BUDGET") return `Budgeten är ${wholeKr(s.budget)} · Ångra`;
  if (s.kind === "SPIKES") return `${s.spikCount} spikar · Ångra`;
  return null;
}

// Vyns live-region (Tillgänglighet).
export function liveSummary(r: TippaResult): string {
  if (r.status === "RULES_DONT_FIT") return `Reglerna ryms inte i ${r.budget} kronor. Behövs minst ${kronor(r.minCost)}.`;
  const left = leftOf(r);
  const head = `${rowsText(r.rows)}, ${kronor(r.cost)}.`;
  if (left < 0) return `${head} Över budget med ${kronor(-left)}.`;
  const spik = r.spikEffective === 1 ? "1 spik." : `${r.spikEffective} spikar.`;
  return `${spik} ${head} Kvar ${kronor(left)}.`;
}

// ---- Förhandsvisningen i arket Ändra avdelning (6.5.11) ----------------------------------------

const MAX_LEG_SENTENCES = 3;

// before = raden innan arket öppnades, after = med den tänkta låsningen av leg.
// picked = valda hästar i arket (tom = ingen häst vald).
export function previewChangeText(before: TippaResult, after: TippaResult, leg: number, picked?: number[]): string {
  if (picked && picked.length === 0) return "Ingen häst vald. Stänger du arket väljer appen avdelningen igen.";
  const sentences: string[] = [];
  const legSentences: string[] = [];
  for (const a of after.legs) {
    if (a.leg === leg) continue;
    const b = legOf(before, a.leg);
    if (!b || b.kind !== "OPEN" || a.kind !== "OPEN" || sameNumbers(a.selection, b.selection)) continue;
    const name = (n: number) => {
      const h = b.field.find((x) => x.number === n) ?? a.field.find((x) => x.number === n);
      return h ? horseName(h) : String(n);
    };
    const added = a.selection.filter((n) => !b.selection.includes(n)).map(name);
    const removed = b.selection.filter((n) => !a.selection.includes(n)).map(name);
    const what = [added.length ? `${joinSv(added)} kommer med` : "", removed.length ? `${joinSv(removed)} tas bort` : ""].filter(Boolean).join(", ");
    if (a.selection.length === b.selection.length) legSentences.push(`Avd ${a.leg} byter häst (${what}).`);
    else if (a.selection.length < b.selection.length) legSentences.push(`Avd ${a.leg} går från ${b.selection.length} till ${a.selection.length} hästar (${what}) för att raden ska komma nära **${wholeKr(after.budget)}**.`);
    else legSentences.push(`Avd ${a.leg} går från ${b.selection.length} till ${a.selection.length} hästar (${what}).`);
  }
  sentences.push(...legSentences.slice(0, MAX_LEG_SENTENCES));
  if (legSentences.length > MAX_LEG_SENTENCES) {
    const rest = legSentences.length - MAX_LEG_SENTENCES;
    sentences.push(`… och ${rest} ${rest === 1 ? "avdelning" : "avdelningar"} till.`);
  }
  const removedSpik = before.spikLegs.filter((x) => !after.spikLegs.includes(x));
  const addedSpik = after.spikLegs.filter((x) => !before.spikLegs.includes(x));
  const pairs = Math.min(removedSpik.length, addedSpik.length);
  for (let i = 0; i < pairs; i++) sentences.push(`Spiken flyttar från avd ${removedSpik[i]} till avd ${addedSpik[i]}.`);
  for (const x of addedSpik.slice(pairs)) sentences.push(`Avd ${x} blir spik.`);
  for (const x of removedSpik.slice(pairs)) if (x !== leg) sentences.push(`Avd ${x} är inte längre spik.`);
  if (after.allgLeg !== before.allgLeg && after.allgLeg !== null) sentences.push(`Allgarderingen flyttar till avd ${after.allgLeg}.`);
  if (after.spikEffective !== before.spikEffective) sentences.push(`Antal spikar blir ${after.spikEffective}.`);
  sentences.push("Övriga avdelningar ändras inte.");
  const left = leftOf(after);
  if (after.status !== "RULES_DONT_FIT" && left < 0) sentences.push(`Raden blir ${rowsText(after.rows)} · ${krText(after.cost)}, över budget med ${krText(-left)}.`);
  return sentences.join(" ");
}

// Förhandsrutans vänstra värde i A4: "5 hästar · låst", "1 häst · egen spik", "Ingen häst vald".
export function previewPickedLabel(n: number): string {
  if (n === 0) return "Ingen häst vald";
  if (n === 1) return "1 häst · egen spik";
  return `${n} hästar · låst`;
}

// ---- Strykningar (Lägen) -----------------------------------------------------------------------

export type SavedRow = { selections: Record<string, number[]>; rows: number; cost: number };

const groupLabel = (h: TippaHorse | undefined) => {
  const c = h?.reasons.find((x) => x === "T3" || x === "MEL" || x === "SKR" || x === "LOW" || x === "NOMEL");
  return c === "T3" ? "Topp 3" : c === "MEL" || c === "NOMEL" ? "Mellan" : c === "SKR" || c === "LOW" ? "Skräll" : null;
};

// Struken häst i en avdelning som appen fyller: number var med i den sparade
// raden och är nu struken.
export function scratchNotice(saved: SavedRow, after: TippaResult, leg: number, number: number): string {
  const l = legOf(after, leg);
  const s = l?.scratched.find((x) => x.number === number);
  const who = s ? horseName(s) : String(number);
  const before = saved.selections[String(leg)] ?? [];
  const added = (l?.selection ?? []).filter((n) => !before.includes(n)).map((n) => l!.horses.find((h) => h.number === n)!);
  let mid = "Den togs bort.";
  if (added.length) {
    const g = added.length === 1 ? groupLabel(added[0]) : null;
    mid = `Den togs bort, och ${joinSv(added.map(horseName))} kom med i stället${g ? ` som ${g}` : ""}.`;
  }
  const same = saved.rows === after.rows && Math.abs(saved.cost - after.cost) < 1e-9;
  const tail = same ? `Raden är fortfarande ${rowsText(after.rows)} · ${krText(after.cost)}.` : `Raden är nu ${rowsText(after.rows)} · ${krText(after.cost)}.`;
  return `**${who} i avd ${leg} är struken.** ${mid} ${tail}`;
}

export type ScratchNoticeKind = "SCRATCHED" | "OWN_SPIK" | "OWN_REMOVED" | "OWN_ALL" | "NO_STARTERS";
export type ScratchNoticeItem = { kind: ScratchNoticeKind; leg: number; numbers: number[]; tone: "warn" | "err"; role: "status" | "alert"; text: string };

// Alla strykningsbanderoller för raden, i avdelningsordning. saved = senast
// sparade raden (null = ingen sparad rad: bara felen visas).
export function scratchNotices(saved: SavedRow | null, after: TippaResult): ScratchNoticeItem[] {
  const out: ScratchNoticeItem[] = [];
  for (const l of after.legs) {
    const name = (n: number) => {
      const s = l.scratched.find((x) => x.number === n);
      return s ? horseName(s) : String(n);
    };
    if (l.struckOwnSpik) {
      out.push({ kind: "OWN_SPIK", leg: l.leg, numbers: l.selection, tone: "err", role: "alert", text: `**Din spik ${name(l.selection[0])} i avd ${l.leg} är struken.** Hos ATG ersätts den med reservhästen. Välj en ny spik, eller låt appen välja.` });
      continue;
    }
    if (l.kind === "NO_STARTERS") {
      out.push({ kind: "NO_STARTERS", leg: l.leg, numbers: [], tone: "err", role: "alert", text: `**Avd ${l.leg} har inga startande hästar.** Raden kan inte kopieras förrän loppet är inställt hos ATG. Hämta omgången igen.` });
      continue;
    }
    if (l.struckRemoved.length) {
      const n = l.struckRemoved;
      const verb = n.length === 1 ? "är struken" : "är strukna";
      out.push({ kind: "OWN_REMOVED", leg: l.leg, numbers: n, tone: "warn", role: "status", text: `**${joinSv(n.map(name))} i avd ${l.leg} ${verb}** och togs bort ur ditt val.` });
      continue;
    }
    if (l.unlocked) {
      out.push({ kind: "OWN_ALL", leg: l.leg, numbers: l.scratched.map((s) => s.number), tone: "warn", role: "status", text: `**Alla dina hästar i avd ${l.leg} är strukna.** Appen väljer avdelningen igen.` });
      continue;
    }
    if (!saved || (l.kind !== "OPEN" && l.kind !== "SPIK" && l.kind !== "ALLG")) continue;
    const prev = saved.selections[String(l.leg)] ?? [];
    for (const s of l.scratched) {
      if (!prev.includes(s.number) || l.kind === "ALLG") continue;
      out.push({ kind: "SCRATCHED", leg: l.leg, numbers: [s.number], tone: "warn", role: "status", text: scratchNotice(saved, after, l.leg, s.number) });
    }
  }
  return out;
}

// ---- Ändrad sedan kopiering --------------------------------------------------------------------

// Avdelningarna där raden skiljer sig från den kopierade.
export function changedSinceCopy(copied: Record<string, number[]> | null | undefined, r: TippaResult): number[] {
  if (!copied) return [];
  return r.legs.filter((l) => !sameNumbers(copied[String(l.leg)] ?? [], l.selection)).map((l) => l.leg);
}

// null när inget har ändrats eller raden inte har kopierats.
export function copyChangedText(copiedAt: string | null | undefined, copied: Record<string, number[]> | null | undefined, r: TippaResult, now: Date): string | null {
  if (!copiedAt || !copied) return null;
  const legs = changedSinceCopy(copied, r);
  if (!legs.length) return null;
  const which = legs.length === 1 ? `Avd ${legs[0]} är ändrad.` : `Avd ${joinSv(legs)} är ändrade.`;
  return `**Raden har ändrats sedan du kopierade den** ${relTime(copiedAt, now)}. ${which} Kopiera igen om du vill spela den nya raden.`;
}

// ---- Arket Välj egen spik (A5) ------------------------------------------------------------------

// Märkena i texten: "S och B 2,40".
function marksText(h: TippaHorse): string {
  const m: string[] = [];
  if (h.spelbar) m.push("S");
  else if (h.interesting) m.push("I");
  if (h.bet) m.push(h.betOdds !== null ? `B ${riktText(h.betOdds)}` : "B");
  return joinSv(m);
}

// Förhandsbanderollen i A5. before = raden nu, after = med hästen number som
// egen spik i leg. Tom lista = inget att säga.
export function spikPreviewTexts(before: TippaResult, after: TippaResult, leg: number, number: number): string[] {
  const out: string[] = [];
  const l = legOf(before, leg);
  const fav = l?.favorite ?? null;
  const isFav = fav?.number === number;
  const hadFav = !!(l && fav && l.selection.includes(fav.number));
  if (isFav && !hadFav) {
    if (after.favCount > after.favLimit) {
      out.push(`**Favoriten blir med i ${after.favCount} av ${after.legCount}, över spärren på ${after.favLimit}.** Ditt val går först, och inget blockeras.`);
    } else {
      const lost = before.legs.filter((b) => {
        if (b.leg === leg || !b.favorite || !b.selection.includes(b.favorite.number)) return false;
        const a = legOf(after, b.leg);
        return !!a && !a.selection.includes(b.favorite.number);
      });
      if (lost.length) {
        const who = lost.map((b) => {
          const m = marksText(b.favorite!);
          return `${horseName(b.favorite!)}${m ? `, ${m}` : ""}`;
        });
        out.push(`**Favoriten blir med i ${before.favCount + 1} av ${before.legCount}.** Appen tar då bort favoriten i avd ${joinSv(lost.map((b) => b.leg))} i stället (${who.join("; ")}), eftersom ditt val går först.`);
      }
    }
  }
  if (before.allgLeg === leg) {
    if (!before.allgAuto) out.push(`Avd ${leg} är din allgardering. Väljer du spik här blir allgarderingen Auto.`);
    else if (after.allgLeg !== null) out.push(`Avd ${leg} allgarderas nu. Allgarderingen flyttar till avd ${after.allgLeg}, näst mest öppna loppet.`);
    else out.push(`Avd ${leg} allgarderas nu. Ingen annan avdelning kan allgarderas.`);
  }
  if (after.spikEffective > before.spikEffective) {
    const own = before.ownSpikes === 1 ? "1 egen spik" : `${before.ownSpikes} egna spikar`;
    out.push(`Du har redan ${own}. Antal spikar blir ${after.spikEffective}.`);
  }
  return out;
}

// ---- Vyns banderoller (Lägen) -------------------------------------------------------------------

// Datum (YYYY-MM-DD) i svensk tid.
const stockholmDate = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

// Preliminär rad: "Strecket kommer måndag." före måndagen i omgångens vecka,
// annars "Strecket saknas än.".
export function prelimText(roundDate: string, now: Date): string {
  const round = new Date(`${roundDate}T12:00:00Z`);
  const monday = new Date(round.getTime() - ((round.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
  const head = stockholmDate(now) < monday ? "**Strecket kommer måndag.**" : "**Strecket saknas än.**";
  return `${head} Raden är preliminär: topp 3, mellan och skräll räknas på modellens ordning, och favoriten är hästen med lägst riktodds. Raden räknas om när strecket finns.`;
}

export const NO_DATA_TEXT = "**Raden kan inte räknas än.** Den behöver riktodds eller streck. Hämta omgången igen när riktoddsen är räknade.";
export const NO_RIKT_TEXT = "Riktodds saknas. Raden bygger på strecket och dina markeringar, och appen väljer inga spikar.";
export const LEGACY_TEXT = "Raden sparades före de nya reglerna och visas som den är.";
export const OFFLINE_TEXT = "Ingen uppkoppling. Raden räknas om här och sparas när du är online igen. Kopiera fungerar ändå.";
export const startedText = (gameType: string) => `${gameType} har startat – raden kan inte längre spelas. Den finns kvar för statistiken.`;

// Orsaken till att Kopiera till ATG är avstängd (aria-describedby). null = aktiv.
export function copyBlockedReason(r: TippaResult): string | null {
  if (r.noData) return "Raden kan inte räknas än.";
  if (r.status === "RULES_DONT_FIT") return "Raden ryms inte i budgeten.";
  if (r.struckOwnSpik.length) return `Välj en ny spik i avd ${r.struckOwnSpik[0]} först.`;
  if (r.noStarters.length) return `Avd ${r.noStarters[0]} har inga startande.`;
  return null;
}

// Avvikelser från mallen för att nå budgeten (Mikael 2026-10-28).
export function templateDeviationText(r: { allgDropped: number; relaxedLegs: number[]; allgLeg: number | null; legs: { leg: number; field: unknown[] }[] }): string | null {
  const parts: string[] = [];
  if (r.allgDropped > 0 && r.allgLeg) {
    const n = r.legs.find((l) => l.leg === r.allgLeg)?.field.length ?? 0;
    parts.push(`Avd ${r.allgLeg} har ${n - r.allgDropped} av ${n} hästar`);
  }
  if (r.relaxedLegs.length) {
    const list = r.relaxedLegs.length === 1 ? `Avd ${r.relaxedLegs[0]} har` : `Avd ${r.relaxedLegs.slice(0, -1).join(", ")} och ${r.relaxedLegs[r.relaxedLegs.length - 1]} har`;
    parts.push(`${list} 2 hästar (bästa Topp 3 och högst rankade av övriga)`);
  }
  return parts.length ? `För att komma nära din budget avviker raden från mallen. ${parts.join(". ")}.` : null;
}
