import React, { forwardRef, useCallback, useRef } from "react";
import MarkdownEditorImpl from "@/components/MarkdownEditorImpl";
import type {
  NoteEditorHandle,
  NoteEditorHeading,
  NoteEditorProps,
} from "@/components/editors/types";
import { normalizeToMarkdown } from "@/lib/contentFormat";
import { mergeMarkdownEditorHeadings } from "@/lib/markdownEditorOutline";

export {
  normalizeFormatHeadingLevel,
} from "@/components/MarkdownEditorImpl";
export type { HeadingItem } from "@/components/MarkdownEditorImpl";

interface MarkdownEditorProps extends NoteEditorProps {
  onAIAssistant?: () => void;
}

/**
 * Public Markdown editor adapter.
 *
 * MarkdownEditorImpl owns CodeMirror and reports its incremental outline. This adapter
 * supplements that outline with H4-H6 entries until every consumer uses the shared
 * H1-H6 outline helper directly. Keeping the merge here avoids touching editor input,
 * collaboration, save, and scrolling behavior.
 */
const MarkdownEditor = forwardRef<NoteEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(props, forwardedRef) {
    const innerRef = useRef<NoteEditorHandle | null>(null);
    const { note, onHeadingsChange } = props;

    const assignRef = useCallback((handle: NoteEditorHandle | null) => {
      innerRef.current = handle;
      if (typeof forwardedRef === "function") {
        forwardedRef(handle);
      } else if (forwardedRef) {
        forwardedRef.current = handle;
      }
    }, [forwardedRef]);

    const handleHeadingsChange = useCallback((headings: NoteEditorHeading[]) => {
      if (!onHeadingsChange) return;
      const markdown =
        innerRef.current?.getSnapshot?.()?.content ??
        normalizeToMarkdown(note.content, note.contentText);
      onHeadingsChange(mergeMarkdownEditorHeadings(headings, markdown));
    }, [note.content, note.contentText, onHeadingsChange]);

    return (
      <MarkdownEditorImpl
        {...props}
        ref={assignRef}
        onHeadingsChange={onHeadingsChange ? handleHeadingsChange : undefined}
      />
    );
  },
);

MarkdownEditor.displayName = "MarkdownEditor";

export default MarkdownEditor;
