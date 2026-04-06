import { describe, expect, it } from "vitest";
import type { DbMemoRow } from "../../server/db/repository.js";
import {
  memoListFilterNeedsMemory,
  memoRowMatchesFilter,
  parseMemoListFilter,
} from "../../server/lib/memo-filter.js";

function row(partial: Partial<DbMemoRow> & Pick<DbMemoRow, "id" | "content">): DbMemoRow {
  const now = new Date().toISOString();
  return {
    id: partial.id,
    creator_username: partial.creator_username ?? "u",
    content: partial.content,
    visibility: partial.visibility ?? "PRIVATE",
    state: partial.state ?? "NORMAL",
    pinned: partial.pinned ?? 0,
    create_time: partial.create_time ?? now,
    update_time: partial.update_time ?? now,
    display_time: partial.display_time ?? null,
    snippet: partial.snippet ?? null,
    parent_memo_id: partial.parent_memo_id ?? null,
    deleted: partial.deleted ?? 0,
    location_latitude: partial.location_latitude ?? null,
    location_longitude: partial.location_longitude ?? null,
    location_placeholder: partial.location_placeholder ?? null,
    payload_tags: partial.payload_tags ?? [],
    payload_property: partial.payload_property ?? null,
  };
}

describe("memo-filter unit", () => {
  it("parseMemoListFilter extracts visibility, creator, tag, pinned, time range", () => {
    expect(parseMemoListFilter('visibility in ["PUBLIC", "PRIVATE"]').visibilityIn).toEqual([
      "PUBLIC",
      "PRIVATE",
    ]);
    expect(parseMemoListFilter('creator == "users/alice"').creatorResource).toBe("users/alice");
    expect(parseMemoListFilter('tag in ["t1"]').tagsIn).toEqual(["t1"]);
    expect(parseMemoListFilter("pinned").pinned).toBe(true);
    const timeF = parseMemoListFilter("created_ts >= 1000 && created_ts < 2000");
    expect(timeF.timeField).toBe("created");
    expect(timeF.timeStartSec).toBe(1000);
    expect(timeF.timeEndSec).toBe(2000);
    const combo = parseMemoListFilter('creator == "users/bob" && tag in ["x"]');
    expect(memoListFilterNeedsMemory(combo)).toBe(true);
  });

  it("memoRowMatchesFilter respects time window and pinned", () => {
    const t = 1500;
    const iso = new Date(t * 1000).toISOString();
    const r = row({
      id: "1",
      content: "#t1 hi",
      pinned: 1,
      create_time: iso,
      update_time: iso,
    });
    const p = parseMemoListFilter(
      `pinned && created_ts >= ${t - 1} && created_ts < ${t + 1} && tag in ["t1"]`,
    );
    expect(memoRowMatchesFilter(r, p)).toBe(true);
  });

  it("content.contains is parsed and needs memory", () => {
    const p = parseMemoListFilter('content.contains("needle")');
    expect(p.contentContains).toBe("needle");
    expect(memoListFilterNeedsMemory(p)).toBe(true);
  });
});
