import { Hono } from "hono";
import type { ApiVariables } from "../../types/api-variables.js";
import type { AppDeps } from "../../types/deps.js";
import { createRepository, type DbIdentityProviderRow } from "../../db/repository.js";
import { GrpcCode, jsonError } from "../../lib/grpc-status.js";
import { parseOAuth2Config } from "../../services/oauth2-idp.js";

const IDP_NAME_PREFIX = "identity-providers/";

function extractUidFromName(name: string): string | null {
  if (!name.startsWith(IDP_NAME_PREFIX)) return null;
  const uid = name.slice(IDP_NAME_PREFIX.length).trim();
  if (!uid) return null;
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/i.test(uid)) return null;
  return uid;
}

function parseIdpType(raw: unknown): "OAUTH2" | null {
  if (raw === 1 || raw === "OAUTH2") return "OAUTH2";
  return null;
}

function readOAuth2ConfigFromBody(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const cfg = raw as Record<string, unknown>;
  if (cfg.oauth2Config) return cfg.oauth2Config;
  if (
    cfg.config &&
    typeof cfg.config === "object" &&
    !Array.isArray(cfg.config)
  ) {
    const nested = cfg.config as Record<string, unknown>;
    if (nested.case === "oauth2Config" && nested.value) return nested.value;
    if (nested.oauth2Config) return nested.oauth2Config;
  }
  return null;
}

function normalizeIdentityProviderRow(row: DbIdentityProviderRow) {
  let parsedConfig: unknown = {};
  try {
    parsedConfig = JSON.parse(row.config);
  } catch {
    parsedConfig = {};
  }
  const oauth2 = parseOAuth2Config(parsedConfig);
  if (!oauth2) {
    return null;
  }
  return {
    name: `${IDP_NAME_PREFIX}${row.uid}`,
    type: "OAUTH2",
    title: row.name,
    identifierFilter: row.identifier_filter,
    config: {
      oauth2Config: oauth2,
    },
  };
}

export function createIdentityProviderRoutes(deps: AppDeps) {
  const r = new Hono<{ Variables: ApiVariables }>();
  const repo = createRepository(deps.sql);

  r.get("/", async (c) => {
    const rows = await repo.listIdentityProviders();
    const identityProviders = rows
      .map(normalizeIdentityProviderRow)
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return c.json({ identityProviders });
  });

  r.get("/:uid", async (c) => {
    const uid = c.req.param("uid");
    const row = await repo.getIdentityProviderByUid(uid);
    if (!row) return jsonError(c, GrpcCode.NOT_FOUND, "identity provider not found");
    const normalized = normalizeIdentityProviderRow(row);
    if (!normalized) return jsonError(c, GrpcCode.INTERNAL, "identity provider config is invalid");
    return c.json(normalized);
  });

  r.post("/", async (c) => {
    const auth = c.get("auth");
    if (!auth || auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "admin only");
    }
    let body: {
      identityProvider?: {
        title?: unknown;
        type?: unknown;
        identifierFilter?: unknown;
        config?: unknown;
      };
      identityProviderId?: unknown;
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid json");
    }
    const uid = typeof body.identityProviderId === "string" ? body.identityProviderId.trim() : "";
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/i.test(uid)) {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid identity provider id");
    }
    const idp = body.identityProvider;
    if (!idp) return jsonError(c, GrpcCode.INVALID_ARGUMENT, "identityProvider is required");
    const type = parseIdpType(idp.type);
    if (!type) return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid identity provider type");
    const oauth2Raw = readOAuth2ConfigFromBody(idp.config);
    const oauth2 = parseOAuth2Config(oauth2Raw);
    if (!oauth2) return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid oauth2 config");
    const title = typeof idp.title === "string" ? idp.title.trim() : "";
    if (!title) return jsonError(c, GrpcCode.INVALID_ARGUMENT, "identity provider title is required");
    const identifierFilter =
      typeof idp.identifierFilter === "string" ? idp.identifierFilter.trim() : "";
    if (identifierFilter) {
      try {
        // Validate regex early to match golang behavior.
        new RegExp(identifierFilter);
      } catch {
        return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid identifier filter");
      }
    }
    try {
      await repo.createIdentityProvider({
        uid,
        name: title,
        type,
        identifierFilter,
        configJson: JSON.stringify(oauth2),
      });
    } catch {
      return jsonError(c, GrpcCode.ALREADY_EXISTS, "identity provider already exists");
    }
    const created = await repo.getIdentityProviderByUid(uid);
    if (!created) return jsonError(c, GrpcCode.INTERNAL, "failed to create identity provider");
    const normalized = normalizeIdentityProviderRow(created);
    if (!normalized) return jsonError(c, GrpcCode.INTERNAL, "identity provider config is invalid");
    return c.json(normalized);
  });

  r.patch("/:uid", async (c) => {
    const auth = c.get("auth");
    if (!auth || auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "admin only");
    }
    const uid = c.req.param("uid");
    let body: {
      identityProvider?: {
        title?: unknown;
        type?: unknown;
        identifierFilter?: unknown;
        config?: unknown;
        name?: unknown;
      };
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid json");
    }
    const idp = body.identityProvider;
    if (!idp) return jsonError(c, GrpcCode.INVALID_ARGUMENT, "identityProvider is required");
    if (typeof idp.name === "string") {
      const requestedUid = extractUidFromName(idp.name);
      if (!requestedUid || requestedUid !== uid) {
        return jsonError(c, GrpcCode.INVALID_ARGUMENT, "identity provider name mismatch");
      }
    }
    const type = parseIdpType(idp.type);
    if (!type) return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid identity provider type");
    const oauth2Raw = readOAuth2ConfigFromBody(idp.config);
    const oauth2 = parseOAuth2Config(oauth2Raw);
    if (!oauth2) return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid oauth2 config");
    const title = typeof idp.title === "string" ? idp.title.trim() : "";
    if (!title) return jsonError(c, GrpcCode.INVALID_ARGUMENT, "identity provider title is required");
    const identifierFilter =
      typeof idp.identifierFilter === "string" ? idp.identifierFilter.trim() : "";
    if (identifierFilter) {
      try {
        new RegExp(identifierFilter);
      } catch {
        return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid identifier filter");
      }
    }
    const ok = await repo.updateIdentityProvider({
      uid,
      name: title,
      type,
      identifierFilter,
      configJson: JSON.stringify(oauth2),
    });
    if (!ok) return jsonError(c, GrpcCode.NOT_FOUND, "identity provider not found");
    const updated = await repo.getIdentityProviderByUid(uid);
    if (!updated) return jsonError(c, GrpcCode.NOT_FOUND, "identity provider not found");
    const normalized = normalizeIdentityProviderRow(updated);
    if (!normalized) return jsonError(c, GrpcCode.INTERNAL, "identity provider config is invalid");
    return c.json(normalized);
  });

  r.delete("/:uid", async (c) => {
    const auth = c.get("auth");
    if (!auth || auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "admin only");
    }
    const uid = c.req.param("uid");
    const ok = await repo.deleteIdentityProvider(uid);
    if (!ok) return jsonError(c, GrpcCode.NOT_FOUND, "identity provider not found");
    return c.json({});
  });

  return r;
}
