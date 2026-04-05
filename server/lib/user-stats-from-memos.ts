import { extractTags } from "../services/markdown.js";
import { deriveMemoProperty } from "../services/memo-content-props.js";

export type MemoStatsRow = {
  id: string;
  content: string;
  display_time: string | null;
  create_time: string;
  update_time: string;
  pinned: number;
};

/**
 * Derive UserStats fields from top-level memo rows.
 * Heatmap timestamps follow golang: created_ts vs updated_ts via instance displayWithUpdateTime.
 */
export function userStatsFieldsFromMemoRows(
  rows: MemoStatsRow[],
  options?: { useUpdateTimeForHeatmap?: boolean },
) {
  const tagCount: Record<string, number> = {};
  const memoDisplayTimestamps: string[] = [];
  const memoTypeStats = { linkCount: 0, codeCount: 0, todoCount: 0, undoCount: 0 };
  const pinnedMemos: string[] = [];

  for (const row of rows) {
    for (const tag of extractTags(row.content)) {
      tagCount[tag] = (tagCount[tag] ?? 0) + 1;
    }
    const prop = deriveMemoProperty(row.content);
    if (prop.hasLink) memoTypeStats.linkCount++;
    if (prop.hasCode) memoTypeStats.codeCount++;
    if (prop.hasTaskList) memoTypeStats.todoCount++;
    if (prop.hasIncompleteTasks) memoTypeStats.undoCount++;

    if (row.pinned) pinnedMemos.push(`memos/${row.id}`);

    const heatmapIso = options?.useUpdateTimeForHeatmap ? row.update_time : row.create_time;
    if (heatmapIso) memoDisplayTimestamps.push(heatmapIso);
  }
  return {
    tagCount,
    memoDisplayTimestamps,
    totalMemoCount: rows.length,
    memoTypeStats,
    pinnedMemos,
  };
}
