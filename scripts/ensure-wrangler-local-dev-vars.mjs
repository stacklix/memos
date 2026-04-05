#!/usr/bin/env node
/**
 * Before `wrangler dev`: ensure `.dev.vars` exists and contains `MEMOS_DEBUG_HTTP=1`
 * for local HTTP debug (same intent as local Node). Does not overwrite an existing
 * MEMOS_DEBUG_HTTP line (so MEMOS_DEBUG_HTTP=0 stays respected). `.dev.vars` is gitignored.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const devVarsPath = path.join(root, ".dev.vars");
const examplePath = path.join(root, ".dev.vars.example");

const hasMemosDebugLine = (content) => /^\s*MEMOS_DEBUG_HTTP\s*=/m.test(content);

if (!fs.existsSync(devVarsPath)) {
  const fromExample = fs.existsSync(examplePath) ? fs.readFileSync(examplePath, "utf8") : "";
  const body = fromExample.trim() ? `${fromExample.trim()}\n` : "";
  const withFlag = hasMemosDebugLine(body)
    ? body
    : `${body}${body && !body.endsWith("\n") ? "\n" : ""}MEMOS_DEBUG_HTTP=1\n`;
  fs.writeFileSync(devVarsPath, withFlag, "utf8");
  console.log("[memos] created .dev.vars for Wrangler local dev (MEMOS_DEBUG_HTTP=1).");
} else {
  let content = fs.readFileSync(devVarsPath, "utf8");
  if (!hasMemosDebugLine(content)) {
    if (content && !content.endsWith("\n")) content += "\n";
    content += "MEMOS_DEBUG_HTTP=1\n";
    fs.writeFileSync(devVarsPath, content, "utf8");
    console.log("[memos] appended MEMOS_DEBUG_HTTP=1 to .dev.vars for Wrangler local dev.");
  }
}
