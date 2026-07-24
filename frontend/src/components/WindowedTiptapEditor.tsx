import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { NoteEditorHandle, NoteEditorProps, NoteEditorUpdatePayload } from "@/components/editors/types";
import {
  splitTiptapSubdocumentSections,
  type TiptapSubdocumentSection,
} from "@/lib/yjsSubdocumentModel";
import BaseTiptapEditor from "./TiptapEditor";

export const TIPTAP_SUBDOCUMENT_WINDOWING_KEY = "nowen:tiptap-subdocuments";

export function isTiptapSubdocumentWindowingEnabled(): boolean {
  try { return localStorage.getItem(TIPTAP_SUBDOCUMENT_WINDOWING_KEY) === "1"; } catch { return false; }
}

interface WindowedTiptapEditorProps extends NoteEditorProps {
  onFallback?: (reason: string) => void;
}

function plainTextFromTiptap(content: string): string {
  try {
    const doc = JSON.parse(content);
    const parts: string[] = [];
    const walk = (node: any) => {
      if (typeof node?.text === "string") parts.push(node.text);
      if (Array.isArray(node?.content)) node.content.forEach(walk);
      if (["paragraph", "heading", "listItem", "taskItem", "blockquote", "codeBlock"].includes(node?.type)) parts.push("\n");
    };
    walk(doc);
    return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return "";
  }
}

function mergeSectionContents(sections: TiptapSubdocumentSection[], values: Map<string, string>): string | null {
  const nodes: any[] = [];
  try {
    for (const section of sections) {
      const doc = JSON.parse(values.get(section.id) || section.content);
      if (doc?.type !== "doc" || !Array.isArray(doc.content)) return null;
      nodes.push(...doc.content);
    }
    return JSON.stringify({ type: "doc", content: nodes });
  } catch {
    return null;
  }
}

function SectionFrame({
  section,
  index,
  mounted,
  estimatedHeight,
  onVisibility,
  onComposition,
  children,
}: {
  section: TiptapSubdocumentSection;
  index: number;
  mounted: boolean;
  estimatedHeight: number;
  onVisibility: (sectionId: string, visible: boolean, height?: number) => void;
  onComposition: (sectionId: string, composing: boolean) => void;
  children: React.ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hostRef.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry) onVisibility(section.id, entry.isIntersecting, Math.ceil(entry.boundingClientRect?.height || 0));
    }, { rootMargin: "1200px 0px" });
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [onVisibility, section.id]);
  useEffect(() => {
    if (!mounted || !hostRef.current) return;
    const height = Math.ceil(hostRef.current.getBoundingClientRect().height);
    if (height > 0) onVisibility(section.id, true, height);
  }, [mounted, onVisibility, section.id]);
  return (
    <section
      ref={hostRef}
      data-windowed-tiptap-section={section.id}
      data-section-index={index}
      onCompositionStartCapture={() => onComposition(section.id, true)}
      onCompositionEndCapture={() => onComposition(section.id, false)}
      style={{ containIntrinsicSize: `auto ${estimatedHeight}px` }}
    >
      {mounted ? children : <div aria-hidden="true" style={{ minHeight: estimatedHeight }} />}
    </section>
  );
}

/**
 * 实验性章节窗口：首章常驻以保留统一工具栏，其余章节只在视口缓冲区内挂载。
 * 每章卸载前同步抓取编辑器快照；任何无法无损合并的状态立即回退单体编辑器。
 */
const WindowedTiptapEditor = forwardRef<NoteEditorHandle, WindowedTiptapEditorProps>(
  function WindowedTiptapEditor(props, ref) {
    const sections = useMemo(
      () => splitTiptapSubdocumentSections(props.note.id, props.note.content, 250),
      [props.note.content, props.note.id],
    );
    const valuesRef = useRef(new Map<string, string>());
    const editorRefs = useRef(new Map<string, NoteEditorHandle>());
    const composingRef = useRef(new Set<string>());
    const [mountedIds, setMountedIds] = useState<Set<string>>(() => new Set(sections?.[0] ? [sections[0].id] : []));
    const [heights, setHeights] = useState<Record<string, number>>({});

    useEffect(() => {
      valuesRef.current = new Map((sections || []).map((section) => [section.id, section.content]));
      setMountedIds(new Set(sections?.[0] ? [sections[0].id] : []));
      setHeights({});
    }, [props.note.id]);

    const snapshotSection = useCallback((sectionId: string) => {
      const snapshot = editorRefs.current.get(sectionId)?.getSnapshot?.();
      if (snapshot?.content) valuesRef.current.set(sectionId, snapshot.content);
    }, []);

    const handleVisibility = useCallback((sectionId: string, visible: boolean, height?: number) => {
      if (height && height > 0) setHeights((current) => current[sectionId] === height ? current : { ...current, [sectionId]: height });
      setMountedIds((current) => {
        const firstId = sections?.[0]?.id;
        if (visible) return current.has(sectionId) ? current : new Set(current).add(sectionId);
        if (sectionId === firstId || composingRef.current.has(sectionId) || !current.has(sectionId)) return current;
        snapshotSection(sectionId);
        const next = new Set(current);
        next.delete(sectionId);
        return next;
      });
    }, [sections, snapshotSection]);

    const handleComposition = useCallback((sectionId: string, composing: boolean) => {
      if (composing) composingRef.current.add(sectionId);
      else composingRef.current.delete(sectionId);
    }, []);

    const emitMergedUpdate = useCallback((sectionId: string, payload: NoteEditorUpdatePayload) => {
      if (!sections || typeof payload.content !== "string") {
        props.onUpdate(payload);
        return;
      }
      valuesRef.current.set(sectionId, payload.content);
      const content = mergeSectionContents(sections, valuesRef.current);
      if (!content) {
        props.onFallback?.("subdocument-materialization-failed");
        return;
      }
      props.onUpdate({
        ...payload,
        title: sectionId === sections[0]?.id ? payload.title : props.note.title,
        content,
        contentText: plainTextFromTiptap(content),
        _noteId: props.note.id,
      });
    }, [props, sections]);

    useEffect(() => {
      if (!props.searchQuery || !sections) return;
      const query = props.searchQuery.toLocaleLowerCase();
      const target = sections.find((section) => section.content.toLocaleLowerCase().includes(query));
      if (!target) return;
      setMountedIds((current) => new Set(current).add(target.id));
      requestAnimationFrame(() => document.querySelector(`[data-windowed-tiptap-section="${CSS.escape(target.id)}"]`)?.scrollIntoView({ block: "center" }));
    }, [props.searchQuery, sections]);

    useImperativeHandle(ref, () => ({
      flushSave: () => editorRefs.current.forEach((editor) => editor.flushSave()),
      discardPending: () => editorRefs.current.forEach((editor) => editor.discardPending?.()),
      getSnapshot: () => {
        if (!sections) return null;
        editorRefs.current.forEach((_editor, sectionId) => snapshotSection(sectionId));
        const content = mergeSectionContents(sections, valuesRef.current);
        return content ? { content, contentText: plainTextFromTiptap(content) } : null;
      },
      acknowledgeSave: (ack) => editorRefs.current.forEach((editor) => editor.acknowledgeSave?.(ack)),
      isReady: () => Boolean(sections && editorRefs.current.get(sections[0]?.id)?.isReady?.()),
      appendMarkdown: () => false,
    }), [sections, snapshotSection]);

    if (!sections || sections.length <= 1) return <BaseTiptapEditor {...props} ref={ref} />;
    return (
      <div data-windowed-tiptap-editor="true" className="h-full overflow-y-auto">
        {sections.map((section, index) => {
          const mounted = mountedIds.has(section.id);
          const sectionNote = { ...props.note, content: valuesRef.current.get(section.id) || section.content };
          return (
            <SectionFrame
              key={section.id}
              section={section}
              index={index}
              mounted={mounted}
              estimatedHeight={heights[section.id] || 640}
              onVisibility={handleVisibility}
              onComposition={handleComposition}
            >
              {mounted && (
                <BaseTiptapEditor
                  {...props}
                  note={sectionNote}
                  ref={(editor) => {
                    if (editor) editorRefs.current.set(section.id, editor);
                    else editorRefs.current.delete(section.id);
                  }}
                  presentationMode={index > 0}
                  windowedSection={index > 0}
                  onHeadingsChange={index === 0 ? props.onHeadingsChange : undefined}
                  onUpdate={(payload) => emitMergedUpdate(section.id, payload)}
                />
              )}
            </SectionFrame>
          );
        })}
      </div>
    );
  },
);

WindowedTiptapEditor.displayName = "WindowedTiptapEditor";
export default WindowedTiptapEditor;
