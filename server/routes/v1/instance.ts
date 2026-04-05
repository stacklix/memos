import { Hono } from "hono";
import type { ApiVariables } from "../../types/api-variables.js";
import type { AppDeps } from "../../types/deps.js";
import { createRepository } from "../../db/repository.js";
import { GrpcCode, jsonError } from "../../lib/grpc-status.js";
import { userToJson } from "../../lib/serializers.js";

const DEFAULT_MEMO_RELATED = {
  displayWithUpdateTime: false,
  contentLengthLimit: 0,
  enableDoubleClickEdit: false,
  reactions: [] as string[],
};

function parseMemoRelatedFromRaw(raw: string | null): typeof DEFAULT_MEMO_RELATED {
  if (!raw) return { ...DEFAULT_MEMO_RELATED };
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const reactions = Array.isArray(j.reactions)
      ? j.reactions.filter((x): x is string => typeof x === "string")
      : [];
    return {
      displayWithUpdateTime: Boolean(j.displayWithUpdateTime),
      contentLengthLimit: typeof j.contentLengthLimit === "number" ? j.contentLengthLimit : 0,
      enableDoubleClickEdit: Boolean(j.enableDoubleClickEdit),
      reactions,
    };
  } catch {
    return { ...DEFAULT_MEMO_RELATED };
  }
}

function parseTagsFromRaw(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw) as { tags?: Record<string, unknown> };
    if (j.tags && typeof j.tags === "object" && !Array.isArray(j.tags)) return j.tags;
  } catch {
    /* ignore */
  }
  return {};
}

export function createInstanceRoutes(deps: AppDeps) {
  const r = new Hono<{ Variables: ApiVariables }>();
  const repo = createRepository(deps.sql);

  r.get("/profile", async (c) => {
    if (!deps.demo) await repo.ensureSecretKey();
    const admin = await repo.findAdmin();
    return c.json({
      version: deps.instanceVersion,
      demo: deps.demo,
      instanceUrl: deps.instanceUrl,
      admin: admin ? userToJson(admin) : null,
    });
  });

  r.get("/settings/*", async (c) => {
    const pathname = new URL(c.req.url).pathname;
    const key = pathname.split("/instance/settings/")[1]?.split("/")[0];
    if (!key) return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid setting name");
    const general = await repo.getGeneralSetting();
    if (key === "GENERAL") {
      return c.json({
        name: `instance/settings/${key}`,
        generalSetting: {
          disallowUserRegistration: general.disallowUserRegistration,
          disallowPasswordAuth: general.disallowPasswordAuth,
          additionalScript: "",
          additionalStyle: "",
          customProfile: { title: "", description: "", logoUrl: "" },
          weekStartDayOffset: 0,
          disallowChangeUsername: false,
          disallowChangeNickname: false,
        },
      });
    }
    if (key === "STORAGE") {
      return c.json({
        name: `instance/settings/${key}`,
        storageSetting: {
          storageType: "DATABASE",
          filepathTemplate: "",
          uploadSizeLimitMb: 0,
        },
      });
    }
    if (key === "MEMO_RELATED") {
      const memoRelatedSetting = parseMemoRelatedFromRaw(await repo.getInstanceSettingRaw("MEMO_RELATED"));
      return c.json({
        name: `instance/settings/${key}`,
        memoRelatedSetting,
      });
    }
    if (key === "TAGS") {
      const tags = parseTagsFromRaw(await repo.getInstanceSettingRaw("TAGS"));
      return c.json({
        name: `instance/settings/${key}`,
        tagsSetting: { tags },
      });
    }
    if (key === "NOTIFICATION") {
      return c.json({
        name: `instance/settings/${key}`,
        notificationSetting: {
          email: {
            enabled: false,
            smtpHost: "",
            smtpPort: 0,
            smtpUsername: "",
            smtpPassword: "",
            fromEmail: "",
            fromName: "",
            replyTo: "",
            useTls: false,
          },
        },
      });
    }
    return jsonError(c, GrpcCode.NOT_FOUND, "setting not found");
  });

  r.patch("/settings/*", async (c) => {
    const auth = c.get("auth");
    if (!auth || auth.role !== "ADMIN") {
      return jsonError(c, GrpcCode.PERMISSION_DENIED, "admin only");
    }
    const pathname = new URL(c.req.url).pathname;
    const key = pathname.split("/instance/settings/")[1]?.split("/")[0];
    if (!key) return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid setting name");
    if (!["GENERAL", "MEMO_RELATED", "TAGS"].includes(key)) {
      return jsonError(c, GrpcCode.UNIMPLEMENTED, "this setting cannot be updated via API yet");
    }
    type Body = {
      setting?: {
        generalSetting?: {
          disallowUserRegistration?: boolean;
          disallowPasswordAuth?: boolean;
        };
        memoRelatedSetting?: {
          displayWithUpdateTime?: boolean;
          contentLengthLimit?: number;
          enableDoubleClickEdit?: boolean;
          reactions?: unknown;
        };
        tagsSetting?: { tags?: unknown };
      };
    };
    let body: Body;
    try {
      body = (await c.req.json()) as Body;
    } catch {
      return jsonError(c, GrpcCode.INVALID_ARGUMENT, "invalid json");
    }

    if (key === "GENERAL") {
      const gs = body.setting?.generalSetting;
      if (!gs) {
        return jsonError(c, GrpcCode.INVALID_ARGUMENT, "setting.generalSetting required");
      }
      await repo.upsertGeneralSetting({
        disallowUserRegistration: gs.disallowUserRegistration,
        disallowPasswordAuth: gs.disallowPasswordAuth,
      });
      const g = await repo.getGeneralSetting();
      return c.json({
        name: `instance/settings/GENERAL`,
        generalSetting: {
          disallowUserRegistration: g.disallowUserRegistration,
          disallowPasswordAuth: g.disallowPasswordAuth,
          additionalScript: "",
          additionalStyle: "",
          customProfile: { title: "", description: "", logoUrl: "" },
          weekStartDayOffset: 0,
          disallowChangeUsername: false,
          disallowChangeNickname: false,
        },
      });
    }

    if (key === "MEMO_RELATED") {
      const mr = body.setting?.memoRelatedSetting;
      if (!mr) {
        return jsonError(c, GrpcCode.INVALID_ARGUMENT, "setting.memoRelatedSetting required");
      }
      const reactions = Array.isArray(mr.reactions)
        ? mr.reactions.filter((x): x is string => typeof x === "string")
        : [];
      if (reactions.length === 0) {
        return jsonError(c, GrpcCode.INVALID_ARGUMENT, "reactions must be non-empty");
      }
      const next = {
        displayWithUpdateTime: Boolean(mr.displayWithUpdateTime),
        contentLengthLimit: typeof mr.contentLengthLimit === "number" ? mr.contentLengthLimit : 0,
        enableDoubleClickEdit: Boolean(mr.enableDoubleClickEdit),
        reactions,
      };
      await repo.upsertInstanceSettingRaw("MEMO_RELATED", JSON.stringify(next));
      return c.json({
        name: `instance/settings/MEMO_RELATED`,
        memoRelatedSetting: next,
      });
    }

    if (key === "TAGS") {
      const ts = body.setting?.tagsSetting;
      if (!ts || typeof ts !== "object") {
        return jsonError(c, GrpcCode.INVALID_ARGUMENT, "setting.tagsSetting required");
      }
      const tags = (ts as { tags?: unknown }).tags;
      if (!tags || typeof tags !== "object" || Array.isArray(tags)) {
        return jsonError(c, GrpcCode.INVALID_ARGUMENT, "tagsSetting.tags must be an object");
      }
      await repo.upsertInstanceSettingRaw("TAGS", JSON.stringify({ tags }));
      return c.json({
        name: `instance/settings/TAGS`,
        tagsSetting: { tags: tags as Record<string, unknown> },
      });
    }

    return jsonError(c, GrpcCode.INTERNAL, "unreachable");
  });

  return r;
}
