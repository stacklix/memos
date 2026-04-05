/**
 * Derive memo `property` and filter flags from raw markdown content.
 * Heuristics aligned loosely with upstream memo payload extraction.
 */

const CODE_FENCE = /```[\s\S]*?```/;

const MD_LINK = /\[[^\]]*]\([^)]+\)/;

const TASK_LINE = /(^|\n)[ \t]*[-*+][ \t]+\[[ xX]\]/;

const UNCHECKED_TASK = /(^|\n)[ \t]*[-*+][ \t]+\[[ \t]*\]/;

export function contentHasCode(content: string): boolean {
  return CODE_FENCE.test(content);
}

export function contentHasLink(content: string): boolean {
  return /https?:\/\//i.test(content) || MD_LINK.test(content);
}

export function contentHasTaskList(content: string): boolean {
  return TASK_LINE.test(content);
}

export function contentHasIncompleteTasks(content: string): boolean {
  return UNCHECKED_TASK.test(content);
}

/** First markdown ATX heading, else first non-empty line (trimmed, capped). */
export function extractTitleHint(content: string): string {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const h = /^\s{0,3}#{1,6}\s+(.+?)\s*$/.exec(line);
    if (h) return h[1]!.trim().slice(0, 200);
  }
  for (const line of lines) {
    const t = line.trim();
    if (t) return t.slice(0, 200);
  }
  return "";
}

export function deriveMemoProperty(content: string) {
  const hasCode = contentHasCode(content);
  const hasLink = contentHasLink(content);
  const hasTaskList = contentHasTaskList(content);
  const hasIncompleteTasks = contentHasIncompleteTasks(content);
  return {
    hasLink,
    hasTaskList,
    hasCode,
    hasIncompleteTasks,
    title: extractTitleHint(content),
  };
}
