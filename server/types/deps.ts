import type { SqlAdapter } from "../db/sql-adapter.js";

export type AppDeps = {
  sql: SqlAdapter;
  demo: boolean;
  instanceVersion: string;
  /** Base URL for instance profile, e.g. https://example.com */
  instanceUrl: string;
};
