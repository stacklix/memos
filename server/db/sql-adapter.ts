export type SqlPrimitive = string | number | bigint | null;

export type SqlRow = Record<string, SqlPrimitive>;

export interface SqlAdapter {
  queryOne<T extends SqlRow = SqlRow>(
    sql: string,
    args?: SqlPrimitive[],
  ): Promise<T | null>;
  queryAll<T extends SqlRow = SqlRow>(
    sql: string,
    args?: SqlPrimitive[],
  ): Promise<T[]>;
  execute(
    sql: string,
    args?: SqlPrimitive[],
  ): Promise<{ changes: number; lastInsertRowid?: bigint }>;
}
