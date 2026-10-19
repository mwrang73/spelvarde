// Skärmbilder av statistikbasen, spelformen, de gröna signalerna och listan
// över spelbara, i 390 × 844 och 1280 × 800, ljust och mörkt, med prefixet h-.
//
//   npm run db:local
//   npm run db:migrate:local && npm run db:seed
//   (statistikbasen inläst, t.ex. med knappen i S10)
//   SPELVARDE_FIXTURES=atg,ts npx next dev -p 3100
//   node scripts/preview-hist.mjs [--base http://localhost:3100] [--themes light,dark]

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

const r2 = (x) => Math.round(x * 100) / 100;
const dec = (x) => x.toFixed(2).replace(".", ",");
const outbox = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("sv-outbox") ?? "[]"));


const browser = await chromium.launch({ executablePath: chromePath() });
try {
  const setup = await newPage(browser, "m", "light");
  const sctx = setup.ctx;
  let cur = await api(sctx, "GET", "/api/rounds/current");
  const chain = async (id) => {
    for (let leg = 1; leg <= 8; leg++) await api(sctx, "POST", `/api/rounds/${id}/fetch/races/${leg}`, {});
    await sctx.request.post(`${BASE}/api/rounds/${id}/fetch/stats`, { data: {} });
    await api(sctx, "POST", `/api/rounds/${id}/riktodds`, {});
  };
  if (!cur.round) {
    const g = await api(sctx, "POST", "/api/rounds/fetch", {});
    await chain(g.roundId);
    cur = await api(sctx, "GET", "/api/rounds/current");
  }
  const roundId = cur.round.id;
  // Räkna om riktoddsen, så att spårets plats % ur statistikbasen kommer med.
  await api(sctx, "POST", `/api/rounds/${roundId}/riktodds`, {});
  await api(sctx, "PUT", "/api/settings", { gameType: "V85" });
  const hist = await api(sctx, "GET", "/api/admin/hist");
  log(`Statistikbas: ${hist.daysDone}/${hist.daysTotal} dagar, ${hist.races} lopp, ${hist.starts} starter (${hist.firstDate} – ${hist.lastDate}).`);

  let round = await api(sctx, "GET", `/api/rounds/${roundId}`);
  log(`Omgång ${round.round.gameType} ${round.round.trackName} ${round.round.date}.`);
  for (const r of round.races) {
    const l = r.statsLine;
    log(`  avd ${r.leg} ${r.distance} ${r.startMethod}: källa ${l.postSource}, bäst vinst ${l.bestNumber ? `${l.bestNumber.number} (${l.bestNumber.pct} %)` : "–"}, bäst plats ${l.bestPlace ? `${l.bestPlace.number} (${l.bestPlace.pct} %)` : "–"}`);
  }

  // Markeringar: i varje avdelning två Intressanta med Unibet-odds, en över
  // riktoddset (spelbar) och en strax under (nära gränsen).
  for (const r of round.races)
    for (const s of r.starts)
      if (s.mark && (s.mark.interesting || s.mark.bet || s.mark.unibetOdds !== null || s.mark.xFactor !== "NONE"))
        await api(sctx, "PUT", `/api/marks/${s.id}`, { interesting: false, bet: false, unibetOdds: null, xFactor: "NONE" });
  for (const r of round.races) {
    const ok = r.starts.filter((x) => !x.scratched && x.riktodds !== null).sort((a, b) => a.riktodds - b.riktodds);
    const [a, b] = [ok[0], ok[2]];
    if (a) await api(sctx, "PUT", `/api/marks/${a.id}`, { interesting: true, unibetOdds: r2(a.riktodds * (1 + 0.05 * r.leg)) });
    if (b) await api(sctx, "PUT", `/api/marks/${b.id}`, { interesting: true, unibetOdds: r2(Math.max(1.01, b.riktodds * 0.94)) });
  }
  round = await api(sctx, "GET", `/api/rounds/${roundId}`);
  const all = round.races.flatMap((r) => r.starts.map((s) => ({ r, s })));
  const green = all.find(({ s }) => s.quick.placePct >= 75 && s.quick.lifeStarts >= 5) ?? all.find(({ s }) => s.form.boxes.some((b) => b.tone === "second"));
  const leg = round.races.find((r) => r.startMethod === "VOLTE")?.leg ?? 1;
  log(`Spelbara: ${all.filter(({ s }) => s.mark?.spelbar).length}. Häst för S3: ${green.s.number} ${green.s.horse.name} (avd ${green.r.leg}, plats ${green.s.quick.placePct} % på ${green.s.quick.lifeStarts} starter). Volte-avd: ${leg}.`);
  await setup.ctx.close();

  for (const theme of THEMES) {
    {
      const { ctx, page } = await newPage(browser, "m", theme);
      await page.goto(`${BASE}/omgang/${roundId}/avd/${leg}`, { waitUntil: "networkidle" });
      await shot(page, "h-s2-avd", "m", theme);
      await page.getByRole("button", { name: /Loppstatistik/ }).click();
      await page.locator(".pbars").waitFor({ timeout: 30_000 });
      await shot(page, "h-s2b", "m", theme);
      await page.locator(".rstats .seg button").nth(1).click();
      await page.waitForTimeout(400);
      await shot(page, "h-s2b-bana", "m", theme);
      await page.goto(`${BASE}/omgang/${roundId}/avd/${green.r.leg}/hast/${green.s.id}`, { waitUntil: "networkidle" });
      await page.locator("dl.kv").first().waitFor();
      await page.evaluate(() => {
        document.querySelector("dl.kv")?.scrollIntoView({ block: "start" });
        window.scrollBy(0, -120);
      });
      await shot(page, "h-s3", "m", theme);
      await page.goto(`${BASE}/omgang/${roundId}/spel?flik=plats`, { waitUntil: "networkidle" });
      await shot(page, "h-s6a", "m", theme, true);
      await page.goto(`${BASE}/installningar`, { waitUntil: "networkidle" });
      await page.locator("#h-hist").waitFor();
      await shot(page, "h-s10", "m", theme, true);
      await ctx.close();
    }
    {
      const { ctx, page } = await newPage(browser, "d", theme);
      await page.goto(`${BASE}/omgang/${roundId}/avd/${leg}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      await shot(page, "h-s2", "d", theme);
      await page.goto(`${BASE}/omgang/${roundId}/spel`, { waitUntil: "networkidle" });
      await shot(page, "h-s6", "d", theme, true);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
