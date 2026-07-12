import type { NoteEditorHeading } from "@/components/editors/types";

interface FenceState {
  marker: "`" | "~";
  size: number;
}

function isFenceClose(line: string, fence: FenceState): boolean {
  const marker = fence.marker === "`" ? "`" : "~";
  return new RegExp(`^[\\t ]{0,3}${marker}{${fence.size},}[\\t ]*$`).test(line);
}

/**
 * Extract ATX H4-H6 headings with source offsets from Markdown.
 *
 * The editor already supplies H1-H3 from CodeMirror's incremental syntax tree. This
 * scanner only fills the historically omitted deep levels and deliberately skips
 * fenced code blocks so examples such as `#### not a heading` do not enter the outline.
 */
export function extractDeepMarkdownHeadings(
  markdown: string | null | undefined,
): NoteEditorHeading[] {
  const source = markdown || "";
  const headings: NoteEditorHeading[] = [];
  const linePattern = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let fence: FenceState | null = null;
  let offset = 0;

  while (true) {
    const match = linePattern.exec(source);
    if (!match) break;

    const line = match[1];
    const newline = match[2];

    if (fence) {
      if (isFenceClose(line, fence)) fence = null;
    } else {
      const fenceStart = line.match(/^[\t ]{0,3}(`{3,}|~{3,})/);
      if (fenceStart) {
        fence = {
          marker: fenceStart[1][0] as "`" | "~",
          size: fenceStart[1].length,
        };
      } else {
        const heading = line.match(/^[\t ]{0,3}(#{4,6})(?:[\t ]+|$)(.*)$/);
        if (heading) {
          const level = heading[1].length;
          const text = heading[2]
            .replace(/[\t ]+#{1,6}[\t ]*$/, "")
            .trim();
          if (text) {
            headings.push({
              id: `h-${offset}`,
              level,
              text,
              pos: offset,
            });
          }
        }
      }
    }

    offset += line.length + newline.length;
    if (!newline) break;
  }

  return headings;
}

/** Merge the editor-provided outline with deep headings without creating duplicates. */
export function mergeMarkdownEditorHeadings(
  existing: NoteEditorHeading[],
  markdown: string | null | undefined,
): NoteEditorHeading[] {
  const merged = new Map<string, NoteEditorHeading>();
  for (const heading of existing) {
    merged.set(`${heading.pos}:${heading.level}`, heading);
  }
  for (const heading of extractDeepMarkdownHeadings(markdown)) {
    const key = `${heading.pos}:${heading.level}`;
    if (!merged.has(key)) merged.set(key, heading);
  }
  return Array.from(merged.values()).sort((a, b) => a.pos - b.pos);
}
