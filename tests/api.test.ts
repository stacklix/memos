import Database from "better-sqlite3";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { createBetterSqliteAdapter } from "../server/db/better-sqlite-adapter.js";
import { migrateBetterSqliteFromDir } from "../server/db/migrate.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(repoRoot, "migrations");

function testDeps() {
  const sqlite = new Database(":memory:");
  migrateBetterSqliteFromDir(sqlite, migrationsDir);
  const sql = createBetterSqliteAdapter(sqlite);
  return {
    sql,
    demo: true,
    instanceVersion: "0.0.0-test",
    instanceUrl: "http://test",
  };
}

describe("API", () => {
  it("GET /healthz returns Service ready.", async () => {
    const app = createApp(testDeps());
    const res = await app.request("http://localhost/healthz");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Service ready.");
  });

  it("GET /api/v1/instance/profile is public", async () => {
    const app = createApp(testDeps());
    const res = await app.request("http://localhost/api/v1/instance/profile");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string; demo: boolean };
    expect(body.version).toBe("0.0.0-test");
    expect(body.demo).toBe(true);
  });

  it("POST /api/v1/users creates first admin", async () => {
    const app = createApp(testDeps());
    const res = await app.request("http://localhost/api/v1/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: { username: "admin", password: "secret123", role: "ADMIN" },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { username: string; role: string };
    expect(body.username).toBe("admin");
    expect(body.role).toBe("ADMIN");
  });

  it("POST memo with protobuf numeric visibility/state appears in GET /memos", async () => {
    const app = createApp(testDeps());
    await app.request("http://localhost/api/v1/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: { username: "writer", password: "secret123", role: "USER" },
      }),
    });
    const signIn = await app.request("http://localhost/api/v1/auth/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passwordCredentials: { username: "writer", password: "secret123" },
      }),
    });
    expect(signIn.status).toBe(200);
    const { accessToken } = (await signIn.json()) as { accessToken: string };
    const auth = { Authorization: `Bearer ${accessToken}` };

    const created = await app.request("http://localhost/api/v1/memos", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({
        memo: { content: "hello from test", visibility: 1, state: 1 },
      }),
    });
    expect(created.status).toBe(200);
    const memo = (await created.json()) as { visibility: string; state: string };
    expect(memo.visibility).toBe("PRIVATE");
    expect(memo.state).toBe("NORMAL");

    const list = await app.request("http://localhost/api/v1/memos?state=NORMAL&pageSize=10", {
      headers: auth,
    });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { memos: { content: string }[] };
    expect(listBody.memos.length).toBe(1);
    expect(listBody.memos[0].content).toBe("hello from test");
  });

  it("POST memo with location persists and GET returns it", async () => {
    const app = createApp(testDeps());
    await app.request("http://localhost/api/v1/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: { username: "geo", password: "secret123", role: "USER" },
      }),
    });
    const signIn = await app.request("http://localhost/api/v1/auth/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passwordCredentials: { username: "geo", password: "secret123" },
      }),
    });
    expect(signIn.status).toBe(200);
    const { accessToken } = (await signIn.json()) as { accessToken: string };
    const auth = { Authorization: `Bearer ${accessToken}` };

    const created = await app.request("http://localhost/api/v1/memos", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({
        memo: {
          content: "at a place",
          visibility: "PRIVATE",
          location: { placeholder: "Test Pin", latitude: 31.23, longitude: 121.47 },
        },
      }),
    });
    expect(created.status).toBe(200);
    const memo = (await created.json()) as {
      name: string;
      location?: { placeholder: string; latitude: number; longitude: number };
    };
    expect(memo.location?.placeholder).toBe("Test Pin");
    expect(memo.location?.latitude).toBe(31.23);
    expect(memo.location?.longitude).toBe(121.47);

    const id = memo.name.replace(/^memos\//, "");
    const again = await app.request(`http://localhost/api/v1/memos/${encodeURIComponent(id)}`, {
      headers: auth,
    });
    expect(again.status).toBe(200);
    const got = (await again.json()) as typeof memo;
    expect(got.location?.latitude).toBe(31.23);
  });

  it("POST memo with empty location object stores defaults like Go JSON", async () => {
    const app = createApp(testDeps());
    await app.request("http://localhost/api/v1/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: { username: "emptyloc", password: "secret123", role: "USER" },
      }),
    });
    const signIn = await app.request("http://localhost/api/v1/auth/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passwordCredentials: { username: "emptyloc", password: "secret123" },
      }),
    });
    const { accessToken } = (await signIn.json()) as { accessToken: string };
    const auth = { Authorization: `Bearer ${accessToken}` };

    const created = await app.request("http://localhost/api/v1/memos", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({
        memo: { content: "no coords", visibility: "PRIVATE", location: {} },
      }),
    });
    expect(created.status).toBe(200);
    const memo = (await created.json()) as {
      location?: { placeholder: string; latitude: number; longitude: number };
    };
    expect(memo.location?.placeholder).toBe("");
    expect(memo.location?.latitude).toBe(0);
    expect(memo.location?.longitude).toBe(0);
  });

  it("POST memo comment accepts location on comment body", async () => {
    const app = createApp(testDeps());
    await app.request("http://localhost/api/v1/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: { username: "commenter", password: "secret123", role: "USER" },
      }),
    });
    const signIn = await app.request("http://localhost/api/v1/auth/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passwordCredentials: { username: "commenter", password: "secret123" },
      }),
    });
    const { accessToken } = (await signIn.json()) as { accessToken: string };
    const auth = { Authorization: `Bearer ${accessToken}` };

    const parent = await app.request("http://localhost/api/v1/memos", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ memo: { content: "parent", visibility: "PRIVATE" } }),
    });
    expect(parent.status).toBe(200);
    const p = (await parent.json()) as { name: string };
    const pid = p.name.replace(/^memos\//, "");

    const comment = await app.request(
      `http://localhost/api/v1/memos/${encodeURIComponent(pid)}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({
          comment: {
            content: "here",
            location: { placeholder: "Cafe", latitude: 1.5, longitude: 2.5 },
          },
        }),
      },
    );
    expect(comment.status).toBe(200);
    const c = (await comment.json()) as {
      location?: { placeholder: string; latitude: number; longitude: number };
    };
    expect(c.location?.placeholder).toBe("Cafe");
    expect(c.location?.latitude).toBe(1.5);
    expect(c.location?.longitude).toBe(2.5);
  });

  it("POST memo rejects non-number latitude in location", async () => {
    const app = createApp(testDeps());
    await app.request("http://localhost/api/v1/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: { username: "badlat", password: "secret123", role: "USER" },
      }),
    });
    const signIn = await app.request("http://localhost/api/v1/auth/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passwordCredentials: { username: "badlat", password: "secret123" },
      }),
    });
    const { accessToken } = (await signIn.json()) as { accessToken: string };
    const res = await app.request("http://localhost/api/v1/memos", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        memo: {
          content: "x",
          visibility: "PRIVATE",
          location: { placeholder: "x", latitude: "31", longitude: 0 },
        },
      }),
    });
    expect(res.status).toBe(400);
  });

  it("GET user getStats returns tagCount from memo content", async () => {
    const app = createApp(testDeps());
    await app.request("http://localhost/api/v1/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: { username: "tagger", password: "secret123", role: "USER" },
      }),
    });
    const signIn = await app.request("http://localhost/api/v1/auth/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passwordCredentials: { username: "tagger", password: "secret123" },
      }),
    });
    expect(signIn.status).toBe(200);
    const { accessToken } = (await signIn.json()) as { accessToken: string };
    const auth = { Authorization: `Bearer ${accessToken}` };

    await app.request("http://localhost/api/v1/memos", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({
        memo: { content: "note with #test tag", visibility: "PRIVATE", state: "NORMAL" },
      }),
    });

    const stats = await app.request(
      "http://localhost/api/v1/users/" + encodeURIComponent("tagger:getStats"),
      { headers: auth },
    );
    expect(stats.status).toBe(200);
    const body = (await stats.json()) as { tagCount: Record<string, number>; totalMemoCount: number };
    expect(body.tagCount.test).toBe(1);
    expect(body.totalMemoCount).toBe(1);
  });

  it("GET /memos with filter returns memo matching tag", async () => {
    const app = createApp(testDeps());
    await app.request("http://localhost/api/v1/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: { username: "filtag", password: "secret123", role: "USER" },
      }),
    });
    const signIn = await app.request("http://localhost/api/v1/auth/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passwordCredentials: { username: "filtag", password: "secret123" },
      }),
    });
    const { accessToken } = (await signIn.json()) as { accessToken: string };
    const auth = { Authorization: `Bearer ${accessToken}` };

    await app.request("http://localhost/api/v1/memos", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({
        memo: { content: "x #alpha", visibility: "PRIVATE", state: "NORMAL" },
      }),
    });

    const q = new URLSearchParams({
      state: "NORMAL",
      pageSize: "50",
      filter: 'creator == "users/filtag" && tag in ["alpha"]',
    });
    const list = await app.request(`http://localhost/api/v1/memos?${q.toString()}`, { headers: auth });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { memos: { content: string }[] };
    expect(listBody.memos.length).toBe(1);
    expect(listBody.memos[0].content).toContain("#alpha");
  });

  it("PATCH instance/settings/TAGS persists for admin", async () => {
    const app = createApp(testDeps());
    await app.request("http://localhost/api/v1/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: { username: "adm", password: "secret123", role: "ADMIN" },
      }),
    });
    const signIn = await app.request("http://localhost/api/v1/auth/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passwordCredentials: { username: "adm", password: "secret123" },
      }),
    });
    const { accessToken } = (await signIn.json()) as { accessToken: string };
    const auth = { Authorization: `Bearer ${accessToken}` };

    const patch = await app.request("http://localhost/api/v1/instance/settings/TAGS", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({
        setting: {
          tagsSetting: {
            tags: { demo: { blurContent: true, backgroundColor: { red: 1, green: 0, blue: 0 } } },
          },
        },
      }),
    });
    expect(patch.status).toBe(200);

    const get = await app.request("http://localhost/api/v1/instance/settings/TAGS", { headers: auth });
    expect(get.status).toBe(200);
    const body = (await get.json()) as { tagsSetting: { tags: { demo: { blurContent: boolean } } } };
    expect(body.tagsSetting.tags.demo.blurContent).toBe(true);
  });
});
