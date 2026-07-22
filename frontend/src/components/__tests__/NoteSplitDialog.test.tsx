import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NoteSplitDialog from "../NoteSplitDialog";
import type { Note, Notebook } from "@/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getNote: vi.fn(),
  splitMarkdownNote: vi.fn(),
  undoMarkdownNoteSplit: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: { getNote: mocks.getNote },
}));

vi.mock("@/lib/noteSplitApi", () => ({
  splitMarkdownNote: mocks.splitMarkdownNote,
  undoMarkdownNoteSplit: mocks.undoMarkdownNoteSplit,
}));

const note: Note = {
  id: "note-1",
  userId: "user-1",
  notebookId: "book-1",
  workspaceId: null,
  title: "Book",
  content: "# Alpha\na\n# Beta\nb\n# Gamma\ng",
  contentText: "Alpha a Beta b Gamma g",
  contentFormat: "markdown",
  isPinned: 0,
  isFavorite: 0,
  isLocked: 0,
  isArchived: 0,
  isTrashed: 0,
  trashedAt: null,
  version: 7,
  sortOrder: 0,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const notebooks: Notebook[] = [{
  id: "book-1",
  userId: "user-1",
  workspaceId: null,
  parentId: null,
  name: "Book",
  description: null,
  icon: "📒",
  color: null,
  sortOrder: 0,
  isExpanded: 1,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  permission: "manage",
}];

describe("NoteSplitDialog", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.getNote.mockResolvedValue(note);
    mocks.splitMarkdownNote.mockResolvedValue({
      operationId: "op-1",
      sourceNote: { ...note, version: 8, content: "directory" },
      createdNotes: [
        { ...note, id: "alpha-note", title: "Alpha", version: 1 },
        { ...note, id: "gamma-note", title: "Gamma", version: 1 },
      ],
      headingLevel: 1,
      preservePreamble: true,
      selectedSectionIndexes: [0, 2],
      retainedSectionCount: 1,
      totalSectionCount: 3,
      canUndo: true,
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("submits only checked section indexes", async () => {
    await act(async () => {
      root.render(
        <NoteSplitDialog
          open
          note={note}
          notebooks={notebooks}
          preferredLevel={1}
          onClose={vi.fn()}
          onApplied={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });

    const alpha = document.querySelector('[data-testid="note-split-section-0"]') as HTMLInputElement;
    const beta = document.querySelector('[data-testid="note-split-section-1"]') as HTMLInputElement;
    const gamma = document.querySelector('[data-testid="note-split-section-2"]') as HTMLInputElement;
    expect(alpha.checked).toBe(true);
    expect(beta.checked).toBe(true);
    expect(gamma.checked).toBe(true);

    await act(async () => {
      beta.click();
    });
    expect(beta.checked).toBe(false);

    const confirm = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("拆分所选 2 篇"));
    expect(confirm).toBeTruthy();
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mocks.splitMarkdownNote).toHaveBeenCalledWith("note-1", {
      version: 7,
      headingLevel: 1,
      sectionIndexes: [0, 2],
      targetNotebookId: "book-1",
      preservePreamble: true,
    });
  });
});
