import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** `dist/server/*.js` vs `server/*.ts` (tsx) */
function isDistServerModuleDir(dir: string): boolean {
  return /[/\\]dist[/\\]server$/i.test(dir.replace(/\\/g, "/"));
}

/**
 * Directory containing `NNNN_*.sql` migrations for Node (same layout as Wrangler `migrations_dir`).
 * Override with **`MEMOS_MIGRATIONS_DIR`** (absolute path) when deploy layout differs.
 */
export function resolveMigrationsDirectory(nodeEntryDir: string): string {
  const override = process.env.MEMOS_MIGRATIONS_DIR?.trim();
  if (override) return resolve(override);
  if (isDistServerModuleDir(nodeEntryDir)) {
    return resolve(join(nodeEntryDir, "../../migrations"));
  }
  return resolve(join(nodeEntryDir, "../migrations"));
}

export function assertMigrationsDirReadable(dir: string): void {
  if (!existsSync(dir)) {
    throw new Error(
      `[memos] migrations directory not found: ${dir}\n` +
        `Set MEMOS_MIGRATIONS_DIR to the absolute path of your migrations folder (same as Wrangler migrations_dir).`,
    );
  }
}
