export type AttachmentStorageMode = "LOCAL" | "DB" | "S3" | "R2";

export type StoredAttachmentObject = {
  storageType: AttachmentStorageMode;
  reference: string;
  blob: Uint8Array<ArrayBufferLike> | null;
  payload?: Record<string, unknown>;
};

export type PutAttachmentInput = {
  id: string;
  filename: string;
  content: Uint8Array<ArrayBufferLike>;
  mimeType: string;
};

export interface AttachmentStorage {
  mode: AttachmentStorageMode;
  put(input: PutAttachmentInput): Promise<StoredAttachmentObject>;
  get(reference: string): Promise<Uint8Array<ArrayBufferLike> | null>;
  delete(reference: string): Promise<void>;
}

export class AttachmentStorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentStorageConfigError";
  }
}

export function parseAttachmentStorageMode(
  raw: string | undefined,
  fallback: AttachmentStorageMode,
): AttachmentStorageMode {
  if (!raw || raw.trim() === "") return fallback;
  const value = raw.trim().toUpperCase();
  if (value === "LOCAL" || value === "DB" || value === "S3" || value === "R2") {
    return value;
  }
  throw new AttachmentStorageConfigError(
    "MEMOS_ATTACHMENT_STORAGE must be one of LOCAL, DB, S3, R2",
  );
}

