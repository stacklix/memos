-- Truncate app data on local D1 (wrangler d1 execute MEMOS_DB --local --file).
-- Keeps table definitions and schema_migrations / Wrangler migration bookkeeping.
PRAGMA foreign_keys = OFF;
DELETE FROM memo_relation;
DELETE FROM reaction;
DELETE FROM memo_share;
DELETE FROM memo;
DELETE FROM attachment;
DELETE FROM inbox;
DELETE FROM idp;
DELETE FROM user_setting;
DELETE FROM user;
DELETE FROM system_setting;
DELETE FROM sqlite_sequence;
PRAGMA foreign_keys = ON;
