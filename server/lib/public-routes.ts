/**
 * HTTP routes that skip Bearer/PAT authentication, aligned with
 * `server/router/api/v1/acl_config.go` `PublicMethods` (IdentityProvider omitted).
 */
export function isPublicApiRoute(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  if (m === "OPTIONS") return true;

  if (pathname === "/api/v1/auth/signin" && m === "POST") return true;
  if (pathname === "/api/v1/auth/refresh" && m === "POST") return true;

  if (pathname === "/api/v1/instance/profile" && m === "GET") return true;
  /** Legacy probes; handler returns 404 (not in golang v1 API). */
  if (pathname === "/api/v1/status" && m === "GET") return true;
  if (m === "GET" && pathname.startsWith("/api/v1/instance/settings/")) return true;

  if (pathname === "/api/v1/users" && m === "POST") return true;
  if (pathname === "/api/v1/users:stats" && m === "GET") return true;

  if (m === "GET" && pathname.startsWith("/api/v1/users/")) {
    const rest = pathname.slice("/api/v1/users/".length);
    if (rest.includes("/")) return false;
    if (rest.endsWith(":getStats")) return true;
    if (rest.includes(":")) return false;
    return true;
  }

  if (pathname === "/api/v1/memos" && m === "GET") return true;
  if (m === "GET" && /^\/api\/v1\/memos\/[^/]+$/.test(pathname)) return true;
  if (m === "GET" && /^\/api\/v1\/memos\/[^/]+\/comments$/.test(pathname))
    return true;
  if (m === "GET" && /^\/api\/v1\/shares\/[^/]+$/.test(pathname)) return true;

  return false;
}
