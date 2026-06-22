export interface EditorFocusLayoutInput {
  editorFullscreen: boolean;
  railVisible: boolean;
  sidebarCollapsed: boolean;
  noteListCollapsed: boolean;
  showNotesInNotebookTree: boolean;
  isRegularNoteBrowser: boolean;
}

export interface EditorFocusLayout {
  showRail: boolean;
  showSidebar: boolean;
  showNoteList: boolean;
}

export function resolveEditorFocusLayout(input: EditorFocusLayoutInput): EditorFocusLayout {
  if (input.editorFullscreen) {
    return {
      showRail: false,
      showSidebar: false,
      showNoteList: false,
    };
  }

  return {
    showRail: input.railVisible,
    showSidebar: !input.sidebarCollapsed,
    showNoteList:
      !input.noteListCollapsed &&
      !(input.showNotesInNotebookTree && input.isRegularNoteBrowser),
  };
}
