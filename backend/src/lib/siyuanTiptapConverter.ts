import type { SiyuanNode } from "./siyuanSyParser";

export interface TiptapJsonNode {
    type: string;
    attrs?: Record<string, unknown>;
    content?: TiptapJsonNode[];
    text?: string;
    marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export interface SiyuanTiptapConvertOptions {
    resolveAssetUrl?: (raw: string) => string | null;
}

const MARKER_NODE_TYPES = new Set([
    "NodeHeadingC8hMarker",
    "NodeBang",
    "NodeOpenBracket",
    "NodeCloseBracket",
    "NodeOpenParen",
    "NodeCloseParen",
    "NodeOpenBrace",
    "NodeCloseBrace",
    "NodeKramdownSpanIAL",
    "NodeBlockquoteMarker",
    "NodeCodeBlockFenceOpenMarker",
    "NodeCodeBlockFenceCloseMarker",
    "NodeCodeBlockFenceInfoMarker",
    "NodeMathBlockOpenMarker",
    "NodeMathBlockCloseMarker",
    "NodeSuperBlockOpenMarker",
    "NodeSuperBlockLayoutMarker",
    "NodeSuperBlockCloseMarker",
    "NodeTaskListItemMarker",
]);

function getValue(node: SiyuanNode | undefined, keys: string[]): unknown {
    if (!node) return undefined;
    for (const key of keys) {
        if (node[key] !== undefined) return node[key];
        if (node.Properties?.[key] !== undefined) return node.Properties[key];
    }
    const lowerKeys = new Set(keys.map((key) => key.toLowerCase()));
    for (const [key, value] of Object.entries(node.Properties || {})) {
        if (lowerKeys.has(key.toLowerCase())) return value;
    }
    for (const [key, value] of Object.entries(node)) {
        if (lowerKeys.has(key.toLowerCase())) return value;
    }
    return undefined;
}

function getString(node: SiyuanNode | undefined, keys: string[]): string {
    const value = getValue(node, keys);
    return typeof value === "string" ? value : value == null ? "" : String(value);
}

function looksLikeAssetOrUrl(value: string): boolean {
    return /^(https?:|data:|blob:|file:|\/|\.\/|\.\.\/|assets\/)/i.test(value.trim()) ||
        /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|mp4|webm|ogg|ogv|m4v|mov|mp3|wav|m4a|flac|aac)([?#].*)?$/i.test(value);
}

function extractSrc(text: string): string {
    return text.match(/\bsrc=["']([^"']+)["']/i)?.[1] || text.match(/\(([^)]+)\)/)?.[1] || text.trim();
}

function getHeadingLevel(node: SiyuanNode): number {
    const raw =
        getString(node, ["HeadingLevel", "headingLevel", "level", "Level"]) ||
        getString((node.Children || []).find((child) => child.Type === "NodeHeadingC8hMarker"), ["Data"]);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(3, Math.max(1, parsed));
}

function isTaskItem(node: SiyuanNode): boolean {
    return (node.Children || []).some((child) => child.Type === "NodeTaskListItemMarker") ||
        getString(node, ["TaskChecked", "checked", "Checked"]).trim() !== "";
}

function isCheckedTask(node: SiyuanNode): boolean {
    const data = [
        getString(node, ["Data"]),
        getString(node, ["TaskChecked", "checked", "Checked"]),
        ...(node.Children || []).map((child) => getString(child, ["Data"])),
    ]
        .join(" ")
        .toLowerCase();
    return data.includes("[x]") || data.includes("checked") || data.includes("done") || data.includes("true");
}

function isOrderedList(node: SiyuanNode): boolean {
    const hint = [
        node.Type,
        getString(node, ["ListData", "SubType", "subType", "listType", "type"]),
        getString(node, ["Data"]),
    ].join(" ").toLowerCase();
    return /\b(ordered|order|ol|number)\b/.test(hint);
}

function withMark(node: TiptapJsonNode, mark: { type: string; attrs?: Record<string, unknown> }): TiptapJsonNode {
    if (node.type !== "text") return node;
    return { ...node, marks: [...(node.marks || []), mark] };
}

function textNode(text: string, marks?: TiptapJsonNode["marks"]): TiptapJsonNode[] {
    if (!text) return [];
    return [{ type: "text", text, ...(marks?.length ? { marks } : {}) }];
}

function trimParagraphBoundary(content: TiptapJsonNode[]): TiptapJsonNode[] {
    const next = content.map((item) => ({ ...item }));
    while (next[0]?.type === "text" && !next[0].marks?.length) {
        next[0].text = (next[0].text || "").replace(/^\s+/, "");
        if (next[0].text) break;
        next.shift();
    }
    while (next[next.length - 1]?.type === "text" && !next[next.length - 1].marks?.length) {
        const last = next[next.length - 1];
        last.text = (last.text || "").replace(/\s+$/, "");
        if (last.text) break;
        next.pop();
    }
    return next;
}

function renderTextMark(node: SiyuanNode, options: SiyuanTiptapConvertOptions): TiptapJsonNode[] {
    const markType = getString(node, ["TextMarkType", "type", "markType"]).toLowerCase();
    const rawText = getString(node, ["TextMarkTextContent", "Text", "text", "Data"]);
    const content = rawText ? textNode(rawText) : renderInlineContent(node, options);
    const href = getString(node, ["TextMarkAHref", "href", "url", "dest"]);

    switch (markType) {
        case "strong":
            return content.map((item) => withMark(item, { type: "bold" }));
        case "em":
            return content.map((item) => withMark(item, { type: "italic" }));
        case "s":
        case "strike":
            return content.map((item) => withMark(item, { type: "strike" }));
        case "code":
            return content.map((item) => withMark(item, { type: "code" }));
        case "u":
            return content.map((item) => withMark(item, { type: "underline" }));
        case "mark":
            return content.map((item) => withMark(item, { type: "highlight" }));
        case "a":
            return href ? content.map((item) => withMark(item, { type: "link", attrs: { href } })) : content;
        default:
            return content;
    }
}

function renderInlineContent(node: SiyuanNode, options: SiyuanTiptapConvertOptions): TiptapJsonNode[] {
    const out: TiptapJsonNode[] = [];
    for (const child of node.Children || []) {
        out.push(...renderInline(child, options));
    }
    return out;
}

function renderInline(node: SiyuanNode, options: SiyuanTiptapConvertOptions): TiptapJsonNode[] {
    if (MARKER_NODE_TYPES.has(node.Type)) return [];

    switch (node.Type) {
        case "NodeText":
        case "NodeCodeBlockCode":
        case "NodeMathBlockContent":
        case "NodeLinkText":
        case "NodeLinkDest":
            return textNode(getString(node, ["Data"]));
        case "NodeTextMark":
            return renderTextMark(node, options);
        case "NodeBr":
            return [{ type: "hardBreak" }];
        case "NodeBackslash":
        case "NodeBlockRef":
        case "NodeInlineHTML":
            return textNode(getString(node, ["Data", "Text", "text", "Tokens", "HTML", "html"]) || renderPlainText(node));
        default:
            return textNode(getString(node, ["Data"]) || renderPlainText(node));
    }
}

function renderParagraphLike(node: SiyuanNode, options: SiyuanTiptapConvertOptions): TiptapJsonNode[] {
    const blocks: TiptapJsonNode[] = [];
    let inline: TiptapJsonNode[] = [];
    const flushParagraph = () => {
        const content = trimParagraphBoundary(inline);
        inline = [];
        if (content.length > 0) {
            blocks.push({ type: "paragraph", content });
        }
    };

    for (const child of node.Children || []) {
        if (MARKER_NODE_TYPES.has(child.Type)) continue;
        if (child.Type === "NodeImage" || child.Type === "NodeVideo") {
            flushParagraph();
            blocks.push(...renderBlock(child, options));
            continue;
        }
        inline.push(...renderInline(child, options));
    }

    flushParagraph();
    if (blocks.length === 0) {
        const data = getString(node, ["Data"]);
        blocks.push(data ? { type: "paragraph", content: textNode(data) } : { type: "paragraph" });
    }
    return blocks;
}

function renderListItemContent(node: SiyuanNode, options: SiyuanTiptapConvertOptions): TiptapJsonNode[] {
    const content: TiptapJsonNode[] = [];
    for (const child of node.Children || []) {
        if (MARKER_NODE_TYPES.has(child.Type)) continue;
        if (child.Type === "NodeParagraph") {
            const paragraph = renderParagraphLike(child, options).filter((item) => item.type === "paragraph");
            content.push(...paragraph);
            continue;
        }
        content.push(...renderBlock(child, options));
    }
    return content.length > 0 ? content : [{ type: "paragraph" }];
}

function renderList(node: SiyuanNode, options: SiyuanTiptapConvertOptions): TiptapJsonNode[] {
    const items = (node.Children || []).filter((child) => child.Type === "NodeListItem");
    if (items.length === 0) return [];

    const taskList = items.some(isTaskItem);
    if (taskList) {
        return [{
            type: "taskList",
            content: items.map((item) => ({
                type: "taskItem",
                attrs: { checked: isCheckedTask(item) },
                content: renderListItemContent(item, options),
            })),
        }];
    }

    return [{
        type: isOrderedList(node) ? "orderedList" : "bulletList",
        content: items.map((item) => ({
            type: "listItem",
            content: renderListItemContent(item, options),
        })),
    }];
}

function resolveMediaSrc(raw: string, options: SiyuanTiptapConvertOptions): string {
    return options.resolveAssetUrl?.(raw) || raw;
}

function renderImage(node: SiyuanNode, options: SiyuanTiptapConvertOptions): TiptapJsonNode[] {
    const childDest = getString((node.Children || []).find((child) => child.Type === "NodeLinkDest"), ["Data"]);
    const explicitSrc = getString(node, ["src", "href", "url"]);
    const data = getString(node, ["Data"]);
    const src = childDest || explicitSrc || (looksLikeAssetOrUrl(data) ? data : "");
    const alt =
        getString(node, ["alt", "title"]) ||
        getString((node.Children || []).find((child) => child.Type === "NodeLinkText"), ["Data"]) ||
        renderPlainText((node.Children || []).find((child) => child.Type === "NodeLinkText"));
    const title = getString((node.Children || []).find((child) => child.Type === "NodeLinkTitle"), ["Data"]);
    if (!src) return alt ? [{ type: "paragraph", content: textNode(alt) }] : [];
    return [{
        type: "image",
        attrs: {
            src: resolveMediaSrc(src, options),
            alt: alt || null,
            title: title || null,
        },
    }];
}

function renderVideo(node: SiyuanNode, options: SiyuanTiptapConvertOptions): TiptapJsonNode[] {
    const raw = getString(node, ["src", "href", "url", "Data", "Tokens", "HTML", "html"]) || renderPlainText(node);
    const src = extractSrc(raw);
    if (!src) return [];
    const resolved = resolveMediaSrc(src, options);
    return [{
        type: "video",
        attrs: {
            src: resolved,
            platform: "file",
            kind: "file",
            originalUrl: resolved,
        },
    }];
}

function renderCodeBlock(node: SiyuanNode): TiptapJsonNode[] {
    const language =
        getString(node, ["CodeBlockInfo", "language", "lang"]) ||
        getString((node.Children || []).find((child) => child.Type === "NodeCodeBlockFenceInfoMarker"), ["Data"]);
    const code =
        getString(node, ["CodeBlockCode", "code", "Data"]) ||
        (node.Children || [])
            .filter((child) => child.Type === "NodeCodeBlockCode")
            .map((child) => getString(child, ["Data"]))
            .join("\n");
    return [{
        type: "codeBlock",
        attrs: { language: language.trim() || null },
        content: code ? [{ type: "text", text: code.replace(/\n$/, "") }] : undefined,
    }];
}

function renderBlockquote(node: SiyuanNode, options: SiyuanTiptapConvertOptions): TiptapJsonNode[] {
    const content = renderBlocks(node.Children || [], options);
    return [{ type: "blockquote", content: content.length > 0 ? content : [{ type: "paragraph" }] }];
}

function flattenTableRows(node: SiyuanNode): SiyuanNode[] {
    const rows: SiyuanNode[] = [];
    const visit = (current: SiyuanNode) => {
        if (current.Type === "NodeTableRow") {
            rows.push(current);
            return;
        }
        for (const child of current.Children || []) visit(child);
    };
    visit(node);
    return rows;
}

function renderTableCell(node: SiyuanNode, options: SiyuanTiptapConvertOptions, type: "tableHeader" | "tableCell"): TiptapJsonNode {
    const content = renderBlocks(node.Children || [], options);
    return {
        type,
        content: content.length > 0 ? content : [{ type: "paragraph" }],
    };
}

function renderTable(node: SiyuanNode, options: SiyuanTiptapConvertOptions): TiptapJsonNode[] {
    const rows: TiptapJsonNode[] = [];
    for (const [rowIndex, row] of flattenTableRows(node).entries()) {
        const cells = (row.Children || []).filter((cell) => cell.Type === "NodeTableCell");
        if (cells.length === 0) continue;
        const cellType = rowIndex === 0 ? "tableHeader" : "tableCell";
        rows.push({
            type: "tableRow",
            content: cells.map((cell) => renderTableCell(cell, options, cellType)),
        });
    }
    return rows.length > 0 ? [{ type: "table", content: rows }] : [];
}

function renderPlainText(node: SiyuanNode | undefined): string {
    if (!node) return "";
    const data = getString(node, ["Data", "Text", "text", "Tokens", "HTML", "html"]);
    if (data) return data;
    return (node.Children || []).map(renderPlainText).join("");
}

function renderDeferredMedia(node: SiyuanNode, options: SiyuanTiptapConvertOptions, label: string): TiptapJsonNode[] {
    const raw = getString(node, ["src", "href", "url", "Data", "Tokens", "HTML", "html"]) || renderPlainText(node);
    const src = extractSrc(raw);
    const text = src ? label : renderPlainText(node);
    if (!src) return text ? [{ type: "paragraph", content: textNode(text) }] : [];
    return [{
        type: "paragraph",
        content: [{
            type: "text",
            text: label,
            marks: [{ type: "link", attrs: { href: resolveMediaSrc(src, options) } }],
        }],
    }];
}

function renderBlock(node: SiyuanNode, options: SiyuanTiptapConvertOptions): TiptapJsonNode[] {
    if (MARKER_NODE_TYPES.has(node.Type)) return [];

    switch (node.Type) {
        case "NodeDocument":
        case "NodeSuperBlock":
            return renderBlocks(node.Children || [], options);
        case "NodeHeading": {
            const content = renderInlineContent(node, options);
            return [{
                type: "heading",
                attrs: { level: getHeadingLevel(node) },
                content: content.length > 0 ? content : undefined,
            }];
        }
        case "NodeParagraph":
            return renderParagraphLike(node, options);
        case "NodeText":
        case "NodeTextMark":
        case "NodeBr":
            return [{ type: "paragraph", content: renderInline(node, options) }];
        case "NodeList":
            return renderList(node, options);
        case "NodeBlockquote":
            return renderBlockquote(node, options);
        case "NodeCodeBlock":
            return renderCodeBlock(node);
        case "NodeThematicBreak":
            return [{ type: "horizontalRule" }];
        case "NodeTable":
            return renderTable(node, options);
        case "NodeImage":
            return renderImage(node, options);
        case "NodeVideo":
            return renderVideo(node, options);
        case "NodeAudio":
            return renderDeferredMedia(node, options, "音频附件");
        case "NodeIFrame":
        case "NodeWidget":
            return renderDeferredMedia(node, options, "嵌入内容");
        default: {
            const childBlocks = renderBlocks(node.Children || [], options);
            if (childBlocks.length > 0) return childBlocks;
            const text = getString(node, ["Data"]) || renderPlainText(node);
            return text ? [{ type: "paragraph", content: textNode(text) }] : [];
        }
    }
}

function renderBlocks(nodes: SiyuanNode[], options: SiyuanTiptapConvertOptions): TiptapJsonNode[] {
    return nodes.flatMap((node) => renderBlock(node, options));
}

export function siyuanSyToTiptapJson(doc: SiyuanNode, options: SiyuanTiptapConvertOptions = {}): string {
    const content = renderBlock(doc, options);
    return JSON.stringify({
        type: "doc",
        content: content.length > 0 ? content : [{ type: "paragraph" }],
    });
}
