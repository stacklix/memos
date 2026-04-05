import { createApp } from "./app.js";
import { createD1Adapter } from "./db/d1-adapter.js";
import type { WorkerBindings } from "./types/bindings.js";

/**
 * Cloudflare Worker: `/healthz` 与 `/api/*` 由 Hono 处理，其余交给 Static Assets（`dist/public/`，见 `wrangler.jsonc`）。
 * 见 `wrangler.jsonc` 中 `assets.run_worker_first`。
 */
export default {
  async fetch(
    request: Request,
    env: WorkerBindings,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const handleApi =
      url.pathname === "/healthz" || url.pathname.startsWith("/api/");
    if (handleApi) {
      const sql = createD1Adapter(env.MEMOS_DB);
      const demo = env.MEMOS_DEMO === "1";
      const instanceUrl = `${url.protocol}//${url.host}`;
      const app = createApp({
        sql,
        demo,
        instanceVersion: env.MEMOS_VERSION ?? "0.1.0",
        instanceUrl,
      });
      return app.fetch(request, env, ctx);
    }
    const assetRes = await env.ASSETS.fetch(request);
    const pathname = url.pathname;
    if (pathname === "/" || pathname === "/index.html") {
      const h = new Headers(assetRes.headers);
      h.set("Cache-Control", "no-cache, no-store, must-revalidate");
      h.set("Pragma", "no-cache");
      h.set("Expires", "0");
      return new Response(assetRes.body, { status: assetRes.status, headers: h });
    }
    if (/-[A-Za-z0-9_-]{6,}\.(js|css|woff2?)$/i.test(pathname)) {
      const h = new Headers(assetRes.headers);
      h.set("Cache-Control", "public, max-age=3600, immutable");
      return new Response(assetRes.body, { status: assetRes.status, headers: h });
    }
    return assetRes;
  },
} satisfies ExportedHandler<WorkerBindings>;
