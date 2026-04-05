-- memos Hono: initial schema (SQLite / D1) — single bootstrap migration until first stable release.
-- Node: all `NNNN_*.sql` in this folder are applied at startup (see `server/db/migrate.ts`). D1: `wrangler d1 migrations apply` / `npm run dev:worker` runs local apply first.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL
);

CREATE TABLE IF NOT EXISTS instance_kv (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS instance_settings (
  setting_key TEXT PRIMARY KEY NOT NULL,
  json_value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'USER',
  display_name TEXT,
  email TEXT,
  avatar_url TEXT,
  description TEXT,
  state TEXT NOT NULL DEFAULT 'NORMAL',
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS refresh_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (username) REFERENCES users (username)
);

CREATE TABLE IF NOT EXISTS personal_access_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  description TEXT,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (username) REFERENCES users (username)
);

CREATE TABLE IF NOT EXISTS memos (
  id TEXT PRIMARY KEY NOT NULL,
  creator_username TEXT NOT NULL,
  content TEXT NOT NULL,
  visibility TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'NORMAL',
  pinned INTEGER NOT NULL DEFAULT 0,
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL,
  display_time TEXT,
  snippet TEXT,
  parent_memo_id TEXT,
  location_placeholder TEXT,
  location_latitude REAL,
  location_longitude REAL,
  deleted INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (creator_username) REFERENCES users (username),
  FOREIGN KEY (parent_memo_id) REFERENCES memos (id)
);

CREATE TABLE IF NOT EXISTS memo_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memo_id TEXT NOT NULL,
  related_memo_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  FOREIGN KEY (memo_id) REFERENCES memos (id),
  FOREIGN KEY (related_memo_id) REFERENCES memos (id),
  UNIQUE (memo_id, related_memo_id, relation_type)
);

CREATE TABLE IF NOT EXISTS memo_reactions (
  id TEXT PRIMARY KEY NOT NULL,
  memo_id TEXT NOT NULL,
  creator_username TEXT NOT NULL,
  reaction_type TEXT NOT NULL,
  create_time TEXT NOT NULL,
  FOREIGN KEY (memo_id) REFERENCES memos (id),
  FOREIGN KEY (creator_username) REFERENCES users (username),
  UNIQUE (memo_id, creator_username, reaction_type)
);

CREATE TABLE IF NOT EXISTS memo_shares (
  id TEXT PRIMARY KEY NOT NULL,
  memo_id TEXT NOT NULL,
  share_token TEXT NOT NULL UNIQUE,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (memo_id) REFERENCES memos (id)
);

CREATE TABLE IF NOT EXISTS shortcuts (
  shortcut_id TEXT NOT NULL,
  username TEXT NOT NULL,
  title TEXT NOT NULL,
  filter_expr TEXT,
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL,
  PRIMARY KEY (username, shortcut_id),
  FOREIGN KEY (username) REFERENCES users (username)
);

CREATE TABLE IF NOT EXISTS user_settings_kv (
  username TEXT NOT NULL,
  setting_key TEXT NOT NULL,
  json_value TEXT NOT NULL,
  PRIMARY KEY (username, setting_key),
  FOREIGN KEY (username) REFERENCES users (username)
);

CREATE TABLE IF NOT EXISTS user_webhooks (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  url TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (username) REFERENCES users (username)
);

CREATE TABLE IF NOT EXISTS user_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL,
  FOREIGN KEY (username) REFERENCES users (username)
);

CREATE INDEX IF NOT EXISTS idx_memos_creator ON memos (creator_username);
CREATE INDEX IF NOT EXISTS idx_memos_visibility ON memos (visibility);
CREATE INDEX IF NOT EXISTS idx_memos_parent ON memos (parent_memo_id);
CREATE INDEX IF NOT EXISTS idx_refresh_username ON refresh_sessions (username);

INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);
