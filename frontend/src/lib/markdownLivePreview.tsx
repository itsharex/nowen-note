import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import {
  applyMarkdownTaskCheckboxChange,
  getMarkdownTaskCheckboxChange,
} from "@/lib/markdownTasks";

const BLOCK_NODE_RE = /^(?:ATXHeading[1-6]|SetextHeading[12]|Paragraph|Blockquote|BulletList|OrderedList|FencedCode|CodeBlock|HorizontalRule|HTMLBlock|Table)$/;
const roots = new WeakMap<HTMLElement, Root>();

export interface MarkdownLivePreviewBlock {
  from: number;
  to: number;
  markdown: string;
}

export function collectMarkdownLivePreviewBlocks(view: EditorView): MarkdownLivePreviewBlock[] {
  const selection = view.state.selection.main;
  const cursor = syntaxTree(view.state).cursor();
  const blocks: MarkdownLivePreviewBlock[] = [];
  if (!cursor.firstChild()) return blocks;

  do {
    const node = cursor.node;
    if (!BLOCK_NODE_RE.test(node.name) || node.from >= node.to) continue;
    const intersectsSelection = selection.from <= node.to && selection.to >= node.from;
    if (intersectsSelection) continue;
    blocks.push({
      from: node.from,
      to: node.to,
      markdown: view.state.doc.sliceString(node.from, node.to),
    });
  } while (cursor.nextSibling());

  return blocks;
}

class MarkdownLivePreviewWidget extends WidgetType {
  constructor(
    readonly markdown: string,
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }

  eq(other: MarkdownLivePreviewWidget): boolean {
    return this.markdown === other.markdown && this.from === other.from && this.to === other.to;
  }

  toDOM(view: EditorView): HTMLElement {
    const host = document.createElement("div");
    host.className = "cm-live-preview-block";
    host.dataset.mdFrom = String(this.from);
    host.dataset.mdTo = String(this.to);

    host.addEventListener("mousedown", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, button, a, video, audio, iframe")) return;
      event.preventDefault();
      view.dispatch({
        selection: { anchor: this.from },
        effects: EditorView.scrollIntoView(this.from, { y: "center" }),
      });
      view.focus();
    });

    const root = createRoot(host);
    roots.set(host, root);
    root.render(
      <MarkdownPreview
        markdown={this.markdown}
        compact
        className="cm-live-preview-render !h-auto !overflow-visible !p-0"
        onTaskCheckboxChange={(taskIndex, checked) => {
          const change = getMarkdownTaskCheckboxChange(this.markdown, taskIndex, checked);
          if (!change) return;
          const nextBlock = applyMarkdownTaskCheckboxChange(this.markdown, change);
          view.dispatch({
            changes: {
              from: this.from,
              to: this.to,
              insert: nextBlock,
            },
          });
        }}
      />,
    );
    return host;
  }

  destroy(dom: HTMLElement): void {
    const root = roots.get(dom);
    roots.delete(dom);
    queueMicrotask(() => root?.unmount());
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  // Large documents stay responsive because CodeMirror's syntax tree is incremental;
  // this hard ceiling prevents thousands of React roots on pathological imports.
  if (view.state.doc.length > 350_000) return Decoration.none;

  const builder = new RangeSetBuilder<Decoration>();
  for (const block of collectMarkdownLivePreviewBlocks(view)) {
    builder.add(
      block.from,
      block.to,
      Decoration.replace({
        widget: new MarkdownLivePreviewWidget(block.markdown, block.from, block.to),
        block: true,
      }),
    );
  }
  return builder.finish();
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

const livePreviewTheme = EditorView.theme({
  ".cm-live-preview-block": {
    boxSizing: "border-box",
    cursor: "text",
    padding: "2px 12px",
    width: "100%",
  },
  ".cm-live-preview-block:hover": {
    backgroundColor: "color-mix(in srgb, var(--color-app-hover, #f1f5f9) 55%, transparent)",
    borderRadius: "8px",
  },
  ".cm-live-preview-block .nowen-md-preview": {
    maxWidth: "none",
    margin: "0",
  },
  ".cm-live-preview-block .cm-live-preview-render > :first-child": {
    marginTop: "0",
  },
  ".cm-live-preview-block .cm-live-preview-render > :last-child": {
    marginBottom: "0",
  },
});

export const markdownLivePreviewExtension: Extension = [livePreviewPlugin, livePreviewTheme];
