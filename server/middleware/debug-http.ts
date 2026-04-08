import type { MiddlewareHandler } from "hono";

const MAX_BODY_CHARS = 24_576;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… [truncated, total ${s.length} chars]`;
}

function headerRecord(h: Headers): Record<string, string> {
  const o: Record<string, string> = {};
  h.forEach((v, k) => {
    o[k] = v;
  });
  return o;
}

/**
 * Verbose HTTP debug for `/api/v1` (enable with `MEMOS_DEBUG_HTTP=1` / `deps.debugHttp`).
 * Logs query params, headers, body, then response status, headers, body. Test-only; may include secrets.
 */
export function debugHttpLog(enabled: boolean): MiddlewareHandler {
  if (!enabled) {
    return async (_c, next) => next();
  }

  return async (c, next) => {
    const id = crypto.randomUUID().slice(0, 8);
    const u = new URL(c.req.url);
    const query = Object.fromEntries(u.searchParams.entries());

    let reqBody = "";
    const method = c.req.method;
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      try {
        reqBody = await c.req.raw.clone().text();
      } catch {
        reqBody = "(failed to read request body)";
      }
    }

    console.log(`[debug:http] ${id} >>> ${method} ${u.pathname}${u.search}`);
    if (Object.keys(query).length > 0) {
      console.log(`[debug:http] ${id} query`, JSON.stringify(query, null, 2));
    }
    console.log(`[debug:http] ${id} request headers`, JSON.stringify(headerRecord(c.req.raw.headers), null, 2));
    if (reqBody) {
      console.log(
        `[debug:http] ${id} ${method} ${u.pathname}${u.search} request body`,
        truncate(reqBody, MAX_BODY_CHARS),
      );
    }

    await next();

    const res = c.res;
    let resBody = "";
    try {
      resBody = await res.clone().text();
    } catch {
      resBody = "(failed to read response body)";
    }

    const ct = res.headers.get("content-type") ?? "";
    console.log(`[debug:http] ${id} <<< ${res.status} content-type=${ct || "(none)"}`);
    console.log(`[debug:http] ${id} response headers`, JSON.stringify(headerRecord(res.headers), null, 2));
    console.log(
      `[debug:http] ${id} ${method} ${u.pathname}${u.search} response body`,
      resBody ? truncate(resBody, MAX_BODY_CHARS) : "(empty)",
    );
  };
}
