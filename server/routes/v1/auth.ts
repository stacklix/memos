import { Hono } from "hono";
import type { ApiVariables } from "../../types/api-variables.js";
import {
  signInRequestSchema,
  type SignInRequest,
} from "../../contract/schemas.js";
import type { AppDeps } from "../../types/deps.js";
import { createRepository } from "../../db/repository.js";
import { GrpcCode, jsonError } from "../../lib/grpc-status.js";
import { verifyPassword } from "../../services/password.js";
import { signAccessToken } from "../../services/jwt-access.js";
import { signRefreshToken, verifyRefreshToken } from "../../services/jwt-refresh.js";
import { buildRefreshCookie, parseCookieHeader, REFRESH_COOKIE_NAME } from "../../lib/cookies.js";
import { authPrincipalFromUserRow, userToJson } from "../../lib/serializers.js";

export function createAuthRoutes(deps: AppDeps) {
  const r = new Hono<{ Variables: ApiVariables }>();
  const repo = createRepository(deps.sql);

  r.get("/me", async (c) => {
    const auth = c.get("auth");
    if (!auth) {
      return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    }
    const user = await repo.getUser(auth.username);
    if (!user) return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    return c.json({ user: userToJson(user, auth) });
  });

  r.post("/signin", async (c) => {
    let body: SignInRequest;
    try {
      body = signInRequestSchema.parse(await c.req.json());
    } catch {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid request body");
    }
    if (body.ssoCredentials) {
      return jsonError(c, GrpcCode.UNIMPLEMENTED, "SSO is not implemented");
    }
    const creds = body.passwordCredentials;
    if (!creds) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "credentials required");
    }
    const general = await repo.getGeneralSetting();
    if (general.disallowPasswordAuth) {
      return jsonError(c, GrpcCode.FAILED_PRECONDITION, "password auth disabled");
    }
    if (!deps.demo) await repo.ensureSecretKey();
    const user = await repo.getUser(creds.username);
    if (!user) {
      return jsonError(c, GrpcCode.UNAUTHENTICATED, "invalid username or password");
    }
    const ok = await verifyPassword(creds.password, user.password_hash);
    if (!ok) {
      return jsonError(c, GrpcCode.UNAUTHENTICATED, "invalid username or password");
    }
    const jwtSecret = deps.demo ? "usememos" : (await repo.getSecretKey())!;
    const userId = await repo.getUserInternalId(user.username);
    if (userId == null) {
      return jsonError(c, GrpcCode.UNAUTHENTICATED, "invalid username or password");
    }
    const { token, expiresAt } = await signAccessToken({
      secret: jwtSecret,
      userId,
      username: user.username,
      role: user.role === "ADMIN" ? "ADMIN" : "USER",
      status: user.state === "ARCHIVED" ? "ARCHIVED" : "NORMAL",
    });
    const tokenId = crypto.randomUUID();
    const { token: refreshJwt, expiresAt: refreshExp } = await signRefreshToken({
      secret: jwtSecret,
      userId,
      tokenId,
    });
    await repo.addRefreshSession({
      username: user.username,
      tokenId,
      expiresAt: refreshExp,
      createdAt: new Date(),
    });
    const origin = c.req.header("origin") ?? "";
    const secure = origin.startsWith("https://");
    c.header(
      "Set-Cookie",
      buildRefreshCookie(refreshJwt, refreshExp, secure),
    );
    return c.json({
      user: userToJson(user, authPrincipalFromUserRow(user)),
      accessToken: token,
      accessTokenExpiresAt: expiresAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
    });
  });

  r.post("/signout", async (c) => {
    const auth = c.get("auth");
    if (!auth) {
      return jsonError(c, GrpcCode.UNAUTHENTICATED, "permission denied");
    }
    const cookies = parseCookieHeader(c.req.header("cookie"));
    const raw = cookies[REFRESH_COOKIE_NAME];
    const jwtSecret = deps.demo ? "usememos" : (await repo.getSecretKey())!;
    const vr = raw ? await verifyRefreshToken(raw, jwtSecret) : null;
    if (vr) {
      const u = await repo.getUserByInternalId(vr.userId);
      if (u) await repo.deleteRefreshToken(u.username, vr.tokenId);
    }
    await repo.deleteRefreshSessionsForUser(auth.username);
    const origin = c.req.header("origin") ?? "";
    const secure = origin.startsWith("https://");
    c.header(
      "Set-Cookie",
      buildRefreshCookie("", null, secure),
    );
    return c.json({});
  });

  r.post("/refresh", async (c) => {
    const cookies = parseCookieHeader(c.req.header("cookie"));
    const raw = cookies[REFRESH_COOKIE_NAME];
    if (!raw) {
      return jsonError(c, GrpcCode.UNAUTHENTICATED, "missing refresh token");
    }
    const jwtSecret = deps.demo ? "usememos" : (await repo.getSecretKey())!;
    const vr = await verifyRefreshToken(raw, jwtSecret);
    if (!vr) {
      return jsonError(c, GrpcCode.UNAUTHENTICATED, "invalid refresh token");
    }
    const rec = await repo.getRefreshTokenRecord(vr.userId, vr.tokenId);
    if (!rec) {
      return jsonError(c, GrpcCode.UNAUTHENTICATED, "invalid refresh token");
    }
    if (new Date(rec.expires_at_iso).getTime() < Date.now()) {
      await repo.deleteRefreshToken(rec.username, vr.tokenId);
      return jsonError(c, GrpcCode.UNAUTHENTICATED, "refresh token expired");
    }
    const user = await repo.getUser(rec.username);
    if (!user) {
      return jsonError(c, GrpcCode.UNAUTHENTICATED, "user not found");
    }
    const { token, expiresAt } = await signAccessToken({
      secret: jwtSecret,
      userId: vr.userId,
      username: user.username,
      role: user.role === "ADMIN" ? "ADMIN" : "USER",
      status: user.state === "ARCHIVED" ? "ARCHIVED" : "NORMAL",
    });
    const newTokenId = crypto.randomUUID();
    await repo.deleteRefreshToken(rec.username, vr.tokenId);
    const { token: newRefreshJwt, expiresAt: newRefreshExp } = await signRefreshToken({
      secret: jwtSecret,
      userId: vr.userId,
      tokenId: newTokenId,
    });
    await repo.addRefreshSession({
      username: rec.username,
      tokenId: newTokenId,
      expiresAt: newRefreshExp,
      createdAt: new Date(),
    });
    const origin = c.req.header("origin") ?? "";
    const secure = origin.startsWith("https://");
    c.header(
      "Set-Cookie",
      buildRefreshCookie(newRefreshJwt, newRefreshExp, secure),
    );
    return c.json({
      accessToken: token,
      expiresAt: expiresAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
    });
  });

  return r;
}
