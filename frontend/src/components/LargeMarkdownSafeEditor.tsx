import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { AlertTriangle, FileText, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import * as Y from "yjs";

import TagInput from "@/components/TagInput";
import type {
  NoteEditorHandle,
  NoteEditorProps,
} from "@/components/editors/types";
import { normalizeToMarkdown } from "@/lib/contentFormat";
import {
  buildLargeMarkdownSearchText,
  computeSingleTextChange,
  extractLargeMarkdownHeadings,
  formatLargeMarkdownSize,
} from "@/lib/largeMarkdownSafety";
import { cn } from "@/lib/utils";

interface LargeMarkdownSafeEditorProps extends NoteEditorProps {
  onAIAssistant?: () => void;
}

type CancelIdleWork = () => void;

function scheduleIdleWork(callback: () => void): CancelIdleWork {
  if (typeof window !== "undefined") {
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        cb: () => void,
        options?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (typeof idleWindow.requestIdleCallback === "function") {
      const id = idleWindow.requestIdleCallback(callback, { timeout: 800 });
      return () => idleWindow.cancelIdleCallback?.(id);
    }
  }

  const id = globalThis.setTimeout(callback, 48);
  return () => globalThis.clearTimeout(id);
}

/**
 * A deliberately small editor for documents that are unsafe for the full CodeMirror +
 * ReactMarkdown pipeline.
 *
 * Important implementation detail: the textarea is uncontrolled. Keeping a 2–10 MB
 * string in React state would make every keystroke compare/copy the full document again.
 * The DOM owns the current value; React only coordinates save, title, tags and outline.
 */
const LargeMarkdownSafeEditor = forwardRef<
  NoteEditorHandle,
  LargeMarkdownSafeEditorProps
>(function LargeMarkdownSafeEditor(
  {
    note,
    onUpdate,
    onTagsChange,
    onHeadingsChange,
    onEditorReady,
    editable = true,
    isGuest = false,
    searchQuery,
    yDoc,
  },
  forwardedRef,
) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const sizeRef = useRef<HTMLSpanElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelOutlineIdleRef = useRef<CancelIdleWork | null>(null);
  const dirtyRef = useRef(false);
  const lastNoteIdRef = useRef(note.id);
  const localYOriginRef = useRef<object>({});
  const onUpdateRef = useRef(onUpdate);
  const onHeadingsChangeRef = useRef(onHeadingsChange);

  onUpdateRef.current = onUpdate;
  onHeadingsChangeRef.current = onHeadingsChange;

  const normalizedNoteContent = useMemo(
    () => normalizeToMarkdown(note.content, note.contentText),
    [note.content, note.contentText],
  );

  const initialMarkdown = useMemo(() => {
    if (!yDoc) return normalizedNoteContent;
    const collaborativeText = yDoc.getText("content").toString();
    return collaborativeText || normalizedNoteContent;
  }, [normalizedNoteContent, yDoc]);

  const lastSyncedContentRef = useRef(initialMarkdown);

  const updateSizeLabel = useCallback((length: number) => {
    if (sizeRef.current) {
      sizeRef.current.textContent = `${length.toLocaleString()} ${t("tiptap.chars", { defaultValue: "字符" })}`;
    }
  }, [t]);

  const publishOutline = useCallback((markdown: string) => {
    cancelOutlineIdleRef.current?.();
    cancelOutlineIdleRef.current = scheduleIdleWork(() => {
      cancelOutlineIdleRef.current = null;
      onHeadingsChangeRef.current?.(extractLargeMarkdownHeadings(markdown));
    });
  }, []);

  const scheduleOutline = useCallback(() => {
    if (!onHeadingsChangeRef.current) return;
    if (outlineTimerRef.current) window.clearTimeout(outlineTimerRef.current);
    outlineTimerRef.current = window.setTimeout(() => {
      outlineTimerRef.current = null;
      const markdown = textareaRef.current?.value || "";
      publishOutline(markdown);
    }, 1_600);
  }, [publishOutline]);

  const emitSave = useCallback(() => {
    if (!dirtyRef.current) return;
    const textarea = textareaRef.current;
    if (!textarea) return;

    const markdown = textarea.value;
    const title = titleRef.current?.value || note.title;

    if (yDoc) {
      const yText = yDoc.getText("content");
      const previous = lastSyncedContentRef.current;
      const change = computeSingleTextChange(previous, markdown);
      if (change) {
        yDoc.transact(() => {
          if (change.deleteCount > 0) yText.delete(change.from, change.deleteCount);
          if (change.insert) yText.insert(change.from, change.insert);
        }, localYOriginRef.current);
      }
      lastSyncedContentRef.current = markdown;
    } else {
      onUpdateRef.current({
        title,
        content: markdown,
        contentText: buildLargeMarkdownSearchText(markdown),
        _noteId: note.id,
      });
    }

    dirtyRef.current = false;
  }, [note.id, note.title, yDoc]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      emitSave();
    }, 1_200);
  }, [emitSave]);

  useImperativeHandle(forwardedRef, () => ({
    flushSave: () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      emitSave();
    },
    discardPending: () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      dirtyRef.current = false;
    },
    getSnapshot: () => {
      const markdown = textareaRef.current?.value;
      if (markdown == null) return null;
      return {
        content: markdown,
        contentText: buildLargeMarkdownSearchText(markdown),
      };
    },
    isReady: () => !!textareaRef.current,
    appendMarkdown: (markdown: string) => {
      const textarea = textareaRef.current;
      if (!textarea || !editable) return false;
      textarea.value += markdown;
      dirtyRef.current = true;
      updateSizeLabel(textarea.value.length);
      scheduleSave();
      scheduleOutline();
      return true;
    },
  }), [editable, emitSave, scheduleOutline, scheduleSave, updateSizeLabel]);

  useEffect(() => {
    const textarea = textareaRef.current;
    const noteChanged = lastNoteIdRef.current !== note.id;

    if (noteChanged) {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      dirtyRef.current = false;
      lastNoteIdRef.current = note.id;
    }

    if (textarea && (noteChanged || !dirtyRef.current)) {
      textarea.value = initialMarkdown;
      lastSyncedContentRef.current = initialMarkdown;
      updateSizeLabel(initialMarkdown.length);
      publishOutline(initialMarkdown);
    }

    if (titleRef.current && (noteChanged || document.activeElement !== titleRef.current)) {
      titleRef.current.value = note.title;
    }
  }, [initialMarkdown, note.id, note.title, publishOutline, updateSizeLabel]);

  useEffect(() => {
    if (!yDoc) return;
    const yText = yDoc.getText("content");

    const handleRemoteUpdate = (event: Y.YTextEvent) => {
      if (event.transaction.origin === localYOriginRef.current) return;
      const markdown = yText.toString();
      lastSyncedContentRef.current = markdown;
      if (dirtyRef.current) return;
      if (textareaRef.current) {
        textareaRef.current.value = markdown;
        updateSizeLabel(markdown.length);
        publishOutline(markdown);
      }
    };

    yText.observe(handleRemoteUpdate);
    return () => yText.unobserve(handleRemoteUpdate);
  }, [publishOutline, updateSizeLabel, yDoc]);

  useEffect(() => {
    onEditorReady?.((position: number) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const clamped = Math.max(0, Math.min(textarea.value.length, position));
      textarea.focus();
      textarea.setSelectionRange(clamped, clamped);
    });
  }, [onEditorReady]);

  useEffect(() => {
    const query = searchQuery?.trim();
    const textarea = textareaRef.current;
    if (!query || !textarea) return;

    const index = textarea.value.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
    if (index < 0) return;
    textarea.focus();
    textarea.setSelectionRange(index, index + query.length);
  }, [note.id, searchQuery]);

  useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    if (outlineTimerRef.current) window.clearTimeout(outlineTimerRef.current);
    cancelOutlineIdleRef.current?.();
  }, []);

  const handleTitleBlur = useCallback(() => {
    const title = titleRef.current?.value.trim() || note.title;
    if (title === note.title) return;
    onUpdateRef.current({ title, _noteId: note.id });
  }, [note.id, note.title]);

  const handleInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    dirtyRef.current = true;
    updateSizeLabel(textarea.value.length);
    scheduleSave();
    scheduleOutline();
  }, [scheduleOutline, scheduleSave, updateSizeLabel]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") {
      event.preventDefault();
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      emitSave();
      return;
    }

    if (event.key === "Tab" && editable) {
      event.preventDefault();
      const textarea = event.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.setRangeText("  ", start, end, "end");
      handleInput();
    }
  }, [editable, emitSave, handleInput]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-app-bg">
      <div className="border-b border-amber-300/60 bg-amber-500/10 px-4 py-3 text-amber-800 dark:border-amber-500/30 dark:text-amber-200 md:px-8">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
              <span>{t("markdown.largeDocument.safeMode", { defaultValue: "大文档安全模式" })}</span>
              <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium">
                {formatLargeMarkdownSize(initialMarkdown.length)}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 opacity-90">
              {t("markdown.largeDocument.safeModeDesc", {
                defaultValue: "已关闭实时预览、语法高亮、自动换行和高频全文分析，避免超大笔记卡死。内容仍会自动保存。",
              })}
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 pb-2 pt-4 md:px-8 md:pt-6">
        <input
          ref={titleRef}
          defaultValue={note.title}
          onBlur={handleTitleBlur}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              textareaRef.current?.focus();
            }
          }}
          readOnly={!editable}
          spellCheck={false}
          className="w-full bg-transparent text-2xl font-bold text-tx-primary outline-none placeholder:text-tx-tertiary/60 md:text-3xl"
          placeholder={t("tiptap.titlePlaceholder", { defaultValue: "无标题" })}
        />
        {!isGuest && (
          <div className="mt-2">
            <TagInput
              noteId={note.id}
              noteTags={note.tags || []}
              onTagsChange={onTagsChange}
            />
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-2 md:px-8">
        <div className="mb-2 flex items-center gap-2 text-[11px] text-tx-tertiary">
          <span className="inline-flex items-center gap-1 rounded-md border border-app-border bg-app-surface px-2 py-1">
            <FileText size={12} />
            Markdown
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-300">
            <ShieldCheck size={12} />
            {t("markdown.largeDocument.protected", { defaultValue: "轻量渲染" })}
          </span>
        </div>

        <textarea
          ref={textareaRef}
          defaultValue={initialMarkdown}
          readOnly={!editable}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={handleInput}
          onBlur={() => {
            if (dirtyRef.current) {
              if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
              saveTimerRef.current = null;
              emitSave();
            }
          }}
          onKeyDown={handleKeyDown}
          className={cn(
            "min-h-0 flex-1 resize-none overflow-auto rounded-xl border border-app-border bg-app-surface p-4 font-mono text-[13px] leading-6 text-tx-primary outline-none",
            "focus:border-accent-primary/60 focus:ring-2 focus:ring-accent-primary/15",
            !editable && "cursor-default opacity-90",
          )}
          aria-label={t("markdown.largeDocument.editorLabel", {
            defaultValue: "大文档轻量源码编辑器",
          })}
        />
      </div>

      <div className="flex items-center gap-3 border-t border-app-border/60 px-4 py-1.5 text-[11px] text-tx-tertiary md:px-8">
        <span ref={sizeRef}>
          {initialMarkdown.length.toLocaleString()} {t("tiptap.chars", { defaultValue: "字符" })}
        </span>
        <span className="opacity-60">·</span>
        <span>{t("markdown.largeDocument.previewDisabled", { defaultValue: "完整预览已停用" })}</span>
        <span className="ml-auto opacity-60">
          {yDoc
            ? t("markdown.largeDocument.collaborationDebounced", { defaultValue: "协作同步（节流）" })
            : t("markdown.largeDocument.autoSave", { defaultValue: "自动保存" })}
        </span>
      </div>
    </div>
  );
});

LargeMarkdownSafeEditor.displayName = "LargeMarkdownSafeEditor";

export default LargeMarkdownSafeEditor;
