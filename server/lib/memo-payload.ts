/**
 * JSON shape for golang `memos.store.MemoPayload` (protojson, camelCase field names).
 * See `golang:proto/store/memo.proto`.
 */
import { extractTags } from "../services/markdown.js";
import { deriveMemoProperty } from "../services/memo-content-props.js";

export type MemoPayloadGolang = {
  property?: {
    hasLink: boolean;
    hasTaskList: boolean;
    hasCode: boolean;
    hasIncompleteTasks: boolean;
    title: string;
  };
  location?: {
    placeholder: string;
    latitude: number;
    longitude: number;
  };
  tags?: string[];
};

export function parseMemoPayloadGolang(raw: string): MemoPayloadGolang {
  try {
    const j = JSON.parse(raw) as MemoPayloadGolang;
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

/** Aligns with golang `memopayload.RebuildMemoPayload` (tags + property from markdown). */
export function rebuildMemoPayloadFromContent(
  content: string,
): Pick<MemoPayloadGolang, "property" | "tags"> {
  const tags = extractTags(content);
  const p = deriveMemoProperty(content);
  return {
    tags,
    property: {
      hasLink: p.hasLink,
      hasTaskList: p.hasTaskList,
      hasCode: p.hasCode,
      hasIncompleteTasks: p.hasIncompleteTasks,
      title: p.title,
    },
  };
}

export function stringifyMemoPayload(p: MemoPayloadGolang): string {
  return JSON.stringify(p);
}

export function memoReactionContentId(memoUid: string): string {
  return `memos/${memoUid}`;
}
