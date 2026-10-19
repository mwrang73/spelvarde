// Skärmbilder av E2.1 (X-faktor och källstöd, specen 6.8) i 390 × 844 och
// 1280 × 800, ljust och mörkt, med prefixet x-. Samma förutsättningar som
// scripts/preview-e2.mjs:
//
//   npm run db:local
//   npm run db:migrate:local && npm run db:seed
//   SPELVARDE_FIXTURES=atg,ts npx next dev -p 3100
//   node scripts/preview-x.mjs [--base http://localhost:3100] [--themes light,dark]
//
// Skriptet ser till att omgången (fixturerna) finns, slår på fyra källor,
// sätter X-faktor, källstöd, Intressant och odds via API:t i avd 7 och
// klickar sedan igenom S2, S3 (lägesväljaren, källstödet, toasten och Ångra),
// S4 (XCycleButton och 350 ms-fönstret), sammanfattningsarket, S6a och S10.
// Det mäter att avd 7 fortfarande får plats utan skroll, att avdelnings- och
// hästbyten inte gör några nätverksanrop och att tangenten X fungerar.

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
  // ---- Omgången, källorna och avd 7 ---------------------------------------------------------
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
  } else {
    const r0 = await api(sctx, "GET", `/api/rounds/${cur.round.id}`);
    if (r0.fetch.resumeFrom || !r0.races.some((r) => r.starts.some((s) => s.riktodds !== null))) await chain(cur.round.id);
  }
  const roundId = cur.round.id;

  // Fyra påslagna källor (m i "n av m källor").
  const sources = await api(sctx, "GET", "/api/sources");
  const list = Array.isArray(sources) ? sources : sources.sources ?? [];
  const enabled = list.filter((s) => s.enabled).length;
  for (let i = enabled; i < 4; i++) await api(sctx, "POST", "/api/sources", { url: `https://exempel-${i + 1}.example.com/v85`, name: `Källa ${i + 1}` });
  // Standardfaktorerna.
  await api(sctx, "PUT", "/api/settings", { xFactorTror: 1.25, xFactorStark: 1.5 });

  let round = await api(sctx, "GET", `/api/rounds/${roundId}`);
  log(`Omgång ${roundId} (${round.round.trackName} ${round.round.date}), ${round.sourcesEnabled} påslagna källor, faktorer ${dec(round.settings.xFactorTror)}/${dec(round.settings.xFactorStark)}.`);
  const avd7 = round.races.find((r) => r.leg === 7);
  const ok7 = avd7.starts.filter((s) => !s.scratched && s.riktodds !== null && s.riktodds >= 1.6).sort((a, b) => a.riktodds - b.riktodds);
  const [A, B, C] = ok7;
  // A: Unibet mellan riktoddset med Tror på och riktoddset → bara spelbar med X.
  const aOdds = r2((A.riktodds + r2(A.riktodds / 1.25)) / 2);
  log(`Avd 7: A = ${A.number} ${A.horse.name} (rikt ${dec(A.riktodds)}, Unibet ${dec(aOdds)}), B = ${B.number} ${B.horse.name} (rikt ${dec(B.riktodds)}), C = ${C.number} ${C.horse.name} (rikt ${dec(C.riktodds)}).`);

  // Nollställ, och sätt en Intressant med odds i övriga avdelningar (S4 börjar då med B).
  const prepare = async () => {
    round = await api(sctx, "GET", `/api/rounds/${roundId}`);
    for (const r of round.races)
      for (const s of r.starts)
        if (s.mark && (s.mark.interesting || s.mark.bet || s.mark.unibetOdds !== null || s.mark.sourceSupport !== null))
          await api(sctx, "PUT", `/api/marks/${s.id}`, { interesting: false, bet: false, unibetOdds: null, sourceSupport: null });
    for (const r of round.races) {
      if (r.leg === 7) continue;
      const s = r.starts.filter((x) => !x.scratched && x.riktodds !== null).sort((a, b) => a.riktodds - b.riktodds)[1];
      if (s) await api(sctx, "PUT", `/api/marks/${s.id}`, { interesting: true, unibetOdds: r2(s.riktodds + (r.leg % 2 ? 0.5 : -0.2)) });
    }
    await api(sctx, "PUT", `/api/marks/${A.id}`, { interesting: true, unibetOdds: aOdds, sourceSupport: 2 });
    await api(sctx, "PUT", `/api/marks/${B.id}`, { xFactor: "STARK" });
    // C har odds, så att S4 börjar med B (utan odds).
    await api(sctx, "PUT", `/api/marks/${C.id}`, { interesting: true, unibetOdds: r2(C.riktodds + 0.3) });
  };
  const markOf = async (id) => (await api(sctx, "GET", `/api/rounds/${roundId}`)).races.flatMap((r) => r.starts).find((s) => s.id === id).mark;

  for (const theme of THEMES) {
    const first = theme === THEMES[0];
    await prepare();
    // ---- Mobil ----------------------------------------------------------------------------
    {
      const { ctx, page } = await newPage(browser, "m", theme);
      const hast = (s) => `${BASE}/omgang/${roundId}/avd/7/hast/${s.id}`;

      // S3 för A: välj Tror på i lägesväljaren (förslaget ändras: "nu föreslagen som Spelbar").
      await page.goto(hast(A), { waitUntil: "networkidle" });
      await page.locator(".xblock").waitFor();
      const reqs = [];
      const onReq = (r) => {
        if (["fetch", "xhr"].includes(r.resourceType()) && !r.url().includes("/api/marks/")) reqs.push(`${r.method()} ${r.url()}`);
      };
      page.on("request", onReq);
      await page.getByRole("radio", { name: /Tror på/ }).click();
      await page.locator(".daside .formula").waitFor({ timeout: 20_000 });
      const eff = await page.locator(".xeff-t").textContent();
      const formula = await page.locator(".daside .formula").textContent();
      page.off("request", onReq);
      if (first) {
        log(`S3 A, Tror på: effektraden "${eff}". Beräkningsraden "${formula}". Anrop för visningen (utöver PUT /api/marks): ${reqs.length}${reqs.length ? `: ${reqs.join(", ")}` : ""}.`);
        const box = await page.locator(".daside .rbox").innerText();
        log(`S3 A, RiktoddsBox: ${JSON.stringify(box)} · under rutan "${await page.locator(".xunder").textContent()}".`);
        log(`S3 A, källstöd: "${await page.locator(".xsrc-t").textContent()}".`);
      }
      await page.evaluate(() => {
        document.querySelector(".xblock").scrollIntoView({ block: "start" });
        window.scrollBy(0, -66);
      });
      await shot(page, "x-s3-tror", "m", theme);
      await page.locator(".daside .rbox").evaluate((e) => {
        e.scrollIntoView({ block: "start" });
        window.scrollBy(0, -100);
      });
      await shot(page, "x-s3-riktodds", "m", theme);
      await settled(page);

      if (first) {
        // Piltangenterna i lägesväljaren väljer, och byter inte avdelning.
        await page.getByRole("radio", { name: /Tror på/ }).focus();
        await page.keyboard.press("ArrowRight");
        const checked = await page.locator('.xseg [aria-checked="true"]').textContent();
        const url = page.url();
        await page.keyboard.press("ArrowLeft");
        log(`S3: → i lägesväljaren gav "${checked}" och adressen ${url.includes("/avd/7/") ? "står kvar på avd 7" : `bytte till ${url}`}.`);
        // Källstödet: + och −, Rensa.
        await page.getByRole("button", { name: "En källa till" }).click();
        const t1 = await page.locator(".xsrc-t").textContent();
        await page.getByRole("button", { name: "Rensa" }).click();
        const t2 = await page.locator(".xsrc-t").textContent();
        await page.getByRole("button", { name: "En källa färre" }).click();
        const t3 = await page.locator(".xsrc-t").textContent();
        for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "En källa till" }).click({ force: true }).catch(() => {});
        const t4 = await page.locator(".xsrc-t").textContent();
        const plusDisabled = await page.getByRole("button", { name: "En källa till" }).isDisabled();
        await page.getByRole("button", { name: "Rensa" }).click();
        await page.getByRole("button", { name: "En källa till" }).click();
        await page.getByRole("button", { name: "En källa till" }).click();
        log(`S3 källstöd: + → "${t1}", Rensa → "${t2}", − på tomt → "${t3}", många + → "${t4}" (+ avstängd: ${plusDisabled}).`);
        await settled(page);
      }

      // Toasten när Intressant tas bort, och Ångra.
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator(".daside .lamp.lab").click();
      await page.locator(".toast").waitFor();
      const toast = await page.locator(".toast").innerText();
      await page.waitForTimeout(250);
      await shot(page, "x-toast", "m", theme);
      await settled(page);
      const off = await markOf(A.id);
      await page.locator(".toast button", { hasText: "Ångra" }).click();
      await settled(page);
      const back = await markOf(A.id);
      if (first)
        log(
          `Toast: ${JSON.stringify(toast)}. Efter borttagen Intressant: interesting=${off.interesting}, xFactor=${off.xFactor}, spelbar=${off.spelbar}, källstöd=${off.sourceSupport}. Efter Ångra: interesting=${back.interesting}, xFactor=${back.xFactor}, spelbar=${back.spelbar}, källstöd=${back.sourceSupport}.`,
        );

      // S3 för B i läget Stark känsla.
      await page.goto(hast(B), { waitUntil: "networkidle" });
      await page.locator(".xblock").waitFor();
      await page.evaluate(() => {
        document.querySelector(".xblock").scrollIntoView({ block: "start" });
        window.scrollBy(0, -66);
      });
      await shot(page, "x-s3-stark", "m", theme);

      if (first) {
        // Offline: tre tryck på X för C blir en post i utkorgen, som skickas när nätet är tillbaka.
        await page.goto(hast(C), { waitUntil: "networkidle" });
        await page.locator(".xblock").waitFor();
        await ctx.setOffline(true);
        await page.evaluate(() => window.dispatchEvent(new Event("offline")));
        for (let i = 0; i < 3; i++) await page.keyboard.press("x");
        await page.keyboard.press("Shift+X");
        const q = await outbox(page);
        const checked = await page.locator('.xseg [aria-checked="true"]').textContent();
        await ctx.setOffline(false);
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
        await settled(page);
        const m = await markOf(C.id);
        await page.reload({ waitUntil: "networkidle" });
        await page.locator(".xblock").waitFor();
        const afterReload = await page.locator('.xseg [aria-checked="true"]').textContent();
        log(`Offline: X, X, X, Shift+X på C gav ${q.length} post(er) i utkorgen (${JSON.stringify(q.map((i) => i.body))}), visat "${checked}". Online: servern har xFactor=${m.xFactor}. Efter omladdning: "${afterReload}".`);
        await api(sctx, "PUT", `/api/marks/${C.id}`, { xFactor: "NONE" });
      }

      // S2 avd 7 med X-märken och riktoddset med X.
      await page.goto(`${BASE}/omgang/${roundId}/avd/7`, { waitUntil: "networkidle" });
      await page.locator(".mlist .row").last().waitFor();
      await shot(page, "x-s2-avd7", "m", theme);
      if (first) {
        const m = await page.evaluate(() => {
          const rows = [...document.querySelectorAll(".mlist .row")];
          const last = rows[rows.length - 1].getBoundingClientRect();
          const tab = document.querySelector(".tabbar").getBoundingClientRect();
          const rk = [...document.querySelectorAll(".mlist .rk")].map((e) => ({ w: e.scrollWidth, cw: e.clientWidth, x: e.classList.contains("x"), t: e.textContent }));
          const heights = [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))];
          const xs = [...document.querySelectorAll(".mlist .rk.x")].map((e) => `${e.getAttribute("title")} (färg ${getComputedStyle(e.querySelector(".rkx")).color})`);
          const badges = [...document.querySelectorAll(".mlist .bdg.x, .mlist .bdg.xp")].map((e) => e.getAttribute("aria-label"));
          return { rows: rows.length, lastBottom: Math.round(last.bottom), tabTop: Math.round(tab.top), heights, rkOverflow: rk.filter((r) => r.w > r.cw).length, xs, badges, sx: document.documentElement.scrollWidth - innerWidth };
        });
        log(
          `S2 avd 7 på 390 × 844: ${m.rows} rader à ${m.heights.join("/")} px, sista raden slutar på y=${m.lastBottom}, bottenmenyn börjar på y=${m.tabTop}: ${m.lastBottom <= m.tabTop ? "alla rader syns utan skroll" : "OBS: sista raden skyms"}. Riktoddsceller som flödar över: ${m.rkOverflow}. Vågrät skroll: ${m.sx} px. X-celler: ${m.xs.join("; ")}. Märken: ${m.badges.join(", ")}.`,
        );
        const reqs2 = [];
        const onReq2 = (r) => {
          if (["fetch", "xhr", "document"].includes(r.resourceType())) reqs2.push(`${r.method()} ${r.url()}`);
        };
        page.on("request", onReq2);
        for (let n = 1; n <= 8; n++) await page.getByRole("tab", { name: new RegExp(`^Avdelning ${n},`) }).click();
        await page.getByRole("tab", { name: /^Avdelning 7,/ }).click();
        await page.locator(".mlist .who").nth(2).click();
        await page.locator(".xblock").waitFor();
        await page.goBack();
        await page.waitForTimeout(300);
        page.off("request", onReq2);
        const nonDetail = reqs2.filter((r) => !r.includes("/api/starts/"));
        log(`Mobil: 9 avdelningsbyten, ett hästkort och tillbaka gav ${nonDetail.length} nätverksanrop mot omgången${nonDetail.length ? `: ${nonDetail.join(", ")}` : ""} (${reqs2.length - nonDetail.length} GET /api/starts för hästkortets tunga delar).`);
      }

      // S4: B först i kön, med XCycleButton och "Riktodds med X".
      await page.goto(`${BASE}/omgang/${roundId}/odds`, { waitUntil: "networkidle" });
      await page.locator(".kp").waitFor();
      const kp = (k) => page.locator(".kp button", { hasText: new RegExp(`^${k}$`) }).click();
      await shot(page, "x-s4", "m", theme);
      // X två gånger (Stark känsla → Ingen → Tror på), sedan tre siffror och X inom 350 ms.
      await page.locator(".xcyc").click();
      const xNone = await page.locator(".xcyc").getAttribute("aria-label");
      await page.locator(".xcyc").click();
      const target = r2(r2(B.riktodds / 1.25) + 0.3);
      const digits = String(Math.round(target * 100)).padStart(3, "0");
      const name0 = await page.locator(".kn").textContent();
      await kp(digits[0]);
      await kp(digits[1]);
      await kp(digits[2]);
      const t0 = Date.now();
      await page.locator(".xcyc").click();
      const tX = Date.now() - t0;
      await page.waitForTimeout(800);
      const name1 = await page.locator(".kn").textContent();
      const res = await page.locator(".kres").innerText();
      const tile = await page.locator(".kcmp > div").first().innerText();
      await shot(page, "x-s4-hold", "m", theme);
      if (first) log(`S4: X-knappen gav "${xNone}". ${digits.split("").join("-")} och X ${tX} ms efter tredje siffran: hästen ${name1 === name0 ? `står kvar (${name1})` : `bytte till ${name1}`}. Riktoddsrutan ${JSON.stringify(tile)}. Resultatraden ${JSON.stringify(res)}.`);
      await page.getByRole("button", { name: "Nästa ›" }).click();
      const name2 = await page.locator(".kn").textContent();
      if (first) log(`S4: Nästa gick vidare till ${name2}.`);
      for (let i = 0; i < 20; i++) {
        if (await page.locator("dialog.sheet[open]").count()) break;
        await page.getByRole("button", { name: "Hoppa över" }).click();
      }
      await page.locator("dialog.sheet[open]").waitFor();
      await shot(page, "x-s4-sammanfattning", "m", theme);
      if (first) log(`S4-arket: ${JSON.stringify((await page.locator("dialog.sheet[open] .prow").allInnerTexts()).filter((t) => t.includes("→ X")))}`);
      await page.getByRole("button", { name: "Stäng" }).click();
      await settled(page);

      // S6a.
      await page.goto(`${BASE}/omgang/${roundId}/spel?flik=plats`, { waitUntil: "networkidle" });
      await page.locator(".brow").first().waitFor();
      await shot(page, "x-s6a", "m", theme);
      if (first) log(`S6a: ${JSON.stringify((await page.locator(".brow").allInnerTexts()).filter((t) => t.includes("→ X")))}`);

      // S10 med faktorerna, och felet för Stark känsla.
      await page.goto(`${BASE}/installningar`, { waitUntil: "networkidle" });
      await page.getByLabel("X-faktor Stark känsla").waitFor();
      await page.getByLabel("X-faktor Tror på").evaluate((e) => {
        e.scrollIntoView({ block: "center" });
      });
      await shot(page, "x-s10", "m", theme);
      await page.getByLabel("X-faktor Stark känsla").fill("1,10");
      await page.getByLabel("X-faktor Stark känsla").press("Enter");
      await page.getByText("Stark känsla ska vara större än Tror på.").waitFor();
      await page.getByLabel("X-faktor Tror på").fill("3,5");
      await page.getByLabel("X-faktor Tror på").press("Tab");
      await shot(page, "x-s10-fel", "m", theme);
      if (first) {
        const inv = await page.getByLabel("X-faktor Stark känsla").getAttribute("aria-invalid");
        const desc = await page.getByLabel("X-faktor Stark känsla").getAttribute("aria-describedby");
        log(`S10: Stark 1,10 → "Stark känsla ska vara större än Tror på." (aria-invalid=${inv}, aria-describedby → "${await page.locator(`[id="${desc}"]`).textContent()}"). Tror på 3,5 → "${await page.locator(".err-msg").first().textContent()}".`);
      }
      await page.getByLabel("X-faktor Tror på").fill("1,25");
      await page.getByLabel("X-faktor Tror på").press("Enter");
      await page.getByLabel("X-faktor Stark känsla").fill("1,50");
      await page.getByLabel("X-faktor Stark känsla").press("Enter");
      if (first) {
        // Ny faktor: cachen räknas om direkt (applySettings), innan omgången hämtas igen.
        await page.getByLabel("X-faktor Tror på").fill("1,30");
        await page.getByLabel("X-faktor Tror på").press("Enter");
        await page.locator(".set-num").filter({ has: page.getByLabel("X-faktor Tror på") }).getByText("Sparat").waitFor();
        const cached = await page.evaluate(
          ([rid, aid]) => JSON.parse(localStorage.getItem(`sv-round-${rid}`)).races.flatMap((r) => r.starts).find((s) => s.id === aid).mark,
          [roundId, A.id],
        );
        log(`S10: Tror på 1,30 sparad. Cachen för A: xFactorValue ${cached.xFactorValue}, riktoddsX ${cached.riktoddsX} (väntat ${r2(A.riktodds / 1.3)}), forslag ${cached.forslag}.`);
        await page.getByLabel("X-faktor Tror på").fill("1,25");
        await page.getByLabel("X-faktor Tror på").press("Enter");
        await page.locator(".set-num").filter({ has: page.getByLabel("X-faktor Tror på") }).getByText("Sparat").waitFor();
      }
      await ctx.close();
    }

    // ---- Desktop ---------------------------------------------------------------------------
    {
      const { ctx, page } = await newPage(browser, "d", theme);
      await page.goto(`${BASE}/omgang/${roundId}/avd/7/hast/${A.id}`, { waitUntil: "networkidle" });
      await page.locator(".daside .formula").waitFor({ timeout: 20_000 });
      await shot(page, "x-s2-s3", "d", theme);
      if (first) {
        const cell = await page.locator(`.tbl [data-start="${A.id}"] .rk`).innerText();
        log(`Desktop S2: Rikt-cellen för A ${JSON.stringify(cell)}.`);
        // X och Shift + X på vald rad (C).
        await page.locator(`.tbl [data-start="${C.id}"]`).click();
        await page.locator(".tbl").focus().catch(() => {});
        await page.keyboard.press("x");
        const a = await page.locator(`.tbl [data-start="${C.id}"] .rk`).getAttribute("title");
        const live = await page.locator(".xeff").innerText();
        await page.keyboard.press("x");
        const b = await page.locator(`.tbl [data-start="${C.id}"] .hl`).innerHTML();
        await page.keyboard.press("Shift+X");
        await page.keyboard.press("Shift+X");
        const c = await page.locator(`.tbl [data-start="${C.id}"] .rk`).getAttribute("title");
        await settled(page);
        const m = await markOf(C.id);
        log(`Desktop S2: X på C → title "${a}", hästkortet "${live}"; X igen → märke ${b.includes('X-faktor: Stark känsla') ? "X+" : "?"}; Shift+X två gånger → title ${c === null ? "utan X" : `"${c}"`}. Servern: xFactor=${m.xFactor}.`);
        // X i ett textfält gör ingenting.
        await page.getByLabel("Kommentar inför loppet").click();
        await page.keyboard.press("x");
        const m2 = (await outbox(page)).filter((i) => i.url.includes("/api/marks/")).length;
        await page.getByLabel("Kommentar inför loppet").fill("");
        log(`Desktop S2: X i kommentarsfältet gav ${m2} markeringar i utkorgen.`);
      }
      await page.goto(`${BASE}/omgang/${roundId}/spel`, { waitUntil: "networkidle" });
      await page.locator(".ptbl").first().waitFor();
      await shot(page, "x-s6", "d", theme);
      if (first) {
        await page.goto(`${BASE}/omgang/${roundId}/odds`, { waitUntil: "networkidle" });
        await page.locator(".kpw").waitFor();
        const before = await page.locator(".xcyc").getAttribute("aria-label");
        await page.keyboard.press("x");
        const after = await page.locator(".xcyc").getAttribute("aria-label");
        await page.keyboard.press("Shift+X");
        const back = await page.locator(".xcyc").getAttribute("aria-label");
        log(`Desktop S4: tangenten X "${before}" → "${after}", Shift+X → "${back}". Hjälptext: "${await page.locator(".kkeys").textContent()}".`);
        await settled(page);
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
console.log("\n" + report.join("\n"));
