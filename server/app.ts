import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { accessLog } from "./middleware/access-log.js";
import { logUncaughtApiError } from "./lib/error-logger.js";
import { GrpcCode, jsonError } from "./lib/grpc-status.js";
import type { AppDeps } from "./types/deps.js";
import { createV1App } from "./routes/v1/index.js";

/** Shared HTTP app. Mounts `GET /healthz` and `/api/v1` for Node and Worker. */
export function createApp(deps: AppDeps) {
  const app = new Hono();
  app.onError((err, c) => {
    const u = new URL(c.req.url);
    logUncaughtApiError(err, { method: c.req.method, path: u.pathname });
    if (err instanceof HTTPException) {
      return err.getResponse();
    }
    return jsonError(c, GrpcCode.INTERNAL, "internal error");
  });
  app.use("*", accessLog());
  app.get("/healthz", (c) => c.text("Service ready."));
  app.route("/api/v1", createV1App(deps));
  return app;
}
