import { SignJWT, jwtVerify } from "jose";
import type { UserRole } from "../types/auth.js";

const ACCESS_TTL_SEC = 15 * 60;
const ISSUER = "memos";
const AUDIENCE = "user.access-token";

export async function signAccessToken(args: {
  secret: string;
  userId: number;
  username: string;
  role: UserRole;
  status?: "NORMAL" | "ARCHIVED";
}): Promise<{ token: string; expiresAt: Date }> {
  const key = new TextEncoder().encode(args.secret);
  const exp = Math.floor(Date.now() / 1000) + ACCESS_TTL_SEC;
  const expiresAt = new Date(exp * 1000);
  const token = await new SignJWT({
    type: "access",
    role: args.role,
    status: args.status ?? "NORMAL",
    username: args.username,
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

export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<{ username: string | null; userId: number | null; role: UserRole } | null> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const tokenType = payload.type ?? payload.kind;
    if (tokenType !== "access") return null;
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    const userId = sub ? parseInt(sub, 10) : NaN;
    const role = payload.role === "ADMIN" ? "ADMIN" : "USER";
    const username = typeof payload.username === "string" ? payload.username : null;
    return {
      username,
      userId: Number.isFinite(userId) ? userId : null,
      role,
    };
  } catch {
    return null;
  }
}
