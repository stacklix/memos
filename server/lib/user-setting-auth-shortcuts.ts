/**
 * golang `user_setting` keys / protojson shapes (`golang:proto/store/user_setting.proto`).
 * Field names use proto JSON (camelCase).
 */

export const USER_SETTING_KEY_REFRESH_TOKENS = "REFRESH_TOKENS";
export const USER_SETTING_KEY_PERSONAL_ACCESS_TOKENS = "PERSONAL_ACCESS_TOKENS";
export const USER_SETTING_KEY_SHORTCUTS = "SHORTCUTS";

export type RefreshTokensUserSettingJson = {
  refreshTokens: Array<{
    tokenId: string;
    /** google.protobuf.Timestamp as RFC 3339 string */
    expiresAt: string;
    createdAt: string;
    clientInfo?: {
      userAgent?: string;
      ipAddress?: string;
      deviceType?: string;
      os?: string;
      browser?: string;
    };
    description?: string;
  }>;
};

export type PersonalAccessTokensUserSettingJson = {
  tokens: Array<{
    tokenId: string;
    tokenHash: string;
    description?: string;
    createdAt?: string;
    expiresAt?: string | null;
    lastUsedAt?: string | null;
  }>;
};

export type ShortcutsUserSettingJson = {
  shortcuts: Array<{ id: string; title: string; filter: string }>;
};

function emptyRefresh(): RefreshTokensUserSettingJson {
  return { refreshTokens: [] };
}

export function parseRefreshTokensUserSetting(
  raw: string | null,
): RefreshTokensUserSettingJson {
  if (!raw) return emptyRefresh();
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const arr = j.refreshTokens ?? j.refresh_tokens;
    if (!Array.isArray(arr)) return emptyRefresh();
    const refreshTokens: RefreshTokensUserSettingJson["refreshTokens"] = [];
    for (const x of arr) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      const tokenId =
        typeof o.tokenId === "string"
          ? o.tokenId
          : typeof o.token_id === "string"
            ? o.token_id
            : "";
      const expiresAt =
        typeof o.expiresAt === "string"
          ? o.expiresAt
          : typeof o.expires_at === "string"
            ? o.expires_at
            : "";
      const createdAt =
        typeof o.createdAt === "string"
          ? o.createdAt
          : typeof o.created_at === "string"
            ? o.created_at
            : "";
      if (!tokenId || !expiresAt || !createdAt) continue;
      refreshTokens.push({ tokenId, expiresAt, createdAt });
    }
    return { refreshTokens };
  } catch {
    return emptyRefresh();
  }
}

export function serializeRefreshTokensUserSetting(
  v: RefreshTokensUserSettingJson,
): string {
  return JSON.stringify(v);
}

function emptyPats(): PersonalAccessTokensUserSettingJson {
  return { tokens: [] };
}

export function parsePersonalAccessTokensUserSetting(
  raw: string | null,
): PersonalAccessTokensUserSettingJson {
  if (!raw) return emptyPats();
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const arr = j.tokens;
    if (!Array.isArray(arr)) return emptyPats();
    const tokens: PersonalAccessTokensUserSettingJson["tokens"] = [];
    for (const x of arr) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      const tokenId =
        typeof o.tokenId === "string"
          ? o.tokenId
          : typeof o.token_id === "string"
            ? o.token_id
            : "";
      const tokenHash =
        typeof o.tokenHash === "string"
          ? o.tokenHash
          : typeof o.token_hash === "string"
            ? o.token_hash
            : "";
      if (!tokenId || !tokenHash) continue;
      tokens.push({
        tokenId,
        tokenHash,
        description: typeof o.description === "string" ? o.description : "",
        createdAt:
          typeof o.createdAt === "string"
            ? o.createdAt
            : typeof o.created_at === "string"
              ? o.created_at
              : undefined,
        expiresAt:
          o.expiresAt === null
            ? null
            : typeof o.expiresAt === "string"
              ? o.expiresAt
              : typeof o.expires_at === "string"
                ? o.expires_at
                : null,
        lastUsedAt:
          o.lastUsedAt === null
            ? null
            : typeof o.lastUsedAt === "string"
              ? o.lastUsedAt
              : typeof o.last_used_at === "string"
                ? o.last_used_at
                : null,
      });
    }
    return { tokens };
  } catch {
    return emptyPats();
  }
}

export function serializePersonalAccessTokensUserSetting(
  v: PersonalAccessTokensUserSettingJson,
): string {
  return JSON.stringify(v);
}

function emptyShortcuts(): ShortcutsUserSettingJson {
  return { shortcuts: [] };
}

export function parseShortcutsUserSetting(raw: string | null): ShortcutsUserSettingJson {
  if (!raw) return emptyShortcuts();
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const arr = j.shortcuts;
    if (!Array.isArray(arr)) return emptyShortcuts();
    const shortcuts: ShortcutsUserSettingJson["shortcuts"] = [];
    for (const x of arr) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      const id =
        typeof o.id === "string" ? o.id : typeof o.shortcut_id === "string" ? o.shortcut_id : "";
      const title = typeof o.title === "string" ? o.title : "";
      const filter = typeof o.filter === "string" ? o.filter : "";
      if (!id) continue;
      shortcuts.push({ id, title, filter });
    }
    return { shortcuts };
  } catch {
    return emptyShortcuts();
  }
}

export function serializeShortcutsUserSetting(v: ShortcutsUserSettingJson): string {
  return JSON.stringify(v);
}
