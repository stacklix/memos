import type { TestApp } from "./test-app.js";

const origin = "http://localhost";

export type JsonRecord = Record<string, unknown>;

export async function apiRequest(
  app: TestApp,
  path: string,
  init?: RequestInit & { json?: unknown; bearer?: string },
): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.json !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.bearer) {
    headers.set("Authorization", `Bearer ${init.bearer}`);
  }
  const { json, bearer: _b, ...rest } = init ?? {};
  return app.request(`${origin}${path}`, {
    ...rest,
    headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
}

export async function apiJson<T = JsonRecord>(
  app: TestApp,
  path: string,
  init?: RequestInit & { json?: unknown; bearer?: string },
): Promise<{ status: number; body: T }> {
  const res = await apiRequest(app, path, init);
  const text = await res.text();
  const body = (text ? JSON.parse(text) : {}) as T;
  return { status: res.status, body };
}
