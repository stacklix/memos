#!/usr/bin/env node
/**
 * Waits until Node API + Vite dev server accept connections, then prints access URLs.
 * Run alongside `dev:node` / `dev:web` via `npm run dev` (concurrently).
 *
 * Override ports: MEMOS_DEV_API_PORT, MEMOS_DEV_WEB_PORT (defaults 3000 / 3001).
 */
import net from "node:net";
import os from "node:os";

const API_PORT = Number(process.env.MEMOS_DEV_API_PORT || 3000);
const WEB_PORT = Number(process.env.MEMOS_DEV_WEB_PORT || 3001);
const WAIT_MS = Number(process.env.MEMOS_DEV_URL_WAIT_MS || 120_000);

function checkPort(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" }, () => {
      s.destroy();
      resolve(true);
    });
    s.on("error", () => resolve(false));
  });
}

function primaryLanIPv4() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const e of nets[name] ?? []) {
      if (e.family === "IPv4" && !e.internal) return e.address;
    }
  }
  return null;
}

async function waitForReady() {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    if ((await checkPort(API_PORT)) && (await checkPort(WEB_PORT))) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** Keep event loop alive without a never-settling top-level await (Node can exit 13 otherwise). */
function stayRunningForConcurrently() {
  setInterval(() => {}, 86_400_000);
}

async function main() {
  const ok = await waitForReady();
  if (!ok) {
    console.warn(`[dev-urls] Timed out waiting for :${API_PORT} and :${WEB_PORT}（未打印地址；进程保持运行以免中断 dev）`);
  } else {
    const ip = primaryLanIPv4();
    const cyan = "\x1b[36m";
    const yellow = "\x1b[33m";
    const green = "\x1b[32m";
    const dim = "\x1b[2m";
    const bold = "\x1b[1m";
    const reset = "\x1b[0m";

    console.log("");
    console.log(`${bold}${cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${reset}`);
    console.log(`${bold}${yellow}  ➜ 开发时请优先使用 Vite 前端地址（热更新）${reset}`);
    console.log(`${bold}${green}     http://localhost:${WEB_PORT}/${reset}`);
    if (ip) {
      console.log(`${bold}${green}     http://${ip}:${WEB_PORT}/${reset}  ${dim}（同一局域网内其他设备）${reset}`);
    }
    console.log("");
    console.log(`${dim}  API / 直连静态（Node）  http://localhost:${API_PORT}${reset}`);
    console.log(`${bold}${cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${reset}`);
    console.log("");
  }

  stayRunningForConcurrently();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
