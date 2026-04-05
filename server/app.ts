import { Hono } from "hono";
import { accessLog } from "./middleware/access-log.js";
import type { AppDeps } from "./types/deps.js";
import { createV1App } from "./routes/v1/index.js";

/** Shared HTTP app. Mounts `GET /healthz` and `/api/v1` for Node and Worker. */
export function createApp(deps: AppDeps) {
  const app = new Hono();
  app.use("*", accessLog());
  app.get("/healthz", (c) => c.text("Service ready."));
  app.route("/api/v1", createV1App(deps));
  return app;
}
