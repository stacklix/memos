import type { SqlAdapter, SqlPrimitive } from "./sql-adapter.js";
import type { UserRole } from "../types/auth.js";
import { randomTokenHex, sha256Hex } from "../services/crypto-util.js";

const DEFAULT_GENERAL = {
  disallowUserRegistration: false,
  disallowPasswordAuth: false,
};

export type DbUserRow = {
  username: string;
  password_hash: string;
  role: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  description: string | null;
  state: string;
  create_time: string;
  update_time: string;
  deleted: number;
};

export type DbMemoRow = {
  id: string;
  creator_username: string;
  content: string;
  visibility: string;
  state: string;
  pinned: number;
  create_time: string;
  update_time: string;
  display_time: string | null;
  snippet: string | null;
  parent_memo_id: string | null;
  deleted: number;
  location_placeholder: string | null;
  location_latitude: number | null;
  location_longitude: number | null;
};

export function createRepository(sql: SqlAdapter) {
  return {
    sql,

    async getSecretKey(): Promise<string | null> {
      const row = await sql.queryOne<{ value: string }>(
        "SELECT value FROM instance_kv WHERE key = 'secret_key'",
      );
      return row?.value ?? null;
    },

    async setSecretKey(value: string): Promise<void> {
      await sql.execute(
        "INSERT INTO instance_kv (key, value) VALUES ('secret_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [value],
      );
    },

    async ensureSecretKey(): Promise<string> {
      const existing = await this.getSecretKey();
      if (existing) return existing;
      const v = crypto.randomUUID();
      await this.setSecretKey(v);
      return v;
    },

    async getGeneralSetting(): Promise<typeof DEFAULT_GENERAL> {
      const row = await sql.queryOne<{ json_value: string }>(
        "SELECT json_value FROM instance_settings WHERE setting_key = 'GENERAL'",
      );
      if (!row) return { ...DEFAULT_GENERAL };
      try {
        const parsed = JSON.parse(row.json_value) as Record<string, unknown>;
        return {
          disallowUserRegistration: Boolean(
            parsed.disallowUserRegistration ?? parsed.disallow_user_registration,
          ),
          disallowPasswordAuth: Boolean(
            parsed.disallowPasswordAuth ?? parsed.disallow_password_auth,
          ),
        };
      } catch {
        return { ...DEFAULT_GENERAL };
      }
    },

    async upsertGeneralSetting(patch: Partial<typeof DEFAULT_GENERAL>): Promise<void> {
      const cur = await this.getGeneralSetting();
      const next = { ...cur };
      if (patch.disallowUserRegistration !== undefined) {
        next.disallowUserRegistration = patch.disallowUserRegistration;
      }
      if (patch.disallowPasswordAuth !== undefined) {
        next.disallowPasswordAuth = patch.disallowPasswordAuth;
      }
      await sql.execute(
        `INSERT INTO instance_settings (setting_key, json_value) VALUES ('GENERAL', ?)
         ON CONFLICT(setting_key) DO UPDATE SET json_value = excluded.json_value`,
        [JSON.stringify(next)],
      );
    },

    async getInstanceSettingRaw(key: string): Promise<string | null> {
      const row = await sql.queryOne<{ json_value: string }>(
        "SELECT json_value FROM instance_settings WHERE setting_key = ?",
        [key],
      );
      return row?.json_value ?? null;
    },

    async upsertInstanceSettingRaw(key: string, jsonValue: string): Promise<void> {
      await sql.execute(
        `INSERT INTO instance_settings (setting_key, json_value) VALUES (?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET json_value = excluded.json_value`,
        [key, jsonValue],
      );
    },

    /** From persisted MEMO_RELATED JSON; aligns user-stats heatmap with golang. */
    async getMemoRelatedDisplayWithUpdateTime(): Promise<boolean> {
      const raw = await this.getInstanceSettingRaw("MEMO_RELATED");
      if (!raw) return false;
      try {
        const j = JSON.parse(raw) as { displayWithUpdateTime?: boolean };
        return Boolean(j.displayWithUpdateTime);
      } catch {
        return false;
      }
    },

    async userCount(): Promise<number> {
      const row = await sql.queryOne<{ c: number }>(
        "SELECT COUNT(*) as c FROM users WHERE deleted = 0",
      );
      return row?.c ?? 0;
    },

    async findAdmin(): Promise<DbUserRow | null> {
      return sql.queryOne<DbUserRow>(
        "SELECT * FROM users WHERE deleted = 0 AND role = 'ADMIN' ORDER BY create_time ASC LIMIT 1",
      );
    },

    async getUser(username: string): Promise<DbUserRow | null> {
      return sql.queryOne<DbUserRow>(
        "SELECT * FROM users WHERE username = ? AND deleted = 0",
        [username],
      );
    },

    async createUser(args: {
      username: string;
      passwordHash: string;
      role: UserRole;
      displayName?: string;
      email?: string;
    }): Promise<DbUserRow> {
      const now = new Date().toISOString();
      await sql.execute(
        `INSERT INTO users (username, password_hash, role, display_name, email, state, create_time, update_time, deleted)
         VALUES (?, ?, ?, ?, ?, 'NORMAL', ?, ?, 0)`,
        [
          args.username,
          args.passwordHash,
          args.role,
          args.displayName ?? null,
          args.email ?? null,
          now,
          now,
        ],
      );
      const u = await this.getUser(args.username);
      if (!u) throw new Error("user missing after insert");
      return u;
    },

    async listUsers(args: { limit: number; offset: number }): Promise<DbUserRow[]> {
      return sql.queryAll<DbUserRow>(
        "SELECT * FROM users WHERE deleted = 0 ORDER BY create_time ASC LIMIT ? OFFSET ?",
        [args.limit, args.offset],
      );
    },

    async updateUser(
      username: string,
      fields: {
        display_name?: string | null;
        email?: string | null;
        avatar_url?: string | null;
        description?: string | null;
        password_hash?: string;
        role?: UserRole;
        state?: string;
      },
    ): Promise<void> {
      const sets: string[] = [];
      const vals: SqlPrimitive[] = [];
      if (fields.display_name !== undefined) {
        sets.push("display_name = ?");
        vals.push(fields.display_name);
      }
      if (fields.email !== undefined) {
        sets.push("email = ?");
        vals.push(fields.email);
      }
      if (fields.avatar_url !== undefined) {
        sets.push("avatar_url = ?");
        vals.push(fields.avatar_url);
      }
      if (fields.description !== undefined) {
        sets.push("description = ?");
        vals.push(fields.description);
      }
      if (fields.password_hash !== undefined) {
        sets.push("password_hash = ?");
        vals.push(fields.password_hash);
      }
      if (fields.role !== undefined) {
        sets.push("role = ?");
        vals.push(fields.role);
      }
      if (fields.state !== undefined) {
        sets.push("state = ?");
        vals.push(fields.state);
      }
      sets.push("update_time = ?");
      vals.push(new Date().toISOString());
      vals.push(username);
      if (sets.length === 1) return;
      await sql.execute(
        `UPDATE users SET ${sets.join(", ")} WHERE username = ? AND deleted = 0`,
        vals,
      );
    },

    async softDeleteUser(username: string): Promise<void> {
      await sql.execute(
        "UPDATE users SET deleted = 1, update_time = ? WHERE username = ?",
        [new Date().toISOString(), username],
      );
    },

    async addRefreshSession(args: {
      id: string;
      username: string;
      tokenHash: string;
      expiresAt: string;
    }): Promise<void> {
      await sql.execute(
        `INSERT INTO refresh_sessions (id, username, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          args.id,
          args.username,
          args.tokenHash,
          args.expiresAt,
          new Date().toISOString(),
        ],
      );
    },

    async getRefreshByHash(
      tokenHash: string,
    ): Promise<{ id: string; username: string; expires_at: string } | null> {
      return sql.queryOne(
        "SELECT id, username, expires_at FROM refresh_sessions WHERE token_hash = ?",
        [tokenHash],
      );
    },

    async deleteRefreshSession(id: string): Promise<void> {
      await sql.execute("DELETE FROM refresh_sessions WHERE id = ?", [id]);
    },

    async deleteRefreshSessionsForUser(username: string): Promise<void> {
      await sql.execute("DELETE FROM refresh_sessions WHERE username = ?", [
        username,
      ]);
    },

    async listPats(username: string) {
      return sql.queryAll<{
        id: string;
        description: string | null;
        created_at: string;
      }>(
        "SELECT id, description, created_at FROM personal_access_tokens WHERE username = ? ORDER BY created_at DESC",
        [username],
      );
    },

    async createPat(username: string, description: string | null) {
      const id = crypto.randomUUID();
      const raw = `memos_pat_${randomTokenHex(24)}`;
      const tokenHash = await sha256Hex(raw);
      await sql.execute(
        `INSERT INTO personal_access_tokens (id, username, description, token_hash, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [id, username, description, tokenHash, new Date().toISOString()],
      );
      return { id, raw };
    },

    async deletePat(username: string, patId: string): Promise<boolean> {
      const r = await sql.execute(
        "DELETE FROM personal_access_tokens WHERE id = ? AND username = ?",
        [patId, username],
      );
      return r.changes > 0;
    },

    async findUserByPat(rawToken: string): Promise<DbUserRow | null> {
      const tokenHash = await sha256Hex(rawToken);
      const row = await sql.queryOne<{ username: string }>(
        `SELECT t.username FROM personal_access_tokens t
         INNER JOIN users u ON u.username = t.username AND u.deleted = 0
         WHERE t.token_hash = ?`,
        [tokenHash],
      );
      if (!row) return null;
      return this.getUser(row.username);
    },

    async createMemo(args: {
      id: string;
      creator: string;
      content: string;
      visibility: string;
      state: string;
      pinned: boolean;
      parentId?: string | null;
      location?: {
        location_placeholder: string;
        location_latitude: number;
        location_longitude: number;
      } | null;
    }): Promise<DbMemoRow> {
      const now = new Date().toISOString();
      const snippet = args.content.slice(0, 200);
      const loc = args.location;
      await sql.execute(
        `INSERT INTO memos (id, creator_username, content, visibility, state, pinned, create_time, update_time, display_time, snippet, parent_memo_id, location_placeholder, location_latitude, location_longitude, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          args.id,
          args.creator,
          args.content,
          args.visibility,
          args.state,
          args.pinned ? 1 : 0,
          now,
          now,
          now,
          snippet,
          args.parentId ?? null,
          loc?.location_placeholder ?? null,
          loc?.location_latitude ?? null,
          loc?.location_longitude ?? null,
        ],
      );
      const m = await this.getMemoById(args.id);
      if (!m) throw new Error("memo missing");
      return m;
    },

    async getMemoById(id: string): Promise<DbMemoRow | null> {
      return sql.queryOne<DbMemoRow>(
        "SELECT * FROM memos WHERE id = ? AND deleted = 0",
        [id],
      );
    },

    async updateMemo(
      id: string,
      patch: Partial<{
        content: string;
        visibility: string;
        state: string;
        pinned: boolean;
        display_time: string | null;
        location:
          | {
              location_placeholder: string;
              location_latitude: number;
              location_longitude: number;
            }
          | null;
      }>,
    ): Promise<void> {
      const sets: string[] = [];
      const vals: SqlPrimitive[] = [];
      if (patch.content !== undefined) {
        sets.push("content = ?");
        vals.push(patch.content);
        sets.push("snippet = ?");
        vals.push(patch.content.slice(0, 200));
      }
      if (patch.visibility !== undefined) {
        sets.push("visibility = ?");
        vals.push(patch.visibility);
      }
      if (patch.state !== undefined) {
        sets.push("state = ?");
        vals.push(patch.state);
      }
      if (patch.pinned !== undefined) {
        sets.push("pinned = ?");
        vals.push(patch.pinned ? 1 : 0);
      }
      if (patch.display_time !== undefined) {
        sets.push("display_time = ?");
        vals.push(patch.display_time);
      }
      if (patch.location !== undefined) {
        if (patch.location === null) {
          sets.push("location_placeholder = ?");
          vals.push(null);
          sets.push("location_latitude = ?");
          vals.push(null);
          sets.push("location_longitude = ?");
          vals.push(null);
        } else {
          sets.push("location_placeholder = ?");
          vals.push(patch.location.location_placeholder);
          sets.push("location_latitude = ?");
          vals.push(patch.location.location_latitude);
          sets.push("location_longitude = ?");
          vals.push(patch.location.location_longitude);
        }
      }
      sets.push("update_time = ?");
      vals.push(new Date().toISOString());
      vals.push(id);
      await sql.execute(`UPDATE memos SET ${sets.join(", ")} WHERE id = ? AND deleted = 0`, vals);
    },

    async softDeleteMemo(id: string): Promise<void> {
      await sql.execute(
        "UPDATE memos SET deleted = 1, update_time = ? WHERE id = ?",
        [new Date().toISOString(), id],
      );
    },

    /**
     * Top-level NORMAL memos for user-stats (tags, activity heatmap), with visibility rules
     * aligned with golang GetUserStats: self sees all; others see PUBLIC+PROTECTED; anonymous PUBLIC only.
     */
    async listTopLevelMemosForUserStats(args: {
      creatorUsername: string;
      /** `null` = unauthenticated caller */
      viewerUsername: string | null;
    }): Promise<
      Array<{
        id: string;
        content: string;
        display_time: string | null;
        create_time: string;
        update_time: string;
        pinned: number;
      }>
    > {
      const where: string[] = [
        "deleted = 0",
        "parent_memo_id IS NULL",
        "state = 'NORMAL'",
        "creator_username = ?",
      ];
      const vals: SqlPrimitive[] = [args.creatorUsername];
      const v = args.viewerUsername;
      if (v === null) {
        where.push("visibility = 'PUBLIC'");
      } else if (v !== args.creatorUsername) {
        where.push("(visibility = 'PUBLIC' OR visibility = 'PROTECTED')");
      }
      return sql.queryAll(
        `SELECT id, content, display_time, create_time, update_time, pinned FROM memos WHERE ${where.join(" AND ")}`,
        vals,
      );
    },

    async listMemosTopLevel(args: {
      limit: number;
      offset: number;
      state: string;
      visibility?: string | null;
      creator?: string | null;
      /** Logged-in non-admin: public, protected, or own private. */
      viewerUsername?: string | null;
      /** Extra visibility constraint (e.g. explore: PUBLIC+PROTECTED). */
      visibilityIn?: string[] | null;
      pinnedOnly?: boolean;
      timeField?: "create_time" | "update_time";
      timeStartSec?: number;
      timeEndSec?: number;
    }): Promise<DbMemoRow[]> {
      const where: string[] = ["deleted = 0", "parent_memo_id IS NULL"];
      const vals: SqlPrimitive[] = [];
      where.push("state = ?");
      vals.push(args.state);
      if (args.visibility) {
        where.push("visibility = ?");
        vals.push(args.visibility);
      }
      if (args.creator) {
        where.push("creator_username = ?");
        vals.push(args.creator);
      }
      if (args.viewerUsername) {
        where.push(
          "(visibility = 'PUBLIC' OR visibility = 'PROTECTED' OR (visibility = 'PRIVATE' AND creator_username = ?))",
        );
        vals.push(args.viewerUsername);
      }
      if (args.visibilityIn && args.visibilityIn.length > 0) {
        const ph = args.visibilityIn.map(() => "?").join(", ");
        where.push(`visibility IN (${ph})`);
        for (const v of args.visibilityIn) vals.push(v);
      }
      if (args.pinnedOnly) {
        where.push("pinned = 1");
      }
      if (
        args.timeField &&
        args.timeStartSec !== undefined &&
        args.timeEndSec !== undefined
      ) {
        where.push(
          `(strftime('%s', ${args.timeField}) + 0) >= ? AND (strftime('%s', ${args.timeField}) + 0) < ?`,
        );
        vals.push(args.timeStartSec, args.timeEndSec);
      }
      vals.push(args.limit, args.offset);
      return sql.queryAll<DbMemoRow>(
        `SELECT * FROM memos WHERE ${where.join(" AND ")} ORDER BY pinned DESC, display_time DESC, create_time DESC LIMIT ? OFFSET ?`,
        vals,
      );
    },

    async listCommentsForMemo(parentId: string): Promise<DbMemoRow[]> {
      return sql.queryAll<DbMemoRow>(
        "SELECT * FROM memos WHERE parent_memo_id = ? AND deleted = 0 ORDER BY create_time ASC",
        [parentId],
      );
    },

    async setMemoRelations(memoId: string, pairs: { relatedId: string; type: string }[]) {
      await sql.execute("DELETE FROM memo_relations WHERE memo_id = ?", [memoId]);
      for (const p of pairs) {
        await sql.execute(
          `INSERT INTO memo_relations (memo_id, related_memo_id, relation_type) VALUES (?, ?, ?)`,
          [memoId, p.relatedId, p.type],
        );
      }
    },

    async listMemoRelations(memoId: string) {
      return sql.queryAll<{
        related_memo_id: string;
        relation_type: string;
      }>(
        "SELECT related_memo_id, relation_type FROM memo_relations WHERE memo_id = ?",
        [memoId],
      );
    },

    async upsertReaction(args: {
      id: string;
      memoId: string;
      creator: string;
      reactionType: string;
    }) {
      const now = new Date().toISOString();
      await sql.execute(
        "DELETE FROM memo_reactions WHERE memo_id = ? AND creator_username = ? AND reaction_type = ?",
        [args.memoId, args.creator, args.reactionType],
      );
      await sql.execute(
        `INSERT INTO memo_reactions (id, memo_id, creator_username, reaction_type, create_time)
         VALUES (?, ?, ?, ?, ?)`,
        [args.id, args.memoId, args.creator, args.reactionType, now],
      );
    },

    async listReactions(memoId: string) {
      return sql.queryAll<{
        id: string;
        creator_username: string;
        reaction_type: string;
        create_time: string;
      }>(
        "SELECT id, creator_username, reaction_type, create_time FROM memo_reactions WHERE memo_id = ? ORDER BY create_time ASC",
        [memoId],
      );
    },

    async deleteReaction(memoId: string, reactionId: string): Promise<boolean> {
      const r = await sql.execute(
        "DELETE FROM memo_reactions WHERE id = ? AND memo_id = ?",
        [reactionId, memoId],
      );
      return r.changes > 0;
    },

    async createShare(args: { id: string; memoId: string; token: string; expiresAt: string | null }) {
      await sql.execute(
        `INSERT INTO memo_shares (id, memo_id, share_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
        [
          args.id,
          args.memoId,
          args.token,
          args.expiresAt,
          new Date().toISOString(),
        ],
      );
    },

    async listShares(memoId: string) {
      return sql.queryAll<{
        id: string;
        share_token: string;
        expires_at: string | null;
        created_at: string;
      }>(
        "SELECT id, share_token, expires_at, created_at FROM memo_shares WHERE memo_id = ? ORDER BY created_at DESC",
        [memoId],
      );
    },

    async deleteShareByName(memoId: string, shareSegment: string): Promise<boolean> {
      const r = await sql.execute(
        "DELETE FROM memo_shares WHERE memo_id = ? AND (share_token = ? OR id = ?)",
        [memoId, shareSegment, shareSegment],
      );
      return r.changes > 0;
    },

    async getMemoIdByShareToken(token: string): Promise<string | null> {
      const row = await sql.queryOne<{ memo_id: string; expires_at: string | null }>(
        "SELECT memo_id, expires_at FROM memo_shares WHERE share_token = ?",
        [token],
      );
      if (!row) return null;
      if (row.expires_at) {
        const ex = new Date(row.expires_at).getTime();
        if (ex < Date.now()) return null;
      }
      return row.memo_id;
    },

    async listShortcuts(username: string) {
      return sql.queryAll<{
        shortcut_id: string;
        title: string;
        filter_expr: string | null;
        create_time: string;
        update_time: string;
      }>(
        "SELECT shortcut_id, title, filter_expr, create_time, update_time FROM shortcuts WHERE username = ? ORDER BY create_time DESC",
        [username],
      );
    },

    async createShortcut(args: {
      username: string;
      shortcutId: string;
      title: string;
      filter: string | null;
    }) {
      const now = new Date().toISOString();
      await sql.execute(
        `INSERT INTO shortcuts (shortcut_id, username, title, filter_expr, create_time, update_time)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [args.shortcutId, args.username, args.title, args.filter, now, now],
      );
    },

    async updateShortcut(
      username: string,
      shortcutId: string,
      patch: { title?: string; filter?: string | null },
    ) {
      const sets: string[] = [];
      const vals: SqlPrimitive[] = [];
      if (patch.title !== undefined) {
        sets.push("title = ?");
        vals.push(patch.title);
      }
      if (patch.filter !== undefined) {
        sets.push("filter_expr = ?");
        vals.push(patch.filter);
      }
      sets.push("update_time = ?");
      vals.push(new Date().toISOString());
      vals.push(username, shortcutId);
      if (sets.length === 1) return;
      await sql.execute(
        `UPDATE shortcuts SET ${sets.join(", ")} WHERE username = ? AND shortcut_id = ?`,
        vals,
      );
    },

    async deleteShortcut(username: string, shortcutId: string): Promise<boolean> {
      const r = await sql.execute(
        "DELETE FROM shortcuts WHERE username = ? AND shortcut_id = ?",
        [username, shortcutId],
      );
      return r.changes > 0;
    },

    async getUserSetting(username: string, key: string): Promise<string | null> {
      const row = await sql.queryOne<{ json_value: string }>(
        "SELECT json_value FROM user_settings_kv WHERE username = ? AND setting_key = ?",
        [username, key],
      );
      return row?.json_value ?? null;
    },

    async upsertUserSetting(username: string, key: string, json: string): Promise<void> {
      await sql.execute(
        `INSERT INTO user_settings_kv (username, setting_key, json_value) VALUES (?, ?, ?)
         ON CONFLICT(username, setting_key) DO UPDATE SET json_value = excluded.json_value`,
        [username, key, json],
      );
    },

    async listUserSettings(username: string) {
      return sql.queryAll<{ setting_key: string; json_value: string }>(
        "SELECT setting_key, json_value FROM user_settings_kv WHERE username = ?",
        [username],
      );
    },

    async listWebhooks(username: string) {
      return sql.queryAll<{
        id: string;
        url: string;
        payload_json: string | null;
        created_at: string;
      }>(
        "SELECT id, url, payload_json, created_at FROM user_webhooks WHERE username = ? ORDER BY created_at DESC",
        [username],
      );
    },

    async createWebhook(username: string, url: string) {
      const id = crypto.randomUUID();
      await sql.execute(
        `INSERT INTO user_webhooks (id, username, url, created_at) VALUES (?, ?, ?, ?)`,
        [id, username, url, new Date().toISOString()],
      );
      return id;
    },

    async deleteWebhook(username: string, id: string): Promise<boolean> {
      const r = await sql.execute(
        "DELETE FROM user_webhooks WHERE id = ? AND username = ?",
        [id, username],
      );
      return r.changes > 0;
    },

    async listNotifications(username: string) {
      return sql.queryAll<{
        id: string;
        status: string;
        payload_json: string;
        create_time: string;
        update_time: string;
      }>(
        "SELECT id, status, payload_json, create_time, update_time FROM user_notifications WHERE username = ? ORDER BY create_time DESC",
        [username],
      );
    },

    async createNotification(args: {
      id: string;
      username: string;
      status: string;
      payload: string;
    }): Promise<void> {
      const now = new Date().toISOString();
      await sql.execute(
        `INSERT INTO user_notifications (id, username, status, payload_json, create_time, update_time)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [args.id, args.username, args.status, args.payload, now, now],
      );
    },

    async updateNotification(args: {
      id: string;
      username: string;
      status: string;
      payload: string;
    }): Promise<boolean> {
      const r = await sql.execute(
        `UPDATE user_notifications SET status = ?, payload_json = ?, update_time = ?
         WHERE id = ? AND username = ?`,
        [
          args.status,
          args.payload,
          new Date().toISOString(),
          args.id,
          args.username,
        ],
      );
      return r.changes > 0;
    },

    async deleteNotification(username: string, id: string): Promise<boolean> {
      const r = await sql.execute(
        "DELETE FROM user_notifications WHERE id = ? AND username = ?",
        [id, username],
      );
      return r.changes > 0;
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;
