/** Cloudflare Worker environment (Static Assets + D1). */
export type WorkerBindings = {
  ASSETS: Fetcher;
  MEMOS_DB: D1Database;
  /** Set to `"1"` to use fixed demo JWT secret (aligns with Go demo mode). */
  MEMOS_DEMO?: string;
  MEMOS_VERSION?: string;
  /** Set to `"1"` to log full request/response for `/api/v1/*` (testing). */
  MEMOS_DEBUG_HTTP?: string;
};
