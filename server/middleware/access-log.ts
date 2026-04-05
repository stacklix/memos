import type { MiddlewareHandler } from "hono";

function outcomeForStatus(status: number): "ok" | "redirect" | "client_error" | "server_error" {
  if (status >= 500) return "server_error";
  if (status >= 400) return "client_error";
  if (status >= 300 && status < 400) return "redirect";
  return "ok";
}

function accessLogEnabled(): boolean {
  if (globalThis.process?.env?.NODE_ENV === "test") return false;
  if (globalThis.process?.env?.MEMOS_ACCESS_LOG === "0") return false;
  return true;
}

/**
 * One line per request: timestamp, method, path+query, status, duration, outcome.
 * Disable with `MEMOS_ACCESS_LOG=0` (Node). Skipped when `NODE_ENV=test`.
 */
export function accessLog(): MiddlewareHandler {
  if (!accessLogEnabled()) {
    return async (_c, next) => {
      await next();
    };
  }

  return async (c, next) => {
    const started = performance.now();
    let status = 0;
    try {
      await next();
      status = c.res.status;
    } catch (err) {
      status = 500;
      throw err;
    } finally {
      const ms = Math.max(0, Math.round(performance.now() - started));
      const u = new URL(c.req.url);
      const pathQuery = `${u.pathname}${u.search}`;
      const finalStatus = status || c.res?.status || 500;
      const outcome = outcomeForStatus(finalStatus);
      const ts = new Date().toISOString();
      console.log(`[access] ${ts} ${c.req.method} ${pathQuery} ${finalStatus} ${ms}ms ${outcome}`);
    }
  };
}
