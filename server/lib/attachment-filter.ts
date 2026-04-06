export type ParsedAttachmentFilter = {
  unlinkedOnly?: boolean;
  linkedOnly?: boolean;
  memoUid?: string;
};

export function parseAttachmentFilter(rawFilter: string): ParsedAttachmentFilter {
  const filter = rawFilter.trim();
  if (!filter) return {};
  if (filter === "memo_id == null" || filter === "memo == null") {
    return { unlinkedOnly: true };
  }
  if (filter === "memo_id != null" || filter === "memo != null") {
    return { linkedOnly: true };
  }
  const byMemo = filter.match(/^memo(_id)?\s*==\s*"memos\/([^"]+)"$/);
  if (byMemo) {
    return { memoUid: byMemo[2] };
  }
  throw new Error("unsupported filter expression");
}
