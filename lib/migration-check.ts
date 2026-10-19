// Kontroll av migreringarnas SQL: allt ska ligga i schemat "spelvarde".
// Körs av lib/migration-check.test.ts (npm run check:migration).
//
// Regler:
// - Inga DROP, TRUNCATE, DELETE, UPDATE eller ALTER ... RENAME.
// - Varje CREATE (TABLE, TYPE, INDEX, SCHEMA …), ALTER, GRANT och REVOKE
//   måste nämna "spelvarde".
// - Varje schemakvalificerat namn ("x"."y" eller x.y) måste ha x = spelvarde.
// - Inget får nämna public, auth, storage eller andra Supabase-scheman.

export type MigrationIssue = { statement: string; problem: string };

// Delar upp SQL i satser. Kommentarer tas bort och $$-block hålls ihop.
export function splitStatements(sql: string): string[] {
  const noComments = sql.replace(/--[^\n]*/g, "");
  const out: string[] = [];
  let buf = "";
  let inDollar = false;
  let inQuote = false;
  for (let i = 0; i < noComments.length; i++) {
    const ch = noComments[i];
    if (!inQuote && noComments.startsWith("$$", i)) {
      inDollar = !inDollar;
      buf += "$$";
      i++;
      continue;
    }
    if (!inDollar && ch === "'") inQuote = !inQuote;
    if (ch === ";" && !inDollar && !inQuote) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const FORBIDDEN = /\b(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+"?\w+"?\s*\.?\s*"?\w*"?\s+SET|RENAME)\b/i;
const OTHER_SCHEMAS = /\b(public|auth|storage|extensions|graphql|graphql_public|realtime|supabase_functions|vault|pgsodium|net|cron)\s*\.|"(public|auth|storage|extensions|realtime|vault)"/i;
const NEEDS_SCHEMA = /^\s*(CREATE|ALTER|GRANT|REVOKE|COMMENT|DO)\b/i;

export function checkMigrationSql(sql: string): MigrationIssue[] {
  const issues: MigrationIssue[] = [];
  for (const statement of splitStatements(sql)) {
    const short = statement.replace(/\s+/g, " ").slice(0, 160);
    // Strängliteraler (t.ex. enumvärdet 'DROP') räknas inte som SQL – utom i
    // DO-block, där strängarna körs med EXECUTE.
    const code = /^\s*DO\b/i.test(statement) ? statement : statement.replace(/'(?:[^']|'')*'/g, "''");
    if (FORBIDDEN.test(code)) issues.push({ statement: short, problem: "förbjuden sats (DROP/TRUNCATE/DELETE/UPDATE/RENAME)" });
    if (OTHER_SCHEMAS.test(code)) issues.push({ statement: short, problem: "nämner ett annat schema" });
    if (NEEDS_SCHEMA.test(statement) && !/"?spelvarde"?/.test(statement)) issues.push({ statement: short, problem: "saknar schemat spelvarde" });
    // Kvalificerade namn "x"."y": x måste vara spelvarde.
    for (const m of statement.matchAll(/"([A-Za-z_][\w$]*)"\s*\.\s*"[A-Za-z_][\w$]*"/g)) {
      if (m[1] !== "spelvarde") issues.push({ statement: short, problem: `kvalificerat namn i schemat ${m[1]}` });
    }
  }
  return issues;
}
