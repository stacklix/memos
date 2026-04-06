#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const hasExplicitConfig = args.includes("--config");
const localConfig = "wrangler.local.jsonc";
const defaultConfig = "wrangler.jsonc";
const selectedConfig = !hasExplicitConfig && existsSync(localConfig) ? localConfig : defaultConfig;

const finalArgs = hasExplicitConfig ? args : [...args, "--config", selectedConfig];
console.log(`[wrangler] using config: ${selectedConfig}`);

const child = spawnSync("wrangler", finalArgs, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (typeof child.status === "number") {
  process.exit(child.status);
}
process.exit(1);
