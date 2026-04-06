import { SignJWT, jwtVerify } from "jose";

/** Matches golang `server/auth/token.go` refresh JWTs (DB rows live in `user_setting` / `REFRESH_TOKENS`). */
const ISSUER = "memos";
const AUDIENCE = "user.refresh-token";
const REFRESH_SEC = 30 * 24 * 60 * 60;

export async function signRefreshToken(args: {
  secret: string;
  userId: number;
  tokenId: string;
}): Promise<{ token: string; expiresAt: Date }> {
  const key = new TextEncoder().encode(args.secret);
  const exp = Math.floor(Date.now() / 1000) + REFRESH_SEC;
  const expiresAt = new Date(exp * 1000);
  const token = await new SignJWT({
    type: "refresh",
    tid: args.tokenId,
  })
    .setProtectedHeader({ alg: "HS256", kid: "v1" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(String(args.userId))
    .setExpirationTime(exp)
    .setIssuedAt()
    .sign(key);
  return { token, expiresAt };
}

export async function verifyRefreshToken(
  token: string,
  secret: string,
): Promise<{ userId: number; tokenId: string } | null> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (payload.type !== "refresh") return null;
    const tid = typeof payload.tid === "string" ? payload.tid : null;
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    if (!tid || !sub) return null;
    const userId = parseInt(sub, 10);
    if (!Number.isFinite(userId)) return null;
    return { userId, tokenId: tid };
  } catch {
    return null;
  }
}
