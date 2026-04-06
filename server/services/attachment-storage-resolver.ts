import type { AppDeps } from "../types/deps.js";
import { AttachmentStorageConfigError, type AttachmentStorage } from "./attachment-storage.js";
import {
  createDbAttachmentStorage,
  createR2AttachmentStorage,
  createS3AttachmentStorage,
} from "./attachment-storage-r2.js";
import type { InstanceStorageSetting } from "../lib/instance-storage-setting.js";

export async function resolveAttachmentStorage(
  deps: AppDeps,
  setting: InstanceStorageSetting,
): Promise<AttachmentStorage> {
  if (setting.storageType === "DB") {
    return createDbAttachmentStorage();
  }
  if (setting.storageType === "LOCAL") {
    if (!deps.attachmentDataDir) {
      throw new AttachmentStorageConfigError(
        "LOCAL storage is not supported in this runtime",
      );
    }
    // Keep LOCAL backend fully out of Worker bundle graph.
    const modulePath = ["./attachment-storage-node-fs", ".js"].join("");
    const loadModule = new Function(
      "p",
      "return import(p)",
    ) as (p: string) => Promise<{
      createNodeFsAttachmentStorage: (dataDir: string) => AttachmentStorage;
    }>;
    const { createNodeFsAttachmentStorage } = await loadModule(modulePath);
    return createNodeFsAttachmentStorage(deps.attachmentDataDir);
  }
  if (setting.storageType === "R2") {
    if (!deps.attachmentR2Bucket) {
      throw new AttachmentStorageConfigError(
        "R2 storage requires MEMOS_ATTACHMENTS binding",
      );
    }
    return createR2AttachmentStorage(deps.attachmentR2Bucket);
  }
  if (!setting.s3Config) {
    throw new AttachmentStorageConfigError("S3 storage requires s3Config in STORAGE setting");
  }
  return createS3AttachmentStorage({
    endpoint: setting.s3Config.endpoint,
    region: setting.s3Config.region || "auto",
    bucket: setting.s3Config.bucket,
    accessKeyId: setting.s3Config.accessKeyId,
    secretAccessKey: setting.s3Config.accessKeySecret,
    forcePathStyle: setting.s3Config.usePathStyle,
  });
}

