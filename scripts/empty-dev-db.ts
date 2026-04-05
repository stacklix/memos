/**
 * Truncates all application data in the local SQLite file while keeping tables
 * and indexes (schema). Does not delete the database file.
 *
 * Preserves `schema_migrations` so the next server start does not re-run embedded
 * migration SQL (tables already exist).
 *
 * Stop the Node server first — the file may be locked while open.
 *
 * Usage:
 *   npm run db:empty:sqlite
 *   npm run db:empty:sqlite -- --yes    # non-interactive
 *
 * Env: DATA_DIR (default `<repo>/data`), same as the Node server.
 */
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "..");

function resolveDataDir(): string {
  return process.env.DATA_DIR ?? join(repoRoot, "data");
}

async function main(): Promise<void> {
  const yes =
    process.argv.includes("--yes") ||
    process.argv.includes("-y") ||
    process.env.MEMOS_EMPTY_DEV_DB_YES === "1";

  const dbPath = join(resolveDataDir(), "memos.sqlite");

  if (!existsSync(dbPath)) {
    console.log(`[empty-dev-db] No database at ${dbPath}`);
    process.exit(0);
  }

  console.log(`[empty-dev-db] Will truncate all data tables in:\n  ${dbPath}`);
  console.log("[empty-dev-db] Schema and schema_migrations version are kept.\n");
  console.log("[empty-dev-db] Stop `npm run dev:node` first if it is running.\n");

  if (!yes) {
    const rl = createInterface({ input, output });
    const answer = (await rl.question("Type yes to truncate: ")).trim().toLowerCase();
    rl.close();
    if (answer !== "yes" && answer !== "y") {
      console.log("[empty-dev-db] Aborted.");
      process.exit(1);
    }
  }

  const db = new Database(dbPath);
  try {
    db.pragma("foreign_keys = OFF");
    const rows = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
           AND name != 'schema_migrations'`,
      )
      .all() as { name: string }[];
    for (const { name } of rows) {
      db.exec(`DELETE FROM "${name.replace(/"/g, '""')}"`);
      console.log(`[empty-dev-db] Truncated ${name}`);
    }
    db.exec("DELETE FROM sqlite_sequence");
    db.pragma("foreign_keys = ON");
    db.exec("VACUUM");
    console.log("[empty-dev-db] Done.");
  } finally {
    db.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
