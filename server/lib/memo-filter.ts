import type { DbMemoRow } from "../db/repository.js";
import { extractTags } from "../services/markdown.js";
import { contentHasCode, contentHasLink, contentHasTaskList } from "../services/memo-content-props.js";

/** Max memos scanned when a CEL-style filter requires in-memory matching. */
export const MEMO_FILTER_MAX_SCAN = 5000;

export type ParsedMemoListFilter = {
  creatorResource?: string;
  visibilityIn?: string[];
  pinned?: true;
  hasLink?: true;
  hasTaskList?: true;
  hasCode?: true;
  contentContains?: string;
  tagsIn?: string[];
  timeField?: "created" | "updated";
  /** Inclusive start, exclusive end, Unix seconds (same as frontend CEL). */
  timeStartSec?: number;
  timeEndSec?: number;
};

function stripTimeRangeClauses(filter: string): { rest: string; ranges: ParsedMemoListFilter[] } {
  const ranges: ParsedMemoListFilter[] = [];
  const re = /(created_ts|updated_ts)\s*>=\s*(\d+)\s*&&\s*\1\s*<\s*(\d+)/g;
  let rest = filter.replace(re, (_m, field: string, a: string, b: string) => {
    ranges.push({
      timeField: field === "updated_ts" ? "updated" : "created",
      timeStartSec: Number(a),
      timeEndSec: Number(b),
    });
    return " ";
  });
  rest = rest.replace(/\s+/g, " ").trim();
  return { rest, ranges };
}

function parseJsonValue<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Parse `GET /memos` filter string produced by the web client (CEL subset). */
export function parseMemoListFilter(filter: string | undefined | null): ParsedMemoListFilter {
  const out: ParsedMemoListFilter = {};
  if (!filter || !filter.trim()) return out;

  const { rest, ranges } = stripTimeRangeClauses(filter);
  if (ranges.length > 0) {
    const r = ranges[0]!;
    out.timeField = r.timeField;
    out.timeStartSec = r.timeStartSec;
    out.timeEndSec = r.timeEndSec;
  }

  const clauses = rest
    .split(" && ")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const c of clauses) {
    if (c === "pinned") {
      out.pinned = true;
    } else if (c === "has_link") {
      out.hasLink = true;
    } else if (c === "has_task_list") {
      out.hasTaskList = true;
    } else if (c === "has_code") {
      out.hasCode = true;
    } else {
      const visM = c.match(/^visibility in (\[[\s\S]*\])$/);
      if (visM) {
        const arr = parseJsonValue<string[]>(visM[1]!);
        if (arr?.length) out.visibilityIn = arr;
      } else {
        const tagM = c.match(/^tag in (\[[\s\S]*\])$/);
        if (tagM) {
          const arr = parseJsonValue<string[]>(tagM[1]!);
          if (arr?.length) out.tagsIn = arr;
        } else {
          const crM = c.match(/^creator == (.+)$/);
          if (crM) {
            const v = parseJsonValue<string>(crM[1]!.trim());
            if (v) out.creatorResource = v;
          } else {
            const ccM = c.match(/^content\.contains\(([\s\S]*)\)$/);
            if (ccM) {
              const inner = ccM[1]!.trim();
              const v = parseJsonValue<string>(inner);
              if (v !== null && v !== undefined) out.contentContains = v;
            }
          }
        }
      }
    }
  }

  return out;
}

export function memoListFilterNeedsMemory(p: ParsedMemoListFilter): boolean {
  return (
    p.contentContains !== undefined ||
    (p.tagsIn?.length ?? 0) > 0 ||
    Boolean(p.hasLink) ||
    Boolean(p.hasTaskList) ||
    Boolean(p.hasCode)
  );
}

function memoTimeSec(row: DbMemoRow, field: "created" | "updated"): number {
  const iso = field === "updated" ? row.update_time : row.create_time;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

export function memoRowMatchesFilter(row: DbMemoRow, p: ParsedMemoListFilter): boolean {
  if (p.pinned && !row.pinned) return false;

  if (p.timeField != null && p.timeStartSec != null && p.timeEndSec != null) {
    const ts = memoTimeSec(row, p.timeField);
    if (ts < p.timeStartSec || ts >= p.timeEndSec) return false;
  }

  if (p.contentContains !== undefined) {
    if (!row.content.includes(p.contentContains)) return false;
  }

  if (p.tagsIn?.length) {
    const tags = new Set(
      row.payload_tags.length > 0 ? row.payload_tags : extractTags(row.content),
    );
    for (const t of p.tagsIn) {
      if (!tags.has(t)) return false;
    }
  }

  if (p.hasLink && !contentHasLink(row.content)) return false;
  if (p.hasTaskList && !contentHasTaskList(row.content)) return false;
  if (p.hasCode && !contentHasCode(row.content)) return false;

  return true;
}

export function creatorUsernameFromResource(name: string): string | null {
  const prefix = "users/";
  if (!name.startsWith(prefix)) return null;
  const u = name.slice(prefix.length);
  return u.length > 0 ? u : null;
}
