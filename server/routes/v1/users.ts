import { Hono } from "hono";
import { z } from "zod";
import type { ApiVariables } from "../../types/api-variables.js";
import type { AppDeps } from "../../types/deps.js";
import { createRepository } from "../../db/repository.js";
import { GrpcCode, jsonError } from "../../lib/grpc-status.js";
import { b64urlToUtf8, utf8ToB64url } from "../../lib/b64url.js";
import { hashPassword } from "../../services/password.js";
import { userToJson } from "../../lib/serializers.js";
import { userStatsFieldsFromMemoRows } from "../../lib/user-stats-from-memos.js";

/** Proto `User.Role`: ROLE_UNSPECIFIED=0, ADMIN=2, USER=3 — JSON often uses these numbers. */
const createUserRoleField = z
  .union([
    z.enum(["ADMIN", "USER", "ROLE_UNSPECIFIED"]),
    z.literal(0),
    z.literal(2),
    z.literal(3),
  ])
  .optional()
  .transform((v): "ADMIN" | "USER" | "ROLE_UNSPECIFIED" | undefined => {
    if (v === undefined) return undefined;
    if (v === "ADMIN" || v === 2) return "ADMIN";
    if (v === "USER" || v === 3) return "USER";
    return "ROLE_UNSPECIFIED";
  });

/** Proto `State` uses ints in JSON; server only validates shape (create ignores state). */
const createUserStateField = z.union([z.string(), z.number()]).optional();

const createUserBody = z.object({
  user: z.object({
    username: z.string(),
    password: z.string().optional(),
    role: createUserRoleField,
    displayName: z.string().optional(),
    email: z.string().optional(),
    state: createUserStateField,
  }),
  userId: z.string().optional(),
  validateOnly: z.boolean().optional(),
});

export function createUserRoutes(deps: AppDeps) {
  const r = new Hono<{ Variables: ApiVariables }>();
  const repo = createRepository(deps.sql);

  r.get("/", async (c) => {
    const auth = c.get("auth");
    if (!auth) {
      return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    }
    if (auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "admin only");
    }
    const pageSize = Math.min(
      1000,
      Math.max(1, Number(c.req.query("pageSize") ?? 50)),
    );
    const token = c.req.query("pageToken");
    let offset = 0;
    if (token) {
      const n = Number(b64urlToUtf8(token));
      offset = Number.isFinite(n) ? n : 0;
    }
    const users = await repo.listUsers({ limit: pageSize, offset });
    const next =
      users.length === pageSize
        ? utf8ToB64url(String(offset + pageSize))
        : "";
    return c.json({
      users: users.map(userToJson),
      nextPageToken: next,
      totalSize: await repo.userCount(),
    });
  });

  r.post("/", async (c) => {
    let body: z.infer<typeof createUserBody>;
    try {
      body = createUserBody.parse(await c.req.json());
    } catch {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid body");
    }
    const general = await repo.getGeneralSetting();
    const count = await repo.userCount();
    if (general.disallowUserRegistration && count > 0) {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "registration disabled");
    }
    const username = body.userId?.trim() || body.user.username;
    if (!username || !/^[a-z0-9-]+$/i.test(username)) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid username");
    }
    if (await repo.getUser(username)) {
      return jsonError(c, GrpcCode.ALREADY_EXISTS, "user exists");
    }
    const role =
      count === 0 ? "ADMIN" : body.user.role === "ADMIN" ? "ADMIN" : "USER";
    if (role === "ADMIN" && count > 0 && c.get("auth")?.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "admin only");
    }
    const password = body.user.password ?? "";
    if (!password) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "password required");
    }
    if (general.disallowPasswordAuth) {
      return jsonError(c, GrpcCode.FAILED_PRECONDITION, "password not allowed");
    }
    if (body.validateOnly) {
      return c.json(
        userToJson({
          username,
          password_hash: "",
          role,
          display_name: body.user.displayName ?? null,
          email: body.user.email ?? null,
          avatar_url: null,
          description: null,
          state: "NORMAL",
          create_time: new Date().toISOString(),
          update_time: new Date().toISOString(),
          deleted: 0,
        }),
      );
    }
    if (!deps.demo) await repo.ensureSecretKey();
    const hash = await hashPassword(password);
    const created = await repo.createUser({
      username,
      passwordHash: hash,
      role: role === "ADMIN" ? "ADMIN" : "USER",
      displayName: body.user.displayName,
      email: body.user.email,
    });
    return c.json(userToJson(created));
  });

  const forUser = new Hono<{ Variables: ApiVariables }>();

  forUser.use(async (c, next) => {
    if (!c.req.param("username")) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid user path");
    }
    await next();
  });

  forUser.get("/", async (c) => {
    const raw = c.req.param("username")!;
    if (raw.endsWith(":getStats")) {
      const username = raw.slice(0, -":getStats".length);
      const user = await repo.getUser(username);
      if (!user) return jsonError(c, GrpcCode.NOT_FOUND, "user not found");
      const auth = c.get("auth");
      const viewerUsername = auth?.username ?? null;
      const useUpdateTimeForHeatmap = await repo.getMemoRelatedDisplayWithUpdateTime();
      const rows = await repo.listTopLevelMemosForUserStats({
        creatorUsername: username,
        viewerUsername,
      });
      const {
        tagCount,
        memoDisplayTimestamps,
        totalMemoCount,
        memoTypeStats,
        pinnedMemos,
      } = userStatsFieldsFromMemoRows(rows, { useUpdateTimeForHeatmap });
      return c.json({
        name: `users/${username}`,
        memoDisplayTimestamps,
        memoTypeStats,
        tagCount,
        pinnedMemos,
        totalMemoCount,
      });
    }
    const user = await repo.getUser(raw);
    if (!user) return jsonError(c, GrpcCode.NOT_FOUND, "user not found");
    return c.json(userToJson(user));
  });

  forUser.patch("/", async (c) => {
    const auth = c.get("auth");
    if (!auth) return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    const username = c.req.param("username")!;
    if (username.includes(":")) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid user resource");
    }
    if (auth.username !== username && auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "permission denied");
    }
    type Body = {
      user?: {
        displayName?: string;
        email?: string;
        password?: string;
        role?: string;
      };
      updateMask?: { paths?: string[] };
    };
    let body: Body;
    try {
      body = (await c.req.json()) as Body;
    } catch {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid json");
    }
    const u = body.user;
    if (!u) return jsonError(c, GrpcCode.INVALID_ARGUMENT, "user required");
    const paths = new Set(body.updateMask?.paths ?? []);
    const fields: Parameters<typeof repo.updateUser>[1] = {};
    if (paths.size === 0 || paths.has("displayName")) {
      if (u.displayName !== undefined) fields.display_name = u.displayName;
    }
    if (paths.size === 0 || paths.has("email")) {
      if (u.email !== undefined) fields.email = u.email;
    }
    if (u.password && (paths.size === 0 || paths.has("password"))) {
      fields.password_hash = await hashPassword(u.password);
    }
    if (u.role && auth.role === "ADMIN" && (paths.size === 0 || paths.has("role"))) {
      fields.role = u.role === "ADMIN" ? "ADMIN" : "USER";
    }
    await repo.updateUser(username, fields);
    const next = await repo.getUser(username);
    if (!next) return jsonError(c, GrpcCode.NOT_FOUND, "user not found");
    return c.json(userToJson(next));
  });

  forUser.delete("/", async (c) => {
    const auth = c.get("auth");
    if (!auth || auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "admin only");
    }
    const username = c.req.param("username")!;
    if (username.includes(":")) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid user resource");
    }
    await repo.softDeleteUser(username);
    return c.json({});
  });

  forUser.get("/settings", async (c) => {
    const auth = c.get("auth");
    if (!auth) return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    const username = c.req.param("username")!;
    if (username.includes(":")) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid user resource");
    }
    if (auth.username !== username && auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "permission denied");
    }
    const rows = await repo.listUserSettings(username);
    const settings = rows.map((row) => {
      const parsed = JSON.parse(row.json_value) as { payload?: unknown };
      if (row.setting_key === "GENERAL") {
        return {
          name: `users/${username}/settings/GENERAL`,
          generalSetting: parsed.payload ?? { locale: "", memoVisibility: "", theme: "" },
        };
      }
      return {
        name: `users/${username}/settings/${row.setting_key}`,
        webhooksSetting: { webhooks: [] },
      };
    });
    return c.json({ settings, nextPageToken: "", totalSize: settings.length });
  });

  forUser.get("/settings/:key", async (c) => {
    const auth = c.get("auth");
    if (!auth) return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    const username = c.req.param("username")!;
    if (username.includes(":")) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid user resource");
    }
    const key = c.req.param("key");
    if (auth.username !== username && auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "permission denied");
    }
    const raw = await repo.getUserSetting(username, key);
    if (!raw) {
      if (key === "GENERAL") {
        return c.json({
          name: `users/${username}/settings/GENERAL`,
          generalSetting: { locale: "", memoVisibility: "", theme: "" },
        });
      }
      return jsonError(c, GrpcCode.NOT_FOUND, "not found");
    }
    const parsed = JSON.parse(raw) as { payload?: unknown };
    if (key === "GENERAL") {
      return c.json({
        name: `users/${username}/settings/GENERAL`,
        generalSetting: parsed.payload ?? {},
      });
    }
    return c.json({
      name: `users/${username}/settings/${key}`,
      webhooksSetting: parsed.payload ?? { webhooks: [] },
    });
  });

  forUser.patch("/settings/:key", async (c) => {
    const auth = c.get("auth");
    if (!auth) return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    const username = c.req.param("username")!;
    if (username.includes(":")) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid user resource");
    }
    const key = c.req.param("key");
    if (auth.username !== username && auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "permission denied");
    }
    type Body = { setting?: { generalSetting?: unknown; webhooksSetting?: unknown } };
    const body = (await c.req.json()) as Body;
    const payload =
      key === "GENERAL"
        ? { kind: "GENERAL", payload: body.setting?.generalSetting ?? {} }
        : { kind: key, payload: body.setting?.webhooksSetting ?? {} };
    await repo.upsertUserSetting(username, key, JSON.stringify(payload));
    const raw = await repo.getUserSetting(username, key);
    if (!raw) {
      return jsonError(c, GrpcCode.INTERNAL, "failed to read setting");
    }
    const parsed = JSON.parse(raw) as { payload?: unknown };
    if (key === "GENERAL") {
      return c.json({
        name: `users/${username}/settings/GENERAL`,
        generalSetting: parsed.payload ?? {},
      });
    }
    return c.json({
      name: `users/${username}/settings/${key}`,
      webhooksSetting: parsed.payload ?? { webhooks: [] },
    });
  });

  forUser.get("/personalAccessTokens", async (c) => {
    const auth = c.get("auth");
    if (!auth) return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    const username = c.req.param("username")!;
    if (username.includes(":")) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid user resource");
    }
    if (auth.username !== username && auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "permission denied");
    }
    const rows = await repo.listPats(username);
    return c.json({
      personalAccessTokens: rows.map((t) => ({
        name: `users/${username}/personalAccessTokens/${t.id}`,
        description: t.description ?? "",
        // Proto field created_at → JSON name createdAt (google.protobuf.Timestamp as RFC 3339).
        createdAt: t.created_at,
      })),
      nextPageToken: "",
    });
  });

  forUser.post("/personalAccessTokens", async (c) => {
    const auth = c.get("auth");
    if (!auth) return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    const username = c.req.param("username")!;
    if (username.includes(":")) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid user resource");
    }
    if (auth.username !== username && auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "permission denied");
    }
    // CreatePersonalAccessTokenRequest (proto): parent + optional description + expires_in_days; HTTP body: "*".
    type Body = {
      parent?: string;
      description?: string;
      expiresInDays?: number;
      personalAccessToken?: { description?: string };
    };
    const body = (await c.req.json()) as Body;
    const description =
      typeof body.description === "string"
        ? body.description
        : (body.personalAccessToken?.description ?? null);
    const { id, raw } = await repo.createPat(username, description?.trim() ? description.trim() : null);
    return c.json({
      personalAccessToken: {
        name: `users/${username}/personalAccessTokens/${id}`,
        description: description?.trim() ?? "",
        createdAt: new Date().toISOString(),
      },
      // Proto field name is `token` (only returned on create).
      token: raw,
    });
  });

  forUser.delete("/personalAccessTokens/:patId", async (c) => {
    const auth = c.get("auth");
    if (!auth) return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    const username = c.req.param("username")!;
    if (username.includes(":")) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid user resource");
    }
    if (auth.username !== username && auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "permission denied");
    }
    const ok = await repo.deletePat(username, c.req.param("patId"));
    if (!ok) return jsonError(c, GrpcCode.NOT_FOUND, "not found");
    return c.json({});
  });

  forUser.get("/webhooks", async (c) => {
    const auth = c.get("auth");
    if (!auth) return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    const username = c.req.param("username")!;
    if (username.includes(":")) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid user resource");
    }
    if (auth.username !== username && auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "permission denied");
    }
    const rows = await repo.listWebhooks(username);
    return c.json({
      webhooks: rows.map((w) => ({
        name: `users/${username}/webhooks/${w.id}`,
        url: w.url,
        createTime: w.created_at,
      })),
    });
  });

  forUser.post("/webhooks", async (c) => {
    const auth = c.get("auth");
    if (!auth) return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    const username = c.req.param("username")!;
    if (username.includes(":")) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid user resource");
    }
    if (auth.username !== username && auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "permission denied");
    }
    type Body = { webhook?: { url?: string } };
    const body = (await c.req.json()) as Body;
    const url = body.webhook?.url;
    if (!url) return jsonError(c, GrpcCode.INVALID_ARGUMENT, "url required");
    const id = await repo.createWebhook(username, url);
    return c.json({
      name: `users/${username}/webhooks/${id}`,
      url,
      createTime: new Date().toISOString(),
    });
  });

  forUser.delete("/webhooks/:whId", async (c) => {
    const auth = c.get("auth");
    if (!auth) return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    const username = c.req.param("username")!;
    if (username.includes(":")) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid user resource");
    }
    if (auth.username !== username && auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "permission denied");
    }
    const ok = await repo.deleteWebhook(username, c.req.param("whId"));
    if (!ok) return jsonError(c, GrpcCode.NOT_FOUND, "not found");
    return c.json({});
  });

  forUser.get("/notifications", async (c) => {
    const auth = c.get("auth");
    if (!auth) return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    const username = c.req.param("username")!;
    if (username.includes(":")) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid user resource");
    }
    if (auth.username !== username && auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "permission denied");
    }
    const rows = await repo.listNotifications(username);
    return c.json({
      notifications: rows.map((n) => ({
        name: `users/${username}/notifications/${n.id}`,
        status: n.status,
        createTime: n.create_time,
        updateTime: n.update_time,
        payload: JSON.parse(n.payload_json) as unknown,
      })),
    });
  });

  forUser.patch("/notifications/:nid", async (c) => {
    const auth = c.get("auth");
    if (!auth) return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    const username = c.req.param("username")!;
    if (username.includes(":")) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid user resource");
    }
    if (auth.username !== username && auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "permission denied");
    }
    type Body = { notification?: { status?: string; payload?: unknown } };
    const body = (await c.req.json()) as Body;
    const payload = JSON.stringify(body.notification?.payload ?? {});
    const ok = await repo.updateNotification({
      id: c.req.param("nid"),
      username,
      status: body.notification?.status ?? "READ",
      payload,
    });
    if (!ok) return jsonError(c, GrpcCode.NOT_FOUND, "not found");
    return c.json({
      name: `users/${username}/notifications/${c.req.param("nid")}`,
      status: body.notification?.status ?? "READ",
      createTime: new Date().toISOString(),
      updateTime: new Date().toISOString(),
      payload: body.notification?.payload ?? {},
    });
  });

  forUser.delete("/notifications/:nid", async (c) => {
    const auth = c.get("auth");
    if (!auth) return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    const username = c.req.param("username")!;
    if (username.includes(":")) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid user resource");
    }
    if (auth.username !== username && auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "permission denied");
    }
    const ok = await repo.deleteNotification(username, c.req.param("nid"));
    if (!ok) return jsonError(c, GrpcCode.NOT_FOUND, "not found");
    return c.json({});
  });

  forUser.get("/shortcuts", async (c) => {
    const auth = c.get("auth");
    if (!auth) return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    const username = c.req.param("username")!;
    if (username.includes(":")) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid user resource");
    }
    if (auth.username !== username && auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "permission denied");
    }
    const rows = await repo.listShortcuts(username);
    return c.json({
      shortcuts: rows.map((s) => ({
        name: `users/${username}/shortcuts/${s.shortcut_id}`,
        title: s.title,
        filter: s.filter_expr ?? "",
      })),
    });
  });

  forUser.get("/shortcuts/:sid", async (c) => {
    const auth = c.get("auth");
    if (!auth) return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    const username = c.req.param("username")!;
    if (username.includes(":")) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid user resource");
    }
    if (auth.username !== username && auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "permission denied");
    }
    const sid = c.req.param("sid");
    const rows = await repo.listShortcuts(username);
    const s = rows.find((x) => x.shortcut_id === sid);
    if (!s) return jsonError(c, GrpcCode.NOT_FOUND, "not found");
    return c.json({
      name: `users/${username}/shortcuts/${sid}`,
      title: s.title,
      filter: s.filter_expr ?? "",
    });
  });

  forUser.post("/shortcuts", async (c) => {
    const auth = c.get("auth");
    if (!auth) return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    const username = c.req.param("username")!;
    if (username.includes(":")) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid user resource");
    }
    if (auth.username !== username && auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "permission denied");
    }
    type Body = { shortcut?: { title?: string; filter?: string } };
    const body = (await c.req.json()) as Body;
    const title = body.shortcut?.title;
    if (!title) return jsonError(c, GrpcCode.INVALID_ARGUMENT, "title required");
    const shortcutId = crypto.randomUUID();
    await repo.createShortcut({
      username,
      shortcutId,
      title,
      filter: body.shortcut?.filter ?? null,
    });
    return c.json({
      name: `users/${username}/shortcuts/${shortcutId}`,
      title,
      filter: body.shortcut?.filter ?? "",
    });
  });

  forUser.patch("/shortcuts/:sid", async (c) => {
    const auth = c.get("auth");
    if (!auth) return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    const username = c.req.param("username")!;
    if (username.includes(":")) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid user resource");
    }
    if (auth.username !== username && auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "permission denied");
    }
    type Body = { shortcut?: { title?: string; filter?: string } };
    const body = (await c.req.json()) as Body;
    await repo.updateShortcut(username, c.req.param("sid"), {
      title: body.shortcut?.title,
      filter: body.shortcut?.filter,
    });
    const rows = await repo.listShortcuts(username);
    const s = rows.find((x) => x.shortcut_id === c.req.param("sid"));
    if (!s) return jsonError(c, GrpcCode.NOT_FOUND, "not found");
    return c.json({
      name: `users/${username}/shortcuts/${c.req.param("sid")}`,
      title: s.title,
      filter: s.filter_expr ?? "",
    });
  });

  forUser.delete("/shortcuts/:sid", async (c) => {
    const auth = c.get("auth");
    if (!auth) return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    const username = c.req.param("username")!;
    if (username.includes(":")) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid user resource");
    }
    if (auth.username !== username && auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "permission denied");
    }
    const ok = await repo.deleteShortcut(username, c.req.param("sid"));
    if (!ok) return jsonError(c, GrpcCode.NOT_FOUND, "not found");
    return c.json({});
  });

  r.route("/:username", forUser);

  return r;
}
