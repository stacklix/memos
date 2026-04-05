import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import type { LocalFile } from "../types/attachment";

/** File uploads / AttachmentService are not implemented server-side. */
export const uploadService = {
  async uploadFiles(_localFiles: LocalFile[]): Promise<Attachment[]> {
    return [];
  },
};
