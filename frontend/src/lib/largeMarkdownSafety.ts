import type { NoteEditorHeading } from "@/components/editors/types";

/**
 * The full Markdown editor enables language parsing, syntax highlighting, live preview,
 * outline extraction and several whole-document transforms. Those features are useful
 * for normal notes, but become unsafe when a note is large enough to monopolize the
 * renderer thread.
 *
 * These thresholds intentionally trigger before CodeMirror/ReactMarkdown reach the
 * pathological range represented by issue #368 (2.4 MB / 45,939 lines / 20k-char lines).
 */
export const LARGE_MARKDOWN_THRESHOLDS = {
  characters: 750_000,
  lines: 20_000,
  longestLine: 8_000,
} as const;

export const LARGE_MARKDOWN_SEARCH_TEXT_LIMIT = 1_000_000;
export const LARGE_MARKDOWN_OUTLINE_LIMIT = 400;

export function shouldUseLargeMarkdownSafeMode(
  content: string | null | undefined,
): boolean {
  if (!content) return false;
  if (content.length >= LARGE_MARKDOWN_THRESHOLDS.characters) return true;

  let lineCount = 1;
  let currentLineLength = 0;

  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    if (code === 10) {
      lineCount += 1;
      currentLineLength = 0;
      if (lineCount >= LARGE_MARKDOWN_THRESHOLDS.lines) return true;
      continue;
    }

    currentLineLength += 1;
    if (currentLineLength >= LARGE_MARKDOWN_THRESHOLDS.longestLine) return true;
  }

  return false;
}

/**
 * A bounded, parser-free search representation for safe mode.
 *
 * The server remains the authoritative indexer, but the editor contract still expects a
 * contentText snapshot. Avoid running the full Markdown parser on the renderer thread;
 * retain the beginning and end so title/introduction and recent appended content remain
 * searchable while keeping payload work bounded.
 */
export function buildLargeMarkdownSearchText(
  markdown: string,
  limit = LARGE_MARKDOWN_SEARCH_TEXT_LIMIT,
): string {
  if (markdown.length <= limit) return markdown.replace(/[\u200B-\u200D\uFEFF]/g, "");

  const headLength = Math.floor(limit * 0.8);
  const tailLength = Math.max(0, limit - headLength);
  return `${markdown.slice(0, headLength)}\n\n…\n\n${markdown.slice(-tailLength)}`
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
}

/**
 * Parser-free outline extraction. It recognizes ATX headings and is deliberately capped
 * so a generated document with thousands of headings cannot create an equally large
 * React outline tree.
 */
export function extractLargeMarkdownHeadings(
  markdown: string,
  limit = LARGE_MARKDOWN_OUTLINE_LIMIT,
): NoteEditorHeading[] {
  const headings: NoteEditorHeading[] = [];
  let lineStart = 0;

  for (let index = 0; index <= markdown.length; index += 1) {
    if (index < markdown.length && markdown.charCodeAt(index) !== 10) continue;

    const line = markdown.slice(lineStart, index);
    const match = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      const text = match[2].trim();
      if (text) {
        headings.push({
          id: `large-md-h-${lineStart}`,
          level: match[1].length,
          text,
          pos: lineStart,
        });
        if (headings.length >= limit) break;
      }
    }

    lineStart = index + 1;
  }

  return headings;
}

export interface SingleTextChange {
  from: number;
  deleteCount: number;
  insert: string;
}

/**
 * Compute one compact replacement range. This is used by the lightweight collaborative
 * editor so a one-character edit does not replace/broadcast the entire multi-megabyte
 * Y.Text document.
 */
export function computeSingleTextChange(
  previous: string,
  next: string,
): SingleTextChange | null {
  if (previous === next) return null;

  const sharedLength = Math.min(previous.length, next.length);
  let from = 0;
  while (from < sharedLength && previous.charCodeAt(from) === next.charCodeAt(from)) {
    from += 1;
  }

  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > from
    && nextEnd > from
    && previous.charCodeAt(previousEnd - 1) === next.charCodeAt(nextEnd - 1)
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  return {
    from,
    deleteCount: previousEnd - from,
    insert: next.slice(from, nextEnd),
  };
}

export function formatLargeMarkdownSize(characters: number): string {
  if (characters < 1024) return `${characters} B`;
  const kilobytes = characters / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`;
  return `${(kilobytes / 1024).toFixed(1)} MB`;
}
