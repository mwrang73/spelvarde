// Vilka källor rutterna använder: riktiga ATG och travstatistik.se, eller
// fixturerna i test/fixtures för lokal provkörning.
//
//   SPELVARDE_FIXTURES=atg,ts   båda från fixturer
//   SPELVARDE_FIXTURES=ts       riktiga ATG, travstatistik från fixturer
//   SPELVARDE_FIXTURES=unibet   Unibets odds från test/fixtures/unibet (E2.2)
//   SPELVARDE_FIXTURES=tips     Hämta tips (E5): sidorna från
//                               test/fixtures/travstugan och AI-svaren från
//                               test/fixtures/tips-ai. Ingen nyckel behövs och
//                               inget går ut på nätet.
//
// Fixturläget vägrar köras på Vercel (VERCEL är satt där).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AtgError, atgFetch, type AtgFetch } from "@/lib/atg";
import type { FetchDeps } from "@/lib/fetch-round";
import { prisma } from "@/lib/prisma";
import { decodeHtml, tsFetch, type TsFetch } from "@/lib/travstatistik";
import { UnibetError, unibetFetch, type UnibetFetch } from "@/lib/unibet";
import type { UnibetDeps } from "@/lib/unibet-server";
import { createClaudeAi, TIPS_MODEL, type TipsAi } from "@/lib/tips/ai";
import { FETCH_ERR, TipFetchError } from "@/lib/tips/errors";
import { fetchPage, fetchRobots, type FetchPage, type FetchRobots } from "@/lib/tips/fetch-page";
import type { TipsDeps } from "@/lib/tips-server";

function fixtureModes(): Set<string> {
  const raw = process.env.SPELVARDE_FIXTURES ?? "";
  if (!raw || process.env.VERCEL) return new Set();
  return new Set(raw.split(",").map((s) => s.trim()));
}

const FIXTURES = path.join(process.cwd(), "test", "fixtures");

// ATG från fixturer. Tidigare starter finns bara för en häst
// (start-2026-10-24_7_11-1.json); för övriga lämnas samma lista utan häst-id,
// vilket räcker för att provköra flödet (inte för att se rätt form).
export const fixtureAtg: AtgFetch = async (p) => {
  const read = async (file: string) => JSON.parse(await readFile(path.join(FIXTURES, "atg", file), "utf8"));
  let m = /^calendar\/day\/(\d{4}-\d{2}-\d{2})$/.exec(p);
  if (m) {
    try {
      return await read(`calendar-${m[1]}.json`);
    } catch {
      throw new AtgError("ATG hittade inte spelet", 404);
    }
  }
  m = /^games\/(.+)$/.exec(p);
  if (m) {
    const id = decodeURIComponent(m[1]);
    for (const f of [`game-${id}-bettable.json`, `game-${id}-results.json`, `game-${id}.json`]) {
      try {
        return await read(f);
      } catch {
        // nästa
      }
    }
    throw new AtgError("ATG hittade inte spelet", 404);
  }
  m = /^races\/([^/]+)\/start\/(\d+)$/.exec(p);
  if (m) {
    const raceId = decodeURIComponent(m[1]);
    try {
      return await read(`start-${raceId}-${m[2]}.json`);
    } catch {
      const base = await read("start-2026-10-24_7_11-1.json");
      delete base.horse.id;
      return { ...base, raceId, startNumber: Number(m[2]) };
    }
  }
  throw new AtgError("Okänd fixtur", 404);
};

const TS_FILES: Record<string, string> = {
  "visaveckansnr.php": "visaveckansnr.html",
  "visaveckansrankvalny.php": "visaveckansrankvalny.html",
  "visaveckansMS.php": "visaveckansMS.html",
  "visaveckansbana.php": "visaveckansbana.html",
  "visakuskligan.php": "visakuskligan.html",
  "visatranarligan.php": "visatranarligan.html",
  "formtoppen.php": "formtoppen.html",
  "visasenasteomg.php": "visasenasteomg.html",
};

export const fixtureTs: TsFetch = async (p) => {
  const file = TS_FILES[p];
  if (!file) throw new Error("travstatistik.se svarade 404");
  return decodeHtml(new Uint8Array(await readFile(path.join(FIXTURES, "travstatistik", file))));
};

export function getFetchDeps(): FetchDeps {
  const modes = fixtureModes();
  return {
    db: prisma,
    atg: modes.has("atg") ? fixtureAtg : atgFetch,
    ts: modes.has("ts") ? fixtureTs : tsFetch,
    warn: (m) => console.warn("[hämtning]", m),
  };
}

// Unibet från fixturer: banor per dag (meetings-<datum>.json, dagen tas ur
// tidsfönstret) och lopp per nyckel (event-<eventKey>.json). Saknas filen
// svarar "Unibet" som före öppning: inga möten, eller ett lopp utan odds.
export const fixtureUnibet: UnibetFetch = async (query) => {
  const read = async (file: string) => JSON.parse(await readFile(path.join(FIXTURES, "unibet", file), "utf8"));
  const ev = /eventKey:"([^"]+)"/.exec(query);
  if (ev) {
    try {
      return await read(`event-${ev[1]}.json`);
    } catch {
      return { data: { viewer: { event: { hasFixedPrices: false, markets: [], competitors: [] } } } };
    }
  }
  const end = /endDateTime:"(\d{4}-\d{2}-\d{2})T/.exec(query);
  if (end) {
    try {
      return await read(`meetings-${end[1]}.json`);
    } catch {
      return { data: { viewer: { meetings: [] } } };
    }
  }
  throw new UnibetError("Okänd fixtur");
};

export function getUnibetDeps(): UnibetDeps {
  return {
    db: prisma,
    unibet: fixtureModes().has("unibet") ? fixtureUnibet : unibetFetch,
    warn: (m) => console.warn("[unibet]", m),
  };
}

// ---- Hämta tips (E5 13) ------------------------------------------------------------

// Sidan läses från test/fixtures/travstugan/<sökväg med / bytt mot _>.html
// (startsidan: index.html), oavsett domän. Saknad fil svarar som 404.
export const fixtureFetchPage: FetchPage = async (url) => {
  const u = new URL(url);
  const name = u.pathname.replace(/^\/+|\/+$/g, "").replace(/\//g, "_") || "index";
  if (!/^[\w.-]+$/.test(name)) throw new TipFetchError(FETCH_ERR.notFound);
  try {
    return { url, html: await readFile(path.join(FIXTURES, "travstugan", `${name}.html`), "utf8") };
  } catch {
    throw new TipFetchError(FETCH_ERR.notFound);
  }
};

export const fixtureRobots: FetchRobots = async () => {
  try {
    return await readFile(path.join(FIXTURES, "travstugan", "robots.txt"), "utf8");
  } catch {
    return null;
  }
};

// AI-svaret läses från test/fixtures/tips-ai/<första 12 tecknen av textHash>.json
// (ett sparat tool_use.input), annars en tom lista. Rapporterar 9 000 tokens
// in och 800 ut, så att AiUsage och dygnsgränsen går att prova utan kostnad.
export const fixtureAi: TipsAi = async ({ textHash }) => {
  let input: unknown = { tips: [] };
  try {
    input = JSON.parse(await readFile(path.join(FIXTURES, "tips-ai", `${textHash.slice(0, 12)}.json`), "utf8"));
  } catch {
    // ingen fixtur: inga tips
  }
  return { input, stopReason: "tool_use", inputTokens: 9000, outputTokens: 800, model: TIPS_MODEL };
};

export function getTipsDeps(): TipsDeps {
  const fixtures = fixtureModes().has("tips");
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  return {
    db: prisma,
    fetchPage: fixtures ? fixtureFetchPage : fetchPage,
    fetchRobots: fixtures ? fixtureRobots : fetchRobots,
    ai: fixtures ? fixtureAi : key ? createClaudeAi(key) : null,
    warn: (m) => console.warn("[tips]", m),
  };
}
