/**
 * Deletes the local SQLite **file** used by `npm run dev:node` / `start:node`
 * (default: <repo>/data/memos.sqlite). Next Node start will re-apply `migrations/0001_initial.sql` automatically if that path is available.
 *
 * To keep the file and only truncate rows (preserve schema), use `npm run db:empty:sqlite`.
 *
 * Stop the Node server first — the file may be locked while open.
 *
 * Usage:
 *   npm run db:clear:sqlite
 *   npm run db:clear:sqlite -- --yes    # non-interactive (CI / scripts)
 *
 * Same data directory as the server: env DATA_DIR, default `<repo>/data`.
 */
import { existsSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "..");

function resolveDataDir(): string {
  return process.env.DATA_DIR ?? join(repoRoot, "data");
}

const SQLITE_SUFFIXES = ["", "-wal", "-shm"] as const;

function dbFiles(base: string): string[] {
  return SQLITE_SUFFIXES.map((s) => `${base}${s}`);
}

async function main(): Promise<void> {
  const yes =
    process.argv.includes("--yes") ||
    process.argv.includes("-y") ||
    process.env.MEMOS_CLEAR_DEV_DB_YES === "1";

  const dataDir = resolveDataDir();
  const dbPath = join(dataDir, "memos.sqlite");
  const paths = dbFiles(dbPath).filter((p) => existsSync(p));

  if (paths.length === 0) {
    console.log(`[clear-dev-db] Nothing to remove (${dbPath}* not found).`);
    process.exit(0);
  }

  console.log("[clear-dev-db] Will remove:");
  for (const p of paths) console.log(`  ${p}`);
  console.log("[clear-dev-db] Stop `npm run dev:node` first if it is running.\n");

  if (!yes) {
    const rl = createInterface({ input, output });
    const answer = (await rl.question("Type yes to delete: ")).trim().toLowerCase();
    rl.close();
    if (answer !== "yes" && answer !== "y") {
      console.log("[clear-dev-db] Aborted.");
      process.exit(1);
    }
  }

  for (const p of paths) {
    try {
      unlinkSync(p);
      console.log(`[clear-dev-db] Removed ${p}`);
    } catch (e) {
      console.error(`[clear-dev-db] Failed to remove ${p}:`, e);
      process.exit(1);
    }
  }

  console.log("[clear-dev-db] Done. Start the server again to apply migrations to a new DB.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
