import type Database from "better-sqlite3";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const NUMBERED_SQL = /^(\d{4})_.+\.sql$/i;

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?=\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.endsWith(";") ? s.slice(0, -1) : s));
}

function appliedVersionSync(db: Database.Database): number {
  const meta = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    )
    .get() as { name: string } | undefined;
  if (!meta) return 0;
  const row = db
    .prepare("SELECT MAX(version) as v FROM schema_migrations")
    .get() as { v: number | null };
  return row?.v ?? 0;
}

/** Apply one migration script (split statements). Caller ensures idempotency via schema version. */
export function migrateBetterSqlite(db: Database.Database, sql: string): void {
  for (const chunk of splitSqlStatements(sql)) {
    if (chunk.trim()) db.exec(chunk);
  }
}

/**
 * Apply pending `NNNN_description.sql` files from a directory (lexicographic order).
 * Skips a file when `MAX(schema_migrations.version) >= NNNN` (integer from the 4-digit prefix).
 * Add new migrations by dropping a new numbered `.sql` file — no TypeScript changes.
 */
export function migrateBetterSqliteFromDir(db: Database.Database, migrationsDir: string): void {
  if (!existsSync(migrationsDir)) {
    throw new Error(`[memos] migrations directory not found: ${migrationsDir}`);
  }
  const files = readdirSync(migrationsDir)
    .filter((f) => NUMBERED_SQL.test(f))
    .sort((a, b) => a.localeCompare(b));
  if (files.length === 0) {
    throw new Error(
      `[memos] No numbered SQL migrations in ${migrationsDir} (expected names like 0001_initial.sql)`,
    );
  }
  for (const name of files) {
    const m = name.match(NUMBERED_SQL);
    const fileVersion = m ? parseInt(m[1]!, 10) : 0;
    if (!Number.isFinite(fileVersion) || fileVersion < 1) continue;
    const current = appliedVersionSync(db);
    if (current >= fileVersion) continue;
    const sql = readFileSync(join(migrationsDir, name), "utf8");
    migrateBetterSqlite(db, sql);
  }
}
