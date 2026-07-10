from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8-sig")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8", newline="\n")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one exact match, found {count}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))


def replace_between(path: str, start_marker: str, end_marker: str, replacement: str) -> None:
    text = read(path)
    start = text.find(start_marker)
    if start < 0:
        raise RuntimeError(f"{path}: start marker not found: {start_marker!r}")
    end = text.find(end_marker, start)
    if end < 0:
        raise RuntimeError(f"{path}: end marker not found: {end_marker!r}")
    write(path, text[:start] + replacement + text[end:])


IMAGE_TRANSFORM = r'''import { mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";

export type ImageWidthMode = "25%" | "50%" | "75%" | "100%" | "original" | "custom";
export type ImageRotation = 0 | 90 | 180 | 270;

export interface ImageTransformAttrs {
  width?: number | string | null;
  height?: number | string | null;
  widthMode?: ImageWidthMode | string | null;
  rotation?: ImageRotation | number | string | null;
  flipX?: boolean | number | string | null;
}

const WIDTH_MODES = new Set<ImageWidthMode>([
  "25%",
  "50%",
  "75%",
  "100%",
  "original",
  "custom",
]);

export function isImageWidthMode(value: unknown): value is ImageWidthMode {
  return typeof value === "string" && WIDTH_MODES.has(value as ImageWidthMode);
}

export function toPositiveImageWidth(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function normalizeImageWidthMode(value: unknown, width?: unknown): ImageWidthMode {
  if (isImageWidthMode(value)) return value;
  return toPositiveImageWidth(width) != null ? "custom" : "original";
}

export function imageWidthModeFromRatio(ratio: number | null): ImageWidthMode {
  if (ratio == null) return "original";
  if (ratio <= 0.25) return "25%";
  if (ratio <= 0.5) return "50%";
  if (ratio <= 0.75) return "75%";
  return "100%";
}

export function imageWidthModePercent(mode: unknown): number | null {
  switch (mode) {
    case "25%": return 0.25;
    case "50%": return 0.5;
    case "75%": return 0.75;
    case "100%": return 1;
    default: return null;
  }
}

export function normalizeImageRotation(value: unknown): ImageRotation {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const normalized = ((Math.round(numeric / 90) * 90) % 360 + 360) % 360;
  return normalized as ImageRotation;
}

export function normalizeImageFlipX(value: unknown): boolean {
  if (value === true || value === 1 || value === "1") return true;
  return typeof value === "string" && value.toLowerCase() === "true";
}

export function getImageTransformCss(rotationValue: unknown, flipValue: unknown): string {
  const rotation = normalizeImageRotation(rotationValue);
  const flipX = normalizeImageFlipX(flipValue);
  const transforms: string[] = [];
  if (rotation !== 0) transforms.push(`rotate(${rotation}deg)`);
  if (flipX) transforms.push("scaleX(-1)");
  return transforms.join(" ");
}

function parseRotationFromElement(element: HTMLElement): ImageRotation {
  const dataValue = element.getAttribute("data-image-rotation");
  if (dataValue != null) return normalizeImageRotation(dataValue);
  const match = element.style.transform.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/i);
  return normalizeImageRotation(match?.[1]);
}

function parseFlipFromElement(element: HTMLElement): boolean {
  const dataValue = element.getAttribute("data-image-flip-x");
  if (dataValue != null) return normalizeImageFlipX(dataValue);
  return /scaleX\(\s*-1\s*\)/i.test(element.style.transform || "");
}

function mergeStyle(existing: unknown, additions: string[]): string | undefined {
  const parts = [typeof existing === "string" ? existing.trim().replace(/;+$/, "") : "", ...additions]
    .filter(Boolean);
  return parts.length ? `${parts.join(";")};` : undefined;
}

/**
 * Shared image schema used by the editor, imports, exports and schema repair.
 * The original binary is never rewritten: layout and transforms live on the image node.
 */
export const TransformableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => toPositiveImageWidth(
          element.getAttribute("width") || element.getAttribute("data-width") || element.style.width,
        ),
        renderHTML: (attributes: ImageTransformAttrs) => {
          const width = toPositiveImageWidth(attributes.width);
          return width == null ? {} : { width: Math.round(width) };
        },
      },
      height: {
        default: null,
        parseHTML: (element: HTMLElement) => toPositiveImageWidth(element.getAttribute("height")),
        renderHTML: (attributes: ImageTransformAttrs) => {
          const height = toPositiveImageWidth(attributes.height);
          return height == null ? {} : { height: Math.round(height) };
        },
      },
      widthMode: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute("data-width-mode");
          return raw && isImageWidthMode(raw) ? raw : null;
        },
        renderHTML: (attributes: ImageTransformAttrs) =>
          isImageWidthMode(attributes.widthMode)
            ? { "data-width-mode": attributes.widthMode }
            : {},
      },
      rotation: {
        default: 0,
        parseHTML: parseRotationFromElement,
        renderHTML: (attributes: ImageTransformAttrs) => {
          const rotation = normalizeImageRotation(attributes.rotation);
          return rotation === 0 ? {} : { "data-image-rotation": rotation };
        },
      },
      flipX: {
        default: false,
        parseHTML: parseFlipFromElement,
        renderHTML: (attributes: ImageTransformAttrs) =>
          normalizeImageFlipX(attributes.flipX) ? { "data-image-flip-x": "true" } : {},
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    const attributes: Record<string, unknown> = { ...HTMLAttributes };
    const widthMode = normalizeImageWidthMode(
      attributes["data-width-mode"],
      attributes.width,
    );
    const rotation = normalizeImageRotation(attributes["data-image-rotation"]);
    const flipX = normalizeImageFlipX(attributes["data-image-flip-x"]);
    const additions: string[] = [];
    const percent = imageWidthModePercent(widthMode);
    if (percent != null) {
      additions.push(`width:${Math.round(percent * 100)}%`, "height:auto", "max-width:100%");
    }
    const transform = getImageTransformCss(rotation, flipX);
    if (transform) additions.push(`transform:${transform}`, "transform-origin:center center");
    const style = mergeStyle(attributes.style, additions);
    if (style) attributes.style = style;
    return ["img", mergeAttributes(this.options.HTMLAttributes, attributes)];
  },
});
'''

IMAGE_TRANSFORM_TEST = r'''import { describe, expect, it } from "vitest";
import { generateHTML, generateJSON } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  TransformableImage,
  getImageTransformCss,
  imageWidthModeFromRatio,
  imageWidthModePercent,
  normalizeImageFlipX,
  normalizeImageRotation,
  normalizeImageWidthMode,
} from "@/lib/imageNodeTransform";

const extensions = [
  StarterKit,
  TransformableImage.configure({ inline: false, allowBase64: true }),
];

describe("image node transforms", () => {
  it("normalizes rotations, flips and width presets", () => {
    expect(normalizeImageRotation(-90)).toBe(270);
    expect(normalizeImageRotation(450)).toBe(90);
    expect(normalizeImageFlipX("true")).toBe(true);
    expect(normalizeImageFlipX(false)).toBe(false);
    expect(normalizeImageWidthMode(undefined, 320)).toBe("custom");
    expect(normalizeImageWidthMode(undefined, null)).toBe("original");
    expect(imageWidthModeFromRatio(0.5)).toBe("50%");
    expect(imageWidthModePercent("75%")).toBe(0.75);
    expect(getImageTransformCss(90, true)).toBe("rotate(90deg) scaleX(-1)");
  });

  it("round-trips persistent image layout attributes through HTML", () => {
    const doc = {
      type: "doc",
      content: [{
        type: "image",
        attrs: {
          src: "https://example.com/a.png",
          alt: "A",
          title: null,
          width: null,
          height: null,
          widthMode: "50%",
          rotation: 270,
          flipX: true,
        },
      }],
    };

    const html = generateHTML(doc as any, extensions);
    expect(html).toContain('data-width-mode="50%"');
    expect(html).toContain('data-image-rotation="270"');
    expect(html).toContain('data-image-flip-x="true"');
    expect(html).toContain("width:50%");
    expect(html).toContain("rotate(270deg) scaleX(-1)");

    const parsed = generateJSON(html, extensions) as any;
    const attrs = parsed.content[0].attrs;
    expect(attrs.widthMode).toBe("50%");
    expect(attrs.rotation).toBe(270);
    expect(attrs.flipX).toBe(true);
  });

  it("keeps custom pixel widths backward compatible", () => {
    const parsed = generateJSON('<img src="/a.png" width="420" />', extensions) as any;
    const attrs = parsed.content[0].attrs;
    expect(attrs.width).toBe(420);
    expect(normalizeImageWidthMode(attrs.widthMode, attrs.width)).toBe("custom");
  });
});
'''

write("frontend/src/lib/imageNodeTransform.ts", IMAGE_TRANSFORM)
write("frontend/src/lib/__tests__/imageNodeTransform.test.ts", IMAGE_TRANSFORM_TEST)

# imageToolbar: preserve transform attrs when replacing the binary.
replace_once(
    "frontend/src/lib/imageToolbar.ts",
    "export interface ImageNodeAttrs {\n",
    "import type { ImageRotation, ImageWidthMode } from \"@/lib/imageNodeTransform\";\n\nexport interface ImageNodeAttrs {\n",
)
replace_once(
    "frontend/src/lib/imageToolbar.ts",
    "  height?: number | string | null;\n}",
    "  height?: number | string | null;\n  widthMode?: ImageWidthMode | string | null;\n  rotation?: ImageRotation | number | string | null;\n  flipX?: boolean | number | string | null;\n}",
)
replace_once(
    "frontend/src/lib/imageToolbar.ts",
    "    height: current.height ?? null,\n",
    "    height: current.height ?? null,\n    widthMode: current.widthMode ?? null,\n    rotation: current.rotation ?? 0,\n    flipX: current.flipX ?? false,\n",
)

# Tiptap editor schema + controls.
replace_once(
    "frontend/src/components/TiptapEditor.tsx",
    'import Image from "@tiptap/extension-image";\n',
    'import {\n  TransformableImage,\n  imageWidthModeFromRatio,\n  normalizeImageFlipX,\n  normalizeImageRotation,\n} from "@/lib/imageNodeTransform";\n',
)
replace_once(
    "frontend/src/components/TiptapEditor.tsx",
    "  Code, FileCode, Sparkles, X, ZoomIn, ZoomOut, RotateCcw,\n",
    "  Code, FileCode, Sparkles, X, ZoomIn, ZoomOut, RotateCcw, RotateCw, FlipHorizontal,\n",
)
replace_between(
    "frontend/src/components/TiptapEditor.tsx",
    "      // Image 扩展：在原扩展基础上",
    "      CodeBlockLowlight.extend({",
    '''      // 图片节点：像素宽度、宽度模式、旋转和水平翻转全部写入文档 attrs。\n      // NodeView 只负责交互展示；导入、导出和 schema repair 复用同一扩展。\n      TransformableImage.extend({\n        addNodeView() {\n          return ReactNodeViewRenderer(ResizableImageView);\n        },\n      }).configure({\n        inline: true,\n        allowBase64: true,\n        HTMLAttributes: { class: "rounded-lg max-w-full mx-auto my-4 shadow-md" },\n      }),\n''',
)
replace_between(
    "frontend/src/components/TiptapEditor.tsx",
    "  const handleSetSelectedImageSize = useCallback((ratio: number | null) => {",
    "  // 动态切换编辑器的可编辑状态",
    '''  const handleSetSelectedImageSize = useCallback((ratio: number | null) => {\n    if (!editor) return;\n    editor\n      .chain()\n      .focus()\n      .updateAttributes("image", {\n        widthMode: imageWidthModeFromRatio(ratio),\n        width: null,\n        height: null,\n      })\n      .run();\n    setImageSizeMenuOpen(false);\n  }, [editor]);\n\n  const handleRotateSelectedImage = useCallback((delta: -90 | 90) => {\n    if (!editor) return;\n    const attrs = getSelectedImageAttrs();\n    const rotation = normalizeImageRotation(normalizeImageRotation(attrs?.rotation) + delta);\n    editor.chain().focus().updateAttributes("image", { rotation }).run();\n  }, [editor, getSelectedImageAttrs]);\n\n  const handleFlipSelectedImage = useCallback(() => {\n    if (!editor) return;\n    const attrs = getSelectedImageAttrs();\n    editor\n      .chain()\n      .focus()\n      .updateAttributes("image", { flipX: !normalizeImageFlipX(attrs?.flipX) })\n      .run();\n  }, [editor, getSelectedImageAttrs]);\n\n''',
)
replace_once(
    "frontend/src/components/TiptapEditor.tsx",
    '''        const { top, left } = getImageToolbarPosition(rect, {\n          width: window.innerWidth,\n          height: window.innerHeight,\n        });''',
    '''        const { top, left } = getImageToolbarPosition(rect, {\n          width: window.innerWidth,\n          height: window.innerHeight,\n        }, { toolbarWidth: 400 });''',
)
replace_once(
    "frontend/src/components/TiptapEditor.tsx",
    '''    editor.on("selectionUpdate", updateBubble);\n    editor.on("blur", onBlur);''',
    '''    const onImageTransaction = () => {\n      if (!editor.isActive("image")) return;\n      requestAnimationFrame(updateBubble);\n    };\n\n    editor.on("selectionUpdate", updateBubble);\n    editor.on("transaction", onImageTransaction);\n    editor.on("blur", onBlur);''',
)
replace_once(
    "frontend/src/components/TiptapEditor.tsx",
    '''      editor.off("selectionUpdate", updateBubble);\n      editor.off("blur", onBlur);''',
    '''      editor.off("selectionUpdate", updateBubble);\n      editor.off("transaction", onImageTransaction);\n      editor.off("blur", onBlur);''',
)
replace_once(
    "frontend/src/components/TiptapEditor.tsx",
    '''          </div>\n        </div>\n      )}\n\n      {editor && editable && !isGuest && imageBubble.open && isMobile && (''',
    '''          </div>\n          <div className="w-px h-4 bg-app-border mx-0.5" />\n          <ToolbarButton title={t("tiptap.imageRotateLeft")} onClick={() => handleRotateSelectedImage(-90)}>\n            <RotateCcw size={14} />\n          </ToolbarButton>\n          <ToolbarButton title={t("tiptap.imageRotateRight")} onClick={() => handleRotateSelectedImage(90)}>\n            <RotateCw size={14} />\n          </ToolbarButton>\n          <ToolbarButton title={t("tiptap.imageFlipHorizontal")} onClick={handleFlipSelectedImage}>\n            <FlipHorizontal size={14} />\n          </ToolbarButton>\n        </div>\n      )}\n\n      {editor && editable && !isGuest && imageBubble.open && isMobile && (''',
)
replace_once(
    "frontend/src/components/TiptapEditor.tsx",
    '''            </div>\n          </div>\n        </div>\n      )}\n\n      {/* 选区气泡菜单：表格操作''',
    '''            </div>\n          </div>\n          <div className="mt-3">\n            <div className="mb-1.5 text-xs font-medium text-tx-tertiary">{t("tiptap.imageTransform")}</div>\n            <div className="grid grid-cols-3 gap-2">\n              <button type="button" title={t("tiptap.imageRotateLeft")} onClick={() => handleRotateSelectedImage(-90)}\n                className="flex h-10 items-center justify-center gap-1.5 rounded-lg border border-app-border text-xs text-tx-secondary active:bg-app-hover">\n                <RotateCcw size={16} /> {t("tiptap.imageRotateLeftShort")}\n              </button>\n              <button type="button" title={t("tiptap.imageRotateRight")} onClick={() => handleRotateSelectedImage(90)}\n                className="flex h-10 items-center justify-center gap-1.5 rounded-lg border border-app-border text-xs text-tx-secondary active:bg-app-hover">\n                <RotateCw size={16} /> {t("tiptap.imageRotateRightShort")}\n              </button>\n              <button type="button" title={t("tiptap.imageFlipHorizontal")} onClick={handleFlipSelectedImage}\n                className="flex h-10 items-center justify-center gap-1.5 rounded-lg border border-app-border text-xs text-tx-secondary active:bg-app-hover">\n                <FlipHorizontal size={16} /> {t("tiptap.imageFlipHorizontalShort")}\n              </button>\n            </div>\n          </div>\n        </div>\n      )}\n\n      {/* 选区气泡菜单：表格操作''',
)

# Resizable node view: render persistent width modes and transforms while keeping drag resize.
replace_once(
    "frontend/src/components/ResizableImageView.tsx",
    'import { resolveAttachmentUrl, getServerUrl } from "@/lib/api";\n',
    'import { resolveAttachmentUrl, getServerUrl } from "@/lib/api";\nimport {\n  getImageTransformCss,\n  imageWidthModePercent,\n  normalizeImageFlipX,\n  normalizeImageRotation,\n  normalizeImageWidthMode,\n  toPositiveImageWidth,\n} from "@/lib/imageNodeTransform";\n',
)
replace_once(
    "frontend/src/components/ResizableImageView.tsx",
    '''  const { src, alt, title } = node.attrs as { src?: string; alt?: string; title?: string };\n  const initialWidth = (node.attrs as { width?: number | string | null }).width ?? null;''',
    '''  const { src, alt, title } = node.attrs as { src?: string; alt?: string; title?: string };\n  const attrs = node.attrs as {\n    width?: number | string | null;\n    widthMode?: string | null;\n    rotation?: number | string | null;\n    flipX?: boolean | number | string | null;\n  };\n  const initialWidth = attrs.width ?? null;\n  const widthMode = normalizeImageWidthMode(attrs.widthMode, initialWidth);\n  const rotation = normalizeImageRotation(attrs.rotation);\n  const flipX = normalizeImageFlipX(attrs.flipX);''',
)
replace_once(
    "frontend/src/components/ResizableImageView.tsx",
    "      updateAttributes({ width: clamped });",
    '      updateAttributes({ width: clamped, height: null, widthMode: "custom" });',
)
replace_once(
    "frontend/src/components/ResizableImageView.tsx",
    "(img?.getBoundingClientRect().width ?? img?.naturalWidth ?? 300)",
    "(img?.offsetWidth ?? img?.naturalWidth ?? 300)",
)
replace_once(
    "frontend/src/components/ResizableImageView.tsx",
    "(img?.getBoundingClientRect().width ?? img?.naturalWidth ?? 300)",
    "(img?.offsetWidth ?? img?.naturalWidth ?? 300)",
)
replace_once(
    "frontend/src/components/ResizableImageView.tsx",
    '''  // 显示用的宽度：拖拽中用 draft，否则用 attribute（null 时交给图片自然宽度）\n  const displayWidth = draftWidth ?? (typeof initialWidth === "number" ? initialWidth : null);''',
    '''  // 百分比预设保持为文档属性；拖动时切回 custom 像素宽度。\n  const storedWidth = toPositiveImageWidth(initialWidth);\n  const displayWidth = draftWidth ?? storedWidth;\n  const widthPercent = imageWidthModePercent(widthMode);\n  const wrapperWidth = draftWidth != null\n    ? `${draftWidth}px`\n    : widthPercent != null\n      ? `${Math.round(widthPercent * 100)}%`\n      : displayWidth != null\n        ? `${displayWidth}px`\n        : undefined;\n  const transform = getImageTransformCss(rotation, flipX);''',
)
replace_once(
    "frontend/src/components/ResizableImageView.tsx",
    '''      data-drag-handle\n      className="resizable-image-wrapper"''',
    '''      data-drag-handle\n      data-image-rotation={rotation}\n      data-image-flip-x={flipX ? "true" : "false"}\n      data-width-mode={widthMode}\n      className="resizable-image-wrapper"''',
)
replace_once(
    "frontend/src/components/ResizableImageView.tsx",
    '''        maxWidth: "100%",\n        // 上下 margin 收紧''',
    '''        width: wrapperWidth,\n        maxWidth: "100%",\n        transform: transform || undefined,\n        transformOrigin: "center center",\n        transition: draftWidth == null ? "transform 160ms ease" : undefined,\n        // 上下 margin 收紧''',
)
replace_once(
    "frontend/src/components/ResizableImageView.tsx",
    '''        width={displayWidth ?? undefined}\n        style={{\n          display: "block",\n          width: displayWidth != null ? `${displayWidth}px` : undefined,''',
    '''        width={widthPercent == null ? displayWidth ?? undefined : undefined}\n        style={{\n          display: "block",\n          width: wrapperWidth ? "100%" : undefined,''',
)

# Use one shared schema in every import/export/repair path.
for path in [
    "frontend/src/lib/contentFormat.ts",
    "frontend/src/lib/importService.ts",
    "frontend/src/lib/exportService.ts",
]:
    replace_once(path, 'import Image from "@tiptap/extension-image";\n', 'import { TransformableImage } from "@/lib/imageNodeTransform";\n')

replace_between(
    "frontend/src/lib/contentFormat.ts",
    "    Image.extend({",
    "    CodeBlockLowlight.configure({ lowlight }),",
    '    TransformableImage.configure({ inline: false, allowBase64: true }),\n',
)
replace_once(
    "frontend/src/lib/importService.ts",
    "  Image.configure({ inline: false, allowBase64: true }),",
    "  TransformableImage.configure({ inline: false, allowBase64: true }),",
)
replace_once(
    "frontend/src/lib/exportService.ts",
    "  Image.configure({ inline: false, allowBase64: true }),",
    "  TransformableImage.configure({ inline: false, allowBase64: true }),",
)

# Preserve transform metadata when converting Tiptap HTML to Markdown HTML islands.
replace_between(
    "frontend/src/lib/contentFormat.ts",
    '  td.addRule("imageWithWidth", {',
    "  // 下划线保持 HTML",
    r'''  td.addRule("imageWithLayout", {
    filter: (node) => {
      if (node.nodeName !== "IMG") return false;
      const el = node as Element;
      return !!(
        el.getAttribute("width") ||
        el.getAttribute("data-width") ||
        el.getAttribute("data-width-mode") ||
        el.getAttribute("data-image-rotation") ||
        el.getAttribute("data-image-flip-x") ||
        (el as HTMLElement).style?.width ||
        (el as HTMLElement).style?.transform
      );
    },
    replacement: (_content, node) => {
      const el = node as Element;
      const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      const src = escape(el.getAttribute("src") || "");
      const alt = escape(el.getAttribute("alt") || "");
      const rawWidth =
        el.getAttribute("width") ||
        el.getAttribute("data-width") ||
        ((el as HTMLElement).style?.width || "").replace(/px$/i, "") ||
        "";
      const widthMatch = String(rawWidth).trim().match(/^(\d+(?:\.\d+)?)$/);
      const width = widthMatch ? Math.round(Number(widthMatch[1])) : null;
      const widthMode = el.getAttribute("data-width-mode") || "";
      const rotation = el.getAttribute("data-image-rotation") || "";
      const flipX = el.getAttribute("data-image-flip-x") || "";
      const attrs = [
        width && width > 0 ? ` width="${width}"` : "",
        /^(25%|50%|75%|100%|original|custom)$/.test(widthMode)
          ? ` data-width-mode="${widthMode}"`
          : "",
        /^(0|90|180|270)$/.test(rotation) && rotation !== "0"
          ? ` data-image-rotation="${rotation}"`
          : "",
        flipX === "true" ? ' data-image-flip-x="true"' : "",
      ].join("");
      return `<img src="${src}" alt="${alt}"${attrs} />`;
    },
  });

''',
)

# Markdown preview keeps only safe data attrs and computes transform itself.
replace_once(
    "frontend/src/components/MarkdownPreview.tsx",
    'import { MarkdownCodeBlock, isMarkdownBlockCode } from "@/components/MarkdownCodeBlock";\n',
    'import { MarkdownCodeBlock, isMarkdownBlockCode } from "@/components/MarkdownCodeBlock";\nimport {\n  getImageTransformCss,\n  imageWidthModePercent,\n  normalizeImageFlipX,\n  normalizeImageRotation,\n  normalizeImageWidthMode,\n  toPositiveImageWidth,\n} from "@/lib/imageNodeTransform";\n',
)
replace_once(
    "frontend/src/components/MarkdownPreview.tsx",
    '''    code: ["className"],\n  },''',
    '''    code: ["className"],\n    img: [\n      ...(((defaultSchema.attributes || {}) as Record<string, any[]>).img || []),\n      "src", "alt", "title", "width", "height",\n      "dataImageRotation", "dataImageFlipX", "dataWidthMode",\n    ],\n  },''',
)
replace_between(
    "frontend/src/components/MarkdownPreview.tsx",
    "function PreviewImage(",
    "function PreviewLink(",
    r'''function imageNodeProperty(node: any, kebab: string, camel: string): unknown {
  return node?.properties?.[kebab] ?? node?.properties?.[camel];
}

function PreviewImage({ node, src, alt, width }: { node?: any; src?: string; alt?: string; width?: number | string }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  if (!src) return null;
  if (failed) {
    return <span className="inline-flex items-center gap-1 rounded-lg bg-app-hover px-3 py-2 text-xs text-tx-tertiary">⚠ {t("markdown.preview.imageLoadFailed")}</span>;
  }
  const widthMode = normalizeImageWidthMode(
    imageNodeProperty(node, "data-width-mode", "dataWidthMode"),
    width,
  );
  const percent = imageWidthModePercent(widthMode);
  const pixelWidth = toPositiveImageWidth(width);
  const rotation = normalizeImageRotation(imageNodeProperty(node, "data-image-rotation", "dataImageRotation"));
  const flipX = normalizeImageFlipX(imageNodeProperty(node, "data-image-flip-x", "dataImageFlipX"));
  const transform = getImageTransformCss(rotation, flipX);
  return (
    <img
      src={src}
      alt={alt || ""}
      loading="lazy"
      className="my-4 block max-h-[520px] max-w-full cursor-pointer rounded-xl border border-app-border object-contain shadow-sm transition-opacity hover:opacity-90"
      style={{
        width: percent != null ? `${Math.round(percent * 100)}%` : pixelWidth != null ? `${pixelWidth}px` : undefined,
        height: "auto",
        transform: transform || undefined,
        transformOrigin: "center center",
      }}
      onClick={() => window.open(src, "_blank", "noopener,noreferrer")}
      onError={() => setFailed(true)}
    />
  );
}

function PreviewMediaImage(props: any) {
  const normalizedAlt = props.alt || "";
  if (normalizedAlt.startsWith("nowen-video:")) {
    return <MarkdownVideoPreview src={props.src || ""} title={normalizedAlt.slice("nowen-video:".length)} />;
  }
  return <PreviewImage {...props} />;
}

''',
)

# Localized tooltips and compact mobile labels.
translations = {
    "frontend/src/i18n/locales/zh-CN.json": {
        "imageRotateLeft": "向左旋转 90°",
        "imageRotateRight": "向右旋转 90°",
        "imageFlipHorizontal": "水平翻转",
        "imageTransform": "旋转与翻转",
        "imageRotateLeftShort": "左转",
        "imageRotateRightShort": "右转",
        "imageFlipHorizontalShort": "翻转",
    },
    "frontend/src/i18n/locales/en.json": {
        "imageRotateLeft": "Rotate left 90°",
        "imageRotateRight": "Rotate right 90°",
        "imageFlipHorizontal": "Flip horizontally",
        "imageTransform": "Rotate and flip",
        "imageRotateLeftShort": "Left",
        "imageRotateRightShort": "Right",
        "imageFlipHorizontalShort": "Flip",
    },
}
for path, values in translations.items():
    data = json.loads(read(path))
    tiptap = data.setdefault("tiptap", {})
    tiptap.update(values)
    write(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")

print("Issue #201 source patch applied")
