import { describe, expect, it } from "vitest";
import { resolveEditorFocusLayout } from "@/lib/editorFocusLayout";

describe("editorFocusLayout", () => {
  it("keeps the current note browser panels when editor fullscreen is off", () => {
    expect(resolveEditorFocusLayout({
      editorFullscreen: false,
      railVisible: true,
      sidebarCollapsed: false,
      noteListCollapsed: false,
      showNotesInNotebookTree: false,
      isRegularNoteBrowser: true,
    })).toEqual({
      showRail: true,
      showSidebar: true,
      showNoteList: true,
    });
  });

  it("hides outer navigation panels while editor fullscreen is on", () => {
    expect(resolveEditorFocusLayout({
      editorFullscreen: true,
      railVisible: true,
      sidebarCollapsed: false,
      noteListCollapsed: false,
      showNotesInNotebookTree: false,
      isRegularNoteBrowser: true,
    })).toEqual({
      showRail: false,
      showSidebar: false,
      showNoteList: false,
    });
  });
});
