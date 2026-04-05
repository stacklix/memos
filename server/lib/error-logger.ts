/**
 * Separate channel from `[access]` logs: uncaught handler errors with stack traces.
 * Disable with `MEMOS_ERROR_LOG=0`. Skipped when `NODE_ENV=test`.
 */
const PREFIX = "[memos:error]";

export function errorDetailLogEnabled(): boolean {
  if (globalThis.process?.env?.MEMOS_ERROR_LOG === "0") return false;
  if (globalThis.process?.env?.NODE_ENV === "test") return false;
  return true;
}

export function logUncaughtApiError(
  err: unknown,
  meta: { method: string; path: string },
): void {
  if (!errorDetailLogEnabled()) return;
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`${PREFIX} ${meta.method} ${meta.path} ${msg}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
}
