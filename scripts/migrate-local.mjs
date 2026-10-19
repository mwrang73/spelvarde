// Kör `prisma migrate deploy` mot den LOKALA databasen (npm run db:local).
// Vägrar om DATABASE_URL/DIRECT_URL pekar någon annanstans än 127.0.0.1 eller
// localhost, så att det här skriptet aldrig kan röra drift.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
  let u;
  try {
    u = new URL(process.env[key] ?? "");
  } catch {
    console.error(`${key} saknas.`);
    process.exit(1);
  }
  if (!["127.0.0.1", "localhost"].includes(u.hostname) || u.searchParams.get("schema") !== "spelvarde") {
    console.error(`${key} pekar inte på den lokala databasen med ?schema=spelvarde. Avbryter.`);
    process.exit(1);
  }
}
execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });
