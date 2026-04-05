import type { SqlAdapter, SqlPrimitive, SqlRow } from "./sql-adapter.js";

export function createD1Adapter(db: D1Database): SqlAdapter {
  return {
    async queryOne<T extends SqlRow = SqlRow>(
      sql: string,
      args: SqlPrimitive[] = [],
    ): Promise<T | null> {
      const stmt = db.prepare(sql).bind(...args);
      const row = await stmt.first<T>();
      return row ?? null;
    },
    async queryAll<T extends SqlRow = SqlRow>(
      sql: string,
      args: SqlPrimitive[] = [],
    ): Promise<T[]> {
      const stmt = db.prepare(sql).bind(...args);
      const { results } = await stmt.all<T>();
      return results ?? [];
    },
    async execute(sql: string, args: SqlPrimitive[] = []) {
      const stmt = db.prepare(sql).bind(...args);
      const meta = await stmt.run();
      return { changes: meta.meta.changes ?? 0 };
    },
  };
}
