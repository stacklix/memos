import Database from "better-sqlite3";
import type { SqlAdapter, SqlPrimitive, SqlRow } from "./sql-adapter.js";

export function createBetterSqliteAdapter(db: Database.Database): SqlAdapter {
  return {
    queryOne<T extends SqlRow = SqlRow>(
      sql: string,
      args: SqlPrimitive[] = [],
    ): Promise<T | null> {
      const row = db.prepare(sql).get(...args) as T | undefined;
      return Promise.resolve(row ?? null);
    },
    queryAll<T extends SqlRow = SqlRow>(
      sql: string,
      args: SqlPrimitive[] = [],
    ): Promise<T[]> {
      const rows = db.prepare(sql).all(...args) as T[];
      return Promise.resolve(rows);
    },
    execute(sql: string, args: SqlPrimitive[] = []): Promise<{ changes: number }> {
      const info = db.prepare(sql).run(...args);
      return Promise.resolve({ changes: info.changes });
    },
  };
}
