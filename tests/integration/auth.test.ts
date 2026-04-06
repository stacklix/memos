import { describe, expect, it } from "vitest";
import { apiJson } from "../helpers/http.js";
import { createTestApp } from "../helpers/test-app.js";
import { postFirstUser, seedAdmin, signIn } from "../helpers/seed.js";

describe("integration: auth", () => {
  it("POST first admin then signIn and GET /auth/me returns same user with email", async () => {
    const app = createTestApp();
    const r = await postFirstUser(app, {
      username: "root",
      password: "secret123",
      role: "ADMIN",
      email: "root@example.com",
    });
    expect(r.status).toBe(200);

    const { accessToken } = await signIn(app, "root", "secret123");
    const me = await apiJson(app, "/api/v1/auth/me", { bearer: accessToken });
    expect(me.status).toBe(200);
    const u = me.body.user as { username: string; email: string };
    expect(u.username).toBe("root");
    expect(u.email).toBe("root@example.com");
  });

  it("GET /auth/me without token returns 401", async () => {
    const app = createTestApp();
    await seedAdmin(app, { username: "a", password: "p" });
    const me = await apiJson(app, "/api/v1/auth/me");
    expect(me.status).toBe(401);
  });
});
