from pathlib import Path

EDITOR_PATH = Path("frontend/src/components/TiptapEditor.tsx")
HELPER_PATH = Path("frontend/src/lib/editorBubbleSelection.ts")
TEST_PATH = Path("frontend/src/lib/__tests__/editorBubbleSelection.test.ts")


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return source.replace(old, new, 1)


def main() -> None:
    source = EDITOR_PATH.read_text(encoding="utf-8")

    state_import = 'import { TextSelection, NodeSelection } from "@tiptap/pm/state";\n'
    cell_import = 'import { CellSelection } from "@tiptap/pm/tables";\n'
    if cell_import not in source:
        source = replace_once(source, state_import, state_import + cell_import, "CellSelection import")

    utils_import = 'import { cn } from "@/lib/utils";\n'
    helper_import = 'import { resolveEditorBubbleKind, type BubbleSelectionKind } from "@/lib/editorBubbleSelection";\n'
    if helper_import not in source:
        source = replace_once(source, utils_import, utils_import + helper_import, "bubble helper import")

    handler_start = source.index("    const updateBubble = () => {")
    handler_end = source.index("    const onBlur = () => {", handler_start)
    handler = source[handler_start:handler_end]

    if "const selectionKind: BubbleSelectionKind" not in handler:
        marker = "      // 空选区 → 文本/图片格式化气泡都关，但若光标停在链接里，显示链接气泡\n"
        decision = '''      const selectionKind: BubbleSelectionKind = empty
        ? "empty"
        : selection instanceof CellSelection
          ? "cell"
          : selection instanceof NodeSelection && selection.node.type.name === "image"
            ? "image"
            : selection instanceof TextSelection
              ? "text"
              : "other";
      const selectedText = selectionKind === "text"
        ? state.doc.textBetween(from, to, " ")
        : "";
      const bubbleKind = resolveEditorBubbleKind({
        selectionKind,
        tableActive: editor.isActive("table"),
        linkActive: editor.isActive("link"),
        hasVisibleText: selectedText.trim().length > 0,
      });

'''
        handler = replace_once(handler, marker, decision + marker, "selection decision insertion")

    handler = replace_once(
        handler,
        '        if (editor.isActive("table")) {',
        '        if (bubbleKind === "table") {',
        "empty table condition",
    )

    handler = replace_once(
        handler,
        '        if (editor.isActive("link")) {',
        '''        if (bubbleKind === "table") {
          setLinkBubble(b => (b.open && b.source === "caret") ? { ...b, open: false } : b);
          return;
        }

        if (bubbleKind === "link") {''',
        "empty table/link priority",
    )

    selected_marker = "      // Keep table bubble open when cells are selected\n"
    selected_start = handler.index(selected_marker)
    prefix = handler[:selected_start]
    selected = handler[selected_start:]

    selected = replace_once(
        selected,
        '''      // Keep table bubble open when cells are selected
      if (editor.isActive("table")) {
        const rect = posToDOMRect(view, from, to);
''',
        '''      // CellSelection owns the table bubble. A TextSelection inside a cell stays textual.
      if (bubbleKind === "table") {
        setBubble(b => b.open ? { ...b, open: false } : b);
        setImageBubble(b => b.open ? { ...b, open: false } : b);
        const rect = posToDOMRect(view, from, to);
''',
        "selected cell branch",
    )
    selected = replace_once(
        selected,
        '''        setTableBubble({ open: true, top, left, cellText });
      } else {
''',
        '''        setTableBubble({ open: true, top, left, cellText });
        return;
      } else {
''',
        "selected cell early return",
    )
    selected = replace_once(
        selected,
        '''      const isImage = editor.isActive("image");

      if (isImage) {
''',
        '      if (bubbleKind === "image") {\n',
        "image node branch",
    )
    selected = replace_once(
        selected,
        '        const text = state.doc.textBetween(from, to, " ");\n',
        '        const text = selectedText;\n',
        "selected text reuse",
    )

    handler = prefix + selected
    source = source[:handler_start] + handler + source[handler_end:]
    EDITOR_PATH.write_text(source, encoding="utf-8")

    HELPER_PATH.write_text(
        '''export type BubbleSelectionKind = "empty" | "text" | "cell" | "image" | "other";
export type EditorBubbleKind = "none" | "text" | "table" | "image" | "link";

export interface EditorBubbleDecisionInput {
  selectionKind: BubbleSelectionKind;
  tableActive: boolean;
  linkActive: boolean;
  hasVisibleText: boolean;
}

/** Resolve exactly one editor bubble for the current ProseMirror selection. */
export function resolveEditorBubbleKind(input: EditorBubbleDecisionInput): EditorBubbleKind {
  switch (input.selectionKind) {
    case "cell":
      return "table";
    case "image":
      return "image";
    case "text":
      return input.hasVisibleText ? "text" : "none";
    case "empty":
      if (input.tableActive) return "table";
      if (input.linkActive) return "link";
      return "none";
    default:
      return "none";
  }
}
''',
        encoding="utf-8",
    )

    TEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    TEST_PATH.write_text(
        '''import { describe, expect, it } from "vitest";
import { resolveEditorBubbleKind } from "../editorBubbleSelection";

describe("resolveEditorBubbleKind", () => {
  it("keeps text selected inside a table text-only", () => {
    expect(resolveEditorBubbleKind({ selectionKind: "text", tableActive: true, linkActive: false, hasVisibleText: true })).toBe("text");
  });

  it("shows only the table bubble for a cell selection", () => {
    expect(resolveEditorBubbleKind({ selectionKind: "cell", tableActive: true, linkActive: false, hasVisibleText: true })).toBe("table");
  });

  it("gives an image node selection priority inside a table", () => {
    expect(resolveEditorBubbleKind({ selectionKind: "image", tableActive: true, linkActive: false, hasVisibleText: false })).toBe("image");
  });

  it("gives an empty table caret priority over a link bubble", () => {
    expect(resolveEditorBubbleKind({ selectionKind: "empty", tableActive: true, linkActive: true, hasVisibleText: false })).toBe("table");
  });

  it("shows a caret link bubble outside tables", () => {
    expect(resolveEditorBubbleKind({ selectionKind: "empty", tableActive: false, linkActive: true, hasVisibleText: false })).toBe("link");
  });

  it("hides text actions for invisible-only selections", () => {
    expect(resolveEditorBubbleKind({ selectionKind: "text", tableActive: true, linkActive: false, hasVisibleText: false })).toBe("none");
  });
});
''',
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
