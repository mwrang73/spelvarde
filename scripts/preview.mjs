// Skärmbilder av E1 i 390 × 844 och 1280 × 800, ljust och mörkt (specen 13,
// Förhandsvisning). Kör mot en igång dev-server med lokal databas:
//
//   npm run db:local -- --reset      # tom databas (för S1 tom och S8 tom)
//   npm run db:migrate:local && npm run db:seed
//   SPELVARDE_FIXTURES=atg,ts npx next dev -p 3100
//   node scripts/preview.mjs [--base http://localhost:3100] [--themes light,dark]
//
// Bilderna hamnar i preview/ (ignoreras av git). Skriptet loggar in med
// SEED_ADMIN_* ur .env, trycker Hämta omgång (fixturerna) och klickar sig
// igenom flödet. Det mäter också att avd 7 får plats utan skroll och att
// avdelningsbyte inte gör några nätverksanrop.
//
// playwright-core läses från projektet eller, om det saknas här, från
// tabellgissningen-app (samma version som används för dess förhandsvisning).
// Chromium tas från ~/.cache/ms-playwright eller PREVIEW_CHROME.

import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const out = join(root, "preview");
mkdirSync(out, { recursive: true });

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const BASE = args.base || process.env.PREVIEW_BASE || "http://localhost:3100";
const THEMES = (args.themes || "light,dark").split(",");

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
  if (process.env.PREVIEW_CHROME) return process.env.PREVIEW_CHROME;
  const cache = join(homedir(), ".cache", "ms-playwright");
  const dir = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : null;
  const exe = dir && join(cache, dir, "chrome-linux64", "chrome");
  if (!exe || !existsSync(exe)) throw new Error("Hittar ingen Chromium. Sätt PREVIEW_CHROME.");
  return exe;
}

function env() {
  const vals = {};
  for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(?:"(.*)"|(.*))$/.exec(line.trim());
    if (m) vals[m[1]] = m[2] ?? m[3];
  }
  return vals;
}

const { chromium } = loadPlaywright();
const { SEED_ADMIN_EMAIL: email, SEED_ADMIN_PASSWORD: password } = env();
const SIZES = { m: { width: 390, height: 844, isMobile: true, hasTouch: true }, d: { width: 1280, height: 800 } };
const report = [];
const log = (s) => {
  report.push(s);
  console.log(s);
};

async function newPage(browser, size, theme, auth = true) {
  const { width, height, isMobile, hasTouch } = SIZES[size];
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: !!isMobile, hasTouch: !!hasTouch, colorScheme: theme, locale: "sv-SE", timezoneId: "Europe/Stockholm" });
  await ctx.addInitScript((t) => {
    try {
      if (!sessionStorage.getItem("pv-init")) {
        localStorage.setItem("sv-theme", t);
        sessionStorage.setItem("pv-init", "1");
      }
    } catch {}
  }, theme);
  if (auth) {
    const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
    if (!res.ok()) throw new Error(`Inloggningen misslyckades: ${res.status()}`);
  }
  const page = await ctx.newPage();
  return { ctx, page };
}

async function shot(page, name, size, theme, fullPage = false) {
  await page.waitForTimeout(650);
  const file = join(out, `${name}-${SIZES[size].width}-${theme}.png`);
  await page.screenshot({ path: file, fullPage });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  console.log(`  ${file.replace(root + "/", "")}${overflow > 0 ? `  (OBS: ${overflow} px vågrät skroll)` : ""}`);
}

const browser = await chromium.launch({ executablePath: chromePath() });
try {
  // ---- Inloggning ----------------------------------------------------------------
  for (const theme of THEMES)
    for (const size of ["m", "d"]) {
      const { ctx, page } = await newPage(browser, size, theme, false);
      await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
      await shot(page, "login", size, theme);
      await ctx.close();
    }

  // ---- S1 tom och S8 tom (kräver tom databas) ----------------------------------------
  const probe = await newPage(browser, "m", "light");
  const current = await (await probe.ctx.request.get(`${BASE}/api/rounds/current`)).json();
  const sources = await (await probe.ctx.request.get(`${BASE}/api/sources`)).json();
  await probe.ctx.close();
  const empty = !current.round;
  if (!empty) log("OBS: databasen har redan en omgång, så S1 tom tas inte. Kör npm run db:local -- --reset först.");
  for (const theme of THEMES)
    for (const size of ["m", "d"]) {
      const { ctx, page } = await newPage(browser, size, theme);
      if (empty) {
        await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
        await page.getByRole("heading", { name: "Ingen omgång hämtad" }).waitFor();
        await shot(page, "s1-tom", size, theme);
      }
      if (!sources.sources.length) {
        await page.goto(`${BASE}/kallor`, { waitUntil: "networkidle" });
        await page.getByRole("heading", { name: "Inga källor än" }).waitFor();
        await shot(page, "s8-tom", size, theme);
      }
      await ctx.close();
    }

  // ---- Hämta omgång --------------------------------------------------------------------
  {
    const { ctx, page } = await newPage(browser, "m", THEMES[0]);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    // Håll avd 3 en stund så att stegraden syns.
    await page.route("**/fetch/races/3", async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue().catch(() => {});
    });
    const t0 = Date.now();
    const btn = empty ? page.getByRole("button", { name: "Hämta omgång" }) : page.getByRole("button", { name: "Hämta omgången igen" });
    await btn.click();
    await page.getByText("Avd 3 av 8 …").waitFor({ timeout: 60_000 });
    await shot(page, "s1-hamtar", "m", THEMES[0]);
    await page.locator(".orow").nth(7).waitFor({ timeout: 120_000 });
    await page.waitForFunction(() => !document.querySelector(".steps"), null, { timeout: 120_000 });
    log(`Hämta omgång: klart på ${((Date.now() - t0) / 1000).toFixed(1)} s inklusive 2,5 s fördröjning.`);
    await ctx.close();
  }

  // Omgångens id och en häst med galopp i avd 7 (för S3).
  const api = await newPage(browser, "m", "light");
  const cur = await (await api.ctx.request.get(`${BASE}/api/rounds/current`)).json();
  const roundId = cur.round.id;
  const round = await (await api.ctx.request.get(`${BASE}/api/rounds/${roundId}`)).json();
  const race7 = round.races.find((r) => r.leg === 7);
  // Hästkortet med galoppvarning: helst i avd 7, annars första avdelningen med galopp (GD före G).
  const allStarts = [race7, ...round.races.filter((r) => r.leg !== 7)].flatMap((r) => r.starts.map((s) => ({ s, leg: r.leg })));
  const pick = allStarts.find((x) => x.s.form.gallop === "GD") ?? allStarts.find((x) => x.s.form.gallop) ?? { s: race7.starts[0], leg: 7 };
  const galStart = pick.s;
  const galLeg = pick.leg;
  const big = round.races.find((r) => r.starts.length >= 15) ?? round.races[1];
  await api.ctx.close();
  // Påhittade siffror för exempelbilden av S2b (märkt "exempeldata").
  const realStats = await (await (await newPage(browser, "m", "light")).ctx.request.get(`${BASE}/api/rounds/${roundId}/races/7/stats`)).json();
  const pcts = [7.6, 9.8, 10.4, 11.0, 12.2, 9.1, 8.3, 5.9, 6.8, 3.1, 4.4, 3.5];
  const exampleStats = {
    ...realStats,
    startnr: { ...realStats.startnr, ok: true, error: null, fetchedAt: new Date().toISOString(), leg: { leg: 7, classCode: "G", distance: 2640, method: "AUTO", extra: null, races: 62, byNumber: pcts.map((p, i) => ({ n: i + 1, count: Math.round(p * 0.62), pct: p })) } },
    favorites: { ...realStats.favorites, ok: true, error: null, fetchedAt: new Date().toISOString(), favoriteWinPct: 54.5, overallWinPct: 36.7 },
    drivers: { ...realStats.drivers, ok: true, error: null, fetchedAt: new Date().toISOString(), rows: realStats.drivers.rows.map((r, i) => (r.linked && i < 4 ? { ...r, league: { rank: i + 1, name: r.rawName ?? r.name, wins: 36 - i * 7, favorite: 0, favoriteWins: 0, favoriteWinPct: null, wonRank23: 0, wonRank46: 0, wonRank7: 0 } } : r)) },
  };
  log(`Omgång ${roundId}, avd 7 har ${race7.starts.length} hästar, S3 visar avd ${galLeg} nr ${galStart.number} ${galStart.horse.name} (${galStart.form.gallop ?? "ingen galopp"}), avd ${big.leg} har ${big.starts.length} hästar.`);

  // ---- Mobil -----------------------------------------------------------------------------
  for (const theme of THEMES) {
    const { ctx, page } = await newPage(browser, "m", theme);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.locator(".orow").first().waitFor();
    await shot(page, "s1-hamtad", "m", theme);

    // Delvis klar: avd 5 svarar 502.
    if (theme === THEMES[0]) {
      await page.route("**/fetch/races/5", (route) => route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "ATG svarade inte" }) }));
      await page.getByRole("button", { name: "Hämta omgången igen" }).click();
      await page.getByText("Hämtningen stannade vid avd 5").first().waitFor({ timeout: 60_000 });
      await page.waitForFunction(() => !document.querySelector(".steps"), null, { timeout: 60_000 });
      await shot(page, "s1-delvis", "m", theme);
      await page.unroute("**/fetch/races/5");
      await page.getByRole("button", { name: "Försök igen" }).first().click();
      await page.waitForFunction(() => !document.querySelector(".ban.warn[role=alert]") && !document.querySelector(".steps"), null, { timeout: 60_000 });
    }

    await page.goto(`${BASE}/omgang/${roundId}/avd/7`, { waitUntil: "networkidle" });
    await page.locator(".mlist .row").nth(race7.starts.length - 1).waitFor();
    if (theme === THEMES[0]) {
      // Markera några som Intressant (optimistiskt, via utkorgen).
      for (const n of [3, 5, 10]) {
        const lamp = page.locator(`.mlist .row:nth-child(${n}) .lamp`);
        if ((await lamp.getAttribute("aria-pressed")) !== "true") await lamp.click();
      }
      await page.waitForTimeout(1500);
    }
    await shot(page, "s2-avd7", "m", theme);
    if (theme === THEMES[0]) {
      const m = await page.evaluate(() => {
        const rows = [...document.querySelectorAll(".mlist .row")];
        const last = rows[rows.length - 1].getBoundingClientRect();
        const tab = document.querySelector(".tabbar").getBoundingClientRect();
        const heights = [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))];
        const stick = document.querySelector(".stick").getBoundingClientRect().height;
        return { rows: rows.length, lastBottom: Math.round(last.bottom), tabTop: Math.round(tab.top), vh: innerHeight, heights, stick: Math.round(stick), scrollY: scrollY };
      });
      log(
        `S2 avd 7 på 390 × 844: ${m.rows} rader à ${m.heights.join("/")} px, fast del ${m.stick} px, sista raden slutar på y=${m.lastBottom} och bottenmenyn börjar på y=${m.tabTop} (skroll ${m.scrollY}). ${m.lastBottom <= m.tabTop ? "Alla rader syns utan skroll." : "OBS: sista raden skyms."}`,
      );

      // Avdelningsbyte ska inte gå mot nätet.
      const reqs = [];
      const onReq = (r) => {
        if (["fetch", "xhr", "document"].includes(r.resourceType())) reqs.push(`${r.method()} ${r.url()}`);
      };
      page.on("request", onReq);
      for (let n = 1; n <= 8; n++) await page.getByRole("tab", { name: new RegExp(`^Avdelning ${n},`) }).click();
      await page.getByRole("tab", { name: /^Avdelning 8,/ }).focus();
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("Home");
      // Svep vänster på listan (nästa avdelning).
      await page.evaluate(() => {
        const el = document.querySelector(".mlist");
        const r = el.getBoundingClientRect();
        const mk = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: r.top + 100 });
        el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [mk(300)], changedTouches: [mk(300)] }));
        el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [mk(150)] }));
      });
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => location.pathname);
      page.off("request", onReq);
      log(`Avdelningsbyte (8 flikar, ← och Home på flikarna, ett svep): ${reqs.length} nätverksanrop${reqs.length ? `: ${reqs.join(", ")}` : ""}. Adress efter svep: ${after}.`);
    }

    // 15 hästar: skrolla till botten, rubriker och flikar ska ligga kvar.
    await page.getByRole("tab", { name: new RegExp(`^Avdelning ${big.leg},`) }).click();
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    if (theme === THEMES[0]) {
      const s = await page.evaluate(() => ({ stickTop: Math.round(document.querySelector(".stick").getBoundingClientRect().top), scrollY: Math.round(scrollY) }));
      log(`S2 avd ${big.leg} med ${big.starts.length} hästar, skrollad ${s.scrollY} px: rubrik, flikar, remsa och kolumnrubrik ligger på y=${s.stickTop}.`);
    }
    await shot(page, `s2-avd${big.leg}-15`, "m", theme);

    // S2b
    await page.getByRole("tab", { name: /^Avdelning 7,/ }).click();
    await page.getByRole("button", { name: "Loppstatistik ›" }).click();
    await page.locator("dialog.sheet[open] .rstats").waitFor();
    await shot(page, "s2b", "m", theme);
    await page.keyboard.press("Escape");

    // S2b med exempeldata: travstatistik.se visar en annan omgång just nu,
    // så svaret byts ut här (bara i skriptet) för att visa staplarna.
    if (exampleStats) {
      await page.route(`**/api/rounds/${roundId}/races/7/stats`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(exampleStats) }));
      await page.goto(`${BASE}/omgang/${roundId}/avd/7`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Loppstatistik ›" }).click();
      await page.locator("dialog.sheet[open] .bars").waitFor();
      await shot(page, "s2b-exempeldata", "m", theme);
      await page.keyboard.press("Escape");
      await page.unroute(`**/api/rounds/${roundId}/races/7/stats`);
    }

    // S3 med galoppvarning.
    await page.goto(`${BASE}/omgang/${roundId}/avd/${galLeg}`, { waitUntil: "networkidle" });
    await page.locator(`.mlist [data-start="${galStart.id}"] .who`).click();
    await page.locator(".daside .starts, .daside .stat-empty").first().waitFor({ timeout: 30_000 });
    if (theme === THEMES[0]) {
      await page.getByLabel("Kommentar inför loppet").fill("Galopperade i första svängen senast. Bra spår nu.");
      await page.waitForTimeout(1800);
      await page.getByRole("button", { name: "Spara", exact: true }).last().click();
      await page.waitForTimeout(1200);
    }
    await shot(page, "s3", "m", theme);
    await page.locator(".daside .cmts, .daside .hk-sec:has(textarea)").first().scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 200));
    await shot(page, "s3-kommentarer", "m", theme);

    await page.goto(`${BASE}/installningar`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Konto" }).waitFor();
    await shot(page, "s10", "m", theme);
    await ctx.close();
  }

  // ---- Desktop ----------------------------------------------------------------------------
  for (const theme of THEMES) {
    const { ctx, page } = await newPage(browser, "d", theme);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.locator(".orow").first().waitFor();
    await shot(page, "s1-hamtad", "d", theme);
    await page.goto(`${BASE}/omgang/${roundId}/avd/${galLeg}/hast/${galStart.id}`, { waitUntil: "networkidle" });
    await page.locator(".daside .starts, .daside .stat-empty").first().waitFor({ timeout: 30_000 });
    await shot(page, `s2-avd${galLeg}-hastkort`, "d", theme);
    await page.getByRole("button", { name: /Loppstatistik/ }).click();
    await page.locator(".dpanel .rstats").waitFor();
    await shot(page, "s2b", "d", theme);
    await page.getByRole("button", { name: /Loppstatistik/ }).click();
    await page.goto(`${BASE}/omgang/${roundId}/avd/${big.leg}`, { waitUntil: "networkidle" });
    await page.locator(".tbl tbody tr").nth(big.starts.length - 1).waitFor();
    await shot(page, `s2-avd${big.leg}-15`, "d", theme);
    await page.goto(`${BASE}/kallor`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /Inga källor än|Källor/ }).first().waitFor();
    await shot(page, "s8", "d", theme);
    await page.goto(`${BASE}/installningar`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Konto" }).waitFor();
    await shot(page, "s10", "d", theme);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log("\n" + report.join("\n"));
