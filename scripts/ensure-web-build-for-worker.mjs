#!/usr/bin/env node
/**
 * For `npm run dev:worker`: run `build:web` only when `dist/public` is missing
 * or older than any tracked file under `web/` (excluding node_modules, caches).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const distPublic = path.join(root, "dist/public");
const distIndex = path.join(distPublic, "index.html");
const webRoot = path.join(root, "web");

/** Directory names to skip anywhere under `web/`. */
const SKIP_DIR_NAMES = new Set(["node_modules", ".vite", ".turbo", ".cache", "coverage", "dist"]);

function maxMtimeMsInTree(dirPath) {
  let max = 0;
  if (!fs.existsSync(dirPath)) return 0;
  const st = fs.lstatSync(dirPath);
  if (!st.isDirectory()) return st.mtimeMs;

  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIR_NAMES.has(e.name)) continue;
      const m = maxMtimeMsInTree(path.join(dirPath, e.name));
      if (m > max) max = m;
    } else {
      try {
        const f = fs.lstatSync(path.join(dirPath, e.name));
        if (f.isFile() && f.mtimeMs > max) max = f.mtimeMs;
      } catch {
        /* ignore */
      }
    }
  }
  return max;
}

function distArtifactMtimeMs() {
  if (!fs.existsSync(distIndex)) return 0;
  return maxMtimeMsInTree(distPublic);
}

function webSourceMtimeMs() {
  return maxMtimeMsInTree(webRoot);
}

function needsBuild() {
  const out = distArtifactMtimeMs();
  if (out === 0) {
    console.log("[dev:worker] dist/public missing or incomplete; running build:web");
    return true;
  }
  const src = webSourceMtimeMs();
  if (src > out) {
    console.log("[dev:worker] web/ is newer than dist/public; running build:web");
    return true;
  }
  console.log("[dev:worker] dist/public is up to date; skipping build:web");
  return false;
}

if (needsBuild()) {
  const shell = process.platform === "win32";
  const r = spawnSync("npm", ["run", "build:web"], {
    cwd: root,
    stdio: "inherit",
    shell,
  });
  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}
