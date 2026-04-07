import type { TestApp } from "./test-app.js";
import { apiJson, apiRequest } from "./http.js";

export type SeedUser = {
  username: string;
  password: string;
  role?: "ADMIN" | "USER";
  email?: string;
};

/** First user on empty instance (no auth). */
export async function postFirstUser(app: TestApp, user: SeedUser) {
  const { status, body } = await apiJson(app, "/api/v1/users", {
    method: "POST",
    json: {
      user: {
        username: user.username,
        password: user.password,
        role: user.role ?? "USER",
        ...(user.email !== undefined ? { email: user.email } : {}),
      },
    },
  });
  return { status, body };
}

/** Additional user; requires admin Bearer when instance already has users. */
export async function postUserAsAdmin(app: TestApp, adminToken: string, user: SeedUser) {
  return apiJson(app, "/api/v1/users", {
    method: "POST",
    bearer: adminToken,
    json: {
      user: {
        username: user.username,
        password: user.password,
        role: user.role ?? "USER",
        ...(user.email !== undefined ? { email: user.email } : {}),
      },
    },
  });
}

export async function signIn(app: TestApp, username: string, password: string) {
  const { status, body } = await apiJson<{
    accessToken?: string;
    user?: { username?: string };
  }>(app, "/api/v1/auth/signin", {
    method: "POST",
    json: { passwordCredentials: { username, password } },
  });
  if (status !== 200 || !body.accessToken) {
    throw new Error(`signIn failed: ${status} ${JSON.stringify(body)}`);
  }
  return { accessToken: body.accessToken, status, body };
}

export function authHeaders(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/** Seed admin + return token (convenience). */
export async function seedAdmin(
  app: TestApp,
  opts: { username?: string; password?: string; email?: string } = {},
) {
  const username = opts.username ?? "admin";
  const password = opts.password ?? "secret123";
  const r = await postFirstUser(app, {
    username,
    password,
    role: "ADMIN",
    email: opts.email ?? "admin@example.com",
  });
  if (r.status !== 200) {
    throw new Error(`seedAdmin failed: ${r.status}`);
  }
  const { accessToken } = await signIn(app, username, password);
  return { username, password, accessToken };
}

export async function postMemo(
  app: TestApp,
  token: string,
  memo: Record<string, unknown>,
) {
  return apiJson(app, "/api/v1/memos", {
    method: "POST",
    bearer: token,
    json: memo,
  });
}

export function memoIdFromName(name: string): string {
  return name.replace(/^memos\//, "");
}
