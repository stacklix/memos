import type { MiddlewareHandler } from "hono";

const ERROR_BODY_PREVIEW_MAX = 512;

function outcomeForStatus(status: number): "ok" | "redirect" | "client_error" | "server_error" {
  if (status >= 500) return "server_error";
  if (status >= 400) return "client_error";
  if (status >= 300 && status < 400) return "redirect";
  return "ok";
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Best-effort summary of an error response body for access logs (does not consume the real body stream).
 */
async function errorResponseDetail(res: Response): Promise<string | undefined> {
  try {
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json") && !ct.includes("text/")) {
      return undefined;
    }
    const raw = (await res.clone().text()).trim();
    if (!raw) return undefined;
    try {
      const j = JSON.parse(raw) as { code?: unknown; message?: unknown; details?: unknown };
      if (typeof j.message === "string") {
        const parts: string[] = [];
        if (typeof j.code === "number") parts.push(`code=${j.code}`);
        parts.push(j.message);
        if (j.details !== undefined) {
          const d = typeof j.details === "string" ? j.details : JSON.stringify(j.details);
          parts.push(`details=${d}`);
        }
        const out = oneLine(parts.join(" "));
        return out.length > ERROR_BODY_PREVIEW_MAX ? `${out.slice(0, ERROR_BODY_PREVIEW_MAX)}…` : out;
      }
    } catch {
      /* not JSON */
    }
    const flat = oneLine(raw);
    return flat.length > ERROR_BODY_PREVIEW_MAX ? `${flat.slice(0, ERROR_BODY_PREVIEW_MAX)}…` : flat;
  } catch {
    return undefined;
  }
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
      let line = `[access] ${ts} ${c.req.method} ${pathQuery} ${finalStatus} ${ms}ms ${outcome}`;
      if (finalStatus >= 400 && c.res) {
        const detail = await errorResponseDetail(c.res);
        if (detail) line += ` | ${detail}`;
      }
      console.log(line);
    }
  };
}
