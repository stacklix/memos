import { create } from "@bufbuild/protobuf";
import { attachmentServiceClient } from "@/connect";
import { AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";
import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import type { LocalFile } from "../types/attachment";

export const uploadService = {
  async uploadFiles(localFiles: LocalFile[]): Promise<Attachment[]> {
    const uploaded: Attachment[] = [];
    for (const local of localFiles) {
      const file = local.file;
      const content = new Uint8Array(await file.arrayBuffer());
      const created = await attachmentServiceClient.createAttachment({
        attachment: create(AttachmentSchema, {
          filename: file.name,
          content,
          type: file.type || "application/octet-stream",
        }),
      });
      uploaded.push(created);
    }
    return uploaded;
  },
};
