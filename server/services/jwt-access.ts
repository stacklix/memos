import { SignJWT, jwtVerify } from "jose";
import type { UserRole } from "../types/auth.js";

const ACCESS_TTL_SEC = 3600;

export async function signAccessToken(args: {
  secret: string;
  username: string;
  role: UserRole;
}): Promise<{ token: string; expiresAt: Date }> {
  const key = new TextEncoder().encode(args.secret);
  const exp = Math.floor(Date.now() / 1000) + ACCESS_TTL_SEC;
  const expiresAt = new Date(exp * 1000);
  const token = await new SignJWT({
    role: args.role,
    kind: "access",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(args.username)
    .setExpirationTime(exp)
    .setIssuedAt()
    .sign(key);
  return { token, expiresAt };
}

export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<{ username: string; role: UserRole } | null> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (payload.kind !== "access") return null;
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    if (!sub) return null;
    const role = payload.role === "ADMIN" ? "ADMIN" : "USER";
    return { username: sub, role };
  } catch {
    return null;
  }
}
