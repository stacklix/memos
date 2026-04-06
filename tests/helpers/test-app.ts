import Database from "better-sqlite3";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../server/app.js";
import { createBetterSqliteAdapter } from "../../server/db/better-sqlite-adapter.js";
import { migrateBetterSqliteFromDir } from "../../server/db/migrate.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const migrationsDir = join(repoRoot, "migrations");

export type TestApp = ReturnType<typeof createApp>;

export function createTestApp(
  opts: {
    sendNotificationEmail?: Parameters<typeof createApp>[0]["sendNotificationEmail"];
  } = {},
): TestApp {
  const sqlite = new Database(":memory:");
  migrateBetterSqliteFromDir(sqlite, migrationsDir);
  const sql = createBetterSqliteAdapter(sqlite);
  return createApp({
    sql,
    demo: true,
    instanceVersion: "0.0.0-test",
    instanceUrl: "http://test",
    defaultAttachmentStorageType: "DB",
    ...(opts.sendNotificationEmail
      ? { sendNotificationEmail: opts.sendNotificationEmail }
      : {}),
  });
}
