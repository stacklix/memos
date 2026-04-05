export const REFRESH_COOKIE_NAME = "memos_refresh";

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

export function buildRefreshCookie(
  token: string,
  expiresAt: Date | null,
  secure: boolean,
): string {
  const attrs = [`${REFRESH_COOKIE_NAME}=${token}`, "Path=/", "HttpOnly"];
  const sameSite = secure ? "SameSite=None" : "SameSite=Lax";
  attrs.push(sameSite);
  if (secure) attrs.push("Secure");
  if (!expiresAt || expiresAt.getTime() <= 0) {
    attrs.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  } else {
    attrs.push(
      "Expires=" +
        expiresAt.toUTCString().replace(/GMT$/, "GMT").replace(/UTC$/, "GMT"),
    );
  }
  return attrs.join("; ");
}
