-- Truncate app data on local D1 (wrangler d1 execute memos --local --file).
-- Keeps table definitions and schema_migrations / Wrangler migration bookkeeping.
PRAGMA foreign_keys = OFF;
DELETE FROM memo_relations;
DELETE FROM memo_reactions;
DELETE FROM memo_shares;
DELETE FROM memos;
DELETE FROM refresh_sessions;
DELETE FROM personal_access_tokens;
DELETE FROM shortcuts;
DELETE FROM user_settings_kv;
DELETE FROM user_webhooks;
DELETE FROM user_notifications;
DELETE FROM users;
DELETE FROM instance_settings;
DELETE FROM instance_kv;
DELETE FROM sqlite_sequence;
PRAGMA foreign_keys = ON;
