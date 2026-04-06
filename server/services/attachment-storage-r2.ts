import type { S3ClientConfig } from "@aws-sdk/client-s3";
import {
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  AttachmentStorage,
  AttachmentStorageMode,
  PutAttachmentInput,
  StoredAttachmentObject,
} from "./attachment-storage.js";
import { AttachmentStorageConfigError } from "./attachment-storage.js";

function objectKeyFor(id: string, filename: string): string {
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  return `attachments/${id.slice(0, 2)}/${id}${ext}`;
}

export function createDbAttachmentStorage(): AttachmentStorage {
  return {
    mode: "DB",
    async put(input: PutAttachmentInput): Promise<StoredAttachmentObject> {
      return {
        storageType: "DB",
        reference: "",
        blob: input.content,
      };
    },
    async get(): Promise<Uint8Array<ArrayBufferLike> | null> {
      return null;
    },
    async delete(): Promise<void> {
      // No-op, blob is deleted with DB row.
    },
  };
}

export function createR2AttachmentStorage(bucket: R2Bucket): AttachmentStorage {
  return {
    mode: "R2",
    async put(input: PutAttachmentInput): Promise<StoredAttachmentObject> {
      const key = objectKeyFor(input.id, input.filename);
      await bucket.put(key, input.content, { httpMetadata: { contentType: input.mimeType } });
      return {
        storageType: "R2",
        reference: key,
        blob: null,
        payload: {
          r2Object: {
            key,
            lastWrittenAt: new Date().toISOString(),
          },
        },
      };
    },
    async get(reference: string): Promise<Uint8Array<ArrayBufferLike> | null> {
      if (!reference) return null;
      const obj = await bucket.get(reference);
      if (!obj) return null;
      const ab = await obj.arrayBuffer();
      return new Uint8Array(ab);
    },
    async delete(reference: string): Promise<void> {
      if (!reference) return;
      await bucket.delete(reference);
    },
  };
}

export function createS3AttachmentStorage(config: {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
  forcePathStyle?: boolean;
}): AttachmentStorage {
  if (
    !config.endpoint ||
    !config.region ||
    !config.bucket ||
    !config.accessKeyId ||
    !config.secretAccessKey
  ) {
    throw new AttachmentStorageConfigError(
      "S3 mode requires MEMOS_S3_ENDPOINT, MEMOS_S3_REGION, MEMOS_S3_BUCKET, MEMOS_S3_ACCESS_KEY_ID, MEMOS_S3_SECRET_ACCESS_KEY",
    );
  }
  const clientConfig: S3ClientConfig = {
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle ?? true,
  };
  const s3 = new S3Client(clientConfig);

  function keyFromReference(reference: string): string {
    if (!reference) return "";
    if (!reference.startsWith("http://") && !reference.startsWith("https://")) {
      return reference;
    }
    try {
      const u = new URL(reference);
      let key = u.pathname.replace(/^\/+/, "");
      if (config.forcePathStyle !== false) {
        const bucketPrefix = `${config.bucket}/`;
        if (key.startsWith(bucketPrefix)) {
          key = key.slice(bucketPrefix.length);
        }
      }
      return decodeURIComponent(key);
    } catch {
      return reference.replace(/^https?:\/\/[^/]+\//, "").split("?")[0] ?? "";
    }
  }

  return {
    mode: "S3",
    async put(input: PutAttachmentInput): Promise<StoredAttachmentObject> {
      const key = objectKeyFor(input.id, input.filename);
      await s3.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: input.content,
          ContentType: input.mimeType,
        }),
      );
      let ref = "";
      if (config.publicBaseUrl) {
        ref = `${config.publicBaseUrl.replace(/\/$/, "")}/${key}`;
      } else {
        try {
          ref = await getSignedUrl(
            s3,
            new GetObjectCommand({
              Bucket: config.bucket,
              Key: key,
            }),
            { expiresIn: 3600 },
          );
        } catch {
          ref = key;
        }
      }
      return {
        storageType: "S3" as AttachmentStorageMode,
        reference: ref,
        blob: null,
        payload: {
          s3Object: {
            key,
            endpoint: config.endpoint,
            region: config.region,
            bucket: config.bucket,
            usePathStyle: config.forcePathStyle ?? true,
            lastPresignedTime: new Date().toISOString(),
          },
        },
      };
    },
    async get(reference: string): Promise<Uint8Array<ArrayBufferLike> | null> {
      if (!reference) return null;
      const key = keyFromReference(reference);
      const res = await s3.send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: key,
        }),
      );
      if (!res.Body) return null;
      const arr = await res.Body.transformToByteArray();
      return new Uint8Array(arr);
    },
    async delete(reference: string): Promise<void> {
      if (!reference) return;
      const key = keyFromReference(reference);
      await s3.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: key,
        }),
      );
    },
  };
}

