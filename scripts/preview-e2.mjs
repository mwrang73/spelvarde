// Skärmbilder av E2 i 390 × 844 och 1280 × 800, ljust och mörkt (specen 13,
// Förhandsvisning). Samma förutsättningar som scripts/preview.mjs:
//
//   npm run db:local -- --reset
//   npm run db:migrate:local && npm run db:seed
//   SPELVARDE_FIXTURES=atg,ts npx next dev -p 3100
//   node scripts/preview-e2.mjs [--base http://localhost:3100] [--themes light,dark]
//
// Skriptet hämtar omgången (fixturerna) om den saknas, markerar Intressant
// och fyller i några odds via API:t och klickar sedan igenom S4 (knappsatsen
// och sammanfattningsarket), S6a, S6b, S3, S2 och S10. Det mäter också att
// avd 7 får plats utan skroll, hur lång tid det automatiska hoppet tar och
// att avdelnings- och hästbyten inte gör några nätverksanrop.

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

const browser = await chromium.launch({ executablePath: chromePath() });
try {
  // ---- Omgången och markeringarna ----------------------------------------------------------
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
  let round = await api(setup.ctx, "GET", `/api/rounds/${roundId}`);
  const withRikt = round.races.flatMap((r) => r.starts).filter((s) => s.riktodds !== null).length;
  log(`Omgång ${roundId}: ${withRikt} starter med riktodds, modell ${round.model?.key ?? "saknas"}.`);
  for (const r of round.races) {
    const sum = r.starts.reduce((a, s) => a + (s.probTop3 ?? 0), 0);
    if (r.starts.some((s) => s.probTop3 !== null)) log(`  Avd ${r.leg}: summa P3 = ${sum.toFixed(3)} (${r.starts.filter((s) => s.uncertain && !s.scratched).length} osäkra)`);
  }

  // Två intressanta per avdelning (de med lägst riktodds), odds för de första 9.
  const picks = round.races.flatMap((r) =>
    r.starts
      .filter((s) => !s.scratched && s.riktodds !== null)
      .sort((a, b) => a.riktodds - b.riktodds)
      .slice(r.leg === 7 ? 0 : 1, r.leg === 7 ? 3 : 3)
      .map((s) => ({ s, leg: r.leg })),
  );
  // Nollställ tidigare körningar.
  for (const r of round.races) for (const s of r.starts) if (s.mark && (s.mark.interesting || s.mark.bet || s.mark.unibetOdds !== null)) await api(setup.ctx, "PUT", `/api/marks/${s.id}`, { interesting: false, bet: false, unibetOdds: null });
  for (const [i, p] of picks.entries()) {
    const body = { interesting: true };
    // Varannan över riktoddset, varannan under. De sista får inga odds (S4 börjar med dem).
    if (i < picks.length - 6) body.unibetOdds = Math.max(1.01, Math.round((p.s.riktodds + (i % 2 === 0 ? 0.6 + i * 0.05 : -0.2)) * 100) / 100);
    await api(setup.ctx, "PUT", `/api/marks/${p.s.id}`, body);
  }
  // Ett ändrat odds ("Ändrat från …") och en Bet.
  const changed = picks[0];
  await api(setup.ctx, "PUT", `/api/marks/${changed.s.id}`, { unibetOdds: Math.round((changed.s.riktodds + 1.1) * 100) / 100 });
  await api(setup.ctx, "PUT", `/api/marks/${picks[2].s.id}`, { bet: true });
  await setup.ctx.request.fetch(`${BASE}/api/rounds/${roundId}/coupon`, { method: "PUT", data: { budget: 200, selections: {}, lockedLegs: [] } });
  round = await api(setup.ctx, "GET", `/api/rounds/${roundId}`);
  const spelbarStart = round.races.flatMap((r) => r.starts.map((s) => ({ s, leg: r.leg }))).find((x) => x.s.mark?.spelbar && x.s.riktodds !== null);
  log(`${picks.length} Intressant, ${round.races.reduce((a, r) => a + r.counts.spelbar, 0)} spelbara efter förifyllda odds. Hästkortet visar avd ${spelbarStart.leg} nr ${spelbarStart.s.number} ${spelbarStart.s.horse.name}.`);
  await setup.ctx.close();

  for (const theme of THEMES) {
    const first = theme === THEMES[0];
    // ---- Mobil ----------------------------------------------------------------------------
    {
      const { ctx, page } = await newPage(browser, "m", theme);
      // S2 avd 7: riktoddskolumnen och märkena.
      await page.goto(`${BASE}/omgang/${roundId}/avd/7`, { waitUntil: "networkidle" });
      await page.locator(".mlist .row").last().waitFor();
      await shot(page, "e2-s2-avd7", "m", theme);
      if (first) {
        const m = await page.evaluate(() => {
          const rows = [...document.querySelectorAll(".mlist .row")];
          const last = rows[rows.length - 1].getBoundingClientRect();
          const tab = document.querySelector(".tabbar").getBoundingClientRect();
          const rk = [...document.querySelectorAll(".mlist .rk")].map((e) => ({ w: e.scrollWidth, cw: e.clientWidth }));
          const names = [...document.querySelectorAll(".mlist .hl")].filter((e) => e.scrollWidth > e.clientWidth + 1).length;
          const heights = [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))];
          return { rows: rows.length, lastBottom: Math.round(last.bottom), tabTop: Math.round(tab.top), heights, rkOverflow: rk.filter((r) => r.w > r.cw).length, names, sx: document.documentElement.scrollWidth - innerWidth };
        });
        log(
          `S2 avd 7 på 390 × 844: ${m.rows} rader à ${m.heights.join("/")} px, sista raden slutar på y=${m.lastBottom}, bottenmenyn börjar på y=${m.tabTop}: ${m.lastBottom <= m.tabTop ? "alla rader syns utan skroll" : "OBS: sista raden skyms"}. Riktoddsceller som flödar över: ${m.rkOverflow}. Vågrät skroll: ${m.sx} px.`,
        );
        // Avdelnings- och hästbyte utan nätverk.
        const reqs = [];
        const onReq = (r) => {
          if (["fetch", "xhr", "document"].includes(r.resourceType())) reqs.push(`${r.method()} ${r.url()}`);
        };
        page.on("request", onReq);
        for (let n = 1; n <= 8; n++) await page.getByRole("tab", { name: new RegExp(`^Avdelning ${n},`) }).click();
        await page.getByRole("tab", { name: /^Avdelning 7,/ }).click();
        await page.waitForTimeout(300);
        page.off("request", onReq);
        log(`Mobil: 9 avdelningsbyten gav ${reqs.length} nätverksanrop${reqs.length ? `: ${reqs.join(", ")}` : ""}.`);
      }

      // S3 med riktodds och skäl.
      await page.goto(`${BASE}/omgang/${roundId}/avd/${spelbarStart.leg}/hast/${spelbarStart.s.id}`, { waitUntil: "networkidle" });
      await page.locator(".daside .rbox").waitFor();
      await page.locator(".daside .formula").waitFor({ timeout: 20_000 });
      await page.locator(".daside .rbox").scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -170));
      await shot(page, "e2-s3-riktodds", "m", theme);

      // S4: knappsatsen mitt i inmatningen (1-2-5-0 = 12,50 kräver Nästa).
      await page.goto(`${BASE}/omgang/${roundId}/odds`, { waitUntil: "networkidle" });
      await page.locator(".kp").waitFor();
      const kp = (k) => page.locator(".kp button", { hasText: new RegExp(`^${k}$`) }).click();
      if (first) {
        // 3-1-0: sparas och hoppar till nästa häst inom 350 ms.
        const before = await page.locator(".kn").textContent();
        await kp("3");
        await kp("1");
        const t0 = Date.now();
        await kp("0");
        await page.waitForFunction((b) => document.querySelector(".kn")?.textContent !== b, before, { timeout: 3000 });
        log(`S4: 3-1-0 sparades och hoppade från ${before} på ${Date.now() - t0} ms (inklusive 350 ms väntan och klicket).`);
        await page.getByRole("button", { name: "‹ Föregående" }).click();
        const disp = await page.locator(".kdisp").textContent();
        log(`S4: Föregående visar det sparade oddset ${disp}.`);
        await page.getByRole("button", { name: "Hoppa över" }).click();
      }
      for (const k of ["1", "2", "5", "0"]) await kp(k);
      await shot(page, "e2-s4-inmatning", "m", theme);
      await page.getByRole("button", { name: "Nästa ›" }).click();
      // Fyll i resten: 2-6-0 (2,60), växelvis 4-1-0.
      for (let i = 0; i < 20; i++) {
        if (await page.locator("dialog.sheet[open]").count()) break;
        const ks = i % 2 ? ["2", "6", "0"] : ["4", "1", "0"];
        for (const k of ks) await kp(k);
        await page.waitForTimeout(500);
      }
      await page.locator("dialog.sheet[open]").waitFor();
      await shot(page, "e2-s4-sammanfattning", "m", theme);
      await page.getByRole("button", { name: "Stäng" }).click();
      await settled(page);

      // S6a Platsspel.
      await page.goto(`${BASE}/omgang/${roundId}/spel?flik=plats`, { waitUntil: "networkidle" });
      await page.locator(".brow").first().waitFor();
      // Rätta ett odds under riktoddset (varningen) och markera Bet.
      const firstRow = page.locator(".brow").first();
      const rikt = await firstRow.locator(".pm b").textContent();
      await firstRow.locator(".oin").fill(String(Math.max(1.01, Number(rikt.replace(",", ".")) - 0.3).toFixed(2)).replace(".", ","));
      await firstRow.locator(".oin").press("Enter");
      await page.locator(".brow").nth(1).locator(".betk").click();
      // Ett ogiltigt odds visar felet.
      await page.locator(".brow").nth(2).locator(".oin").fill("1");
      await page.locator(".brow").nth(2).locator(".oin").press("Enter");
      await shot(page, "e2-s6a", "m", theme);
      await page.locator(".brow").nth(2).locator(".oin").press("Escape");

      // S6b V85-rad: föreslå inom budget.
      await page.getByRole("button", { name: "V85-rad" }).click();
      await page.getByRole("button", { name: "Föreslå inom budget" }).click();
      await shot(page, "e2-s6b-inom", "m", theme);
      // Eget val i avd 3 (låst) och för låg budget.
      await page.locator(".vrow").nth(2).locator(".vpick").click();
      await page.locator("dialog.sheet[open] .hchip").nth(0).click();
      await page.locator("dialog.sheet[open] .hchip").nth(4).click();
      await shot(page, "e2-s6b-arket", "m", theme);
      await page.getByRole("button", { name: "Klar", exact: true }).click();
      await page.getByLabel("Exakt belopp").fill("40");
      await page.getByLabel("Exakt belopp").press("Enter");
      await page.locator(".vrow").nth(4).getByRole("button", { name: /En häst till/ }).click();
      await shot(page, "e2-s6b-over", "m", theme);
      if (first) {
        await page.getByRole("button", { name: "Spela hos ATG" }).click();
        await page.getByRole("button", { name: "Kopiera texten" }).click();
        await page.getByText("Raden är kopierad.").waitFor({ timeout: 5000 });
        const text = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
        log(`Kopiera texten: ${text ? JSON.stringify(text) : "statusraden visades (urklippet gick inte att läsa)"}`);
        await page.getByRole("button", { name: "Stäng" }).click();
        await settled(page);
        const c = await api(ctx, "GET", `/api/rounds/${roundId}/coupon`);
        log(`Kupongen sparad på servern: budget ${c.coupon.budget}, ${c.coupon.rows} rader, ${c.coupon.cost} kr, låsta avd ${JSON.stringify(c.coupon.lockedLegs)}.`);
      }
      // Tillbaka till en rimlig budget för desktopbilden.
      await page.getByLabel("Exakt belopp").fill("200");
      await page.getByLabel("Exakt belopp").press("Enter");
      await page.getByRole("button", { name: "Föreslå inom budget" }).click();
      await settled(page);

      // S1 med räknarna.
      await page.goto(`${BASE}/omgang/${roundId}`, { waitUntil: "networkidle" });
      await page.locator(".orow").first().waitFor();
      await shot(page, "e2-s1", "m", theme);

      // S10 med modellvikterna.
      await page.goto(`${BASE}/installningar`, { waitUntil: "networkidle" });
      await page.locator(".wtbl").waitFor();
      await page.locator("#h-spel").scrollIntoViewIfNeeded();
      await shot(page, "e2-s10", "m", theme);
      await page.locator(".wtbl").scrollIntoViewIfNeeded();
      await shot(page, "e2-s10-modell", "m", theme);
      await ctx.close();
    }

    // ---- Desktop ---------------------------------------------------------------------------
    {
      const { ctx, page } = await newPage(browser, "d", theme);
      await page.goto(`${BASE}/omgang/${roundId}/avd/${spelbarStart.leg}/hast/${spelbarStart.s.id}`, { waitUntil: "networkidle" });
      await page.locator(".daside .formula").waitFor({ timeout: 20_000 });
      await shot(page, "e2-s2-s3", "d", theme);
      if (first) {
        const reqs = [];
        const onReq = (r) => {
          if (["fetch", "xhr", "document"].includes(r.resourceType()) && !r.url().includes("/api/starts/") && !r.url().includes("/stats")) reqs.push(`${r.method()} ${r.url()}`);
        };
        page.on("request", onReq);
        await page.locator(".tbl tbody tr").nth(2).click();
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("ArrowDown");
        await page.locator(".vt").nth(6).click();
        await page.locator(".vt").nth(spelbarStart.leg - 1).click();
        await page.waitForTimeout(400);
        page.off("request", onReq);
        log(`Desktop: hästbyten (klick, ↓ ↓) och två avdelningsbyten gav ${reqs.length} anrop mot omgången${reqs.length ? `: ${reqs.join(", ")}` : ""} (hästkortens GET /api/starts räknas inte; de är förhandsladdning enligt 9.1).`);
      }
      await page.goto(`${BASE}/omgang/${roundId}/spel`, { waitUntil: "networkidle" });
      await page.locator(".ptbl").first().waitFor();
      await shot(page, "e2-s6", "d", theme);
      await page.goto(`${BASE}/omgang/${roundId}/odds`, { waitUntil: "networkidle" });
      await page.locator(".kpw, .kend").first().waitFor();
      await page.keyboard.press("Home");
      // Tangentbordet: Föregående med ← tills första hästen, skriv 4,10 med punkt.
      for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowLeft");
      for (const k of ["4", ".", "1"]) await page.keyboard.press(k);
      await shot(page, "e2-s4-tangentbord", "d", theme);
      if (first) {
        const disp = await page.locator(".kdisp").textContent();
        await page.keyboard.press("Backspace");
        await page.keyboard.press("Backspace");
        log(`Desktop S4: 4 . 1 på tangentbordet visar ${disp} (punkten ignoreras).`);
      }
      await page.goto(`${BASE}/installningar`, { waitUntil: "networkidle" });
      await page.locator(".wtbl").waitFor();
      await page.locator("#h-spel").scrollIntoViewIfNeeded();
      await shot(page, "e2-s10", "d", theme);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
console.log("\n" + report.join("\n"));
