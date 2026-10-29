// Skärmbilder av E6b Max hästar per lopp och prioriterat lopp
// (docs/specs/e6b-max-per-lopp.md 9.2.5) i 390 × 844 och 1280 × 800, ljust
// och mörkt. Samma förutsättningar som scripts/preview-e2.mjs:
//
//   npm run db:local
//   npm run db:migrate:local && npm run db:seed
//   SPELVARDE_FIXTURES=atg,ts npx next dev -p 3100
//   node scripts/preview-e6b.mjs [--base http://localhost:3100] [--themes light,dark]
//
// Skriptet sparar en ny rad (tak 7, Auto) och tar bilder av Regler för raden,
// arket Välj lopp att prioritera, kortet för det prioriterade loppet, taket
// Alla och läget efter spelstopp (webbläsarens klocka efter första starten).

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

async function newPage(browser, size, theme) {
  const { width, height, isMobile, hasTouch } = SIZES[size];
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: !!isMobile, hasTouch: !!hasTouch, colorScheme: theme, locale: "sv-SE", timezoneId: "Europe/Stockholm" });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE }).catch(() => {});
  await ctx.addInitScript((t) => {
    try {
      if (!sessionStorage.getItem("pv-init")) {
        localStorage.setItem("sv-theme", t);
        sessionStorage.setItem("pv-init", "1");
      }
    } catch {}
  }, theme);
  const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
  if (!res.ok()) throw new Error(`Inloggningen misslyckades: ${res.status()}`);
  const page = await ctx.newPage();
  // Första kompileringen i next dev kan ta en halv minut per vy.
  page.setDefaultNavigationTimeout(180_000);
  page.setDefaultTimeout(60_000);
  return { ctx, page };
}

async function shot(page, name, size, theme, fullPage = false) {
  await page.waitForTimeout(650);
  const file = join(out, `${name}-${SIZES[size].width}-${theme}.png`);
  await page.screenshot({ path: file, fullPage });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  console.log(`  ${file.replace(root + "/", "")}${overflow > 0 ? `  (OBS: ${overflow} px vågrät skroll)` : ""}`);
}

const api = async (ctx, method, url, data) => {
  const res = await ctx.request.fetch(`${BASE}${url}`, { method, data });
  const body = await res.json().catch(() => null);
  if (!res.ok()) throw new Error(`${method} ${url}: ${res.status()} ${JSON.stringify(body)}`);
  return body;
};

// Väntar tills utkorgen är tom (allt sparat).
const settled = (page) => page.waitForFunction(() => (localStorage.getItem("sv-outbox") ?? "[]") === "[]", null, { timeout: 20_000 });


const rulesOf = (page) => page.locator("section.rules");
const prioCard = (page) => page.locator("section.lg").filter({ has: page.locator(".lr.allg") }).first();

const browser = await chromium.launch({ executablePath: chromePath() });
try {
  const setup = await newPage(browser, "m", "light");
  let cur = await api(setup.ctx, "GET", "/api/rounds/current");
  const chain = async (id) => {
    for (let leg = 1; leg <= 8; leg++) await api(setup.ctx, "POST", `/api/rounds/${id}/fetch/races/${leg}`, {});
    await setup.ctx.request.post(`${BASE}/api/rounds/${id}/fetch/stats`, { data: {} });
    await api(setup.ctx, "POST", `/api/rounds/${id}/riktodds`, {});
  };
  if (!cur.round) {
    const g = await api(setup.ctx, "POST", "/api/rounds/fetch", {});
    await chain(g.roundId);
    cur = await api(setup.ctx, "GET", "/api/rounds/current");
  } else {
    const r0 = await api(setup.ctx, "GET", `/api/rounds/${cur.round.id}`);
    if (r0.fetch.resumeFrom || !r0.races.some((r) => r.starts.some((s) => s.riktodds !== null))) await chain(cur.round.id);
  }
  const roundId = cur.round.id;
  const round = await api(setup.ctx, "GET", `/api/rounds/${roundId}`);
  const firstStart = round.races.map((r) => r.startTime ?? r.startAt).filter(Boolean).sort()[0];
  log(`Omgång ${roundId} (${round.round.gameType}), första start ${firstStart}.`);
  await setup.ctx.close();

  // Ny rad: tak 7, Auto, 2 spikar, budget 400.
  const fresh = (ctx) =>
    api(ctx, "PUT", `/api/rounds/${roundId}/coupon`, { budget: 400, rowPrice: 0.5, selections: {}, lockedLegs: [], spikCount: 2, allgMode: "AUTO", allgLeg: null, maxPerLeg: 7, legRoles: null, copiedAt: null, copiedSelections: null });
  const url = `${BASE}/omgang/${roundId}/spel?flik=rad`;

  for (const theme of THEMES) {
    for (const size of ["m", "d"]) {
      const { ctx, page } = await newPage(browser, size, theme);
      await fresh(ctx);
      await page.goto(url, { waitUntil: "networkidle" });
      await rulesOf(page).waitFor();
      await settled(page);
      // 1. Regler för raden, tak 7, Auto.
      await page.getByText("Max hästar per lopp", { exact: true }).scrollIntoViewIfNeeded();
      if (size === "m") await page.evaluate(() => window.scrollBy(0, -80));
      await shot(page, "e6b-regler-tak7", size, theme);
      // 2. Arket Välj lopp att prioritera.
      await rulesOf(page).getByRole("button", { name: "Välj avd" }).click();
      await page.locator("dialog.sheet[open] .hchips").waitFor();
      await shot(page, "e6b-arket", size, theme);
      await page.locator("dialog.sheet[open]").getByRole("button", { name: "Avbryt" }).click();
      // 3. Kortet för det prioriterade loppet (7 av n).
      await prioCard(page).scrollIntoViewIfNeeded();
      if (size === "m") await page.evaluate(() => window.scrollBy(0, -60));
      const tag = await prioCard(page).locator(".lr.allg").innerText();
      if (theme === THEMES[0] && size === "m") log(`Kortet: typtaggen "${tag}". Varför-raden: ${await prioCard(page).locator(".lg-w").innerText()}`);
      await shot(page, "e6b-kortet", size, theme);
      // 4. Tak Alla: + tills Alla.
      const plus = rulesOf(page).getByRole("button", { name: "En häst till per lopp" });
      for (let i = 0; i < 30 && (await plus.isEnabled()); i++) await plus.click();
      await page.waitForTimeout(900);
      await settled(page);
      await page.getByText("Max hästar per lopp", { exact: true }).scrollIntoViewIfNeeded();
      if (size === "m") await page.evaluate(() => window.scrollBy(0, -80));
      if (theme === THEMES[0] && size === "m") {
        const c = await api(ctx, "GET", `/api/rounds/${roundId}/coupon`);
        log(`Alla: stegaren visar "${await rulesOf(page).locator(".stp output").nth(1).innerText()}", sparat maxPerLeg ${JSON.stringify(c.coupon?.maxPerLeg)}.`);
      }
      await shot(page, "e6b-alla", size, theme);
      if (size === "d") {
        await prioCard(page).scrollIntoViewIfNeeded();
        await shot(page, "e6b-kortet-alla", size, theme);
      }
      // Tillbaka till 7 och spara, så att raden efter spelstopp har taket.
      const minus = rulesOf(page).getByRole("button", { name: "En häst färre per lopp" });
      for (let i = 0; i < 30; i++) {
        const v = await rulesOf(page).locator(".stp output").nth(1).innerText();
        if (v === "7") break;
        await minus.click();
      }
      await page.waitForTimeout(800);
      await settled(page);
      await ctx.close();

      // 5. Efter spelstopp.
      const st = await newPage(browser, size, theme);
      await st.page.clock.install({ time: new Date(new Date(firstStart).getTime() + 5 * 60_000) });
      await st.page.goto(url, { waitUntil: "networkidle" });
      await rulesOf(st.page).waitFor();
      // Kortet Regler för raden överst under vyrubriken.
      await st.page.evaluate(() => {
        document.querySelector("section.rules")?.scrollIntoView({ block: "start" });
        window.scrollBy(0, -130);
      });
      if (theme === THEMES[0] && size === "m") log(`Efter spelstopp: ${await rulesOf(st.page).locator(".help").allInnerTexts().then((t) => t.join(" | "))}`);
      await shot(st.page, "e6b-spelstopp", size, theme);
      await prioCard(st.page).scrollIntoViewIfNeeded().catch(() => {});
      const sc = st.page.locator("section.lg").filter({ hasText: "Prioriterat lopp vid spelstopp" }).first();
      if (await sc.count()) {
        await sc.scrollIntoViewIfNeeded();
        if (theme === THEMES[0] && size === "m") log(`Kortet efter spelstopp: ${await sc.locator(".lg-w").innerText()}`);
        await shot(st.page, "e6b-spelstopp-kortet", size, theme);
      }
      await st.ctx.close();
    }
  }
} finally {
  await browser.close();
}
console.log("\n" + report.join("\n"));
