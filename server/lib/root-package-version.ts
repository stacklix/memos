import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Read root `package.json` `"version"` (Node only). Tries `../package.json` from `server/`
 * and `../../package.json` from `dist/server/`.
 */
export function readRootPackageJsonVersion(fromDir: string): string {
  const candidates = [join(fromDir, "..", "package.json"), join(fromDir, "..", "..", "package.json")];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, "utf-8")) as { version?: unknown };
      if (typeof j.version === "string" && j.version.length > 0) return j.version;
    } catch {
      /* skip */
    }
  }
  return "0.0.0";
}
