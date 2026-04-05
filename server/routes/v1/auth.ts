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
import { randomTokenHex, sha256Hex } from "../../services/crypto-util.js";
import { buildRefreshCookie, parseCookieHeader, REFRESH_COOKIE_NAME } from "../../lib/cookies.js";
import { userToJson } from "../../lib/serializers.js";

const REFRESH_DAYS = 30;

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
    return c.json({ user: userToJson(user) });
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
    const { token, expiresAt } = await signAccessToken({
      secret: jwtSecret,
      username: user.username,
      role: user.role === "ADMIN" ? "ADMIN" : "USER",
    });
    const refreshRaw = randomTokenHex(32);
    const refreshHash = await sha256Hex(refreshRaw);
    const sessionId = crypto.randomUUID();
    const exp = new Date();
    exp.setDate(exp.getDate() + REFRESH_DAYS);
    await repo.addRefreshSession({
      id: sessionId,
      username: user.username,
      tokenHash: refreshHash,
      expiresAt: exp.toISOString(),
    });
    const origin = c.req.header("origin") ?? "";
    const secure = origin.startsWith("https://");
    c.header(
      "Set-Cookie",
      buildRefreshCookie(refreshRaw, exp, secure),
    );
    return c.json({
      user: userToJson(user),
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
    if (raw) {
      const h = await sha256Hex(raw);
      const row = await repo.getRefreshByHash(h);
      if (row) await repo.deleteRefreshSession(row.id);
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
    const h = await sha256Hex(raw);
    const row = await repo.getRefreshByHash(h);
    if (!row) {
      return jsonError(c, GrpcCode.UNAUTHENTICATED, "invalid refresh token");
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await repo.deleteRefreshSession(row.id);
      return jsonError(c, GrpcCode.UNAUTHENTICATED, "refresh token expired");
    }
    const user = await repo.getUser(row.username);
    if (!user) {
      return jsonError(c, GrpcCode.UNAUTHENTICATED, "user not found");
    }
    const jwtSecret = deps.demo ? "usememos" : (await repo.getSecretKey())!;
    const { token, expiresAt } = await signAccessToken({
      secret: jwtSecret,
      username: user.username,
      role: user.role === "ADMIN" ? "ADMIN" : "USER",
    });
    const newRefresh = randomTokenHex(32);
    const newHash = await sha256Hex(newRefresh);
    const newExp = new Date();
    newExp.setDate(newExp.getDate() + REFRESH_DAYS);
    await repo.deleteRefreshSession(row.id);
    await repo.addRefreshSession({
      id: crypto.randomUUID(),
      username: user.username,
      tokenHash: newHash,
      expiresAt: newExp.toISOString(),
    });
    const origin = c.req.header("origin") ?? "";
    const secure = origin.startsWith("https://");
    c.header(
      "Set-Cookie",
      buildRefreshCookie(newRefresh, newExp, secure),
    );
    return c.json({
      accessToken: token,
      expiresAt: expiresAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
    });
  });

  return r;
}
