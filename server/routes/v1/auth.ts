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
import { hashPassword } from "../../services/password.js";
import { signAccessToken } from "../../services/jwt-access.js";
import { signRefreshToken, verifyRefreshToken } from "../../services/jwt-refresh.js";
import { buildRefreshCookie, parseCookieHeader, REFRESH_COOKIE_NAME } from "../../lib/cookies.js";
import { authPrincipalFromUserRow, userToJson } from "../../lib/serializers.js";
import {
  exchangeOAuth2Token,
  fetchOAuth2UserInfo,
  parseOAuth2Config,
} from "../../services/oauth2-idp.js";

function extractIdentityProviderUid(name: string): string | null {
  const prefix = "identity-providers/";
  if (!name.startsWith(prefix)) return null;
  const uid = name.slice(prefix.length).trim();
  if (!uid || !/^[a-z0-9][a-z0-9-]{0,31}$/i.test(uid)) return null;
  return uid;
}

function randomPassword(length: number): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

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
    let user = null;
    if (body.passwordCredentials) {
      const creds = body.passwordCredentials;
      const general = await repo.getGeneralSetting();
      if (general.disallowPasswordAuth) {
        return jsonError(c, GrpcCode.FAILED_PRECONDITION, "password auth disabled");
      }
      user = await repo.getUser(creds.username);
      if (!user) {
        return jsonError(c, GrpcCode.UNAUTHENTICATED, "invalid username or password");
      }
      const ok = await verifyPassword(creds.password, user.password_hash);
      if (!ok) {
        return jsonError(c, GrpcCode.UNAUTHENTICATED, "invalid username or password");
      }
    } else if (body.ssoCredentials) {
      const sso = body.ssoCredentials;
      const uid = extractIdentityProviderUid(sso.idpName);
      if (!uid) {
        return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid identity provider name");
      }
      const provider = await repo.getIdentityProviderByUid(uid);
      if (!provider) {
        return jsonError(c, GrpcCode.INVALID_ARGUMENT, "identity provider not found");
      }
      if (provider.type !== "OAUTH2") {
        return jsonError(c, GrpcCode.INVALID_ARGUMENT, "unsupported identity provider type");
      }
      let providerConfig: unknown = {};
      try {
        providerConfig = JSON.parse(provider.config);
      } catch {
        return jsonError(c, GrpcCode.INTERNAL, "invalid identity provider config");
      }
      const oauth2Config = parseOAuth2Config(providerConfig);
      if (!oauth2Config) {
        return jsonError(c, GrpcCode.INTERNAL, "invalid identity provider config");
      }
      let oauthAccessToken = "";
      try {
        oauthAccessToken = await exchangeOAuth2Token({
          config: oauth2Config,
          redirectUri: sso.redirectUri,
          code: sso.code,
          codeVerifier: sso.codeVerifier,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "failed to exchange token";
        return jsonError(c, GrpcCode.INTERNAL, message);
      }
      let userInfo: {
        identifier: string;
        displayName: string;
        email: string;
        avatarUrl: string;
      };
      try {
        userInfo = await fetchOAuth2UserInfo({
          config: oauth2Config,
          accessToken: oauthAccessToken,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "failed to get user info";
        return jsonError(c, GrpcCode.INTERNAL, message);
      }
      if (provider.identifier_filter) {
        let regex: RegExp;
        try {
          regex = new RegExp(provider.identifier_filter);
        } catch {
          return jsonError(c, GrpcCode.INTERNAL, "invalid identity provider identifier filter");
        }
        if (!regex.test(userInfo.identifier)) {
          return jsonError(c, GrpcCode.PERMISSION_DENIED, "identifier is not allowed");
        }
      }
      user = await repo.getUser(userInfo.identifier);
      if (!user) {
        const general = await repo.getGeneralSetting();
        if (general.disallowUserRegistration) {
          return jsonError(c, GrpcCode.PERMISSION_DENIED, "user registration is not allowed");
        }
        const passwordHash = await hashPassword(randomPassword(20));
        user = await repo.createUser({
          username: userInfo.identifier,
          passwordHash,
          role: "USER",
          displayName: userInfo.displayName,
          email: userInfo.email,
        });
        if (userInfo.avatarUrl) {
          await repo.updateUser(user.username, { avatar_url: userInfo.avatarUrl });
          user = await repo.getUser(user.username);
        }
      }
    } else {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "credentials required");
    }
    if (!user) return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid credentials");
    if (!deps.demo) await repo.ensureSecretKey();
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
