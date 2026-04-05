/**
 * Web client sends protobuf numeric enums in JSON; DB rows use string names
 * (e.g. PRIVATE, NORMAL) for SQL filters.
 */
export function normalizeMemoVisibilityFromClient(v: unknown): string {
  if (v === undefined || v === null) return "PRIVATE";
  if (typeof v === "number") {
    if (v === 1) return "PRIVATE";
    if (v === 2) return "PROTECTED";
    if (v === 3) return "PUBLIC";
  }
  if (v === "PRIVATE" || v === "PROTECTED" || v === "PUBLIC") return v;
  return "PRIVATE";
}

export function normalizeMemoStateFromClient(v: unknown): string {
  if (v === undefined || v === null) return "NORMAL";
  if (typeof v === "number") {
    if (v === 1) return "NORMAL";
    if (v === 2) return "ARCHIVED";
  }
  if (v === "NORMAL" || v === "ARCHIVED") return v;
  return "NORMAL";
}
