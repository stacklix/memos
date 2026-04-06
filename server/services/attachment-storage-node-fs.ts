import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type {
  AttachmentStorage,
  PutAttachmentInput,
  StoredAttachmentObject,
} from "./attachment-storage.js";

function safeExt(filename: string): string {
  const ext = extname(filename || "");
  return ext && ext.length <= 10 ? ext : "";
}

export function createNodeFsAttachmentStorage(dataDir: string): AttachmentStorage {
  const root = join(dataDir, "attachments");
  return {
    mode: "LOCAL",
    async put(input: PutAttachmentInput): Promise<StoredAttachmentObject> {
      const ext = safeExt(input.filename);
      const rel = join(input.id.slice(0, 2), `${input.id}${ext}`).replaceAll("\\", "/");
      const abs = join(root, rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, Buffer.from(input.content));
      return {
        storageType: "LOCAL",
        reference: rel,
        blob: null,
      };
    },
    async get(reference: string): Promise<Uint8Array<ArrayBufferLike> | null> {
      if (!reference) return null;
      const abs = join(root, reference);
      try {
        const buf = await readFile(abs);
        return new Uint8Array(buf);
      } catch {
        return null;
      }
    },
    async delete(reference: string): Promise<void> {
      if (!reference) return;
      const abs = join(root, reference);
      try {
        await unlink(abs);
      } catch {
        // Ignore missing files to keep delete idempotent.
      }
    },
  };
}

