import type { Note } from "@/types";

/**
 * Rich-text payloads are usually serialized as compact, single-line Tiptap JSON or HTML.
 * Markdown's line-count / longest-line thresholds therefore cannot be reused here: an ordinary
 * 18 KB Tiptap document would look like one 18,000-character line and be incorrectly forced into
 * read-only mode.
 *
 * This mode is an emergency guard for genuinely pathological payloads, not a normal large-note
 * UX. Trigger on serialized size or extreme Tiptap structure instead.
 */
export const LARGE_RICH_TEXT_THRESHOLDS = {
  serializedCharacters: 1_000_000,
  approximateNodes: 20_000,
} as const;

export function shouldUseLargeRichTextSafeMode(
  content: string | null | undefined,
  contentFormat: string | null | undefined,
): boolean {
  if (!content) return false;
  if (content.length >= LARGE_RICH_TEXT_THRESHOLDS.serializedCharacters) return true;

  // HTML and unknown legacy formats use only the size guard. For Tiptap JSON, cheaply count
  // structural `type` fields without parsing/mounting ProseMirror. Stop as soon as the limit is hit.
  if ((contentFormat || "tiptap-json") !== "tiptap-json") return false;

  const typeFieldPattern = /"type"\s*:/g;
  let approximateNodes = 0;
  while (typeFieldPattern.exec(content)) {
    approximateNodes += 1;
    if (approximateNodes >= LARGE_RICH_TEXT_THRESHOLDS.approximateNodes) return true;
  }

  return false;
}

/**
 * Runtime-only marker used when a large non-Markdown note must not enter Tiptap.
 *
 * The original content is kept untouched in memory. Only contentFormat is overridden so
 * EditorPane selects the Markdown adapter, which then renders LargeRichTextSafeViewer.
 * Nothing here is persisted to the server.
 */
export interface RuntimeLargeRichTextSafeNote extends Note {
  __nowenLargeRichTextSafeMode: true;
  __nowenOriginalContentFormat: string;
}

const collaborationBlockedNoteIds = new Set<string>();

export function isLargeRichTextSafeNote(
  note: Note | null | undefined,
): note is RuntimeLargeRichTextSafeNote {
  return !!note && (note as RuntimeLargeRichTextSafeNote).__nowenLargeRichTextSafeMode === true;
}

export function prepareLargeRichTextNoteForDisplay(note: Note): Note {
  if (isLargeRichTextSafeNote(note)) {
    collaborationBlockedNoteIds.add(note.id);
    return note;
  }

  const originalFormat = note.contentFormat || "tiptap-json";
  const shouldProtect =
    originalFormat !== "markdown"
    && shouldUseLargeRichTextSafeMode(note.content || note.contentText, originalFormat);

  if (!shouldProtect) {
    collaborationBlockedNoteIds.delete(note.id);
    return note;
  }

  collaborationBlockedNoteIds.add(note.id);
  return {
    ...note,
    // Runtime routing override only. The raw Tiptap/HTML payload remains in `content`.
    contentFormat: "markdown",
    __nowenLargeRichTextSafeMode: true,
    __nowenOriginalContentFormat: originalFormat,
  } satisfies RuntimeLargeRichTextSafeNote;
}

export function isLargeDocumentCollaborationBlocked(
  noteId: string | null | undefined,
): boolean {
  return !!noteId && collaborationBlockedNoteIds.has(noteId);
}

export function getLargeDocumentOriginalFormat(note: Note): string | undefined {
  return isLargeRichTextSafeNote(note)
    ? note.__nowenOriginalContentFormat
    : note.contentFormat;
}
