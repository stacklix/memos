#!/usr/bin/env node
/**
 * Deletes `<repo>/.wrangler/state` (local Wrangler persistence: D1, and any other dev state).
 * Next `npm run dev:worker` / `db:migrate:d1:local` recreates an empty local D1 and reapplies migrations.
 *
 * Stop `wrangler dev` first.
 *
 *   npm run db:clear:d1:local
 *   npm run db:clear:d1:local -- --yes
 */
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "..");
const stateDir = join(repoRoot, ".wrangler", "state");

async function main() {
  const yes =
    process.argv.includes("--yes") ||
    process.argv.includes("-y") ||
    process.env.MEMOS_CLEAR_WORKER_DB_YES === "1";

  if (!existsSync(stateDir)) {
    console.log(`[db:clear:d1:local] Nothing to remove (${stateDir} not found).`);
    process.exit(0);
  }

  console.log("[db:clear:d1:local] Will delete local Wrangler persistence:\n  " + stateDir);
  console.log("[db:clear:d1:local] This removes local D1 data and other dev state under .wrangler/state.\n");
  console.log("[db:clear:d1:local] Stop `wrangler dev` first.\n");

  if (!yes) {
    const rl = createInterface({ input, output });
    const answer = (await rl.question("Type yes to delete: ")).trim().toLowerCase();
    rl.close();
    if (answer !== "yes" && answer !== "y") {
      console.log("[db:clear:d1:local] Aborted.");
      process.exit(1);
    }
  }

  rmSync(stateDir, { recursive: true, force: true });
  console.log("[db:clear:d1:local] Done. Run `npm run db:migrate:d1:local` or `npm run dev:worker` to recreate local D1.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
