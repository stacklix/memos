/**
 * REST `/api/v1` transport (replaces Connect binary). Keeps the same exported
 * service client names so hooks and components stay unchanged.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { FieldMask } from "@bufbuild/protobuf/wkt";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import { getAccessToken, hasStoredToken, isTokenExpired, REQUEST_TOKEN_EXPIRY_BUFFER_MS, setAccessToken } from "./auth-state";
import { memoFromJson, userFromJson } from "./lib/proto-adapters";
import { redirectOnAuthFailure } from "./utils/auth-redirect";
import type {
  InstanceProfile,
  InstanceSetting,
  InstanceSetting_MemoRelatedSetting,
  InstanceSetting_TagsSetting,
} from "./types/proto/api/v1/instance_service_pb";
import {
  InstanceProfileSchema,
  InstanceSettingSchema,
  InstanceSetting_GeneralSettingSchema,
  InstanceSetting_MemoRelatedSettingSchema,
  InstanceSetting_TagsSettingSchema,
} from "./types/proto/api/v1/instance_service_pb";
import { State } from "./types/proto/api/v1/common_pb";
import type { Memo, MemoShare, MemoRelation, Reaction } from "./types/proto/api/v1/memo_service_pb";
import { MemoShareSchema, MemoRelationSchema, ReactionSchema } from "./types/proto/api/v1/memo_service_pb";
import type { Shortcut } from "./types/proto/api/v1/shortcut_service_pb";
import { ShortcutSchema } from "./types/proto/api/v1/shortcut_service_pb";
import type { CreatePersonalAccessTokenResponse, PersonalAccessToken, User, UserSetting } from "./types/proto/api/v1/user_service_pb";
import {
  CreatePersonalAccessTokenResponseSchema,
  PersonalAccessTokenSchema,
  UserSettingSchema,
  UserSetting_GeneralSettingSchema,
  UserSetting_WebhooksSettingSchema,
} from "./types/proto/api/v1/user_service_pb";

const API = "/api/v1";
const RETRY_HEADER = "X-Retry";
const RETRY_HEADER_VALUE = "true";

function grpcToCode(code: number | undefined, status: number): Code {
  if (code === 16 || status === 401) return Code.Unauthenticated;
  if (code === 7 || status === 403) return Code.PermissionDenied;
  if (code === 5 || status === 404) return Code.NotFound;
  if (code === 6 || status === 409) return Code.AlreadyExists;
  if (code === 9) return Code.FailedPrecondition;
  if (code === 12) return Code.Unimplemented;
  if (status >= 500) return Code.Internal;
  return Code.Unknown;
}

function userSeg(resourceName: string): string {
  return resourceName.replace(/^users\//, "");
}

function memoIdFromName(name: string): string {
  return name.replace(/^memos\//, "");
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function throwUnlessOk(res: Response): Promise<void> {
  if (res.ok) return;
  const body = (await readJson(res)) as { code?: number; message?: string };
  throw new ConnectError(body.message ?? res.statusText, grpcToCode(body.code, res.status));
}

const tokenRefreshManager = (() => {
  let isRefreshing = false;
  let refreshPromise: Promise<void> | null = null;
  return {
    async refresh(refreshFn: () => Promise<void>): Promise<void> {
      if (isRefreshing && refreshPromise) return refreshPromise;
      isRefreshing = true;
      refreshPromise = refreshFn().finally(() => {
        isRefreshing = false;
        refreshPromise = null;
      });
      return refreshPromise;
    },
  };
})();

const fetchWithCredentials: typeof globalThis.fetch = (input, init) =>
  globalThis.fetch(input, { ...init, credentials: "include" });

async function doRefreshAccessToken(): Promise<void> {
  const res = await fetchWithCredentials(`${window.location.origin}${API}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  await throwUnlessOk(res);
  const j = (await readJson(res)) as { accessToken?: string; expiresAt?: string };
  if (!j.accessToken) {
    throw new ConnectError("Refresh token response missing access token", Code.Internal);
  }
  setAccessToken(j.accessToken, j.expiresAt ? new Date(j.expiresAt) : undefined);
}

export async function refreshAccessToken(): Promise<void> {
  return tokenRefreshManager.refresh(doRefreshAccessToken);
}

function shouldRetryUnauthenticated(error: unknown, isRetry: boolean): boolean {
  return error instanceof ConnectError && error.code === Code.Unauthenticated && !isRetry;
}

async function refreshAndGetAccessToken(): Promise<string> {
  await refreshAccessToken();
  const token = getAccessToken();
  if (!token) {
    throw new ConnectError("Token refresh succeeded but no token available", Code.Internal);
  }
  return token;
}

async function getRequestToken(): Promise<string | null> {
  let token = getAccessToken();
  if (!token) {
    if (!hasStoredToken()) return null;
    try {
      token = await refreshAndGetAccessToken();
    } catch {
      return null;
    }
    return token;
  }
  if (isTokenExpired(REQUEST_TOKEN_EXPIRY_BUFFER_MS)) {
    try {
      token = await refreshAndGetAccessToken();
    } catch {
      /* reactive 401 path */
    }
  }
  return token;
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headersFor = async (isRetry: boolean) => {
    const headers = new Headers(init.headers);
    const token = await getRequestToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (isRetry) headers.set(RETRY_HEADER, RETRY_HEADER_VALUE);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return headers;
  };

  let res = await fetchWithCredentials(`${window.location.origin}${API}${path}`, {
    ...init,
    headers: await headersFor(false),
  });
  if (res.status === 401) {
    try {
      await refreshAndGetAccessToken();
      res = await fetchWithCredentials(`${window.location.origin}${API}${path}`, {
        ...init,
        headers: await headersFor(true),
      });
    } catch (e) {
      redirectOnAuthFailure();
      throw e;
    }
    if (res.status === 401) {
      redirectOnAuthFailure();
      await throwUnlessOk(res);
    }
  }
  return res;
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  await throwUnlessOk(res);
  return (await readJson(res)) as T;
}

function tagsSettingToApiJson(v: InstanceSetting_TagsSetting): Record<string, unknown> {
  const tags: Record<string, unknown> = {};
  for (const [k, meta] of Object.entries(v.tags)) {
    const row: Record<string, unknown> = { blurContent: meta.blurContent };
    const bg = meta.backgroundColor;
    if (bg) {
      row.backgroundColor = {
        red: bg.red,
        green: bg.green,
        blue: bg.blue,
      };
    }
    tags[k] = row;
  }
  return { tags };
}

function memoRelatedToApiJson(v: InstanceSetting_MemoRelatedSetting): Record<string, unknown> {
  return {
    displayWithUpdateTime: v.displayWithUpdateTime,
    contentLengthLimit: v.contentLengthLimit,
    enableDoubleClickEdit: v.enableDoubleClickEdit,
    reactions: [...v.reactions],
  };
}

function instanceSettingFromResponse(j: Record<string, unknown>): InstanceSetting {
  const name = String(j.name ?? "");
  if (j.generalSetting) {
    return create(InstanceSettingSchema, {
      name,
      value: {
        case: "generalSetting",
        value: create(InstanceSetting_GeneralSettingSchema, j.generalSetting as Record<string, unknown>),
      },
    });
  }
  if (j.memoRelatedSetting) {
    return create(InstanceSettingSchema, {
      name,
      value: {
        case: "memoRelatedSetting",
        value: create(InstanceSetting_MemoRelatedSettingSchema, j.memoRelatedSetting as Record<string, unknown>),
      },
    });
  }
  if (j.tagsSetting) {
    return create(InstanceSettingSchema, {
      name,
      value: {
        case: "tagsSetting",
        value: create(InstanceSetting_TagsSettingSchema, j.tagsSetting as Record<string, unknown>),
      },
    });
  }
  return create(InstanceSettingSchema, { name, value: { case: undefined, value: undefined } });
}

function profileFromJson(j: Record<string, unknown>): InstanceProfile {
  return create(InstanceProfileSchema, {
    version: String(j.version ?? ""),
    demo: Boolean(j.demo),
    instanceUrl: String(j.instanceUrl ?? ""),
    admin: j.admin ? userFromJson(j.admin as Record<string, unknown>) : undefined,
  } as Record<string, unknown>);
}

function userSettingFromJson(j: Record<string, unknown>): UserSetting {
  if (j.generalSetting) {
    return create(UserSettingSchema, {
      name: String(j.name ?? ""),
      value: {
        case: "generalSetting",
        value: create(UserSetting_GeneralSettingSchema, j.generalSetting as Record<string, unknown>),
      },
    });
  }
  return create(UserSettingSchema, {
    name: String(j.name ?? ""),
    value: {
      case: "webhooksSetting",
      value: create(UserSetting_WebhooksSettingSchema, (j.webhooksSetting as Record<string, unknown>) ?? {}),
    },
  });
}

function shortcutFromJson(j: Record<string, unknown>): Shortcut {
  return create(ShortcutSchema, {
    name: String(j.name ?? ""),
    title: String(j.title ?? ""),
    filter: String(j.filter ?? ""),
  });
}

function memoShareFromJson(j: Record<string, unknown>): MemoShare {
  return create(MemoShareSchema, {
    name: String(j.name ?? ""),
    createTime: j.createTime ? timestampFromDate(new Date(String(j.createTime))) : undefined,
    expireTime: j.expireTime ? timestampFromDate(new Date(String(j.expireTime))) : undefined,
  } as Record<string, unknown>);
}

function listMemosQuery(req: Record<string, unknown>): string {
  const p = new URLSearchParams();
  if (req.pageSize != null) p.set("pageSize", String(req.pageSize));
  if (req.pageToken) p.set("pageToken", String(req.pageToken));
  let stateStr = "NORMAL";
  if (req.state != null && req.state !== "") {
    const st = req.state as number | string;
    stateStr = typeof st === "number" ? (State[st] as string | undefined) ?? "NORMAL" : String(st);
  } else if (req.showDeleted) stateStr = "ARCHIVED";
  p.set("state", stateStr);
  if (req.filter != null && String(req.filter).length > 0) {
    p.set("filter", String(req.filter));
  }
  return `?${p.toString()}`;
}

export const instanceServiceClient = {
  async getInstanceProfile(_req: object): Promise<InstanceProfile> {
    const j = (await apiJson<Record<string, unknown>>("/instance/profile")) as Record<string, unknown>;
    return profileFromJson(j);
  },
  async getInstanceSetting(req: { name: string }): Promise<InstanceSetting> {
    const key = req.name.replace(/^instance\/settings\//, "");
    const j = (await apiJson<Record<string, unknown>>(`/instance/settings/${encodeURIComponent(key)}`)) as Record<string, unknown>;
    return instanceSettingFromResponse(j);
  },
  async updateInstanceSetting(req: { setting: InstanceSetting }): Promise<InstanceSetting> {
    const key = req.setting.name.replace(/^instance\/settings\//, "");
    const v = req.setting.value;
    const settingBody: Record<string, unknown> = {};
    if (v.case === "generalSetting") {
      settingBody.generalSetting = {
        disallowUserRegistration: v.value.disallowUserRegistration,
        disallowPasswordAuth: v.value.disallowPasswordAuth,
      };
    } else if (v.case === "tagsSetting") {
      settingBody.tagsSetting = tagsSettingToApiJson(v.value);
    } else if (v.case === "memoRelatedSetting") {
      settingBody.memoRelatedSetting = memoRelatedToApiJson(v.value);
    } else {
      throw new ConnectError("Unsupported instance setting update", Code.InvalidArgument);
    }
    const res = await apiFetch(`/instance/settings/${encodeURIComponent(key)}`, {
      method: "PATCH",
      body: JSON.stringify({ setting: settingBody }),
    });
    await throwUnlessOk(res);
    const j = (await readJson(res)) as Record<string, unknown>;
    return instanceSettingFromResponse(j);
  },
};

export const authServiceClient = {
  async getCurrentUser(_req: object): Promise<{ user: User | undefined }> {
    const res = await apiFetch("/auth/me");
    await throwUnlessOk(res);
    const j = (await readJson(res)) as { user?: Record<string, unknown> };
    return { user: j.user ? userFromJson(j.user) : undefined };
  },
  async signIn(req: {
    passwordCredentials?: { username?: string; password?: string };
    ssoCredentials?: unknown;
  }): Promise<{ user?: User; accessToken?: string; accessTokenExpiresAt?: string }> {
    const res = await fetchWithCredentials(`${window.location.origin}${API}/auth/signin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passwordCredentials: req.passwordCredentials,
        ssoCredentials: req.ssoCredentials,
      }),
    });
    await throwUnlessOk(res);
    const j = (await readJson(res)) as {
      user?: Record<string, unknown>;
      accessToken?: string;
      accessTokenExpiresAt?: string;
    };
    if (j.accessToken && j.accessTokenExpiresAt) {
      setAccessToken(j.accessToken, new Date(j.accessTokenExpiresAt));
    }
    return {
      user: j.user ? userFromJson(j.user) : undefined,
      accessToken: j.accessToken,
      accessTokenExpiresAt: j.accessTokenExpiresAt,
    };
  },
  async signOut(_req: object): Promise<object> {
    await apiJson("/auth/signout", { method: "POST", body: "{}" });
    return {};
  },
  async refreshToken(_req: object): Promise<{ accessToken?: string; expiresAt?: { seconds: bigint; nanos: number } }> {
    await doRefreshAccessToken();
    const t = getAccessToken();
    return { accessToken: t ?? undefined };
  },
};

export const userServiceClient = {
  async listUsers(req: { pageSize?: number; pageToken?: string }) {
    const q = new URLSearchParams();
    if (req.pageSize != null) q.set("pageSize", String(req.pageSize));
    if (req.pageToken) q.set("pageToken", req.pageToken);
    const qs = q.toString();
    const j = await apiJson<{ users: Record<string, unknown>[]; nextPageToken?: string; totalSize?: number }>(
      `/users${qs ? `?${qs}` : ""}`,
    );
    return { users: j.users.map((u) => userFromJson(u)), nextPageToken: j.nextPageToken ?? "", totalSize: j.totalSize ?? 0 };
  },
  async createUser(req: { user: Partial<User> & { username?: string; password?: string }; userId?: string; validateOnly?: boolean }) {
    const res = await apiFetch("/users", {
      method: "POST",
      body: JSON.stringify({
        user: {
          username: req.user.username,
          password: req.user.password,
          role: req.user.role,
          displayName: req.user.displayName,
          email: req.user.email,
          state: req.user.state,
        },
        userId: req.userId,
        validateOnly: req.validateOnly,
      }),
    });
    await throwUnlessOk(res);
    const j = (await readJson(res)) as Record<string, unknown>;
    return userFromJson(j);
  },
  async getUser(req: { name: string }): Promise<User> {
    const pathSeg = encodeURIComponent(req.name.replace(/^users\//, ""));
    const j = (await apiJson<Record<string, unknown>>(`/users/${pathSeg}`)) as Record<string, unknown>;
    return userFromJson(j);
  },
  async getUserStats(req: { name: string }): Promise<Record<string, unknown>> {
    const base = userSeg(req.name);
    const j = await apiJson<Record<string, unknown>>(`/users/${encodeURIComponent(`${base}:getStats`)}`);
    return j;
  },
  async updateUser(req: { user: User; updateMask: FieldMask }): Promise<User> {
    const username = userSeg(req.user.name);
    const res = await apiFetch(`/users/${encodeURIComponent(username)}`, {
      method: "PATCH",
      body: JSON.stringify({
        user: {
          displayName: req.user.displayName,
          email: req.user.email,
          password: (req.user as { password?: string }).password,
          role: req.user.role,
        },
        updateMask: req.updateMask,
      }),
    });
    await throwUnlessOk(res);
    return userFromJson((await readJson(res)) as Record<string, unknown>);
  },
  async deleteUser(req: { name: string }): Promise<object> {
    const username = userSeg(req.name);
    await apiJson(`/users/${encodeURIComponent(username)}`, { method: "DELETE" });
    return {};
  },
  async listUserSettings(req: { parent: string }) {
    const u = userSeg(req.parent);
    const j = await apiJson<{ settings: Record<string, unknown>[] }>(`/users/${encodeURIComponent(u)}/settings`);
    return {
      settings: j.settings.map((s) => userSettingFromJson(s)),
      nextPageToken: "",
      totalSize: j.settings.length,
    };
  },
  async updateUserSetting(req: { setting: UserSetting; updateMask: FieldMask }): Promise<UserSetting> {
    const m = req.setting.name.match(/^users\/([^/]+)\/settings\/(.+)$/);
    if (!m) throw new ConnectError("invalid setting name", Code.InvalidArgument);
    const [, user, key] = m;
    const body: Record<string, unknown> = { setting: {} };
    if (req.setting.value.case === "generalSetting") {
      (body.setting as Record<string, unknown>).generalSetting = req.setting.value.value;
    } else if (req.setting.value.case === "webhooksSetting") {
      (body.setting as Record<string, unknown>).webhooksSetting = req.setting.value.value;
    }
    const res = await apiFetch(`/users/${encodeURIComponent(user)}/settings/${encodeURIComponent(key)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    await throwUnlessOk(res);
    return userSettingFromJson((await readJson(res)) as Record<string, unknown>);
  },
  async listPersonalAccessTokens(req: { parent: string }): Promise<{ personalAccessTokens: PersonalAccessToken[] }> {
    const u = userSeg(req.parent);
    const j = await apiJson<{
      personalAccessTokens: { name: string; description?: string; createdAt?: string; createTime?: string }[];
    }>(`/users/${encodeURIComponent(u)}/personalAccessTokens`);
    return {
      personalAccessTokens: j.personalAccessTokens.map((row) => {
        const iso = row.createdAt ?? row.createTime;
        return create(PersonalAccessTokenSchema, {
          name: row.name,
          description: row.description ?? "",
          createdAt: iso ? timestampFromDate(new Date(iso)) : undefined,
        });
      }),
    };
  },
  async createPersonalAccessToken(req: {
    parent?: string;
    personalAccessToken?: { description?: string };
    description?: string;
    expiresInDays?: number;
  }): Promise<CreatePersonalAccessTokenResponse> {
    const u = userSeg(req.parent ?? "");
    if (!u) {
      throw new ConnectError("invalid parent", Code.InvalidArgument);
    }
    const description = req.description ?? req.personalAccessToken?.description ?? "";
    const raw = await apiJson<{
      personalAccessToken?: { name: string; description?: string; createdAt?: string; createTime?: string };
      token?: string;
      accessToken?: string;
    }>(`/users/${encodeURIComponent(u)}/personalAccessTokens`, {
      method: "POST",
      body: JSON.stringify({
        description,
        expiresInDays: req.expiresInDays ?? 0,
      }),
    });
    const meta = raw.personalAccessToken;
    const iso = meta?.createdAt ?? meta?.createTime;
    return create(CreatePersonalAccessTokenResponseSchema, {
      personalAccessToken: meta
        ? create(PersonalAccessTokenSchema, {
            name: meta.name,
            description: meta.description ?? "",
            createdAt: iso ? timestampFromDate(new Date(iso)) : undefined,
          })
        : undefined,
      token: raw.token ?? raw.accessToken ?? "",
    });
  },
  async deletePersonalAccessToken(req: { name: string }): Promise<object> {
    const m = req.name.match(/^users\/([^/]+)\/personalAccessTokens\/(.+)$/);
    if (!m) throw new ConnectError("invalid token name", Code.InvalidArgument);
    await apiJson(`/users/${encodeURIComponent(m[1])}/personalAccessTokens/${encodeURIComponent(m[2])}`, { method: "DELETE" });
    return {};
  },
  async listUserWebhooks(req: { parent: string }) {
    const u = userSeg(req.parent);
    const j = await apiJson<{ webhooks: { name: string; url: string; createTime?: string }[] }>(
      `/users/${encodeURIComponent(u)}/webhooks`,
    );
    return {
      webhooks: j.webhooks.map((w) => ({
        name: w.name,
        url: w.url,
        displayName: "",
        createTime: w.createTime,
      })),
    };
  },
  async createUserWebhook(req: { parent: string; webhook?: { url?: string; displayName?: string } }) {
    const u = userSeg(req.parent);
    return apiJson<Record<string, unknown>>(`/users/${encodeURIComponent(u)}/webhooks`, {
      method: "POST",
      body: JSON.stringify({ webhook: { url: req.webhook?.url } }),
    });
  },
  async updateUserWebhook(req: { webhook: { name?: string; url?: string; displayName?: string }; updateMask: FieldMask }) {
    const wh = req.webhook;
    const name = wh.name ?? "";
    const m = name.match(/^users\/([^/]+)\/webhooks\/([^/]+)$/);
    if (!m) throw new ConnectError("invalid webhook name", Code.InvalidArgument);
    await apiJson(`/users/${encodeURIComponent(m[1])}/webhooks/${encodeURIComponent(m[2])}`, { method: "DELETE" });
    return apiJson<Record<string, unknown>>(`/users/${encodeURIComponent(m[1])}/webhooks`, {
      method: "POST",
      body: JSON.stringify({ webhook: { url: wh.url } }),
    });
  },
  async deleteUserWebhook(req: { name: string }): Promise<object> {
    const m = req.name.match(/^users\/([^/]+)\/webhooks\/([^/]+)$/);
    if (!m) throw new ConnectError("invalid webhook name", Code.InvalidArgument);
    await apiJson(`/users/${encodeURIComponent(m[1])}/webhooks/${encodeURIComponent(m[2])}`, { method: "DELETE" });
    return {};
  },
  async listUserNotifications(req: { parent: string }) {
    const u = userSeg(req.parent);
    const j = await apiJson<{ notifications: Record<string, unknown>[] }>(`/users/${encodeURIComponent(u)}/notifications`);
    return { notifications: j.notifications };
  },
  async updateUserNotification(req: { notification: { name?: string; status?: string; payload?: unknown } }) {
    const name = req.notification.name ?? "";
    const m = name.match(/^users\/([^/]+)\/notifications\/([^/]+)$/);
    if (!m) throw new ConnectError("invalid notification name", Code.InvalidArgument);
    const j = await apiJson<Record<string, unknown>>(`/users/${encodeURIComponent(m[1])}/notifications/${encodeURIComponent(m[2])}`, {
      method: "PATCH",
      body: JSON.stringify({ notification: { status: req.notification.status, payload: req.notification.payload } }),
    });
    return j;
  },
  async deleteUserNotification(req: { name: string }): Promise<object> {
    const m = req.name.match(/^users\/([^/]+)\/notifications\/([^/]+)$/);
    if (!m) throw new ConnectError("invalid notification name", Code.InvalidArgument);
    await apiJson(`/users/${encodeURIComponent(m[1])}/notifications/${encodeURIComponent(m[2])}`, { method: "DELETE" });
    return {};
  },
  async listAllUserStats(_req: object) {
    const j = await apiJson<{ stats: Record<string, unknown>[] }>("/users:stats");
    return { stats: j.stats };
  },
};

export const shortcutServiceClient = {
  async listShortcuts(req: { parent?: string }) {
    if (!req.parent) {
      return { shortcuts: [] as Shortcut[], nextPageToken: "", totalSize: 0 };
    }
    const u = userSeg(req.parent);
    const j = await apiJson<{ shortcuts: Record<string, unknown>[] }>(`/users/${encodeURIComponent(u)}/shortcuts`);
    return {
      shortcuts: j.shortcuts.map((s) => shortcutFromJson(s)),
      nextPageToken: "",
      totalSize: j.shortcuts.length,
    };
  },
  async createShortcut(req: { parent?: string; shortcut?: { title?: string; filter?: string } }) {
    if (!req.parent) throw new ConnectError("parent required", Code.InvalidArgument);
    const u = userSeg(req.parent);
    const j = await apiJson<Record<string, unknown>>(`/users/${encodeURIComponent(u)}/shortcuts`, {
      method: "POST",
      body: JSON.stringify({ shortcut: { title: req.shortcut?.title, filter: req.shortcut?.filter } }),
    });
    return { shortcut: shortcutFromJson(j) };
  },
  async updateShortcut(req: { shortcut: Shortcut; updateMask: FieldMask }) {
    const m = req.shortcut.name.match(/^users\/([^/]+)\/shortcuts\/([^/]+)$/);
    if (!m) throw new ConnectError("invalid shortcut name", Code.InvalidArgument);
    const j = await apiJson<Record<string, unknown>>(`/users/${encodeURIComponent(m[1])}/shortcuts/${encodeURIComponent(m[2])}`, {
      method: "PATCH",
      body: JSON.stringify({
        shortcut: { title: req.shortcut.title, filter: req.shortcut.filter },
      }),
    });
    return { shortcut: shortcutFromJson(j) };
  },
  async deleteShortcut(req: { name: string }): Promise<object> {
    const m = req.name.match(/^users\/([^/]+)\/shortcuts\/([^/]+)$/);
    if (!m) throw new ConnectError("invalid shortcut name", Code.InvalidArgument);
    await apiJson(`/users/${encodeURIComponent(m[1])}/shortcuts/${encodeURIComponent(m[2])}`, { method: "DELETE" });
    return {};
  },
};

export const memoServiceClient = {
  async listMemos(req: Record<string, unknown>) {
    const j = await apiJson<{ memos: Record<string, unknown>[]; nextPageToken?: string }>(`/memos${listMemosQuery(req)}`);
    return { memos: j.memos.map((m) => memoFromJson(m)), nextPageToken: j.nextPageToken ?? "" };
  },
  async getMemo(req: { name: string }): Promise<Memo> {
    const id = memoIdFromName(req.name);
    const j = (await apiJson<Record<string, unknown>>(`/memos/${encodeURIComponent(id)}`)) as Record<string, unknown>;
    return memoFromJson(j);
  },
  async createMemo(req: { memo?: Memo }) {
    const m = req.memo;
    const loc = m?.location;
    const j = await apiJson<Record<string, unknown>>("/memos", {
      method: "POST",
      body: JSON.stringify({
        memo: {
          content: m?.content,
          visibility: m?.visibility,
          state: m?.state,
          pinned: m?.pinned,
          ...(loc
            ? {
                location: {
                  placeholder: loc.placeholder,
                  latitude: loc.latitude,
                  longitude: loc.longitude,
                },
              }
            : {}),
        },
      }),
    });
    return memoFromJson(j);
  },
  async updateMemo(req: { memo: Memo; updateMask: FieldMask }) {
    const id = memoIdFromName(req.memo.name);
    const patch: Record<string, unknown> = {};
    for (const p of req.updateMask.paths ?? []) {
      if (p === "content") patch.content = req.memo.content;
      if (p === "visibility") patch.visibility = req.memo.visibility;
      if (p === "state") patch.state = req.memo.state;
      if (p === "pinned") patch.pinned = req.memo.pinned;
      if (p === "display_time" || p === "displayTime") {
        patch.displayTime = req.memo.displayTime ? timestampDate(req.memo.displayTime).toISOString() : undefined;
      }
      if (p === "location") {
        const loc = req.memo.location;
        if (loc !== undefined && loc !== null) {
          patch.location = {
            placeholder: loc.placeholder ?? "",
            latitude: Number.isFinite(loc.latitude) ? loc.latitude : 0,
            longitude: Number.isFinite(loc.longitude) ? loc.longitude : 0,
          };
        } else {
          patch.location = null;
        }
      }
    }
    const j = await apiJson<Record<string, unknown>>(`/memos/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ memo: patch }),
    });
    return memoFromJson(j);
  },
  async deleteMemo(req: { name: string }): Promise<object> {
    const id = memoIdFromName(req.name);
    await apiJson(`/memos/${encodeURIComponent(id)}`, { method: "DELETE" });
    return {};
  },
  async listMemoComments(req: { name: string }) {
    const id = memoIdFromName(req.name);
    const j = await apiJson<{ memos: Record<string, unknown>[]; nextPageToken?: string; totalSize?: number }>(
      `/memos/${encodeURIComponent(id)}/comments`,
    );
    return {
      memos: j.memos.map((m) => memoFromJson(m)),
      nextPageToken: j.nextPageToken ?? "",
      totalSize: j.totalSize ?? j.memos.length,
    };
  },
  async createMemoComment(req: { name: string; comment?: Memo }) {
    const id = memoIdFromName(req.name);
    const c = req.comment;
    const loc = c?.location;
    const j = await apiJson<Record<string, unknown>>(`/memos/${encodeURIComponent(id)}/comments`, {
      method: "POST",
      body: JSON.stringify({
        comment: {
          content: c?.content,
          visibility: c?.visibility,
          state: c?.state,
          ...(loc
            ? {
                location: {
                  placeholder: loc.placeholder ?? "",
                  latitude: loc.latitude ?? 0,
                  longitude: loc.longitude ?? 0,
                },
              }
            : {}),
        },
      }),
    });
    return memoFromJson(j);
  },
  async listMemoRelations(req: { name: string }) {
    const id = memoIdFromName(req.name);
    const j = await apiJson<{ relations: Record<string, unknown>[] }>(`/memos/${encodeURIComponent(id)}/relations`);
    const relations = (j.relations ?? []).map((r) =>
      create(MemoRelationSchema, {
        memo: r.memo,
        relatedMemo: r.relatedMemo,
        type: r.type,
      } as Record<string, unknown>),
    );
    return { relations, nextPageToken: "", totalSize: relations.length };
  },
  async setMemoRelations(req: { name: string; relations: MemoRelation[] }) {
    const id = memoIdFromName(req.name);
    await apiJson(`/memos/${encodeURIComponent(id)}/relations`, {
      method: "PATCH",
      body: JSON.stringify({
        relations: req.relations.map((rel) => ({
          relatedMemo: rel.relatedMemo,
          type: rel.type,
        })),
      }),
    });
    return {};
  },
  async listMemoReactions(req: { name: string }) {
    const id = memoIdFromName(req.name);
    const j = await apiJson<{ reactions: Record<string, unknown>[]; nextPageToken?: string; totalSize?: number }>(
      `/memos/${encodeURIComponent(id)}/reactions`,
    );
    return {
      reactions: j.reactions,
      nextPageToken: j.nextPageToken ?? "",
      totalSize: j.totalSize ?? j.reactions.length,
    };
  },
  async upsertMemoReaction(req: { name: string; reaction: { reactionType?: string } }): Promise<Reaction> {
    const id = memoIdFromName(req.name);
    const j = await apiJson<Record<string, unknown>>(`/memos/${encodeURIComponent(id)}/reactions`, {
      method: "POST",
      body: JSON.stringify({ reaction: { reactionType: req.reaction.reactionType } }),
    });
    return create(ReactionSchema, {
      ...j,
      createTime: j.createTime ? timestampFromDate(new Date(String(j.createTime))) : undefined,
    } as Record<string, unknown>);
  },
  async deleteMemoReaction(req: { name: string }): Promise<object> {
    const m = req.name.match(/^memos\/([^/]+)\/reactions\/([^/]+)$/);
    if (!m) throw new ConnectError("invalid reaction name", Code.InvalidArgument);
    await apiJson(`/memos/${encodeURIComponent(m[1])}/reactions/${encodeURIComponent(m[2])}`, { method: "DELETE" });
    return {};
  },
  async listMemoShares(req: { parent: string }) {
    const id = memoIdFromName(req.parent);
    const j = await apiJson<{ shares: Record<string, unknown>[] }>(`/memos/${encodeURIComponent(id)}/shares`);
    return { memoShares: (j.shares ?? []).map((s) => memoShareFromJson(s)) };
  },
  async createMemoShare(req: { parent: string; memoShare?: MemoShare }) {
    const id = memoIdFromName(req.parent);
    const j = await apiJson<Record<string, unknown>>(`/memos/${encodeURIComponent(id)}/shares`, {
      method: "POST",
      body: JSON.stringify({
        memoShare: {
          expireTime: req.memoShare?.expireTime ? timestampDate(req.memoShare.expireTime).toISOString() : undefined,
        },
      }),
    });
    return { memoShare: memoShareFromJson(j) };
  },
  async deleteMemoShare(req: { name: string }): Promise<object> {
    const m = req.name.match(/^memos\/([^/]+)\/shares\/([^/]+)$/);
    if (!m) throw new ConnectError("invalid share name", Code.InvalidArgument);
    await apiJson(`/memos/${encodeURIComponent(m[1])}/shares/${encodeURIComponent(m[2])}`, { method: "DELETE" });
    return {};
  },
  async getMemoByShare(req: { shareId: string }): Promise<Memo> {
    const j = (await apiJson<Record<string, unknown>>(`/shares/${encodeURIComponent(req.shareId)}`)) as Record<string, unknown>;
    return memoFromJson(j);
  },
};

/** Removed server features: keep export so accidental imports fail at runtime clearly. */
export const attachmentServiceClient = {
  async listAttachments(): Promise<{ attachments: never[] }> {
    throw new ConnectError("attachments are not supported", Code.Unimplemented);
  },
  async createAttachment(): Promise<never> {
    throw new ConnectError("attachments are not supported", Code.Unimplemented);
  },
  async deleteAttachment(): Promise<never> {
    throw new ConnectError("attachments are not supported", Code.Unimplemented);
  },
};

export const identityProviderServiceClient = {
  async listIdentityProviders(): Promise<{ identityProviders: never[] }> {
    return { identityProviders: [] };
  },
  async createIdentityProvider(): Promise<never> {
    throw new ConnectError("SSO is not supported", Code.Unimplemented);
  },
  async updateIdentityProvider(): Promise<never> {
    throw new ConnectError("SSO is not supported", Code.Unimplemented);
  },
  async deleteIdentityProvider(): Promise<never> {
    throw new ConnectError("SSO is not supported", Code.Unimplemented);
  },
};
