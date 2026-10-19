import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkMigrationSql, splitStatements } from "@/lib/migration-check";

const dir = path.join(__dirname, "..", "prisma", "migrations");
const migrations = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

describe("migreringarna rör bara schemat spelvarde", () => {
  it("finns minst en migrering", () => expect(migrations.length).toBeGreaterThan(0));
  for (const m of migrations) {
    it(m, () => {
      const sql = readFileSync(path.join(dir, m, "migration.sql"), "utf8");
      expect(checkMigrationSql(sql)).toEqual([]);
      const statements = splitStatements(sql);
      expect(statements.filter((s) => /^CREATE TABLE/i.test(s)).every((s) => /^CREATE TABLE "spelvarde"\./.test(s))).toBe(true);
      // RLS på varje tabell som skapas.
      const tables = statements.map((s) => /^CREATE TABLE "spelvarde"\."(\w+)"/.exec(s)?.[1]).filter(Boolean);
      for (const t of tables) expect(sql).toContain(`ALTER TABLE "spelvarde"."${t}" ENABLE ROW LEVEL SECURITY;`);
    });
  }
  it("kontrollen hittar fel", () => {
    expect(checkMigrationSql('DROP TABLE "spelvarde"."User";')).not.toEqual([]);
    expect(checkMigrationSql('CREATE TABLE "User" (id text);')).not.toEqual([]);
    expect(checkMigrationSql('ALTER TABLE "public"."User" ADD COLUMN x int;')).not.toEqual([]);
    expect(checkMigrationSql('CREATE INDEX "i" ON public.users(id);')).not.toEqual([]);
    expect(checkMigrationSql('TRUNCATE "spelvarde"."Mark";')).not.toEqual([]);
    expect(checkMigrationSql(`CREATE TYPE "spelvarde"."K" AS ENUM ('RUSH', 'DROP');`)).toEqual([]);
    expect(checkMigrationSql(`DO $$ BEGIN EXECUTE 'DROP TABLE "spelvarde"."X"'; END $$;`)).not.toEqual([]);
    expect(checkMigrationSql('CREATE TABLE "spelvarde"."X" ("id" TEXT, CONSTRAINT f FOREIGN KEY ("id") REFERENCES "spelvarde"."Y"("id") ON DELETE CASCADE ON UPDATE CASCADE);')).toEqual([]);
  });
});
