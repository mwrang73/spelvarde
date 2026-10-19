// Vilka källor rutterna använder: riktiga ATG och travstatistik.se, eller
// fixturerna i test/fixtures för lokal provkörning.
//
//   SPELVARDE_FIXTURES=atg,ts   båda från fixturer
//   SPELVARDE_FIXTURES=ts       riktiga ATG, travstatistik från fixturer
//
// Fixturläget vägrar köras på Vercel (VERCEL är satt där).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AtgError, atgFetch, type AtgFetch } from "@/lib/atg";
import type { FetchDeps } from "@/lib/fetch-round";
import { prisma } from "@/lib/prisma";
import { decodeHtml, tsFetch, type TsFetch } from "@/lib/travstatistik";

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
