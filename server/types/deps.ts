import type { SqlAdapter } from "../db/sql-adapter.js";

export type AppDeps = {
  sql: SqlAdapter;
  demo: boolean;
  instanceVersion: string;
  /** Base URL for instance profile, e.g. https://example.com */
  instanceUrl: string;
  /** When true, log request query/headers/body and response headers/body for `/api/v1/*` (`MEMOS_DEBUG_HTTP=1`). */
  debugHttp?: boolean;
};
