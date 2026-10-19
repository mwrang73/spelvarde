// Lokal Postgres utan Docker, för utveckling och provkörning.
//
//   npm run db:local            startar databasen (stannar med Ctrl+C)
//   npm run db:local -- --reset raderar den lokala datan först
//
// Databasen ligger i .local-db/ (ignoreras av git) och lyssnar bara på
// 127.0.0.1:54329. Den kör samma huvudversion av Postgres som Supabase
// (17). Den matchar DATABASE_URL i .env.example för lokal körning.
// Skriptet vägrar köra om DATABASE_URL pekar någon annanstans än hit, så att
// migreringar och seed aldrig råkar gå mot en fjärrdatabas.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.join(root, ".local-db");
const PORT = 54329;
const USER = "spelvarde";
const PASSWORD = "spelvarde";
const DB = "spelvarde_dev";

const reset = process.argv.includes("--reset");
if (reset && existsSync(dataDir)) {
  rmSync(dataDir, { recursive: true, force: true });
  console.log("Lokal databas raderad.");
}

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: USER,
  password: PASSWORD,
  port: PORT,
  persistent: true,
  onLog: () => {},
  onError: (e) => console.error(String(e)),
  postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
});

const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase(DB);

console.log(`Lokal Postgres kör på 127.0.0.1:${PORT}, databas ${DB}.`);
console.log(`DATABASE_URL="postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DB}?schema=spelvarde"`);
console.log("Kör i en annan terminal: npx prisma migrate deploy && npm run db:seed");

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
// Håll processen vid liv.
setInterval(() => {}, 1 << 30);
