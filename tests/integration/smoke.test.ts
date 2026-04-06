import { describe, expect, it } from "vitest";
import { apiRequest } from "../helpers/http.js";
import { createTestApp } from "../helpers/test-app.js";

describe("integration: smoke", () => {
  it("GET /healthz returns Service ready.", async () => {
    const app = createTestApp();
    const res = await apiRequest(app, "/healthz");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Service ready.");
  });

  it("GET /api/v1/instance/profile is public", async () => {
    const app = createTestApp();
    const res = await apiRequest(app, "/api/v1/instance/profile");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string; demo: boolean };
    expect(body.version).toBe("0.0.0-test");
    expect(body.demo).toBe(true);
  });

  it("GET /api/v1/status is unregistered; unauthenticated gets 401", async () => {
    const app = createTestApp();
    const res = await apiRequest(app, "/api/v1/status");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: number; message: string };
    expect(body.code).toBe(16);
    expect(body.message).toBe("permission denied");
  });
});
