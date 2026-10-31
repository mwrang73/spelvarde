// Provkörning av E8 Live (docs/specs/e8-live.md 18). Ändrar bara den lokala
// databasen, och återställer den när körningen är klar.
//
//   npm run db:local
//   npm run -s build && SPELVARDE_FIXTURES=atg,ts npx next start -p 3100
//   node scripts/preview-e8.mjs [--only live,rad,...]

import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const out = join(root, "preview");
mkdirSync(out, { recursive: true });
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const BASE = args.base || "http://localhost:3100";
const ONLY = args.only ? args.only.split(",") : null;
const want = (k) => !ONLY || ONLY.includes(k);

const envVals = {};
for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
  const m = /^([A-Z_]+)=(?:"(.*)"|(.*))$/.exec(line.trim());
  if (m) envVals[m[1]] = m[2] ?? m[3];
}
if (!/@127\.0\.0\.1[:/]/.test(envVals.DATABASE_URL ?? "")) throw new Error("DATABASE_URL pekar inte på 127.0.0.1. Avbryter.");
process.env.DATABASE_URL = envVals.DATABASE_URL;
const req = createRequire(join(root, "package.json"));
const { PrismaClient } = req("@prisma/client");
const db = new PrismaClient();

function loadPlaywright() {
  for (const from of [join(root, "package.json"), resolve(root, "../tabellgissningen-app/package.json")]) {
    try {
      return createRequire(from)("playwright-core");
    } catch {
      // nästa
    }
  }
  throw new Error("Hittar inte playwright-core.");
}
function chromePath() {
  const cache = join(homedir(), ".cache", "ms-playwright");
  const dir = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : null;
  const exe = dir && join(cache, dir, "chrome-linux64", "chrome");
  if (!exe || !existsSync(exe)) throw new Error("Hittar ingen Chromium.");
  return exe;
}
const { chromium } = loadPlaywright();

let failures = 0;
const check = (ok, text) => {
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FEL "} ${text}`);
};

// ---- Databasen ------------------------------------------------------------------------------

const user = await db.user.findFirst({ where: { email: envVals.SEED_ADMIN_EMAIL } });
const round = await db.round.findFirst({ where: { atgGameId: { startsWith: "V85_" } }, orderBy: { date: "desc" }, include: { races: { orderBy: { leg: "asc" }, include: { starts: { orderBy: { number: "asc" }, include: { horse: true } } } } } });
const roundId = round.id;
const startIds = round.races.flatMap((r) => r.starts.map((s) => s.id));
const race = (leg) => round.races.find((r) => r.leg === leg);
const startOf = (leg, n) => race(leg).starts.find((s) => s.number === n);
const nameOf = (leg, n) => startOf(leg, n).horse.name;

const backup = {
  races: round.races.map((r) => ({ id: r.id, startAt: r.startAt, scheduledStartAt: r.scheduledStartAt, resultAt: r.resultAt, cancelled: r.cancelled, outcomesFrozenAt: r.outcomesFrozenAt })),
  starts: round.races.flatMap((r) => r.starts.map((s) => ({ id: s.id, scratched: s.scratched, scratchedAt: s.scratchedAt, place: s.place, finishOrder: s.finishOrder, disqualified: s.disqualified, galloped: s.galloped, resultAt: s.resultAt }))),
  marks: await db.mark.findMany({ where: { startId: { in: startIds } } }),
  outcomes: await db.outcome.findMany({ where: { roundId } }),
  comments: await db.horseComment.findMany({ where: { roundId } }),
  coupon: await db.coupon.findMany({ where: { roundId } }),
  submitted: await db.submittedRow.findMany({ where: { roundId } }),
  roundFields: { liveOkAt: round.liveOkAt },
};

async function clearUser() {
  await db.mark.deleteMany({ where: { startId: { in: startIds } } });
  await db.outcome.deleteMany({ where: { roundId } });
  await db.horseComment.deleteMany({ where: { roundId } });
  await db.submittedRow.deleteMany({ where: { roundId } });
}

async function restore() {
  await clearUser();
  await db.coupon.deleteMany({ where: { roundId } });
  for (const r of backup.races) await db.race.update({ where: { id: r.id }, data: { startAt: r.startAt, scheduledStartAt: r.scheduledStartAt, resultAt: r.resultAt, cancelled: r.cancelled, outcomesFrozenAt: r.outcomesFrozenAt } });
  for (const s of backup.starts) await db.start.update({ where: { id: s.id }, data: { scratched: s.scratched, scratchedAt: s.scratchedAt, place: s.place, finishOrder: s.finishOrder, disqualified: s.disqualified, galloped: s.galloped, resultAt: s.resultAt } });
  if (backup.marks.length) await db.mark.createMany({ data: backup.marks });
  if (backup.outcomes.length) await db.outcome.createMany({ data: backup.outcomes });
  if (backup.comments.length) await db.horseComment.createMany({ data: backup.comments });
  if (backup.coupon.length) await db.coupon.createMany({ data: backup.coupon });
  if (backup.submitted.length) await db.submittedRow.createMany({ data: backup.submitted });
  await db.round.update({ where: { id: roundId }, data: backup.roundFields });
}

const minutes = (m) => new Date(Date.now() + m * 60_000);
const allNumbers = (leg) => race(leg).starts.map((s) => s.number);

// Lägen: leg1 resultat (2 strukna), leg2 resultat (dött lopp), leg3 dröjer, leg4 väntar,
// leg5 pågår med 15 hästar, leg6 före start, leg7 inställt, leg8 före start.
const LIVE_TIMES = { 1: -150, 2: -120, 3: -60, 4: -15, 5: -5, 6: 10, 7: 30, 8: 60 };

async function liveScenario({ legTimes = LIVE_TIMES, row = true } = {}) {
  await clearUser();
  for (const r of round.races) {
    const t = minutes(legTimes[r.leg] ?? 60);
    await db.race.update({ where: { id: r.id }, data: { startAt: t, scheduledStartAt: t, resultAt: null, cancelled: false, outcomesFrozenAt: null } });
    await db.start.updateMany({ where: { raceId: r.id }, data: { scratched: false, scratchedAt: null, place: null, finishOrder: null, disqualified: false, galloped: false, resultAt: null } });
  }
  await db.race.update({ where: { id: race(7).id }, data: { cancelled: true } });

  // Leg 1: 1, 2, 3, 4, 5, oplacerade, diskad, två strukna.
  const at = minutes(-130);
  const res = async (leg, n, data) => db.start.update({ where: { id: startOf(leg, n).id }, data: { resultAt: at, ...data } });
  await db.race.update({ where: { id: race(1).id }, data: { resultAt: at, outcomesFrozenAt: at } });
  for (const n of allNumbers(1)) await res(1, n, { place: 0, finishOrder: n + 5 });
  await res(1, 2, { place: 1, finishOrder: 1 });
  await res(1, 5, { place: 2, finishOrder: 2 });
  await res(1, 7, { place: 3, finishOrder: 3 });
  await res(1, 1, { place: 4, finishOrder: 4 });
  await res(1, 9, { place: 5, finishOrder: 5 });
  await res(1, 11, { place: null, finishOrder: null, disqualified: true, galloped: true });
  for (const n of [4, 10]) await db.start.update({ where: { id: startOf(1, n).id }, data: { scratched: true, scratchedAt: minutes(-200), place: null, finishOrder: null, resultAt: null } });

  // Leg 2: dött lopp 1, 1, 3.
  const at2 = minutes(-100);
  await db.race.update({ where: { id: race(2).id }, data: { resultAt: at2, outcomesFrozenAt: at2 } });
  for (const n of allNumbers(2)) await res(2, n, { place: 0, finishOrder: n + 3 });
  await res(2, 3, { place: 1, finishOrder: 1 });
  await res(2, 6, { place: 1, finishOrder: 1 });
  await res(2, 8, { place: 3, finishOrder: 3 });

  // Markeringar: leg 5 Bet + RAD på 7, Bet på 12, RAD på 3, I och S på andra.
  const mark = (leg, n, d) => db.mark.create({ data: { userId: user.id, startId: startOf(leg, n).id, ...d } });
  const bet = (odds) => ({ bet: true, betAt: minutes(-300), betOdds: odds, interesting: true, interestingAt: minutes(-300) });
  await mark(5, 7, bet(2.4));
  await mark(5, 12, bet(3.1));
  await mark(5, 1, { interesting: true, interestingAt: minutes(-300) });
  await mark(5, 9, { interesting: true, interestingAt: minutes(-300), spelbarOverride: "ON" });
  await mark(1, 5, bet(2.2));
  await mark(1, 1, bet(3.4));
  await mark(1, 11, bet(5.0));
  await mark(1, 4, bet(4.0));
  await mark(2, 6, bet(1.9));
  const outcome = (leg, n, hit, place, disq = false) =>
    db.outcome.create({ data: { userId: user.id, startId: startOf(leg, n).id, roundId, interesting: true, spelbar: false, bet: true, betOdds: 2, place, disqualified: disq, hit } });
  await outcome(1, 5, true, 2);
  await outcome(1, 1, false, 4);
  await outcome(1, 11, false, null, true);
  await outcome(2, 6, true, 1);

  if (row) {
    const sel = {};
    for (const r of round.races) sel[r.leg] = [allNumbers(r.leg)[0]];
    sel[1] = [2, 5, 4];
    sel[2] = [3, 1];
    sel[5] = [3, 7, 8];
    await db.submittedRow.create({ data: { userId: user.id, roundId, selections: sel, rows: 18, cost: 9, rowPrice: 0.5, markedAt: minutes(-400), markedLate: false } });
  }
  // Befintlig tagg från före bygget.
  const s = startOf(1, 2);
  await db.horseComment.create({ data: { userId: user.id, horseId: s.horseId, startId: s.id, roundId, kind: "RACE", tags: ["Tog spets", "Ledde hela vägen", "Stark avslutning"], text: "Sparad före bygget", clientId: "11111111-1111-4111-8111-111111111111" } });
}

// Inget har startat: V85-raden före spelstopp.
const PRE_TIMES = { 1: 60, 2: 90, 3: 120, 4: 150, 5: 180, 6: 210, 7: 240, 8: 270 };
async function preScenario() {
  await clearUser();
  for (const r of round.races) {
    const t = minutes(PRE_TIMES[r.leg]);
    await db.race.update({ where: { id: r.id }, data: { startAt: t, scheduledStartAt: t, resultAt: null, cancelled: false, outcomesFrozenAt: null } });
    await db.start.updateMany({ where: { raceId: r.id }, data: { scratched: false, scratchedAt: null, place: null, finishOrder: null, disqualified: false, galloped: false, resultAt: null } });
  }
}

// ---- Webbläsaren ----------------------------------------------------------------------------

const browser = await chromium.launch({ executablePath: chromePath() });

async function newPage(w, h, theme, { touch = false, blockPoll = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: touch ? 2 : 1, isMobile: touch, hasTouch: touch, colorScheme: theme, locale: "sv-SE", timezoneId: "Europe/Stockholm" });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("sv-theme", t);
    } catch {}
  }, theme);
  const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: envVals.SEED_ADMIN_EMAIL, password: envVals.SEED_ADMIN_PASSWORD } });
  if (!res.ok()) throw new Error(`Inloggningen misslyckades: ${res.status()}`);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  // Fixturerna får inte skriva resultat under körningen.
  if (blockPoll) await page.route(`**/api/rounds/${roundId}/results`, (r) => r.fulfill({ json: { changed: false, rev: "x", syncedAt: null, races: [] } }));
  return { ctx, page };
}

const LIVE = `${BASE}/omgang/${roundId}/live`;
const shotName = (name, w, theme, h) => join(out, `e8-${name}-${h ? `${w}x${h}` : w}-${theme}.png`);
async function shot(page, name, theme, withH = false) {
  await page.waitForTimeout(350);
  const v = page.viewportSize();
  await page.screenshot({ path: shotName(name, v.width, theme, withH ? v.height : null) });
  const m = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth - innerWidth, lv: (() => { const l = document.querySelector(".lv"); return l ? l.scrollWidth - l.clientWidth : 0; })() }));
  if (m.doc > 0 || m.lv > 0) check(false, `${name} ${v.width} ${theme}: vågrät skroll ${JSON.stringify(m)}`);
}
const openLive = async (page, q = "") => {
  await page.goto(`${LIVE}${q}`, { waitUntil: "networkidle" });
  await page.locator(".lv h1").first().waitFor();
};
const settled = (page) => page.waitForFunction(() => (localStorage.getItem("sv-outbox") ?? "[]") === "[]", null, { timeout: 20_000 });

// All text: synlig, skärmläsare och etiketter. Taggknappar, formrutor och fasraden räknas bort.
const allText = (page) =>
  page.evaluate(() => {
    const clone = document.body.cloneNode(true);
    // Tidigare starter är hästens historik (8.2 rad 17). Dagens lopp får inte stå där.
    const hist = [...clone.querySelectorAll(".cell, .msec, section")].filter((e) => /^\s*5 senaste starter/i.test(e.textContent));
    const today = hist.filter((e) => e.textContent.includes("31 okt")).map((e) => `Vinnare 1 i dagens lopp i historiken: ${e.textContent}`);
    hist.forEach((e) => e.remove());
    clone.append(today.join(" "));
    clone.querySelectorAll(".tbn, .qc, .form, .lowst, script, style, next-route-announcer").forEach((e) => e.remove());
    const labels = [...clone.querySelectorAll("[aria-label], [title]")].map((e) => `${e.getAttribute("aria-label") ?? ""} ${e.getAttribute("title") ?? ""}`);
    return `${clone.textContent} ${labels.join(" ")}`;
  });
const LEAK = /\b[1-9]:[ae]\b|Vinnare \d|\bTräff\b|\bMiss\b|\d+\s*\/\s*\d+ topp 3|rätt av|diskad|oplacerad|\bvann\b|5 eller sämre|Placering\b/i;
const leakCheck = async (page, label, extra = []) => {
  const text = await allText(page);
  const m = LEAK.exec(text.replace(/Chans till topp 3|kom topp 3 i \d+ %|\d+:[ae] i fältet/g, ""));
  const names = extra.filter((n) => text.includes(n));
  check(!m && !names.length, `${label}: inget om resultatet i texten${m ? ` (hittade "${text.slice(Math.max(0, m.index - 40), m.index + 30)}")` : ""}${names.length ? ` (namn: ${names.join(", ")})` : ""}`);
};

const dbTags = async () => {
  const rows = await db.horseComment.findMany({ where: { roundId, kind: "RACE", deletedAt: null }, select: { startId: true, tags: true, text: true, clientId: true } });
  return Object.fromEntries(rows.map((r) => [r.startId, r]));
};
const col = (page, n, name) => page.getByRole("button", { name: `${name}, ${n} `, exact: false });

try {
  console.log(`Omgång ${round.atgGameId}, ${round.races.map((r) => r.starts.length).join("/")} starter.`);
  await liveScenario();
  const THEMES = ["light", "dark"];

  // ---- Skärmbilder av Live -----------------------------------------------------------------
  if (want("live")) {
    for (const theme of THEMES) {
      const sizes = [[1400, 900, false], [1920, 1080, false], [390, 844, true]];
      for (const [w, h, touch] of sizes) {
        const { ctx, page } = await newPage(w, h, theme, { touch });
        await openLive(page, "?avd=5");
        await page.locator(".tbn, .qc button").first().waitFor();
        await page.waitForFunction(() => !document.querySelector(".tbn:disabled, .qc button:disabled"));
        await shot(page, "live-15", theme);
        await leakCheck(page, `Live V85-5 ${w} ${theme}`);
        if (!touch) {
          const m = await page.evaluate(() => {
            const main = document.querySelector(".dmain");
            const cols = [...document.querySelectorAll(".ga > .hc:not(.xc)")].map((c) => Math.round(c.getBoundingClientRect().width));
            return { vs: main.scrollHeight - main.clientHeight, hs: main.scrollWidth - main.clientWidth, n: cols.length, w: cols[0], h: Math.round(document.querySelector(".tbn").getBoundingClientRect().height) };
          });
          check(m.n === 15, `${w}×${h} ${theme}: 15 kolumner à ${m.w} px, taggrad ${m.h} px, lodrät skroll ${m.vs} px, vågrät ${m.hs} px`);
          check(m.hs <= 0, `${w}×${h} ${theme}: ingen vågrät skroll i rutnätet`);
        }
        // Strukna (V85-1, dolt resultat).
        await openLive(page, "?avd=1");
        await page.waitForFunction(() => !document.querySelector(".tbn:disabled, .qc button:disabled"));
        await shot(page, "strukna-dolt", theme);
        await leakCheck(page, `Live V85-1 dolt ${w} ${theme}`, [nameOf(1, 4) === "" ? "x" : "Vinnare"]);
        // Väntar på resultat.
        await openLive(page, "?avd=4");
        await shot(page, "vantar", theme);
        await leakCheck(page, `Väntar ${w} ${theme}`);
        // Resultatlistan: V85-1.
        await openLive(page, "?avd=1");
        await page.getByRole("button", { name: "Visa resultat" }).first().click();
        await page.locator(".lrl").waitFor();
        const foc = await page.evaluate(() => document.activeElement?.id);
        check(foc === "lres-h", `Visa resultat ${w} ${theme}: fokus på rubriken (${foc})`);
        await shot(page, "resultat", theme);
        const list = await page.evaluate(() => [...document.querySelectorAll(".lrw .sr")].map((e) => e.textContent));
        if (w === 1400 && theme === "light") console.log(list.join("\n"));
        check(list[0].startsWith("1:a, nummer 2") && list.some((t) => t.startsWith("Oplacerad")) && list[list.length - 1].startsWith("Diskad") && !list.some((t) => t.includes(`nummer 4,`)), `Resultatlista ${w} ${theme}: topp, oplacerad, diskad sist, struken saknas`);
        check(await page.locator(".lrw.top").count() === 3, `Resultatlista ${w} ${theme}: 3 topp-rader`);
        check((await page.locator(".lres .tk.y").count()) > 0 && (await page.locator(".lres .tk.n").count()) > 0 && (await page.locator(".lres").textContent()).includes("✓ RAD"), `Resultatlista ${w} ${theme}: grön och röd Bet-biljett och ✓ RAD`);
        const score = await page.locator(".score").first().textContent();
        check(score === "Raden: 1 rätt av 1 visade", `Summan: "${score}"`);
        await page.getByRole("button", { name: "Dölj resultat" }).first().click();
        await page.waitForTimeout(150);
        const f2 = await page.evaluate(() => document.activeElement?.textContent);
        check(f2 === "Visa resultat", `Dölj resultat ${w} ${theme}: fokus på Visa resultat`);
        await ctx.close();
      }
    }
  }

  // ---- Snabba klick, omladdning ------------------------------------------------------------
  if (want("klick")) {
    await liveScenario();
    const { ctx, page } = await newPage(1400, 900, "light");
    const puts = [];
    page.on("response", (r) => {
      if (r.url().includes("/api/comments/")) puts.push(r.status());
    });
    await openLive(page, "?avd=5");
    await page.waitForFunction(() => document.querySelectorAll(".tbn:not(:disabled)").length > 100);
    const numbers = [1, 3, 7, 9, 12];
    const sequence = [
      [1, "Galopp"], [3, "Dödens"], [7, "Tog spets"], [9, "Tröttnade"], [12, "Diskad"],
      [1, "Dödens"], [3, "Galopp"], [7, "Stark avslutning"], [9, "Galopp"], [12, "Galopp"],
      [1, "Tröttnade"], [3, "Tröttnade"], [7, "Galopp"], [9, "Dödens"], [12, "Tröttnade"],
      [1, "Stark avslutning"], [3, "Tog spets"], [7, "Dödens"], [9, "Tog spets"], [12, "Dödens"],
    ];
    const t0 = Date.now();
    // Klick i samma uppgift, utan väntan på ritning.
    await page.evaluate((seq) => {
      const name = new Map([...document.querySelectorAll(".tbn")].map((b) => [b.getAttribute("aria-label"), b]));
      for (const [n, tag] of seq) {
        const b = [...name.entries()].find(([k]) => k.startsWith(`${tag}, ${n} `))?.[1];
        b.click();
      }
    }, sequence);
    const ms = Date.now() - t0;
    await page.waitForTimeout(50);
    await shot(page, "snabba-klick", "light");
    await settled(page);
    await page.waitForTimeout(300);
    const expected = {};
    for (const [n, tag] of sequence) (expected[n] ??= []).push(tag);
    const saved = await dbTags();
    let ok = true;
    for (const n of numbers) {
      const id = startOf(5, n).id;
      const a = [...(saved[id]?.tags ?? [])].sort().join("|");
      const b = [...expected[n]].sort().join("|");
      if (a !== b) ok = false;
      console.log(`     nr ${n}: i databasen ${saved[id]?.tags.join(", ")}`);
    }
    check(ok, `20 klick på ${ms} ms över 5 hästar: alla taggar rätt i databasen`);
    check(puts.every((s) => s === 200), `Inga fel från API:t (${puts.length} anrop, statusar ${[...new Set(puts)].join(",")})`);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelectorAll(".tbn:not(:disabled)").length > 100);
    const back = await page.evaluate(() => [...document.querySelectorAll('.tbn[aria-pressed="true"]')].map((b) => b.getAttribute("aria-label")));
    const want20 = sequence.map(([n, tag]) => `${tag}, ${n} `);
    check(back.length === 20 && want20.every((p) => back.some((l) => l.startsWith(p))), `Efter omladdning: ${back.length} tända taggar, samma som klicken`);
    await shot(page, "efter-omladdning", "light");
    // Kolumnerna som ritas om per klick: ingen annan knapp får ändras.
    const counts = await page.evaluate(() => [...document.querySelectorAll(".ga > .hc:not(.xc)")].map((c) => c.querySelectorAll('.tbn[aria-pressed="true"]').length));
    check(counts.reduce((a, b) => a + b, 0) === 20, `Kolumner med taggar: ${counts.join(" ")}`);
    await ctx.close();

    // Kön överlever omladdning: PUT stoppas, ladda om, tagga vidare, släpp igenom. Inget 422.
    await liveScenario();
    const q = await newPage(1400, 900, "light");
    const statuses = [];
    let block = true;
    await q.page.route("**/api/comments/**", (r) => (block ? r.abort() : r.continue()));
    q.page.on("response", (r) => {
      if (r.url().includes("/api/comments/")) statuses.push(r.status());
    });
    await openLive(q.page, "?avd=5");
    await q.page.waitForFunction(() => document.querySelectorAll(".tbn:not(:disabled)").length > 100);
    await col(q.page, 3, "Galopp").click();
    await col(q.page, 8, "Dödens").click();
    await q.page.waitForTimeout(300);
    const queued = await q.page.evaluate(() => JSON.parse(localStorage.getItem("sv-outbox") ?? "[]").length);
    check(queued === 2, `Kön har ${queued} poster medan nätet stoppas`);
    await q.page.reload({ waitUntil: "networkidle" });
    await q.page.waitForFunction(() => document.querySelectorAll(".tbn:not(:disabled)").length > 100);
    const afterReload = await q.page.evaluate(() => [...document.querySelectorAll('.tbn[aria-pressed="true"]')].map((b) => b.getAttribute("aria-label")));
    check(afterReload.length === 2 && afterReload.some((l) => l.startsWith("Galopp, 3 ")) && afterReload.some((l) => l.startsWith("Dödens, 8 ")), `Kön läses in efter omladdning: ${afterReload.join(" · ")}`);
    await col(q.page, 3, "Tröttnade").click();
    await q.page.waitForTimeout(200);
    const qStatus = await q.page.locator(".rbar .tstat").textContent();
    console.log(`     status under försök: ${qStatus}`);
    block = false;
    await q.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await settled(q.page);
    await q.page.waitForTimeout(300);
    const s3 = await dbTags();
    check((s3[startOf(5, 3).id]?.tags ?? []).sort().join() === "Galopp,Tröttnade" && (s3[startOf(5, 8).id]?.tags ?? []).join() === "Dödens", `Sparat efter nätet: nr 3 ${s3[startOf(5, 3).id]?.tags}, nr 8 ${s3[startOf(5, 8).id]?.tags}`);
    check(!statuses.includes(422), `Inget 422 (statusar ${[...new Set(statuses)].join(",")})`);
    await q.ctx.close();

    // Offline enligt webbläsaren: I kö. Utloggad: Logga in igen.
    await liveScenario();
    const o = await newPage(1400, 900, "light");
    await openLive(o.page, "?avd=5");
    await o.page.waitForFunction(() => document.querySelectorAll(".tbn:not(:disabled)").length > 100);
    await o.ctx.setOffline(true);
    await o.page.waitForTimeout(100);
    check((await o.page.locator(".rbar .tstat").textContent()).startsWith("Ingen uppkoppling"), "Offline, tom kö: Ingen uppkoppling");
    await col(o.page, 3, "Galopp").click();
    await col(o.page, 8, "Galopp").click();
    await o.page.waitForTimeout(150);
    const st = await o.page.locator(".rbar .tstat .tst").textContent();
    check(st === "I kö (2) · skickas när nätet är tillbaka", `Offline med kö: "${st}"`);
    await shot(o.page, "offline-ko", "light");
    await o.ctx.setOffline(false);
    await o.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await settled(o.page);
    const s4 = await dbTags();
    check(!!s4[startOf(5, 3).id] && !!s4[startOf(5, 8).id], "Offline: posterna sparade när nätet är tillbaka");
    await o.ctx.close();

    const p = await newPage(1400, 900, "light");
    await openLive(p.page, "?avd=5");
    await p.page.waitForFunction(() => document.querySelectorAll(".tbn:not(:disabled)").length > 100);
    await p.page.route("**/api/comments/**", (r) => r.fulfill({ status: 401, json: { error: "Logga in." } }));
    await col(p.page, 5, "Galopp").click();
    await p.page.waitForTimeout(400);
    const pt = await p.page.locator(".rbar .tstat .tst").textContent();
    check(pt === "Logga in igen för att spara taggarna.", `Utloggad (paused) är inte offline: "${pt}"`);
    await p.ctx.close();

    // Tangenter: 1 + bokstav vid 15 hästar, håll en bokstav.
    await liveScenario();
    const k = await newPage(1400, 900, "light");
    await openLive(k.page, "?avd=5");
    await k.page.waitForFunction(() => document.querySelectorAll(".tbn:not(:disabled)").length > 100);
    await k.page.keyboard.press("5");
    await k.page.keyboard.press("g");
    await k.page.keyboard.press("1");
    await k.page.keyboard.press("d");
    await k.page.keyboard.press("1");
    await k.page.keyboard.press("3");
    await k.page.keyboard.press("t");
    await k.page.keyboard.down("m");
    await k.page.keyboard.down("m");
    await k.page.keyboard.down("m");
    await k.page.keyboard.up("m");
    await settled(k.page);
    await k.page.waitForTimeout(200);
    const s5 = await dbTags();
    check(s5[startOf(5, 5).id]?.tags.join() === "Galopp" && s5[startOf(5, 1).id]?.tags.join() === "Dödens", `Tangent: "5 g" på nr 5, "1 d" direkt på nr 1 (${s5[startOf(5, 1).id]?.tags})`);
    check((s5[startOf(5, 13).id]?.tags ?? []).sort().join() === "Spurtade i tredjespår,Tröttnade", `Tangent: "1 3 t" och hållen m på nr 13: ${s5[startOf(5, 13).id]?.tags}`);
    await k.page.keyboard.press("?");
    await shot(k.page, "tangenthjalp", "light");
    await k.page.keyboard.press("Escape");
    await k.page.keyboard.press("+");
    await k.page.locator(".ftpop textarea").waitFor();
    check(await k.page.evaluate(() => document.activeElement?.tagName === "TEXTAREA"), "+ öppnar Fritext med fokus i fältet");
    await k.page.keyboard.type("Satt fast");
    await shot(k.page, "fritext", "light");
    await k.page.keyboard.press("Escape");
    await settled(k.page);
    await k.page.waitForTimeout(150);
    const s6 = await dbTags();
    check(s6[startOf(5, 13).id]?.text === "Satt fast" && s6[startOf(5, 13).id]?.tags.length === 2, `Fritext sparad med taggarna kvar: "${s6[startOf(5, 13).id]?.text}"`);
    await k.ctx.close();

    // Mobil: snabba tryck, sen läsning.
    await liveScenario();
    const mo = await newPage(390, 844, "dark", { touch: true });
    await openLive(mo.page, "?avd=5");
    await mo.page.waitForFunction(() => document.querySelectorAll(".qc button:not(:disabled)").length === 15);
    await mo.page.evaluate(() => {
      const b = [...document.querySelectorAll(".qc button")];
      b[0].click();
      b[1].click();
      b[6].click();
    });
    await mo.page.waitForTimeout(100);
    await shot(mo.page, "mobil-taggad", "dark");
    await settled(mo.page);
    await mo.page.reload({ waitUntil: "networkidle" });
    await mo.page.waitForFunction(() => document.querySelectorAll(".qc button:not(:disabled)").length === 15);
    check((await mo.page.locator('.qc button[aria-pressed="true"]').count()) === 3, "Mobil: tre snabba tryck läses tillbaka efter omladdning");
    await mo.ctx.close();
  }

  // ---- Bredder -----------------------------------------------------------------------------
  if (want("bredd")) {
    await liveScenario();
    const { ctx, page } = await newPage(1400, 900, "light");
    for (const [w, h] of [[1400, 760], [1100, 800], [1099, 800], [1024, 700], [900, 720], [768, 900], [600, 800], [480, 800], [390, 844], [360, 640]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const avd of [5, 1]) {
        await openLive(page, `?avd=${avd}`);
        await page.waitForFunction(() => !document.querySelector(".tbn:disabled, .qc button:disabled"));
        const m = await page.evaluate(() => {
          const over = (sel) => [...document.querySelectorAll(sel)].map((e) => e.scrollWidth - e.clientWidth).reduce((a, b) => Math.max(a, b), 0);
          const nav = document.querySelector(".tnav");
          return { doc: document.documentElement.scrollWidth - innerWidth, lv: over(".lv"), main: over(".dmain, .lv-body"), cols: !!document.querySelector(".ga"), qc: document.querySelector(".qc") ? getComputedStyle(document.querySelector(".qc")).gridTemplateColumns.split(" ").length : 0, tag: (document.querySelector(".tbn") ?? document.querySelector(".qc button"))?.getBoundingClientRect().height, navBottom: nav ? Math.round(nav.getBoundingClientRect().bottom) : null, clip: [...document.querySelectorAll(".tbn > span")].filter((s) => s.scrollHeight > s.parentElement.clientHeight + 1).length };
        });
        check(m.doc <= 0 && m.lv <= 0 && m.main <= 0, `${w}×${h} V85-${avd}: ${m.cols ? "kolumner" : `en häst, ${m.qc} kolumner taggar`}, tagg ${Math.round(m.tag)} px, klippta ${m.clip}, sidled ${m.doc}/${m.lv}/${m.main}${m.navBottom ? `, Nästa slutar y=${m.navBottom}` : ""}`);
      }
      if ([1400, 1100, 1099, 900, 360].includes(w)) {
        await openLive(page, "?avd=1");
        await page.waitForTimeout(200);
        await shot(page, "bredd", "light", true);
      }
    }
    await ctx.close();
  }

  // ---- Lägen i 6.2 -------------------------------------------------------------------------
  if (want("lagen")) {
    await liveScenario();
    for (const theme of THEMES) {
      for (const [w, h, touch] of [[1400, 900, false], [390, 844, true]]) {
        const { ctx, page } = await newPage(w, h, theme, { touch });
        await openLive(page, "?avd=6");
        await shot(page, "fore-start", theme);
        check((await page.locator(".empty h2").textContent()).startsWith("V85-6 startar"), `${w} ${theme}: före start`);
        await openLive(page, "?avd=3");
        await shot(page, "drojer", theme);
        check((await page.getByRole("button", { name: "Hämta resultat" }).count()) >= 1, `${w} ${theme}: dröjer med Hämta resultat`);
        await openLive(page, "?avd=7");
        await shot(page, "installt", theme);
        check((await page.locator(".empty h2").textContent()) === "Loppet är inställt", `${w} ${theme}: inställt`);
        await ctx.close();
      }
    }
    // Resultatet kommer medan loppet är öppet, och aria-live-noden.
    const { ctx, page } = await newPage(1400, 900, "light");
    await openLive(page, "?avd=4");
    await page.route(`**/api/rounds/${roundId}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const res = await route.fetch();
      const j = await res.json();
      const r = j.races.find((x) => x.leg === 4);
      r.resultAt = new Date().toISOString();
      r.starts[0].result = { place: 1, finishOrder: 1, disqualified: false, galloped: false, kmTime: null, finalOdds: null };
      await route.fulfill({ response: res, json: j });
    });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.getByText("Resultatet har kommit.").waitFor();
    const say = await page.evaluate(() => [...document.querySelectorAll("p.sr[aria-live]")].map((e) => e.textContent).join(" "));
    check(say.includes("Resultatet för V85-4 har kommit. Det är dolt."), `aria-live: "${say}"`);
    await shot(page, "resultat-kom", "light");
    await leakCheck(page, "Resultatet kom, fönstret öppet");
    await ctx.close();

    // Nytt lopp startar: V85-6 om 1 s. Klockan flyttas.
    await liveScenario({ legTimes: { ...LIVE_TIMES, 6: 0.3 } });
    const n = await newPage(1400, 900, "light");
    await n.page.clock.install({ time: new Date() });
    await openLive(n.page, "?avd=5");
    await n.page.clock.runFor(60_000);
    await n.page.locator(".ban b", { hasText: "V85-6 har startat." }).waitFor();
    await shot(n.page, "nytt-lopp", "light");
    check(await n.page.getByRole("button", { name: "Byt till V85-6" }).isVisible(), "Nytt lopp: banderoll och Byt till V85-6");
    await n.ctx.close();

    // Tidigare omgång.
    await liveScenario();
    const older = await db.round.findFirst({ where: { atgGameId: { startsWith: "V85_2026-10-24" } } });
    if (older) {
      const t = await newPage(1400, 900, "light");
      await t.page.goto(`${BASE}/omgang/${older.id}/live`, { waitUntil: "networkidle" });
      await t.page.locator(".lv h1").first().waitFor();
      await t.page.waitForTimeout(300);
      await t.page.screenshot({ path: shotName("tidigare-omgang", 1400, "light") });
      check((await t.page.locator(".lv").textContent()).includes("tidigare omgång"), "Tidigare omgång: raden visas");
      await t.ctx.close();
    }
  }

  // ---- Analys, Omgång, hästkort ------------------------------------------------------------
  if (want("skydd")) {
    await liveScenario();
    const winner1 = nameOf(1, 2);
    for (const theme of THEMES) {
      for (const [w, h, touch] of [[1400, 900, false], [390, 844, true]]) {
        const { ctx, page } = await newPage(w, h, theme, { touch });
        await page.goto(`${BASE}/omgang/${roundId}`, { waitUntil: "networkidle" });
        await page.locator(".olist").waitFor();
        await page.waitForTimeout(300);
        await shot(page, "omgang-dolt", theme);
        await leakCheck(page, `Omgång allt dolt ${w} ${theme}`);
        check((await page.locator(".olist .tag", { hasText: "Dolt" }).count()) === 2, `Omgång ${w} ${theme}: 2 rader med Dolt`);
        check((await page.locator(".sumw").count()) === 0, `Omgång ${w} ${theme}: ingen summering`);

        await page.goto(`${BASE}/omgang/${roundId}/avd/1`, { waitUntil: "networkidle" });
        await page.locator(".rsegc").first().waitFor();
        await page.waitForTimeout(400);
        check((await page.locator('.rsegc button[aria-pressed="true"]').first().textContent()) === "Startlista", `Analys ${w} ${theme}: Startlista förvald`);
        await leakCheck(page, `Analys startlista ${w} ${theme}`);
        await shot(page, "analys-startlista", theme);
        await page.locator(".rsegc").first().getByRole("button", { name: "Resultat" }).click();
        await page.getByText("Resultatet för V85-1 är dolt.").waitFor();
        await shot(page, "analys-gate", theme);
        await leakCheck(page, `Analys Resultat, dolt ${w} ${theme}`);

        await page.goto(`${BASE}/omgang/${roundId}/avd/1?vy=resultat`, { waitUntil: "networkidle" });
        await page.getByText("Resultatet för V85-1 är dolt.").waitFor();
        await leakCheck(page, `?vy=resultat, dolt ${w} ${theme}`);
        await page.getByRole("button", { name: "Visa resultat" }).click();
        await page.locator(".rres h2", { hasText: "Placering" }).waitFor();
        await page.waitForTimeout(150);
        check((await page.evaluate(() => document.activeElement?.textContent)) === "Placering", `Analys ${w} ${theme}: fokus på Placering`);
        check((await page.locator(".rres").textContent()).includes(winner1), `Analys ${w} ${theme}: resultatet visas`);
        await shot(page, "analys-visat", theme);

        await page.goto(`${BASE}/omgang/${roundId}`, { waitUntil: "networkidle" });
        await page.locator(".olist").waitFor();
        await page.waitForTimeout(300);
        await shot(page, "omgang-delvis", theme);
        check((await page.locator(".sumw").textContent()).includes("Visade lopp (1 av 2)"), `Omgång ${w} ${theme}: Visade lopp (1 av 2)`);
        check((await page.locator(".olist").textContent()).includes("Vinnare 2"), `Omgång ${w} ${theme}: visat lopp har vinnaren`);

        // Valet är gemensamt: Live visar listan för samma lopp.
        await openLive(page, "?avd=1");
        await page.locator(".lrl").waitFor();
        check(true, `Live ${w} ${theme}: visat i Analys är visat i Live`);
        await page.reload({ waitUntil: "networkidle" });
        await page.locator(".lrl").waitFor();
        check(true, `Live ${w} ${theme}: valet gäller efter omladdning`);
        await page.getByRole("button", { name: "Dölj resultat" }).first().click();
        await page.waitForTimeout(150);
        await leakCheck(page, `Dölj igen ${w} ${theme}`);

        // Hästkortet: kommentar med dolt lopp.
        await page.goto(`${BASE}/omgang/${roundId}/avd/1/hast/${startOf(1, 2).id}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(800);
        const card = await page.evaluate(() => [...document.querySelectorAll(".when")].map((e) => e.textContent).join(" | "));
        check(/V85-1/.test(card) === true && !/1:a|oplacerad|diskad/.test(card.split("|").find((x) => x.includes("V85-1")) ?? ""), `Hästkort ${w} ${theme}: "${card}" utan placering`);
        check((await page.getByRole("link", { name: "Tagga i Live ›" }).count()) >= 1, `Hästkort ${w} ${theme}: Tagga i Live`);
        await shot(page, "hastkort-dolt", theme);
        await ctx.close();
      }
    }
    // Hästen från hästkortet blir aktiv, och befintlig tagg syns.
    const { ctx, page } = await newPage(1400, 900, "light");
    await openLive(page, `?avd=1&hast=${startOf(1, 2).id}`);
    await page.waitForFunction(() => !document.querySelector(".tbn:disabled"));
    check((await page.locator(".hc.on .hh .nr b").textContent()) === "2", "hast= gör hästen aktiv");
    const pre = await page.locator('.hc.on .tbn[aria-pressed="true"]').count();
    check(pre === 3, `Befintliga taggar från före bygget syns i Live (${pre})`);
    await page.locator(".hc.on .tbn").nth(4).click();
    await page.waitForFunction(() => !new URLSearchParams(location.search).has("hast") || true);
    await settled(page);
    const cm = await db.horseComment.findFirst({ where: { clientId: "11111111-1111-4111-8111-111111111111" } });
    check(cm.tags.length === 4 && cm.text === "Sparad före bygget", `Tagg läggs till på befintlig kommentar: ${cm.tags.join(", ")} · "${cm.text}"`);
    await page.goto(`${BASE}/omgang/${roundId}/analys`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    check((await page.locator("main").textContent()).includes("Efteranalysen visar resultatet för alla lopp, också de du inte har visat."), "Efteranalys: varningsraden");
    await page.screenshot({ path: shotName("efteranalys", 1400, "light") });
    await page.goto(`${BASE}/statistik`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    check((await page.locator("main").textContent()).includes("Statistiken räknar med alla lopp som har resultat"), "Statistik: varningsraden under pågående omgång");
    await page.screenshot({ path: shotName("statistik", 1400, "light") });
    await ctx.close();
    // Blockerad lagring ger inget fel.
    const bl = await newPage(1400, 900, "light");
    const errs = [];
    bl.page.on("pageerror", (e) => errs.push(e.message));
    await bl.ctx.addInitScript(() => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === "sv-visat") throw new Error("blockerad");
        return real.call(this, k, v);
      };
    });
    await openLive(bl.page, "?avd=1");
    await bl.page.getByRole("button", { name: "Visa resultat" }).first().click();
    await bl.page.locator(".lrl").waitFor();
    check(errs.length === 0, `Blockerad lagring: resultatet visas utan fel (${errs.length} fel)`);
    await bl.ctx.close();
  }

  // ---- V85-raden ---------------------------------------------------------------------------
  // Taggarna öppnas 5 minuter före start: V85-6 om 3 min är öppet, V85-8 om 8 min inte.
  if (want("fem")) {
    for (const [w, h, touch] of [[1400, 900, false], [390, 844, true]]) {
      await liveScenario({ legTimes: { ...LIVE_TIMES, 6: 3, 8: 8 } });
      const { ctx, page } = await newPage(w, h, "light", { touch });
      await openLive(page, "?avd=6");
      await page.locator(".tbn, .qc button").first().waitFor();
      await page.waitForFunction(() => !document.querySelector(".tbn:disabled, .qc button:disabled"));
      const open = await page.locator("main").textContent();
      check(!open.includes("Taggarna öppnas"), `Fem min ${w}: V85-6 om 3 min har taggar`);
      check(!(await page.locator("body").textContent()).includes("Väntar på resultat"), `Fem min ${w}: säger inte Väntar på resultat före start`);
      await page.locator(".tbn, .qc button").filter({ hasText: "Bevaka!" }).first().click();
      await page.waitForTimeout(300);
      check((await page.locator('.tbn[aria-pressed="true"], .qc button[aria-pressed="true"]').filter({ hasText: "Bevaka!" }).count()) === 1, `Fem min ${w}: Bevaka! går att tagga före start`);
      await shot(page, "fem-oppet", "light");
      await openLive(page, "?avd=8");
      await page.waitForTimeout(400);
      check((await page.locator("main").textContent()).includes("Taggarna öppnas 5 minuter före start"), `Fem min ${w}: V85-8 om 8 min är stängt`);
      await ctx.close();
    }
    await liveScenario();
  }

  // Blått radhuvud: smalt fönster med 15 hästar, och Bet + Rad i mobilen.
  if (want("radhuvud")) {
    const racesWithBoth = await db.submittedRow.findFirst({ where: { roundId, userId: user.id } });
    console.log("Raden:", JSON.stringify(racesWithBoth?.selections));
    for (const theme of THEMES) {
      const narrow = await newPage(1100, 800, theme);
      await openLive(narrow.page, "?avd=5");
      await narrow.page.locator(".tbn").first().waitFor();
      await shot(narrow.page, "radhuvud-smal", theme);
      const over = await narrow.page.evaluate(() => [...document.querySelectorAll(".hc .hh1")].filter((e) => e.scrollWidth > e.clientWidth).length);
      check(over === 0, `1100 ${theme}: inget huvud spiller över (${over})`);
      await narrow.ctx.close();
      for (const [w, h, touch] of [[1400, 900, false], [390, 844, true]]) {
        const { ctx, page } = await newPage(w, h, theme, { touch });
        for (let leg = 1; leg <= 6; leg++) {
          if (leg === 4) continue;
          await openLive(page, `?avd=${leg}`);
          await page.waitForTimeout(500);
          const both = page.locator(touch ? ".tgb.rr.is-b" : ".hc.is-r.is-b");
          if (await both.count()) {
            if (touch) await both.first().click();
            await page.waitForTimeout(300);
            await shot(page, "radhuvud-bet-rad", theme);
            console.log(`Bet + Rad i V85-${leg} (${w} ${theme})`);
            break;
          }
        }
        await ctx.close();
      }
    }
  }

  if (want("rad")) {
    const RAD = `${BASE}/omgang/${roundId}/spel?flik=rad`;
    const api = async (ctx, method, url, data) => {
      const res = await ctx.request.fetch(`${BASE}${url}`, { method, data });
      const body = await res.json().catch(() => null);
      if (!res.ok()) throw new Error(`${method} ${url}: ${res.status()} ${JSON.stringify(body)}`);
      return body;
    };
    const fresh = (ctx, over = {}) => api(ctx, "PUT", `/api/rounds/${roundId}/coupon`, { budget: 288, rowPrice: 0.5, selections: {}, lockedLegs: [], spikCount: 2, allgMode: "AUTO", allgLeg: null, maxPerLeg: 7, legRoles: null, copiedAt: null, copiedSelections: null, ...over });
    const open = async (page) => {
      await page.goto(RAD, { waitUntil: "networkidle" });
      await page.locator(".budget").first().waitFor();
      await settled(page);
    };
    const row = async () => db.submittedRow.findFirst({ where: { roundId, userId: user.id } });
    for (const theme of THEMES) {
      for (const [w, h, touch] of [[1400, 900, false], [390, 844, true]]) {
        const tag = `${w} ${theme}`;
        await preScenario();
        const { ctx, page } = await newPage(w, h, theme, { touch });
        await fresh(ctx);
        await open(page);
        await page.waitForTimeout(900);
        await settled(page);
        await shot(page, "rad-inget", theme);
        check(await page.getByRole("button", { name: "Jag har lämnat in raden" }).first().isVisible(), `${tag}: knappen Jag har lämnat in raden`);
        if (touch) check((await page.locator(".actbar").textContent()).includes("Inte markerad som inlämnad"), `${tag}: handlingsraden säger Inte markerad`);

        await page.getByRole("button", { name: "Jag har lämnat in raden" }).first().click();
        await page.locator("dialog.sheet[open] .subact").waitFor();
        await page.waitForTimeout(400);
        await shot(page, "rad-ark", theme);
        check((await page.locator("dialog.sheet[open] .atg-steps li").count()) === 5, `${tag}: steg 5 i arket`);
        // Nedladdning är inte nödvändig: kopiera ger copiedAt.
        await page.locator("dialog.sheet[open]").getByRole("button", { name: "Jag har lämnat in raden" }).click();
        await page.locator(".subbox .stamp").waitFor();
        await settled(page);
        const saved = await row();
        check(!!saved && saved.markedLate === false, `${tag}: rad sparad, ${saved?.rows} rader, ${saved?.cost} kr, markedLate ${saved?.markedLate}`);
        await page.waitForTimeout(150);
        check((await page.locator(".subbox").textContent()).includes("Sparad. Live visar den här raden."), `${tag}: statusen Sparad`);
        check(await page.evaluate(() => document.activeElement?.classList.contains("sub-st")), `${tag}: fokus på statusraden`);
        await page.evaluate(() => (document.querySelector(".drad-l") ?? window).scrollTo?.(0, 0));
        await shot(page, "rad-inlamnad", theme);
        await page.getByRole("button", { name: "Visa raden" }).click();
        await page.waitForTimeout(100);
        await shot(page, "rad-visa-raden", theme);
        await page.getByRole("button", { name: "Dölj raden" }).click();
        if (touch) check((await page.locator(".actbar").textContent()).includes("✓ Inlämnad"), `${tag}: handlingsraden säger Inlämnad`);

        // Samma rad i arket.
        await page.locator(".actbar .btn:visible, .dact .btn:visible").first().click();
        await page.locator("dialog.sheet[open] .subact").waitFor();
        check((await page.locator("dialog.sheet[open] .subact").textContent()).includes("✓ Den här raden är markerad som inlämnad."), `${tag}: samma rad säger det`);
        await page.waitForTimeout(350);
        await shot(page, "rad-ark-samma", theme);
        await page.getByRole("button", { name: "Stäng" }).click();

        // Ändrad arbetsrad efteråt: kopian oförändrad, en banderoll.
        const before = JSON.stringify((await row()).selections);
        await page.locator(".budget").first().getByLabel("Exakt belopp").fill("600");
        await page.locator(".budget").first().getByLabel("Exakt belopp").press("Enter");
        const ban = page.locator(".ban").filter({ hasText: "Raden här har ändrats efter inlämningen" });
        await ban.first().waitFor();
        await settled(page);
        await page.waitForTimeout(900);
        await settled(page);
        check((await page.locator(".ban").filter({ hasText: "Raden har ändrats sedan du laddade" }).count()) === 0, `${tag}: bara en banderoll om ändrad rad`);
        check(JSON.stringify((await row()).selections) === before, `${tag}: kopian oförändrad`);
        const bantext = await ban.first().textContent();
        console.log(`     ${bantext.slice(0, 120)}`);
        await shot(page, "rad-andrad", theme);

        // Ersätt raden, Ångra: gamla värden och gamla tid.
        const old = await row();
        await page.locator(".actbar .btn:visible, .dact .btn:visible").first().click();
        await page.locator("dialog.sheet[open] .subact").waitFor();
        await page.waitForTimeout(350);
        await shot(page, "rad-ark-ersatt", theme);
        const reHelp = (await page.locator("dialog.sheet[open]").textContent()).includes("Ersätt bara om du har makulerat raden hos ATG.");
        check(reHelp, `${tag}: hjälptexten för Ersätt`);
        await page.locator("dialog.sheet[open]").getByRole("button", { name: "Ersätt raden" }).click();
        await page.getByText("Raden är ersatt.").waitFor();
        await settled(page);
        const replaced = await row();
        check(JSON.stringify(replaced.selections) !== before, `${tag}: raden ersatt (${replaced.rows} rader)`);
        await shot(page, "rad-ersatt", theme);
        await page.getByText("Raden är ersatt.").locator("xpath=ancestor::div[contains(@class,'ban')]").getByRole("button", { name: "Ångra" }).click();
        await settled(page);
        await page.waitForTimeout(200);
        const undone = await row();
        check(JSON.stringify(undone.selections) === before && undone.markedAt.getTime() === old.markedAt.getTime(), `${tag}: Ångra ger gamla värden och gamla tid`);

        // Ångra markeringen, Ångra.
        await page.getByRole("button", { name: "Ångra markeringen" }).click();
        await page.getByText("Markeringen är borttagen.").waitFor();
        await settled(page);
        check((await row()) === null, `${tag}: markeringen borttagen`);
        await shot(page, "rad-borttagen", theme);
        await page.getByText("Markeringen är borttagen.").locator("xpath=ancestor::div[contains(@class,'ban')]").getByRole("button", { name: "Ångra" }).click();
        await settled(page);
        await page.waitForTimeout(200);
        check(!!(await row()), `${tag}: Ångra tar tillbaka markeringen`);
        await ctx.close();

        // Vald rad: uttagen rad skiljer sig.
        await preScenario();
        const c2 = await newPage(w, h, theme, { touch });
        await fresh(c2.ctx);
        await open(c2.page);
        await c2.page.waitForTimeout(900);
        await settled(c2.page);
        const cur = (await api(c2.ctx, "GET", `/api/rounds/${roundId}/coupon`)).coupon;
        const copied = { ...cur.selections, 1: cur.selections["1"].slice(0, 1) };
        await fresh(c2.ctx, { selections: cur.selections, copiedAt: new Date(Date.now() - 600_000).toISOString(), copiedSelections: copied, spikCount: cur.spikCount, allgMode: cur.allgMode, allgLeg: cur.allgLeg, maxPerLeg: cur.maxPerLeg, legRoles: cur.legRoles });
        await open(c2.page);
        await c2.page.getByRole("button", { name: "Jag har lämnat in raden" }).first().click();
        await c2.page.locator("dialog.sheet[open] .chs").waitFor();
        await c2.page.waitForTimeout(350);
        await shot(c2.page, "rad-ark-val", theme);
        const fs = await c2.page.locator("dialog.sheet[open] .chs").textContent();
        check(fs.includes("Vilken rad lämnade du in?") && fs.includes("Raden du laddade ner eller kopierade") && (await c2.page.locator("dialog.sheet[open] .chs input").first().isChecked()), `${tag}: valet av rad, uttagen förvald`);
        check(/primary/.test(await c2.page.locator("dialog.sheet[open] .subact .btn").getAttribute("class")), `${tag}: Jag har lämnat in raden är primär efter uttag`);
        await c2.page.locator("dialog.sheet[open] .subact .btn").click();
        await c2.page.locator(".subbox .stamp").waitFor();
        await settled(c2.page);
        check(JSON.stringify((await row()).selections["1"]) === JSON.stringify(copied["1"]), `${tag}: den uttagna raden sparades`);
        await c2.ctx.close();
      }
    }

    // Efter spelstopp: inget markerat, markera sent, kopia, struken häst.
    for (const theme of THEMES) {
      for (const [w, h, touch] of [[1400, 900, false], [390, 844, true]]) {
        const tag = `${w} ${theme} efter start`;
        await preScenario();
        const { ctx, page } = await newPage(w, h, theme, { touch });
        await fresh(ctx);
        await open(page);
        await page.waitForTimeout(900);
        await settled(page);
        await liveScenario({ row: false });
        await openLive(page, "?avd=5");
        check((await page.locator(".lv").textContent()).includes("Ingen inlämnad rad") && (await page.locator(".rad").count()) === 0, `${tag}: Live säger Ingen inlämnad rad, utan RAD-märken`);
        await open(page);
        await page.waitForTimeout(300);
        check((await page.locator(".subbox").textContent()).includes("Ingen rad är markerad som inlämnad."), `${tag}: Ingen rad är markerad`);
        await shot(page, "rad-efter-inget", theme);
        await page.getByRole("button", { name: "Jag lämnade in raden före start" }).first().click();
        await page.locator("dialog.sheet[open] .subact .btn").waitFor();
        await page.waitForTimeout(350);
        await shot(page, "rad-ark-efter", theme);
        await page.locator("dialog.sheet[open] .subact .btn").click();
        await page.locator(".subbox .stamp").waitFor();
        await settled(page);
        const r = await row();
        check(r?.markedLate === true, `${tag}: markedLate ${r?.markedLate}`);
        check((await page.locator(".subbox").textContent()).includes("markerad efter spelstopp"), `${tag}: texten markerad efter spelstopp`);
        await page.waitForTimeout(200);
        await shot(page, "rad-efter-sen", theme);
        if (touch) check((await page.locator(".actbar .btn").textContent()).includes("Visa kupongen"), `${tag}: Visa kupongen i handlingsraden`);
        check((await page.getByRole("heading", { name: "Inlämnad rad per lopp" }).count()) === 1, `${tag}: Inlämnad rad per lopp`);
        await page.locator(".actbar .btn:visible, .dact .btn:visible").first().click();
        await page.locator("dialog.sheet[open]").waitFor();
        check((await page.locator("dialog.sheet[open] .subact").textContent()).startsWith("✓ Inlämnad"), `${tag}: arket säger Inlämnad`);
        await page.getByRole("button", { name: "Stäng" }).click();

        // Struken häst i kopian.
        await liveScenario();
        await open(page);
        await page.waitForTimeout(300);
        const sb = page.locator(".ban").filter({ hasText: "är struken." });
        check((await sb.count()) >= 1 && (await sb.first().textContent()).includes(`4 ${nameOf(1, 4)} i V85-1 är struken.`), `${tag}: banderoll för struken häst`);
        await shot(page, "rad-efter-struken", theme);
        await ctx.close();
      }
    }

    // Offline: markera, RAD syns, nätet tillbaka efter "start": markedLate false.
    await preScenario();
    const of = await newPage(390, 844, "light", { touch: true });
    await fresh(of.ctx);
    await open(of.page);
    await of.page.waitForTimeout(900);
    await settled(of.page);
    await of.ctx.setOffline(true);
    await of.page.waitForTimeout(100);
    await of.page.getByRole("button", { name: "Jag har lämnat in raden" }).first().click();
    await of.page.locator("dialog.sheet[open] .subact .btn").click();
    await of.page.locator(".subbox .stamp").waitFor();
    const q = await of.page.locator(".subbox").textContent();
    check(q.includes("I kö · sparas när nätet är tillbaka"), "Offline: rutan säger I kö");
    await shot(of.page, "rad-offline", "light");
    // Starten passeras efter trycket, medan posten ligger i kön.
    await of.page.waitForTimeout(1200);
    const firstStart = minutes(-0.01);
    await db.race.update({ where: { id: race(1).id }, data: { startAt: firstStart, scheduledStartAt: firstStart } });
    await of.ctx.setOffline(false);
    await of.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await settled(of.page);
    const late = await row();
    check(!!late && late.markedLate === false, `Offline: skickad efter simulerad start, markedLate ${late?.markedLate}`);
    await of.ctx.close();

    // Handlingsraden och arket vid 360 × 640: knappen syns.
    await preScenario();
    const sm = await newPage(360, 640, "light", { touch: true });
    await fresh(sm.ctx);
    await open(sm.page);
    await sm.page.waitForTimeout(900);
    await settled(sm.page);
    await sm.page.getByRole("button", { name: "Jag har lämnat in raden" }).first().click();
    await sm.page.locator("dialog.sheet[open] .subact .btn").waitFor();
    await sm.page.waitForTimeout(400);
    const y = await sm.page.evaluate(() => {
      const b = document.querySelector("dialog.sheet[open] .subact .btn").getBoundingClientRect();
      return { b: Math.round(b.bottom), h: Math.round(b.height), r: Math.round(b.right) };
    });
    check(y.b <= 640 && y.r <= 360, `Arket 360×640: knappen slutar y=${y.b}, ${y.h} px hög`);
    await sm.page.screenshot({ path: join(out, "e8-rad-ark-360x640-light.png") });
    await sm.ctx.close();
  }

  // ---- V75 ---------------------------------------------------------------------------------
} finally {
  await browser.close();
  await restore();
  await db.$disconnect();
}
console.log(failures ? `\n${failures} kontroller FELADE.` : "\nAlla kontroller gick igenom.");
process.exitCode = failures ? 1 : 0;
