import React, { act, forwardRef, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteEditorHandle } from "@/components/editors/types";

vi.mock("../TiptapEditor", () => ({
  default: forwardRef<NoteEditorHandle, any>(function MockSectionEditor({ note, onUpdate }, ref) {
    useImperativeHandle(ref, () => ({
      flushSave: () => undefined,
      getSnapshot: () => ({ content: note.content, contentText: "" }),
      isReady: () => true,
    }), [note.content]);
    return (
      <textarea
        data-section-editor={JSON.parse(note.content).content[0]?.attrs?.blockId || "empty"}
        defaultValue={note.content}
        onChange={(event) => onUpdate({ content: event.target.value, contentText: "", title: note.title })}
      />
    );
  }),
}));

import WindowedTiptapEditor from "../WindowedTiptapEditor";

function largeNote() {
  return {
    id: "window-note",
    userId: "user",
    notebookId: "book",
    workspaceId: null,
    title: "Window",
    content: JSON.stringify({
      type: "doc",
      content: Array.from({ length: 520 }, (_, index) => ({
        type: "paragraph",
        attrs: { blockId: `blk_${String(index).padStart(6, "0")}` },
        content: [{ type: "text", text: `p${index}` }],
      })),
    }),
    contentText: "",
    contentFormat: "tiptap-json",
    version: 1,
    isPinned: 0,
    isFavorite: 0,
    isLocked: 0,
    isArchived: 0,
    isTrashed: 0,
    sortOrder: 0,
    createdAt: "2026-01-01 00:00:00",
    updatedAt: "2026-01-01 00:00:00",
    tags: [],
  } as any;
}

describe("WindowedTiptapEditor", () => {
  let host: HTMLDivElement;
  let root: Root;
  let callbacks: IntersectionObserverCallback[];

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    callbacks = [];
    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) { callbacks.push(callback); }
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = "1200px 0px";
      thresholds = [0];
    }
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  it("keeps a bounded editor set and restores an offscreen section", async () => {
    await act(async () => root.render(<WindowedTiptapEditor note={largeNote()} onUpdate={vi.fn()} />));
    expect(host.querySelectorAll("[data-windowed-tiptap-section]")).toHaveLength(3);
    expect(host.querySelectorAll("[data-section-editor]")).toHaveLength(1);
    await act(async () => callbacks[1]?.([{ isIntersecting: true, boundingClientRect: { height: 700 } } as any], {} as any));
    expect(host.querySelectorAll("[data-section-editor]")).toHaveLength(2);
    await act(async () => callbacks[1]?.([{ isIntersecting: false, boundingClientRect: { height: 700 } } as any], {} as any));
    expect(host.querySelectorAll("[data-section-editor]")).toHaveLength(1);
    expect(host.querySelectorAll("[data-windowed-tiptap-section]")[1]?.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("does not unload a section while IME composition is active", async () => {
    await act(async () => root.render(<WindowedTiptapEditor note={largeNote()} onUpdate={vi.fn()} />));
    await act(async () => callbacks[1]?.([{ isIntersecting: true, boundingClientRect: { height: 600 } } as any], {} as any));
    const second = host.querySelectorAll<HTMLElement>("[data-windowed-tiptap-section]")[1];
    await act(async () => second.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
    await act(async () => callbacks[1]?.([{ isIntersecting: false, boundingClientRect: { height: 600 } } as any], {} as any));
    expect(host.querySelectorAll("[data-section-editor]")).toHaveLength(2);
    await act(async () => second.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
    await act(async () => callbacks[1]?.([{ isIntersecting: false, boundingClientRect: { height: 600 } } as any], {} as any));
    expect(host.querySelectorAll("[data-section-editor]")).toHaveLength(1);
  });
});
