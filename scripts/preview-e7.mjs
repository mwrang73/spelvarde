// Provkörning av E7 ATG-filen (docs/specs/e7-atg-fil.md 9): skärmbilder i 390 px
// och 1400 × 900, ljust och mörkt, en verklig nedladdning som jämförs med
// kupongen, och lägena i arket. Ändrar bara den lokala databasen (kupongen).
//
//   npm run db:local
//   npm run -s build && SPELVARDE_FIXTURES=atg,ts npx next start -p 3100
//   node scripts/preview-e7.mjs [--base http://localhost:3100] [--themes light,dark]

import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const out = join(root, "preview");
const dlDir = join(out, "e7-nedladdat");
mkdirSync(dlDir, { recursive: true });

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const BASE = args.base || "http://localhost:3100";
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
  const cache = join(homedir(), ".cache", "ms-playwright");
  const dir = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : null;
  const exe = dir && join(cache, dir, "chrome-linux64", "chrome");
  if (!exe || !existsSync(exe)) throw new Error("Hittar ingen Chromium.");
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

const envVals = env();
if (!/@127\.0\.0\.1[:/]/.test(envVals.DATABASE_URL ?? "")) throw new Error("DATABASE_URL pekar inte på 127.0.0.1. Avbryter.");
const { chromium } = loadPlaywright();
const SIZES = { m: { width: 390, height: 844, isMobile: true, hasTouch: true }, d: { width: 1400, height: 900 } };

let failures = 0;
const check = (ok, text) => {
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FEL "} ${text}`);
};

// Oberoende av lib/atg-file.ts: MSB först med polynom 0x8005 och reflektion.
const rev = (x, n) => parseInt(x.toString(2).padStart(n, "0").split("").reverse().join(""), 2);
function crcArc(bytes) {
  let c = 0;
  for (const b of bytes) {
    c ^= rev(b, 8) << 8;
    for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff;
  }
  return rev(c, 16).toString(16).padStart(4, "0");
}

async function newPage(browser, size, theme, extra = {}) {
  const { width, height, isMobile, hasTouch } = SIZES[size];
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: !!isMobile, hasTouch: !!hasTouch, colorScheme: theme, locale: "sv-SE", timezoneId: "Europe/Stockholm", acceptDownloads: true, ...extra });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE }).catch(() => {});
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("sv-theme", t);
    } catch {}
  }, theme);
  const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: envVals.SEED_ADMIN_EMAIL, password: envVals.SEED_ADMIN_PASSWORD } });
  if (!res.ok()) throw new Error(`Inloggningen misslyckades: ${res.status()}`);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(60_000);
  return { ctx, page };
}

async function shot(page, name, size, theme) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, `${name}-${SIZES[size].width}-${theme}.png`) });
  const sx = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (sx > 0) check(false, `${name} ${size} ${theme}: ${sx} px vågrät skroll`);
}

const api = async (ctx, method, url, data) => {
  const res = await ctx.request.fetch(`${BASE}${url}`, { method, data });
  const body = await res.json().catch(() => null);
  if (!res.ok()) throw new Error(`${method} ${url}: ${res.status()} ${JSON.stringify(body)}`);
  return body;
};
const settled = (page) => page.waitForFunction(() => (localStorage.getItem("sv-outbox") ?? "[]") === "[]", null, { timeout: 20_000 });

const browser = await chromium.launch({ executablePath: chromePath() });
try {
  const setup = await newPage(browser, "m", "light");
  const cur = await api(setup.ctx, "GET", "/api/rounds/current");
  const roundId = cur.round.id;
  const round = await api(setup.ctx, "GET", `/api/rounds/${roundId}`);
  const firstStart = round.races.map((r) => r.startAt).sort()[0];
  console.log(`Omgång ${round.round.atgGameId}, ${round.races.map((r) => r.starts.length).join("/")} starter, första start ${firstStart}.`);
  if (new Date(firstStart) <= new Date()) throw new Error("Omgången har startat. Flytta Race.startAt i den lokala databasen.");
  await setup.ctx.close();

  const url = `${BASE}/omgang/${roundId}/spel?flik=rad`;
  const fresh = (ctx, over = {}) => api(ctx, "PUT", `/api/rounds/${roundId}/coupon`, { budget: 288, rowPrice: 0.5, selections: {}, lockedLegs: [], spikCount: 2, allgMode: "AUTO", allgLeg: null, maxPerLeg: 7, legRoles: null, copiedAt: null, copiedSelections: null, ...over });
  const openRad = async (page) => {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.locator(".budget").first().waitFor();
    await settled(page);
  };
  const openSheet = async (page) => {
    await page.getByRole("button", { name: "Spela hos ATG" }).first().click();
    await page.locator("dialog.sheet[open] .atg-foot").waitFor();
    await page.waitForTimeout(450);
  };
  const dialogButton = (page, name) => page.locator("dialog.sheet[open]").getByRole("button", { name });
  const status = (page) => page.locator("dialog.sheet[open] .atg-status").textContent();

  for (const theme of THEMES) {
    for (const size of ["m", "d"]) {
      const tag = `${size === "m" ? "390" : "1400"} ${theme}`;
      const { ctx, page } = await newPage(browser, size, theme);
      await fresh(ctx);
      await openRad(page);
      await shot(page, "e7-rad", size, theme);

      if (size === "d") {
        const order = await page.evaluate(() => {
          const b = document.querySelector(".drad-l .budget");
          return { next: b.nextElementSibling?.className, classes: [...b.parentElement.children].map((c) => c.className) };
        });
        check(order.next.includes("dact"), `${tag}: knappen ligger direkt efter budgetrutan (${order.classes.join(" > ")})`);
        for (const [w, h] of [[1400, 900], [1280, 720], [1024, 600]]) {
          await page.setViewportSize({ width: w, height: h });
          await page.evaluate(() => window.scrollTo(0, 0));
          const m = await page.evaluate(() => {
            const help = document.querySelector(".dact .help").getBoundingClientRect();
            const btn = document.querySelector(".dact .btn").getBoundingClientRect();
            return { btn: Math.round(btn.bottom), help: Math.round(help.bottom), bh: Math.round(btn.height), text: document.querySelector(".dact .help").textContent };
          });
          check(m.help <= h, `${tag} ${w}×${h}: knappen slutar y=${m.btn}, hjälptexten y=${m.help} (höjd ${h}), knapp ${m.bh} px`);
          if (w === 1280) await page.screenshot({ path: join(out, `e7-rad-1280x720-${theme}.png`) });
          if (w === 1024) await page.screenshot({ path: join(out, `e7-rad-1024x600-${theme}.png`) });
        }
        await page.setViewportSize({ width: 1400, height: 900 });
      }

      await openSheet(page);
      const focus = await page.evaluate(() => document.activeElement?.textContent?.trim());
      check(/Ladda ner ATG-fil/.test(focus ?? ""), `${tag}: fokus på "${focus}" när arket öppnas`);
      await shot(page, "e7-ark", size, theme);
      const foot = await page.evaluate(() => {
        const f = document.querySelector("dialog.sheet[open] .atg-foot").getBoundingClientRect();
        const s = document.querySelector("dialog.sheet[open] .sheet-in");
        const r = s.getBoundingClientRect();
        const heights = [...document.querySelectorAll("dialog.sheet[open] .shbtns .btn")].map((b) => Math.round(b.getBoundingClientRect().height));
        return { gap: Math.round(r.bottom - f.bottom), scrolls: s.scrollHeight > s.clientHeight, heights, inView: f.bottom <= innerHeight + 1 };
      });
      check(foot.gap === 0 && foot.inView, `${tag}: knapparna ligger mot arkets underkant (glipa ${foot.gap} px, arket skrollar: ${foot.scrolls})`);
      check(foot.heights.every((x) => x >= 44), `${tag}: knapphöjder ${foot.heights.join("/")} px`);

      if (foot.scrolls) {
        await page.evaluate(() => document.querySelector("dialog.sheet[open] .sheet-in").scrollTo(0, 99999));
        await shot(page, "e7-ark-slut", size, theme);
        const end = await page.evaluate(() => {
          const s = document.querySelector("dialog.sheet[open] .sheet-in").getBoundingClientRect();
          return Math.round(s.bottom - document.querySelector("dialog.sheet[open] .atg-foot").getBoundingClientRect().bottom);
        });
        check(end === 0, `${tag}: skrollat till slutet, glipa ${end} px`);
      }

      // Verklig nedladdning.
      const [dl] = await Promise.all([page.waitForEvent("download"), dialogButton(page, "Ladda ner ATG-fil").click()]);
      const name = dl.suggestedFilename();
      const dest = join(dlDir, name);
      await dl.saveAs(dest);
      const bytes = readFileSync(dest);
      const text = bytes.toString("utf8");
      const m = /^v85_(\d{4}-\d{2}-\d{2})_([0-9a-f]{4})\.xml$/.exec(name);
      check(!!m, `${tag}: filnamn ${name}`);
      check(m?.[1] === round.round.atgGameId.split("_")[1], `${tag}: datum i filnamnet = omgångens ${round.round.atgGameId}`);
      const crc = crcArc(bytes);
      check(m?.[2] === crc, `${tag}: CRC i filnamnet ${m?.[2]} = oberoende räknad ${crc}`);
      check(bytes[0] === 0x3c && !bytes.includes(0x0d) && bytes.every((b) => b < 128) && text.endsWith("</issuer>\n"), `${tag}: ingen BOM, inga CR, bara ASCII, ${bytes.length} byte`);
      const legs = [...text.matchAll(/<leg legno="(\d+)" marks="([01]{15})"\/>/g)].map((x) => ({ leg: +x[1], nums: [...x[2]].flatMap((c, i) => (c === "1" ? [i + 1] : [])) }));
      const shown = await page.evaluate(() => {
        const grid = document.querySelector("dialog.sheet[open] .kup .kg");
        const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
        const out = Array.from({ length: cols }, () => []);
        [...grid.children].filter((c) => c.matches(".kh, .kc")).forEach((c, i) => {
          if (c.classList.contains("kc") && c.classList.contains("on")) out[i % cols].push(Number(c.textContent.replace(/\D/g, "")));
        });
        return out.map((x) => x.sort((a, b) => a - b));
      });
      check(legs.length === 8 && JSON.stringify(legs.map((l) => l.nums)) === JSON.stringify(shown), `${tag}: marks = kupongen i arket: ${legs.map((l) => l.nums.join(",")).join(" | ")}`);
      const st = await status(page);
      check(st.includes(name) && st.includes("Du hittar den bland nedladdade filer."), `${tag}: statusrad "${st}"`);
      await shot(page, "e7-ark-nedladdad", size, theme);
      check((await page.locator("dialog.sheet[open]").count()) === 1, `${tag}: arket står kvar`);
      await settled(page);
      await page.waitForTimeout(900);
      await settled(page);
      const saved = (await api(ctx, "GET", `/api/rounds/${roundId}/coupon`)).coupon;
      const savedSel = legs.map((l) => (saved.selections[String(l.leg)] ?? []).slice().sort((a, b) => a - b));
      check(!!saved.copiedAt && JSON.stringify(savedSel) === JSON.stringify(legs.map((l) => l.nums)), `${tag}: sparad kupong: copiedAt ${saved.copiedAt}, samma nummer som filen, ${saved.rows} rader, ${saved.cost} kr`);
      const created = /createdtime="(\d{2}:\d{2}):\d{2}"/.exec(text)?.[1];
      check(!!created && st.includes(`skapad ${created}`) && text.includes('couponid="1"') && text.includes('betmultiplier="1"') && !text.includes("trackcode"), `${tag}: createdtime ${created} = statusraden, couponid 1, betmultiplier 1, ingen trackcode`);

      // Kopiera i arket: statusraden, ingen toast.
      await dialogButton(page, "Kopiera texten").click();
      await page.waitForFunction(() => document.querySelector("dialog.sheet[open] .atg-status")?.textContent === "Raden är kopierad.");
      check((await page.locator(".toast-region").getByText("Raden är kopierad").count()) === 0, `${tag}: Kopiera texten ger statusraden och ingen toast`);
      await page.getByRole("button", { name: "Stäng" }).click();

      // Ändrad rad efter nedladdning: banderollen.
      await page.locator(".budget").first().getByLabel("Exakt belopp").fill("500");
      await page.locator(".budget").first().getByLabel("Exakt belopp").press("Enter");
      const banner = page.locator(".ban").filter({ hasText: "Raden har ändrats sedan du laddade ner eller kopierade den" });
      await banner.first().waitFor();
      check(await banner.first().getByRole("button", { name: "Spela hos ATG" }).isVisible(), `${tag}: banderollen "Raden har ändrats" med knappen Spela hos ATG`);
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, "e7-andrad", size, theme);
      await settled(page);
      await ctx.close();

      // Fel: startnummer 16 (bara i svaret till webbläsaren, servern sparar inget av det).
      {
        const { ctx: c, page: p } = await newPage(browser, size, theme);
        await fresh(c);
        const sel = (await (async () => {
          const q = await newPage(browser, "m", theme);
          await openRad(q.page);
          await q.page.waitForTimeout(900);
          await settled(q.page);
          const r = await api(q.ctx, "GET", `/api/rounds/${roundId}/coupon`);
          await q.ctx.close();
          return r.coupon.selections;
        })());
        const target = sel["3"][0];
        await p.route(`**/api/rounds/${roundId}`, async (route) => {
          if (route.request().method() !== "GET") return route.continue();
          const res = await route.fetch();
          const j = await res.json();
          for (const r of j.races) if (r.leg === 3) for (const s of r.starts) if (s.number === target) s.number = 16;
          await route.fulfill({ response: res, json: j });
        });
        await p.route(`**/api/rounds/${roundId}/coupon`, (route) => (route.request().method() === "PUT" ? route.fulfill({ json: { ok: true } }) : route.continue()));
        await p.goto(url, { waitUntil: "networkidle" });
        await p.locator(".budget").first().waitFor();
        await openSheet(p);
        const b = p.locator("dialog.sheet[open] .ban.err");
        const t = await b.first().textContent();
        check(/Startnummer 16 i V85-3 får inte plats i ATG-filen/.test(t ?? ""), `${tag}: fel "${t}"`);
        const dlBtn = dialogButton(p, "Ladda ner ATG-fil");
        const describedBy = await dlBtn.getAttribute("aria-describedby");
        check((await dlBtn.isDisabled()) && (await p.locator(`[id="${describedBy}"] .ban.err`).count()) > 0, `${tag}: Ladda ner avstängd, aria-describedby pekar på felet`);
        const fo = await p.evaluate(() => document.activeElement?.textContent?.trim());
        check(fo === "Öppna ATG", `${tag}: fokus på första aktiva knappen (${fo})`);
        check(await dialogButton(p, "Kopiera texten").isEnabled(), `${tag}: Kopiera texten aktiv`);
        await shot(p, "e7-ark-fel16", size, theme);
        await c.close();
      }

      // Efter start: webbläsarens klocka efter första starten.
      {
        const { ctx: c, page: p } = await newPage(browser, size, theme);
        await fresh(c);
        await p.clock.install({ time: new Date(new Date(firstStart).getTime() + 5 * 60_000) });
        await p.goto(url, { waitUntil: "load" });
        await p.locator(".budget").first().waitFor();
        await p.waitForTimeout(800);
        await openSheet(p);
        const d = p.locator("dialog.sheet[open]");
        check((await d.getByRole("button", { name: "Ladda ner ATG-fil" }).count()) === 0 && (await d.getByRole("link", { name: /Öppna ATG/ }).count()) === 0 && (await d.getByText("Så spelar du raden").count()) === 0 && (await d.getByText("inte provad").count()) === 0, `${tag}: efter start finns varken Ladda ner, Öppna ATG, stegen eller banderollen`);
        check(await d.getByText("V85 har startat, så ATG-filen går inte längre att ladda ner.").isVisible(), `${tag}: efter start visas meningen`);
        check((await d.locator(".btn.primary").textContent()) === "Kopiera texten", `${tag}: efter start är Kopiera texten primär`);
        await shot(p, "e7-ark-efter-start", size, theme);
        await c.close();
      }
    }
  }

  // ---- En gång: övriga lägen ------------------------------------------------------------------
  const theme = THEMES[0];
  const once = async (size, fn, extra) => {
    const { ctx, page } = await newPage(browser, size, theme, extra);
    await fresh(ctx);
    try {
      await fn(ctx, page);
    } finally {
      await ctx.close();
    }
  };

  // Spelstopp passerar medan arket är öppet.
  await once("m", async (ctx, page) => {
    await page.clock.install({ time: new Date() });
    await openRad(page);
    await openSheet(page);
    await page.clock.setSystemTime(new Date(new Date(firstStart).getTime() + 60_000));
    let downloaded = false;
    page.on("download", () => (downloaded = true));
    await dialogButton(page, "Ladda ner ATG-fil").click();
    const t = await page.locator("dialog.sheet[open] .ban.err").textContent();
    await page.waitForTimeout(400);
    check(t === "V85 har startat. ATG-filen skapades inte." && !downloaded, `Spelstopp vid klick: "${t}", ingen fil`);
    await shot(page, "e7-ark-spelstopp", "m", theme);
  });

  // Nedladdningen kastar: felbanderoll, copiedAt sätts inte, knappen går att prova igen.
  await once("m", async (ctx, page) => {
    await ctx.addInitScript(() => {
      URL.createObjectURL = () => {
        throw new Error("blockerad");
      };
    });
    await openRad(page);
    await openSheet(page);
    await dialogButton(page, "Ladda ner ATG-fil").click();
    const t = await page.locator("dialog.sheet[open] .ban.err").textContent();
    await page.waitForTimeout(1000);
    const c = (await api(ctx, "GET", `/api/rounds/${roundId}/coupon`)).coupon;
    check(/^Filen kunde inte laddas ner/.test(t) && !c.copiedAt && (await dialogButton(page, "Ladda ner ATG-fil").isEnabled()) && (await status(page)) === "", `Nedladdningen kastar: "${t}", copiedAt ${c.copiedAt}, knappen aktiv, tom statusrad`);
  });

  // Radpris 1 kr: varning, filen går att ladda ner.
  await once("d", async (ctx, page) => {
    await fresh(ctx, { rowPrice: 1, budget: 500 });
    await openRad(page);
    await openSheet(page);
    const t = await page.locator("dialog.sheet[open] .ban.warn").first().textContent();
    check(/^Radpriset i appen är 1,00 kr\. Filen har inget radpris/.test(t), `Radpris: "${t}"`);
    const [dl] = await Promise.all([page.waitForEvent("download"), dialogButton(page, "Ladda ner ATG-fil").click()]);
    check(!!dl.suggestedFilename(), `Radpris: filen laddas ner (${dl.suggestedFilename()})`);
    await shot(page, "e7-ark-radpris", "d", theme);
    await fresh(ctx);
  });

  // Blockerad: budgeten räcker inte. Synlig orsak under knappen.
  await once("d", async (ctx, page) => {
    await fresh(ctx, { budget: 20, spikCount: 0, maxPerLeg: 7 });
    await openRad(page);
    const b = page.locator(".dact .btn");
    const h = await page.locator(".dact .help").textContent();
    const by = await b.getAttribute("aria-describedby");
    check((await b.isDisabled()) && h === "Raden ryms inte i budgeten." && (await page.locator(`[id="${by}"]`).textContent()) === h, `Blockerad: avstängd med synlig orsak "${h}"`);
    await page.locator(".drad-l").evaluate((e) => e.scrollTo(0, 0));
    await shot(page, "e7-rad-blockerad", "d", theme);
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const y = await page.locator(".dact .help").evaluate((e) => Math.round(e.getBoundingClientRect().bottom));
    check(y <= 600, `Blockerad 1024×600: orsaken slutar y=${y}`);
    await page.screenshot({ path: join(out, `e7-rad-blockerad-1024x600-${theme}.png`) });
    await fresh(ctx);
  });

  // Gammal rad med struken häst i valet.
  await once("m", async (ctx, page) => {
    const sel = {};
    for (let leg = 1; leg <= 8; leg++) sel[leg] = leg === 7 ? [1, 2, 3] : [1, 2];
    await fresh(ctx, { selections: sel, spikCount: null, allgMode: null, maxPerLeg: null });
    await page.route(`**/api/rounds/${roundId}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const res = await route.fetch();
      const j = await res.json();
      for (const r of j.races) if (r.leg === 7) for (const s of r.starts) if (s.number === 2) s.scratched = true;
      await route.fulfill({ response: res, json: j });
    });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.locator(".budget").first().waitFor();
    await openSheet(page);
    const t = await page.locator("dialog.sheet[open] .ban.warn").first().textContent();
    const step = await page.locator("dialog.sheet[open] .atg-steps li").last().textContent();
    check(/^2 .* i V85-7 är struken och är inte med i ATG-filen\.$/.test(t), `Gammal rad: "${t}"`);
    check(step.includes(`${2 ** 7 * 2} rader · ${(2 ** 7 * 2 * 0.5).toFixed(2).replace(".", ",")} kr`), `Gammal rad: steg 4 räknas från filen: "${step}"`);
    const [dl] = await Promise.all([page.waitForEvent("download"), dialogButton(page, "Ladda ner ATG-fil").click()]);
    const f = join(dlDir, `gammal-${dl.suggestedFilename()}`);
    await dl.saveAs(f);
    check(readFileSync(f, "utf8").includes('<leg legno="7" marks="101000000000000"/>'), "Gammal rad: filen har inte den strukna hästen");
    await shot(page, "e7-ark-gammal-rad", "m", theme);
    await fresh(ctx);
  });

  // 360 × 640 med 15 startande: knapparna syns utan skrollning.
  await once("m", async (ctx, page) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await openRad(page);
    await openSheet(page);
    const m = await page.evaluate(() => [...document.querySelectorAll("dialog.sheet[open] .shbtns .btn")].map((b) => {
      const r = b.getBoundingClientRect();
      return { b: Math.round(r.bottom), r: Math.round(r.right), over: b.scrollWidth - b.clientWidth };
    }));
    const cols = await page.locator("dialog.sheet[open] .kup .kc").count();
    check(m.every((x) => x.b <= 640 && x.r <= 360 && x.over <= 0), `360×640: ${JSON.stringify(m)} (${cols} rutor i kupongen)`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `e7-ark-360x640-${theme}.png`) });
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(200);
    check((await page.locator("dialog.sheet[open] .atg-foot").evaluate((e) => getComputedStyle(e).position)) === "static", "Liggande 844×390: knapparna är inte klistrade");
  });

  // Hemskärmen i iPhone: hänvisningen till Safari, bara där.
  await once(
    "m",
    async (ctx, page) => {
      await ctx.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
      await openRad(page);
      await openSheet(page);
      check((await page.locator("dialog.sheet[open]").textContent()).includes("Öppna Spelvärde i Safari"), "iPhone på hemskärmen (simulerad): hänvisningen till Safari visas");
    },
    { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148" },
  );
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} kontroller FELADE.` : "\nAlla kontroller gick igenom.");
process.exitCode = failures ? 1 : 0;
