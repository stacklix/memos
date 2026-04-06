import { describe, expect, it } from "vitest";
import { apiJson } from "../helpers/http.js";
import { createTestApp } from "../helpers/test-app.js";
import { postMemo, postUserAsAdmin, postFirstUser, seedAdmin, signIn } from "../helpers/seed.js";

describe("integration: users", () => {
  it("GET user email redacted for anonymous; visible for admin viewer", async () => {
    const app = createTestApp();
    await postFirstUser(app, {
      username: "admin",
      password: "secret123",
      role: "ADMIN",
      email: "admin@example.com",
    });

    const anon = await apiJson(app, "/api/v1/users/admin");
    expect(anon.status).toBe(200);
    expect((anon.body as { email: string }).email).toBe("");

    const { accessToken } = await signIn(app, "admin", "secret123");
    const authed = await apiJson(app, "/api/v1/users/admin", { bearer: accessToken });
    expect(authed.status).toBe(200);
    expect((authed.body as { email: string }).email).toBe("admin@example.com");
  });

  it("admin lists users with pageSize and pageToken chain", async () => {
    const app = createTestApp();
    const { accessToken } = await seedAdmin(app, { username: "adm", password: "secret123" });
    await postUserAsAdmin(app, accessToken, {
      username: "u1",
      password: "secret123",
      role: "USER",
    });
    await postUserAsAdmin(app, accessToken, {
      username: "u2",
      password: "secret123",
      role: "USER",
    });

    const p1 = await apiJson<{
      users: { username: string }[];
      nextPageToken?: string;
    }>(app, "/api/v1/users?pageSize=1", { bearer: accessToken });
    expect(p1.status).toBe(200);
    expect(p1.body.users.length).toBe(1);
    expect(p1.body.nextPageToken).toBeTruthy();

    const p2 = await apiJson<{
      users: { username: string }[];
    }>(app, `/api/v1/users?pageSize=1&pageToken=${encodeURIComponent(p1.body.nextPageToken!)}`, {
      bearer: accessToken,
    });
    expect(p2.status).toBe(200);
    expect(p2.body.users.length).toBe(1);
    expect(p2.body.users[0].username).not.toBe(p1.body.users[0].username);
  });

  it("user PATCH displayName then GET reflects change", async () => {
    const app = createTestApp();
    await postFirstUser(app, { username: "self", password: "secret123", role: "USER" });
    const { accessToken } = await signIn(app, "self", "secret123");

    const patch = await apiJson(app, "/api/v1/users/self", {
      method: "PATCH",
      bearer: accessToken,
      json: {
        user: { displayName: "New Name" },
        updateMask: { paths: ["displayName"] },
      },
    });
    expect(patch.status).toBe(200);
    expect((patch.body as { displayName: string }).displayName).toBe("New Name");

    const get = await apiJson(app, "/api/v1/users/self", { bearer: accessToken });
    expect(get.status).toBe(200);
    expect((get.body as { displayName: string }).displayName).toBe("New Name");
  });

  it(":getStats and GET /users:stats agree after memos with tags", async () => {
    const app = createTestApp();
    await postFirstUser(app, { username: "tagger", password: "secret123", role: "USER" });
    const { accessToken } = await signIn(app, "tagger", "secret123");

    const created = await postMemo(app, accessToken, {
      content: "note with #test tag",
      visibility: "PRIVATE",
      state: "NORMAL",
    });
    expect(created.status).toBe(200);

    const stats = await apiJson<{
      name: string;
      tagCount: Record<string, number>;
      totalMemoCount: number;
    }>(app, "/api/v1/users/" + encodeURIComponent("tagger:getStats"), { bearer: accessToken });
    expect(stats.status).toBe(200);
    expect(stats.body.name).toBe("users/tagger/stats");
    expect(stats.body.tagCount.test).toBe(1);
    expect(stats.body.totalMemoCount).toBe(1);

    const all = await apiJson<{ stats: { name: string; tagCount: Record<string, number> }[] }>(
      app,
      "/api/v1/users:stats",
      { bearer: accessToken },
    );
    expect(all.status).toBe(200);
    const row = all.body.stats.find((s) => s.name === "users/tagger/stats");
    expect(row).toBeDefined();
    expect(row!.tagCount.test).toBe(1);
  });
});
