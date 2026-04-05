import { micromark } from "micromark";

export function renderMarkdown(source: string): string {
  return micromark(source);
}

const TAG_RE = /(?:^|\s)#([a-zA-Z0-9_/-]+)/g;

export function extractTags(content: string): string[] {
  const tags = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(TAG_RE.source, TAG_RE.flags);
  while ((m = re.exec(content)) !== null) {
    tags.add(m[1]!);
  }
  return [...tags];
}
