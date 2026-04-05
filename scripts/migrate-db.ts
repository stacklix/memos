/**
 * Apply pending `migrations/NNNN_*.sql` to `memos.sqlite` without starting HTTP.
 * Same logic as `server/node.ts` startup (honours `MEMOS_MIGRATIONS_DIR`).
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateBetterSqliteFromDir } from "../server/db/migrate.js";
import { resolveMigrationsDirectory } from "../server/lib/initial-migration-sql.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolveMigrationsDirectory(resolve(join(scriptDir, "..", "server")));
const dataDir = process.env.DATA_DIR ?? resolve(join(scriptDir, "..", "data"));
mkdirSync(dataDir, { recursive: true });
const dbPath = join(dataDir, "memos.sqlite");

const db = new Database(dbPath);
try {
  migrateBetterSqliteFromDir(db, migrationsDir);
  console.log("[db:migrate:sqlite] OK", dbPath);
} finally {
  db.close();
}
