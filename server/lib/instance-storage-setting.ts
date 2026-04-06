import type { AttachmentStorageMode } from "../services/attachment-storage.js";

export const DEFAULT_FILEPATH_TEMPLATE = "assets/{timestamp}_{uuid}_{filename}";
export const DEFAULT_UPLOAD_SIZE_LIMIT_MB = 30;

export type InstanceStorageSetting = {
  storageType: AttachmentStorageMode;
  filepathTemplate: string;
  uploadSizeLimitMb: number;
  s3Config?: {
    accessKeyId: string;
    accessKeySecret: string;
    endpoint: string;
    region: string;
    bucket: string;
    usePathStyle: boolean;
  };
};

export function parseInstanceStorageSetting(
  raw: string | null,
  defaultStorageType: AttachmentStorageMode,
): InstanceStorageSetting {
  const base: InstanceStorageSetting = {
    storageType: defaultStorageType,
    filepathTemplate: DEFAULT_FILEPATH_TEMPLATE,
    uploadSizeLimitMb: DEFAULT_UPLOAD_SIZE_LIMIT_MB,
  };
  if (!raw) return base;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const stRaw = String(j.storageType ?? "STORAGE_TYPE_UNSPECIFIED");
    const mapped =
      stRaw === "DATABASE"
        ? "DB"
        : stRaw === "LOCAL"
          ? "LOCAL"
          : stRaw === "S3"
            ? "S3"
            : stRaw === "R2"
              ? "R2"
              : defaultStorageType;
    const out: InstanceStorageSetting = {
      storageType: mapped,
      filepathTemplate:
        typeof j.filepathTemplate === "string" && j.filepathTemplate.trim() !== ""
          ? j.filepathTemplate
          : DEFAULT_FILEPATH_TEMPLATE,
      uploadSizeLimitMb:
        typeof j.uploadSizeLimitMb === "number" && Number.isFinite(j.uploadSizeLimitMb)
          ? j.uploadSizeLimitMb
          : DEFAULT_UPLOAD_SIZE_LIMIT_MB,
    };
    if (j.s3Config && typeof j.s3Config === "object") {
      const s = j.s3Config as Record<string, unknown>;
      out.s3Config = {
        accessKeyId: String(s.accessKeyId ?? ""),
        accessKeySecret: String(s.accessKeySecret ?? ""),
        endpoint: String(s.endpoint ?? ""),
        region: String(s.region ?? ""),
        bucket: String(s.bucket ?? ""),
        usePathStyle: s.usePathStyle !== false,
      };
    }
    return out;
  } catch {
    return base;
  }
}

export function storageSettingToApiJson(
  setting: InstanceStorageSetting,
  includeSecret: boolean,
) {
  const storageType =
    setting.storageType === "DB"
      ? "DATABASE"
      : setting.storageType === "LOCAL"
        ? "LOCAL"
        : setting.storageType === "S3"
          ? "S3"
          : "R2";
  return {
    storageType,
    filepathTemplate: setting.filepathTemplate,
    uploadSizeLimitMb: setting.uploadSizeLimitMb,
    ...(setting.s3Config
      ? {
          s3Config: {
            accessKeyId: setting.s3Config.accessKeyId,
            accessKeySecret: includeSecret ? setting.s3Config.accessKeySecret : "",
            endpoint: setting.s3Config.endpoint,
            region: setting.s3Config.region,
            bucket: setting.s3Config.bucket,
            usePathStyle: setting.s3Config.usePathStyle,
          },
        }
      : {}),
  };
}

