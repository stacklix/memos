import { describe, expect, it } from "vitest";
import { apiJson, apiRequest } from "../helpers/http.js";
import { createTestApp } from "../helpers/test-app.js";
import { postFirstUser, postMemo, postUserAsAdmin, seedAdmin, signIn } from "../helpers/seed.js";

describe("integration: errors and unimplemented", () => {
  it("PATCH memo without auth returns 401", async () => {
    const app = createTestApp();
    await postFirstUser(app, { username: "e1", password: "secret123", role: "USER" });
    const { accessToken } = await signIn(app, "e1", "secret123");
    const m = await postMemo(app, accessToken, { content: "x", visibility: "PRIVATE" });
    const id = (m.body as { name: string }).name.replace(/^memos\//, "");

    const res = await apiJson(app, `/api/v1/memos/${encodeURIComponent(id)}`, {
      method: "PATCH",
      json: { memo: { content: "y" } },
    });
    expect(res.status).toBe(401);
  });

  it("non-owner cannot delete others memo (403)", async () => {
    const app = createTestApp();
    const { accessToken: adminTok } = await seedAdmin(app, { username: "adm", password: "secret123" });
    await postUserAsAdmin(app, adminTok, { username: "owner", password: "secret123", role: "USER" });
    await postUserAsAdmin(app, adminTok, { username: "other", password: "secret123", role: "USER" });
    const ownerTok = (await signIn(app, "owner", "secret123")).accessToken;
    const otherTok = (await signIn(app, "other", "secret123")).accessToken;
    const m = await postMemo(app, ownerTok, { content: "mine", visibility: "PRIVATE" });
    const id = (m.body as { name: string }).name.replace(/^memos\//, "");

    const del = await apiJson(app, `/api/v1/memos/${encodeURIComponent(id)}`, {
      method: "DELETE",
      bearer: otherTok,
    });
    expect(del.status).toBe(403);
  });

  it("malformed JSON body is rejected (non-2xx)", async () => {
    const app = createTestApp();
    await postFirstUser(app, { username: "e2", password: "secret123", role: "USER" });
    const { accessToken } = await signIn(app, "e2", "secret123");
    const res = await apiRequest(app, "/api/v1/memos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: "{not-json",
    });
    // Current Hono handler surfaces JSON.parse failure as 500 + grpc internal
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("SSO signin returns 501", async () => {
    const app = createTestApp();
    const res = await apiJson(app, "/api/v1/auth/signin", {
      method: "POST",
      json: { ssoCredentials: { something: 1 } },
    });
    expect(res.status).toBe(501);
    expect((res.body as { code: number }).code).toBe(12);
  });

  it("memo attachments routes are implemented", async () => {
    const app = createTestApp();
    await postFirstUser(app, { username: "e3", password: "secret123", role: "USER" });
    const { accessToken } = await signIn(app, "e3", "secret123");
    const m = await postMemo(app, accessToken, { content: "a", visibility: "PRIVATE" });
    const id = (m.body as { name: string }).name.replace(/^memos\//, "");

    const get = await apiJson(app, `/api/v1/memos/${encodeURIComponent(id)}/attachments`, {
      bearer: accessToken,
    });
    expect(get.status).toBe(200);

    const patch = await apiJson(app, `/api/v1/memos/${encodeURIComponent(id)}/attachments`, {
      method: "PATCH",
      bearer: accessToken,
      json: { attachments: [] },
    });
    expect(patch.status).toBe(200);
  });
});
