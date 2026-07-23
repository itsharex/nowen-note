import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

import type { NoteLinkEntry } from "../repositories/types.js";
import type { NoteBlockIndexRow, NoteBlockType } from "./noteBlocks.js";
import type { IncrementalPatchIndexPlan } from "./blockPatchIncrementalIndexes.js";
import type { TiptapListItemStructuralOperation } from "./tiptapListItemStructure.js";

const BLOCK_ID_RE = /^blk_[A-Za-z0-9_-]{6,}$/;
const LEAF_BLOCK_TYPES = new Set(["paragraph", "heading", "codeBlock"]);
const LIST_ITEM_TYPES = new Set(["listItem", "taskItem"]);
const INDEXED_BLOCK_TYPES = new Set([
  "heading",
  "paragraph",
  "listItem",
  "taskItem",
  "blockquote",
  "codeBlock",
]);
const NOTE_LINK_RE = /\[\[note:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:#blk:([a-zA-Z0-9_-]+))?(?:\|([^\]]*))?\]\]/g;
const NOTE_HREF_RE = /note:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:#blk:([a-zA-Z0-9_-]+))?/g;

interface ExistingIndexRow {
  blockId: string;
  blockType: string;
  parentBlockId: string | null;
  blockOrder: number;
  plainText: string;
  contentHash: string;
  path: string;
}

interface AnalyzedBlock {
  row: NoteBlockIndexRow;
  node: any;
}

interface TiptapAnalysis {
  blocks: AnalyzedBlock[];
  byId: Map<string, AnalyzedBlock>;
  contentText: string;
}

function validBlockId(value: unknown): value is string {
  return typeof value === "string" && BLOCK_ID_RE.test(value);
}

function oneListStructureOperation(operations: unknown[]): TiptapListItemStructuralOperation | null {
  if (operations.length !== 1) return null;
  const operation = operations[0] as any;
  if (!operation || operation.scope !== "listItem") return null;
  if (operation.type === "create") {
    return validBlockId(operation.blockId)
      && validBlockId(operation.targetBlockId)
      && ["before", "after"].includes(operation.position)
      ? operation as TiptapListItemStructuralOperation
      : null;
  }
  if (operation.type === "delete") {
    return validBlockId(operation.blockId) ? operation as TiptapListItemStructuralOperation : null;
  }
  return null;
}

function collectNodeText(node: any): string {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return String(node.text || "");
  if (node.type === "hardBreak") return "\n";
  if (!Array.isArray(node.content)) return "";
  return node.content.map(collectNodeText).join("");
}

function hashText(type: string, text: string): string {
  return createHash("sha256")
    .update(type)
    .update("\0")
    .update(text.replace(/\s+/g, " ").trim())
    .digest("hex");
}

function analyzeTiptap(noteId: string, content: string): TiptapAnalysis | null {
  let doc: any;
  try {
    doc = JSON.parse(content || "{}");
  } catch {
    return null;
  }
  if (!doc || doc.type !== "doc" || !Array.isArray(doc.content)) return null;

  const blocks: AnalyzedBlock[] = [];
  const byId = new Map<string, AnalyzedBlock>();
  let order = 0;
  let invalid = false;
  const visit = (nodes: any[], parentBlockId: string | null, parentPath: number[]) => {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (!node || typeof node !== "object") continue;
      const path = [...parentPath, index];
      let nextParent = parentBlockId;
      if (INDEXED_BLOCK_TYPES.has(node.type)) {
        const blockId = node.attrs?.blockId;
        if (!validBlockId(blockId) || byId.has(blockId)) {
          invalid = true;
          return;
        }
        const plainText = collectNodeText(node).replace(/\u0000/g, "").trim();
        const analyzed: AnalyzedBlock = {
          row: {
            noteId,
            blockId,
            blockType: node.type as NoteBlockType,
            parentBlockId,
            blockOrder: order,
            plainText,
            contentHash: hashText(node.type, plainText),
            path: path.join("."),
            startOffset: null,
            endOffset: null,
          },
          node,
        };
        order += 1;
        blocks.push(analyzed);
        byId.set(blockId, analyzed);
        nextParent = blockId;
      }
      if (Array.isArray(node.content)) {
        visit(node.content, nextParent, path);
        if (invalid) return;
      }
    }
  };
  visit(doc.content, null, []);
  if (invalid) return null;
  return {
    blocks,
    byId,
    contentText: blocks.map(({ row }) => row.plainText).filter(Boolean).join("\n\n"),
  };
}

function loadExistingRows(db: Database.Database, noteId: string): ExistingIndexRow[] {
  return db.prepare(`
    SELECT blockId, blockType, parentBlockId, blockOrder, plainText, contentHash, path
    FROM note_blocks_index
    WHERE noteId = ?
    ORDER BY blockOrder ASC
  `).all(noteId) as ExistingIndexRow[];
}

function rowsMirrorAnalysis(existing: ExistingIndexRow[], analysis: TiptapAnalysis): boolean {
  if (existing.length !== analysis.blocks.length) return false;
  const existingById = new Map(existing.map((row) => [row.blockId, row]));
  if (existingById.size !== analysis.blocks.length) return false;
  return analysis.blocks.every(({ row }) => {
    const previous = existingById.get(row.blockId);
    return Boolean(previous
      && previous.blockType === row.blockType
      && previous.parentBlockId === row.parentBlockId
      && previous.blockOrder === row.blockOrder
      && previous.plainText === row.plainText
      && previous.contentHash === row.contentHash
      && previous.path === row.path);
  });
}

function collectAncestorIds(
  rowsById: Map<string, { parentBlockId: string | null }>,
  startIds: string[],
): Set<string> {
  const output = new Set<string>();
  for (const startId of startIds) {
    let current: string | null = startId;
    while (current && !output.has(current)) {
      output.add(current);
      current = rowsById.get(current)?.parentBlockId || null;
    }
  }
  return output;
}

function addLink(
  links: NoteLinkEntry[],
  seen: Set<string>,
  entry: NoteLinkEntry,
): void {
  const key = `${entry.sourceBlockId || ""}:${entry.targetNoteId}:${entry.targetBlockId || ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  links.push(entry);
}

function entriesFromText(
  text: string,
  sourceBlockId: string,
  excerpt: string | null,
  links: NoteLinkEntry[],
  seen: Set<string>,
): void {
  for (const match of text.matchAll(NOTE_LINK_RE)) {
    addLink(links, seen, {
      targetNoteId: match[1].toLowerCase(),
      targetBlockId: match[2] || null,
      sourceBlockId,
      linkType: match[2] ? "block" : "note",
      linkText: match[3] || null,
      excerpt: excerpt || match[3] || null,
    });
  }
  for (const match of text.matchAll(NOTE_HREF_RE)) {
    addLink(links, seen, {
      targetNoteId: match[1].toLowerCase(),
      targetBlockId: match[2] || null,
      sourceBlockId,
      linkType: match[2] ? "block" : "note",
      linkText: null,
      excerpt,
    });
  }
}

function extractLinks(node: any, sourceBlockId: string, plainText: string): NoteLinkEntry[] {
  const links: NoteLinkEntry[] = [];
  const seen = new Set<string>();
  const excerpt = plainText.replace(/\s+/g, " ").trim().slice(0, 240) || null;
  const visit = (candidate: any) => {
    if (!candidate || typeof candidate !== "object") return;
    if (candidate.type === "text") {
      const text = String(candidate.text || "");
      entriesFromText(text, sourceBlockId, excerpt, links, seen);
      for (const mark of Array.isArray(candidate.marks) ? candidate.marks : []) {
        const href = mark?.attrs?.href;
        if (mark?.type === "link" && typeof href === "string" && href.startsWith("note:")) {
          entriesFromText(href, sourceBlockId, excerpt, links, seen);
        }
      }
    }
    for (const child of Array.isArray(candidate.content) ? candidate.content : []) visit(child);
  };
  visit(node);
  return links;
}

function filterExistingTargets(
  db: Database.Database,
  noteId: string,
  links: NoteLinkEntry[],
): NoteLinkEntry[] {
  const targetExists = db.prepare("SELECT id FROM notes WHERE id = ?");
  return links.filter(
    (link) => !(link.targetNoteId === noteId.toLowerCase() && !link.targetBlockId)
      && Boolean(targetExists.get(link.targetNoteId)),
  );
}

/** Allow pre-patch normalization bypass only when one scoped item create/delete starts from an exact index mirror. */
export function canUseIncrementalListStructureIndexes(
  db: Database.Database,
  noteId: string,
  content: string,
  operations: unknown[],
): boolean {
  const operation = oneListStructureOperation(operations);
  if (!operation) return false;
  const analysis = analyzeTiptap(noteId, content);
  if (!analysis || !rowsMirrorAnalysis(loadExistingRows(db, noteId), analysis)) return false;
  if (operation.type === "create") {
    const target = analysis.byId.get(operation.targetBlockId)?.row;
    return Boolean(target && LIST_ITEM_TYPES.has(target.blockType));
  }
  const source = analysis.byId.get(operation.blockId)?.row;
  return Boolean(source && LIST_ITEM_TYPES.has(source.blockType));
}

/** Build a minimal post-patch plan for one scoped leaf list-item create/delete. */
export function planIncrementalListStructureIndexes(
  db: Database.Database,
  noteId: string,
  content: string,
  operations: unknown[],
): IncrementalPatchIndexPlan | null {
  const operation = oneListStructureOperation(operations);
  if (!operation) return null;
  const analysis = analyzeTiptap(noteId, content);
  if (!analysis) return null;

  const existing = loadExistingRows(db, noteId);
  const existingById = new Map(existing.map((row) => [row.blockId, row]));
  const postIds = new Set(analysis.blocks.map(({ row }) => row.blockId));
  const addedIds = analysis.blocks.map(({ row }) => row.blockId).filter((id) => !existingById.has(id));
  const deletedIds = existing.map((row) => row.blockId).filter((id) => !postIds.has(id));

  if (operation.type === "create") {
    const requestedIds = new Set([
      operation.blockId,
      (operation.node as any)?.content?.[0]?.attrs?.blockId,
    ].filter(validBlockId));
    if (addedIds.length !== 2 || requestedIds.size !== 2 || addedIds.some((id) => !requestedIds.has(id))) {
      return null;
    }
    if (deletedIds.length > 0) return null;
    const item = analysis.byId.get(operation.blockId)?.row;
    const paragraphId = [...requestedIds].find((id) => id !== operation.blockId);
    const paragraph = paragraphId ? analysis.byId.get(paragraphId)?.row : null;
    const target = analysis.byId.get(operation.targetBlockId)?.row;
    if (
      !item
      || !paragraph
      || !target
      || !LIST_ITEM_TYPES.has(item.blockType)
      || item.blockType !== target.blockType
      || paragraph.blockType !== "paragraph"
      || paragraph.parentBlockId !== item.blockId
      || item.parentBlockId !== target.parentBlockId
    ) {
      return null;
    }
  } else {
    if (addedIds.length > 0 || deletedIds.length !== 2 || !deletedIds.includes(operation.blockId)) return null;
    const deletedItem = existingById.get(operation.blockId);
    const deletedParagraph = deletedIds
      .map((id) => existingById.get(id))
      .find((row) => row?.parentBlockId === operation.blockId && row.blockType === "paragraph");
    if (!deletedItem || !LIST_ITEM_TYPES.has(deletedItem.blockType) || !deletedParagraph) return null;
  }

  const existingParentMap = new Map(existing.map((row) => [row.blockId, { parentBlockId: row.parentBlockId }]));
  const postParentMap = new Map(analysis.blocks.map(({ row }) => [row.blockId, { parentBlockId: row.parentBlockId }]));
  const aggregateIds = operation.type === "create"
    ? collectAncestorIds(postParentMap, [operation.blockId])
    : collectAncestorIds(existingParentMap, [operation.blockId]);

  const affectedRows: NoteBlockIndexRow[] = [];
  for (const { row } of analysis.blocks) {
    const previous = existingById.get(row.blockId);
    if (!previous) {
      affectedRows.push(row);
      continue;
    }
    const contentChanged = previous.blockType !== row.blockType
      || previous.plainText !== row.plainText
      || previous.contentHash !== row.contentHash;
    const parentChanged = previous.parentBlockId !== row.parentBlockId;
    const orderChanged = previous.blockOrder !== row.blockOrder;
    const pathChanged = previous.path !== row.path;

    if (contentChanged && LEAF_BLOCK_TYPES.has(row.blockType)) return null;
    if (contentChanged && !aggregateIds.has(row.blockId)) return null;
    if (parentChanged) return null;
    if (contentChanged || orderChanged || pathChanged) affectedRows.push(row);
  }

  const linkBlockIds = operation.type === "create" ? addedIds : deletedIds;
  const links: NoteLinkEntry[] = [];
  if (operation.type === "create") {
    for (const blockId of addedIds) {
      const block = analysis.byId.get(blockId);
      if (!block || block.row.blockType !== "paragraph") continue;
      links.push(...extractLinks(block.node, blockId, block.row.plainText));
    }
  }

  return {
    mode: "incremental",
    kind: "structural",
    contentText: analysis.contentText,
    affectedRows,
    deletedBlockIds: deletedIds,
    links: filterExistingTargets(db, noteId, links),
    indexedBlockIds: [...new Set([...deletedIds, ...affectedRows.map((row) => row.blockId)])],
    linkBlockIds,
  };
}
