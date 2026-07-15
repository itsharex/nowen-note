from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    source = file.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match in {path}, got {count}")
    file.write_text(source.replace(old, new, 1), encoding="utf-8")


def write(path: str, content: str) -> None:
    file = Path(path)
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(content.rstrip() + "\n", encoding="utf-8")


NOTE_BLOCKS = r'''import { createHash } from "node:crypto";
import { v4 as uuid } from "uuid";
import type Database from "better-sqlite3";

export const SUPPORTED_NOTE_BLOCK_TYPES = [
  "heading",
  "paragraph",
  "listItem",
  "taskItem",
  "blockquote",
  "codeBlock",
] as const;

export type NoteBlockType = typeof SUPPORTED_NOTE_BLOCK_TYPES[number];

export interface NoteBlockIndexRow {
  noteId: string;
  blockId: string;
  blockType: NoteBlockType;
  parentBlockId: string | null;
  blockOrder: number;
  plainText: string;
  contentHash: string;
  path: string;
  startOffset: number | null;
  endOffset: number | null;
  createdAt?: string;
  updatedAt?: string;
}

interface BlockCandidate extends Omit<NoteBlockIndexRow, "blockId"> {
  blockId: string | null;
  explicitBlockId: boolean;
  markerInsertOffset?: number;
  markerStyle?: "inline" | "standalone";
}

const SUPPORTED = new Set<string>(SUPPORTED_NOTE_BLOCK_TYPES);
const BLOCK_ID_RE = /^blk_[A-Za-z0-9_-]{6,}$/;
const MARKDOWN_BLOCK_ID_RE = /(?:\s+|^)(\^blk_[A-Za-z0-9_-]{6,})\s*$/;

function makeBlockId(): string {
  return `blk_${uuid()}`;
}

function hashText(type: string, text: string): string {
  return createHash("sha256")
    .update(type)
    .update("\0")
    .update(text.replace(/\s+/g, " ").trim())
    .digest("hex");
}

function collectNodeText(node: any): string {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return String(node.text || "");
  if (node.type === "hardBreak") return "\n";
  if (!Array.isArray(node.content)) return "";
  return node.content.map(collectNodeText).join("");
}

function validBlockId(value: unknown): value is string {
  return typeof value === "string" && BLOCK_ID_RE.test(value);
}

function parseTiptap(noteId: string, content: string): {
  normalizedContent: string;
  candidates: BlockCandidate[];
  changed: boolean;
} {
  let doc: any;
  try {
    doc = JSON.parse(content || "{}");
  } catch {
    return { normalizedContent: content, candidates: [], changed: false };
  }
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.content)) {
    return { normalizedContent: content, candidates: [], changed: false };
  }

  const seen = new Set<string>();
  const candidates: BlockCandidate[] = [];
  let order = 0;
  let changed = false;

  const visit = (nodes: any[], parentBlockId: string | null, path: number[]) => {
    nodes.forEach((node, index) => {
      if (!node || typeof node !== "object") return;
      const currentPath = [...path, index];
      let nextParent = parentBlockId;

      if (SUPPORTED.has(node.type)) {
        const attrs = node.attrs && typeof node.attrs === "object" ? { ...node.attrs } : {};
        let blockId = validBlockId(attrs.blockId) ? attrs.blockId : null;
        if (!blockId || seen.has(blockId)) {
          blockId = makeBlockId();
          attrs.blockId = blockId;
          node.attrs = attrs;
          changed = true;
        }
        seen.add(blockId);
        const plainText = collectNodeText(node).replace(/\u0000/g, "").trim();
        candidates.push({
          noteId,
          blockId,
          explicitBlockId: true,
          blockType: node.type as NoteBlockType,
          parentBlockId,
          blockOrder: order++,
          plainText,
          contentHash: hashText(node.type, plainText),
          path: currentPath.join("."),
          startOffset: null,
          endOffset: null,
        });
        nextParent = blockId;
      }

      if (Array.isArray(node.content)) visit(node.content, nextParent, currentPath);
    });
  };

  visit(doc.content, null, []);
  return {
    normalizedContent: changed ? JSON.stringify(doc) : content,
    candidates,
    changed,
  };
}

function lineOffsets(content: string): Array<{ text: string; start: number; end: number; endWithNewline: number }> {
  const lines: Array<{ text: string; start: number; end: number; endWithNewline: number }> = [];
  let cursor = 0;
  const raw = content.split("\n");
  for (let i = 0; i < raw.length; i++) {
    const text = raw[i];
    const start = cursor;
    const end = start + text.length;
    const endWithNewline = end + (i < raw.length - 1 ? 1 : 0);
    lines.push({ text, start, end, endWithNewline });
    cursor = endWithNewline;
  }
  return lines;
}

function stripMarkdownMarker(raw: string): { text: string; blockId: string | null } {
  const match = raw.match(MARKDOWN_BLOCK_ID_RE);
  if (!match) return { text: raw, blockId: null };
  const blockId = match[1].slice(1);
  return { text: raw.slice(0, match.index).replace(/\s+$/, ""), blockId };
}

function classifyMarkdownLine(line: string): NoteBlockType | null {
  if (/^\s{0,3}#{1,6}\s+/.test(line)) return "heading";
  if (/^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)) return "taskItem";
  if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) return "listItem";
  if (/^\s{0,3}>\s?/.test(line)) return "blockquote";
  return line.trim() ? "paragraph" : null;
}

function cleanMarkdownText(type: NoteBlockType, value: string): string {
  let text = value.trim();
  if (type === "heading") text = text.replace(/^#{1,6}\s+/, "");
  else if (type === "taskItem") text = text.replace(/^[-*+]\s+\[[ xX]\]\s+/, "");
  else if (type === "listItem") text = text.replace(/^(?:[-*+]|\d+\.)\s+/, "");
  else if (type === "blockquote") text = text.replace(/^>\s?/, "");
  return text.replace(/\s+\^blk_[A-Za-z0-9_-]{6,}\s*$/, "").trim();
}

function parseMarkdown(noteId: string, content: string): {
  normalizedContent: string;
  candidates: BlockCandidate[];
  changed: boolean;
} {
  const lines = lineOffsets(content);
  const candidates: BlockCandidate[] = [];
  let order = 0;

  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.text.trim()) {
      i++;
      continue;
    }

    const fence = line.text.match(/^\s*(```+|~~~+)/);
    if (fence) {
      const fenceToken = fence[1];
      let j = i + 1;
      while (j < lines.length && !new RegExp(`^\\s*${fenceToken[0]}{${fenceToken.length},}\\s*$`).test(lines[j].text)) j++;
      if (j < lines.length) j++;
      let markerLine = j;
      let explicitBlockId: string | null = null;
      if (markerLine < lines.length) {
        const marker = lines[markerLine].text.trim().match(/^\^(blk_[A-Za-z0-9_-]{6,})$/);
        if (marker) {
          explicitBlockId = marker[1];
          j++;
        }
      }
      const start = line.start;
      const end = (j > i ? lines[j - 1].endWithNewline : line.endWithNewline);
      const raw = content.slice(start, end);
      const plainText = raw
        .replace(/^\s*(```+|~~~+)[^\n]*\n?/, "")
        .replace(/\n?\s*(```+|~~~+)\s*(?:\n\^blk_[A-Za-z0-9_-]+)?\s*$/, "")
        .trim();
      candidates.push({
        noteId,
        blockId: explicitBlockId,
        explicitBlockId: Boolean(explicitBlockId),
        blockType: "codeBlock",
        parentBlockId: null,
        blockOrder: order++,
        plainText,
        contentHash: hashText("codeBlock", plainText),
        path: String(order - 1),
        startOffset: start,
        endOffset: end,
        markerInsertOffset: (j > i ? lines[j - 1].end : line.end),
        markerStyle: "standalone",
      });
      i = Math.max(j, i + 1);
      continue;
    }

    const type = classifyMarkdownLine(line.text);
    if (!type) {
      i++;
      continue;
    }

    let j = i + 1;
    if (type === "paragraph") {
      while (j < lines.length && lines[j].text.trim() && classifyMarkdownLine(lines[j].text) === "paragraph" && !/^\s*(```+|~~~+)/.test(lines[j].text)) {
        j++;
      }
    }
    const start = line.start;
    const end = lines[j - 1].endWithNewline;
    const raw = content.slice(start, end).replace(/\n$/, "");
    const stripped = stripMarkdownMarker(raw);
    const plainText = cleanMarkdownText(type, stripped.text.replace(/\n/g, " "));
    candidates.push({
      noteId,
      blockId: stripped.blockId,
      explicitBlockId: Boolean(stripped.blockId),
      blockType: type,
      parentBlockId: null,
      blockOrder: order++,
      plainText,
      contentHash: hashText(type, plainText),
      path: String(order - 1),
      startOffset: start,
      endOffset: end,
      markerInsertOffset: lines[j - 1].end,
      markerStyle: "inline",
    });
    i = j;
  }

  return { normalizedContent: content, candidates, changed: false };
}

export function ensureNoteBlockTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS note_blocks_index (
      noteId TEXT NOT NULL,
      blockId TEXT NOT NULL,
      blockType TEXT NOT NULL,
      parentBlockId TEXT,
      blockOrder INTEGER NOT NULL DEFAULT 0,
      plainText TEXT NOT NULL DEFAULT '',
      contentHash TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL DEFAULT '',
      startOffset INTEGER,
      endOffset INTEGER,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (noteId, blockId),
      FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_note_blocks_block_id ON note_blocks_index(blockId);
    CREATE INDEX IF NOT EXISTS idx_note_blocks_note_order ON note_blocks_index(noteId, blockOrder);
    CREATE INDEX IF NOT EXISTS idx_note_blocks_hash ON note_blocks_index(noteId, blockType, contentHash);

    CREATE TABLE IF NOT EXISTS block_operations (
      userId TEXT NOT NULL,
      operationId TEXT NOT NULL,
      noteId TEXT NOT NULL,
      resultJson TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (userId, operationId),
      FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_block_operations_note ON block_operations(noteId, createdAt DESC);
  `);
}

function assignCandidateIds(
  db: Database.Database,
  noteId: string,
  candidates: BlockCandidate[],
): void {
  const previous = db.prepare(`
    SELECT blockId, blockType, contentHash, blockOrder
    FROM note_blocks_index
    WHERE noteId = ?
    ORDER BY blockOrder ASC
  `).all(noteId) as Array<{ blockId: string; blockType: string; contentHash: string; blockOrder: number }>;

  const reusable = new Map<string, string[]>();
  for (const row of previous) {
    const key = `${row.blockType}:${row.contentHash}`;
    const list = reusable.get(key) || [];
    list.push(row.blockId);
    reusable.set(key, list);
  }

  const used = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.blockId && !used.has(candidate.blockId)) {
      used.add(candidate.blockId);
      continue;
    }
    const key = `${candidate.blockType}:${candidate.contentHash}`;
    const list = reusable.get(key) || [];
    let reused: string | undefined;
    while (list.length > 0 && !reused) {
      const value = list.shift();
      if (value && !used.has(value)) reused = value;
    }
    candidate.blockId = reused || makeBlockId();
    used.add(candidate.blockId);
  }
}

function applyMarkdownIds(content: string, candidates: BlockCandidate[]): string {
  const inserts = candidates
    .filter((candidate) => !candidate.explicitBlockId && candidate.markerInsertOffset != null && candidate.blockId)
    .map((candidate) => ({
      offset: candidate.markerInsertOffset as number,
      text: candidate.markerStyle === "standalone" ? `\n^${candidate.blockId}` : ` ^${candidate.blockId}`,
    }))
    .sort((a, b) => b.offset - a.offset);
  let out = content;
  for (const insert of inserts) out = out.slice(0, insert.offset) + insert.text + out.slice(insert.offset);
  return out;
}

function materializeRows(candidates: BlockCandidate[]): NoteBlockIndexRow[] {
  return candidates.map((candidate) => ({
    noteId: candidate.noteId,
    blockId: candidate.blockId as string,
    blockType: candidate.blockType,
    parentBlockId: candidate.parentBlockId,
    blockOrder: candidate.blockOrder,
    plainText: candidate.plainText,
    contentHash: candidate.contentHash,
    path: candidate.path,
    startOffset: candidate.startOffset,
    endOffset: candidate.endOffset,
  }));
}

export function syncNoteBlocks(
  db: Database.Database,
  noteId: string,
  content: string,
  contentFormat: string,
): { content: string; contentText: string; blocks: NoteBlockIndexRow[]; changed: boolean } {
  ensureNoteBlockTables(db);
  const parsed = contentFormat === "tiptap-json"
    ? parseTiptap(noteId, content)
    : parseMarkdown(noteId, content);
  assignCandidateIds(db, noteId, parsed.candidates);

  let normalizedContent = parsed.normalizedContent;
  if (contentFormat === "markdown") normalizedContent = applyMarkdownIds(normalizedContent, parsed.candidates);
  const changed = normalizedContent !== content;

  // Reparse Markdown after marker insertion so offsets stored in the index match the persisted text.
  let candidates = parsed.candidates;
  if (contentFormat === "markdown" && changed) {
    const reparsed = parseMarkdown(noteId, normalizedContent);
    const byOrder = new Map(parsed.candidates.map((candidate) => [candidate.blockOrder, candidate.blockId]));
    reparsed.candidates.forEach((candidate) => {
      candidate.blockId = candidate.blockId || byOrder.get(candidate.blockOrder) || makeBlockId();
      candidate.explicitBlockId = true;
    });
    candidates = reparsed.candidates;
  }

  const rows = materializeRows(candidates);
  const contentText = rows.map((row) => row.plainText).filter(Boolean).join("\n\n");
  const insert = db.prepare(`
    INSERT INTO note_blocks_index (
      noteId, blockId, blockType, parentBlockId, blockOrder, plainText,
      contentHash, path, startOffset, endOffset, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM note_blocks_index WHERE noteId = ?").run(noteId);
    for (const row of rows) {
      insert.run(
        row.noteId,
        row.blockId,
        row.blockType,
        row.parentBlockId,
        row.blockOrder,
        row.plainText,
        row.contentHash,
        row.path,
        row.startOffset,
        row.endOffset,
      );
    }
    if (changed) {
      db.prepare("UPDATE notes SET content = ?, contentText = ? WHERE id = ?")
        .run(normalizedContent, contentText, noteId);
    }
  });
  tx();
  return { content: normalizedContent, contentText, blocks: rows, changed };
}

export function ensureNoteIndexed(db: Database.Database, noteId: string): NoteBlockIndexRow[] {
  ensureNoteBlockTables(db);
  const note = db.prepare("SELECT content, contentFormat FROM notes WHERE id = ?").get(noteId) as
    | { content: string; contentFormat: string }
    | undefined;
  if (!note) return [];
  return syncNoteBlocks(db, noteId, note.content || "", note.contentFormat || "tiptap-json").blocks;
}

export function getNoteBlocks(db: Database.Database, noteId: string, limit = 500): NoteBlockIndexRow[] {
  ensureNoteBlockTables(db);
  return db.prepare(`
    SELECT noteId, blockId, blockType, parentBlockId, blockOrder, plainText,
           contentHash, path, startOffset, endOffset, createdAt, updatedAt
    FROM note_blocks_index
    WHERE noteId = ?
    ORDER BY blockOrder ASC
    LIMIT ?
  `).all(noteId, limit) as NoteBlockIndexRow[];
}

export function getNoteBlock(
  db: Database.Database,
  noteId: string,
  blockId: string,
): NoteBlockIndexRow | null {
  ensureNoteBlockTables(db);
  return (db.prepare(`
    SELECT noteId, blockId, blockType, parentBlockId, blockOrder, plainText,
           contentHash, path, startOffset, endOffset, createdAt, updatedAt
    FROM note_blocks_index
    WHERE noteId = ? AND blockId = ?
  `).get(noteId, blockId) as NoteBlockIndexRow | undefined) || null;
}

export function searchNoteBlocks(
  db: Database.Database,
  query: string,
  options: { notebookId?: string; allowedNotebookIds?: string[]; limit?: number } = {},
): Array<NoteBlockIndexRow & { title: string; notebookId: string; updatedAt: string }> {
  ensureNoteBlockTables(db);
  const limit = Math.min(Math.max(options.limit || 50, 1), 200);
  const clauses = ["n.isTrashed = 0", "b.plainText LIKE ?"];
  const params: unknown[] = [`%${query.replace(/[\\%_]/g, "\\$&")}%`];
  if (options.notebookId) {
    clauses.push("n.notebookId = ?");
    params.push(options.notebookId);
  }
  if (options.allowedNotebookIds) {
    if (options.allowedNotebookIds.length === 0) return [];
    clauses.push(`n.notebookId IN (${options.allowedNotebookIds.map(() => "?").join(",")})`);
    params.push(...options.allowedNotebookIds);
  }
  params.push(limit);
  return db.prepare(`
    SELECT b.noteId, b.blockId, b.blockType, b.parentBlockId, b.blockOrder,
           b.plainText, b.contentHash, b.path, b.startOffset, b.endOffset,
           b.createdAt, b.updatedAt, n.title, n.notebookId, n.updatedAt AS updatedAt
    FROM note_blocks_index b
    JOIN notes n ON n.id = b.noteId
    WHERE ${clauses.join(" AND ")}
    ORDER BY n.updatedAt DESC, b.blockOrder ASC
    LIMIT ?
  `).all(...params) as Array<NoteBlockIndexRow & { title: string; notebookId: string; updatedAt: string }>;
}

export function plainTextFromNoteContent(content: string, contentFormat: string): string {
  const parsed = contentFormat === "tiptap-json"
    ? parseTiptap("", content).candidates
    : parseMarkdown("", content).candidates;
  return parsed.map((block) => block.plainText).filter(Boolean).join("\n\n");
}
'''

BLOCK_ROUTES = r'''import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import { getDb } from "../db/schema";
import { hasPermission, resolveNotePermission } from "../middleware/acl";
import { logAudit } from "../services/audit";
import { syncNoteLinks } from "../lib/noteLinks";
import {
  ensureNoteIndexed,
  getNoteBlock,
  getNoteBlocks,
  plainTextFromNoteContent,
  searchNoteBlocks,
  syncNoteBlocks,
  type NoteBlockIndexRow,
  type NoteBlockType,
} from "../lib/noteBlocks";

const app = new Hono();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BLOCK_ID_RE = /^blk_[A-Za-z0-9_-]{6,}$/;

interface NoteRecord {
  id: string;
  userId: string;
  notebookId: string;
  title: string;
  content: string;
  contentText: string;
  contentFormat: string;
  version: number;
  isLocked: number;
  isTrashed: number;
}

function allowedNotebookIds(header: string | undefined): string[] | undefined {
  if (header == null) return undefined;
  return header.split(",").map((value) => value.trim()).filter(Boolean);
}

function readNote(noteId: string): NoteRecord | null {
  return (getDb().prepare(`
    SELECT id, userId, notebookId, title, content, contentText, contentFormat,
           version, isLocked, isTrashed
    FROM notes WHERE id = ?
  `).get(noteId) as NoteRecord | undefined) || null;
}

function requireNote(c: any, noteId: string, permission: "read" | "write"):
  | { note: NoteRecord; userId: string }
  | Response {
  const userId = c.req.header("X-User-Id") || "";
  const note = readNote(noteId);
  if (!note || note.isTrashed) return c.json({ error: "笔记不存在", code: "NOT_FOUND" }, 404);
  const resolved = resolveNotePermission(noteId, userId);
  if (!hasPermission(resolved.permission, permission)) {
    return c.json({ error: "笔记不存在或无权限", code: "NOT_FOUND" }, 404);
  }
  return { note, userId };
}

function serializeResult(result: unknown): string {
  return JSON.stringify(result);
}

function readIdempotentResult(userId: string, operationId: string): unknown | null {
  const row = getDb().prepare(`
    SELECT resultJson FROM block_operations WHERE userId = ? AND operationId = ?
  `).get(userId, operationId) as { resultJson: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.resultJson); } catch { return null; }
}

function storeIdempotentResult(userId: string, operationId: string, noteId: string, result: unknown): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO block_operations (userId, operationId, noteId, resultJson, createdAt)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(userId, operationId, noteId, serializeResult(result));
}

function validateWriteBody(body: any): string | null {
  if (!Number.isInteger(body?.expectedNoteVersion) || body.expectedNoteVersion < 1) {
    return "expectedNoteVersion 必须是正整数";
  }
  if (typeof body?.operationId !== "string" || body.operationId.length < 8 || body.operationId.length > 128) {
    return "operationId 长度必须为 8-128";
  }
  return null;
}

function createTiptapNode(blockType: NoteBlockType, text: string, blockId: string): any {
  const textContent = text ? [{ type: "text", text }] : [];
  if (blockType === "heading") return { type: "heading", attrs: { level: 2, blockId }, content: textContent };
  if (blockType === "paragraph") return { type: "paragraph", attrs: { blockId }, content: textContent };
  if (blockType === "codeBlock") return { type: "codeBlock", attrs: { language: null, blockId }, content: textContent };
  if (blockType === "blockquote") {
    return { type: "blockquote", attrs: { blockId }, content: [{ type: "paragraph", content: textContent }] };
  }
  const item = {
    type: blockType,
    attrs: blockType === "taskItem" ? { checked: false, blockId } : { blockId },
    content: [{ type: "paragraph", content: textContent }],
  };
  return { type: blockType === "taskItem" ? "taskList" : "bulletList", content: [item] };
}

interface TiptapLocation {
  node: any;
  parent: any[];
  index: number;
  topIndex: number;
}

function findTiptapBlock(nodes: any[], blockId: string, topIndex = -1): TiptapLocation | null {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const currentTop = topIndex < 0 ? index : topIndex;
    if (node?.attrs?.blockId === blockId) return { node, parent: nodes, index, topIndex: currentTop };
    if (Array.isArray(node?.content)) {
      const nested = findTiptapBlock(node.content, blockId, currentTop);
      if (nested) return nested;
    }
  }
  return null;
}

function setTiptapBlockText(node: any, text: string): void {
  const content = text ? [{ type: "text", text }] : [];
  if (["paragraph", "heading", "codeBlock"].includes(node.type)) {
    node.content = content;
    return;
  }
  const findTextContainer = (candidate: any): any | null => {
    if (!candidate || typeof candidate !== "object") return null;
    if (["paragraph", "heading", "codeBlock"].includes(candidate.type)) return candidate;
    if (!Array.isArray(candidate.content)) return null;
    for (const child of candidate.content) {
      const found = findTextContainer(child);
      if (found) return found;
    }
    return null;
  };
  const container = findTextContainer(node);
  if (container) container.content = content;
  else node.content = [{ type: "paragraph", content }];
}

function mutateTiptap(
  content: string,
  action: "create" | "update" | "delete" | "move",
  params: any,
): { content: string; affectedBlockId: string } {
  const doc = JSON.parse(content || '{"type":"doc","content":[]}');
  if (!Array.isArray(doc.content)) doc.content = [];

  if (action === "create") {
    const blockId = params.blockId || `blk_${uuid()}`;
    const newNode = createTiptapNode(params.blockType || "paragraph", String(params.text || ""), blockId);
    if (params.afterBlockId) {
      const target = findTiptapBlock(doc.content, params.afterBlockId);
      if (target) doc.content.splice(target.topIndex + 1, 0, newNode);
      else doc.content.push(newNode);
    } else doc.content.push(newNode);
    return { content: JSON.stringify(doc), affectedBlockId: blockId };
  }

  const target = findTiptapBlock(doc.content, params.blockId);
  if (!target) throw new Error("BLOCK_NOT_FOUND");
  if (action === "update") {
    setTiptapBlockText(target.node, String(params.text || ""));
  } else if (action === "delete") {
    target.parent.splice(target.index, 1);
  } else {
    const anchor = findTiptapBlock(doc.content, params.targetBlockId);
    if (!anchor || anchor.parent !== target.parent) throw new Error("BLOCK_MOVE_PARENT_MISMATCH");
    const [node] = target.parent.splice(target.index, 1);
    let destination = anchor.index;
    if (target.index < anchor.index) destination -= 1;
    if (params.position !== "before") destination += 1;
    target.parent.splice(Math.max(0, destination), 0, node);
  }
  return { content: JSON.stringify(doc), affectedBlockId: params.blockId };
}

function renderMarkdownBlock(blockType: NoteBlockType, text: string, blockId: string): string {
  const clean = text.replace(/\s+\^blk_[A-Za-z0-9_-]+\s*$/, "").trim();
  if (blockType === "heading") return `## ${clean} ^${blockId}`;
  if (blockType === "listItem") return `- ${clean} ^${blockId}`;
  if (blockType === "taskItem") return `- [ ] ${clean} ^${blockId}`;
  if (blockType === "blockquote") return `> ${clean} ^${blockId}`;
  if (blockType === "codeBlock") return `\`\`\`\n${clean}\n\`\`\`\n^${blockId}`;
  return `${clean} ^${blockId}`;
}

function mutateMarkdown(
  note: NoteRecord,
  action: "create" | "update" | "delete" | "move",
  params: any,
): { content: string; affectedBlockId: string } {
  const db = getDb();
  ensureNoteIndexed(db, note.id);
  const blocks = getNoteBlocks(db, note.id, 10000);
  const find = (id: string): NoteBlockIndexRow => {
    const block = blocks.find((item) => item.blockId === id);
    if (!block || block.startOffset == null || block.endOffset == null) throw new Error("BLOCK_NOT_FOUND");
    return block;
  };
  let content = note.content || "";

  if (action === "create") {
    const blockId = params.blockId || `blk_${uuid()}`;
    const rendered = renderMarkdownBlock(params.blockType || "paragraph", String(params.text || ""), blockId);
    if (params.afterBlockId) {
      const target = find(params.afterBlockId);
      const offset = target.endOffset as number;
      content = content.slice(0, offset).replace(/\s*$/, "") + `\n\n${rendered}\n` + content.slice(offset).replace(/^\s*/, "");
    } else content = content.replace(/\s*$/, "") + `\n\n${rendered}\n`;
    return { content, affectedBlockId: blockId };
  }

  const target = find(params.blockId);
  const start = target.startOffset as number;
  const end = target.endOffset as number;
  if (action === "update") {
    const rendered = renderMarkdownBlock(target.blockType, String(params.text || ""), target.blockId);
    content = content.slice(0, start) + rendered + (content.slice(end).startsWith("\n") ? "" : "\n") + content.slice(end);
  } else if (action === "delete") {
    content = (content.slice(0, start) + content.slice(end)).replace(/\n{3,}/g, "\n\n").trim() + "\n";
  } else {
    const anchor = find(params.targetBlockId);
    const segment = content.slice(start, end).replace(/^\s+|\s+$/g, "");
    let without = content.slice(0, start) + content.slice(end);
    let anchorStart = anchor.startOffset as number;
    let anchorEnd = anchor.endOffset as number;
    if (start < anchorStart) {
      const removed = end - start;
      anchorStart -= removed;
      anchorEnd -= removed;
    }
    const insertAt = params.position === "before" ? anchorStart : anchorEnd;
    without = without.slice(0, insertAt).replace(/\s*$/, "") + `\n\n${segment}\n\n` + without.slice(insertAt).replace(/^\s*/, "");
    content = without.replace(/\n{3,}/g, "\n\n");
  }
  return { content, affectedBlockId: target.blockId };
}

async function performWrite(c: any, action: "create" | "update" | "delete" | "move") {
  const noteId = c.req.param("noteId");
  const body = await c.req.json().catch(() => ({}));
  const error = validateWriteBody(body);
  if (error) return c.json({ error, code: "INVALID_BLOCK_OPERATION" }, 400);

  const required = requireNote(c, noteId, "write");
  if (required instanceof Response) return required;
  const { note, userId } = required;
  if (note.isLocked) return c.json({ error: "Note is locked", code: "NOTE_LOCKED" }, 403);
  if (note.version !== body.expectedNoteVersion) {
    return c.json({ error: "Version conflict", code: "VERSION_CONFLICT", currentVersion: note.version }, 409);
  }

  const cached = readIdempotentResult(userId, body.operationId);
  if (cached) return c.json({ ...cached as any, idempotentReplay: true });

  if (action !== "create") body.blockId = c.req.param("blockId");
  try {
    const mutation = note.contentFormat === "tiptap-json"
      ? mutateTiptap(note.content, action, body)
      : mutateMarkdown(note, action, body);
    const db = getDb();
    const contentText = plainTextFromNoteContent(mutation.content, note.contentFormat);
    const nextVersion = note.version + 1;
    db.prepare(`
      UPDATE notes
      SET content = ?, contentText = ?, version = ?, updatedAt = datetime('now')
      WHERE id = ?
    `).run(mutation.content, contentText, nextVersion, noteId);
    const synced = syncNoteBlocks(db, noteId, mutation.content, note.contentFormat);
    syncNoteLinks(db, userId, noteId, synced.content);
    const result = {
      success: true,
      noteId,
      blockId: mutation.affectedBlockId,
      action,
      version: nextVersion,
      contentChangedByNormalization: synced.changed,
    };
    storeIdempotentResult(userId, body.operationId, noteId, result);
    logAudit(userId, "note", `block_${action}`, result, { targetType: "note", targetId: noteId });
    return c.json(result, action === "create" ? 201 : 200);
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : String(cause);
    if (code === "BLOCK_NOT_FOUND") return c.json({ error: "块不存在", code }, 404);
    if (code === "BLOCK_MOVE_PARENT_MISMATCH") {
      return c.json({ error: "当前仅支持同一父块内移动", code }, 400);
    }
    throw cause;
  }
}

app.get("/search", (c) => {
  const userId = c.req.header("X-User-Id") || "";
  const q = (c.req.query("q") || "").trim();
  if (!q) return c.json([]);
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50", 10) || 50, 1), 200);
  const notebookId = c.req.query("notebookId") || undefined;
  const allowed = allowedNotebookIds(c.req.header("X-Api-Allowed-Notebook-Ids"));
  const rows = searchNoteBlocks(getDb(), q, { notebookId, allowedNotebookIds: allowed, limit });
  return c.json(rows.filter((row) => hasPermission(resolveNotePermission(row.noteId, userId).permission, "read")));
});

app.get("/resolve", (c) => {
  const raw = c.req.query("link") || "";
  const match = raw.match(/note:([0-9a-f-]{36})(?:#blk:([A-Za-z0-9_-]+))?/i);
  if (!match || !UUID_RE.test(match[1])) return c.json({ error: "无效的内部链接", code: "INVALID_LINK" }, 400);
  const noteId = match[1].toLowerCase();
  const required = requireNote(c, noteId, "read");
  if (required instanceof Response) return required;
  ensureNoteIndexed(getDb(), noteId);
  const block = match[2] ? getNoteBlock(getDb(), noteId, match[2]) : null;
  if (match[2] && !block) return c.json({ error: "引用块不存在", code: "BLOCK_NOT_FOUND" }, 404);
  return c.json({
    note: { id: required.note.id, title: required.note.title, notebookId: required.note.notebookId, version: required.note.version },
    block,
  });
});

app.get("/graph", (c) => {
  const userId = c.req.header("X-User-Id") || "";
  const focusNoteId = c.req.query("noteId") || undefined;
  const allowed = allowedNotebookIds(c.req.header("X-Api-Allowed-Notebook-Ids"));
  const db = getDb();
  const links = db.prepare(`
    SELECT nl.sourceNoteId, nl.targetNoteId, nl.sourceBlockId, nl.targetBlockId, nl.linkType,
           s.title AS sourceTitle, s.notebookId AS sourceNotebookId,
           t.title AS targetTitle, t.notebookId AS targetNotebookId
    FROM note_links nl
    JOIN notes s ON s.id = nl.sourceNoteId AND s.isTrashed = 0
    JOIN notes t ON t.id = nl.targetNoteId AND t.isTrashed = 0
    WHERE (? IS NULL OR nl.sourceNoteId = ? OR nl.targetNoteId = ?)
    ORDER BY nl.updatedAt DESC
    LIMIT 1000
  `).all(focusNoteId || null, focusNoteId || null, focusNoteId || null) as any[];
  const visible = links.filter((link) => {
    if (allowed && (!allowed.includes(link.sourceNotebookId) || !allowed.includes(link.targetNotebookId))) return false;
    return hasPermission(resolveNotePermission(link.sourceNoteId, userId).permission, "read")
      && hasPermission(resolveNotePermission(link.targetNoteId, userId).permission, "read");
  });
  const nodes = new Map<string, any>();
  for (const link of visible) {
    nodes.set(link.sourceNoteId, { id: link.sourceNoteId, title: link.sourceTitle, notebookId: link.sourceNotebookId });
    nodes.set(link.targetNoteId, { id: link.targetNoteId, title: link.targetTitle, notebookId: link.targetNotebookId });
  }
  return c.json({ nodes: Array.from(nodes.values()), edges: visible });
});

app.get("/note/:noteId", (c) => {
  const noteId = c.req.param("noteId");
  const required = requireNote(c, noteId, "read");
  if (required instanceof Response) return required;
  ensureNoteIndexed(getDb(), noteId);
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "500", 10) || 500, 1), 2000);
  return c.json({ noteId, blocks: getNoteBlocks(getDb(), noteId, limit) });
});

app.get("/:noteId/:blockId/backlinks", (c) => {
  const noteId = c.req.param("noteId");
  const blockId = c.req.param("blockId");
  const required = requireNote(c, noteId, "read");
  if (required instanceof Response) return required;
  const userId = required.userId;
  ensureNoteIndexed(getDb(), noteId);
  if (!getNoteBlock(getDb(), noteId, blockId)) return c.json({ error: "块不存在", code: "BLOCK_NOT_FOUND" }, 404);
  const rows = getDb().prepare(`
    SELECT nl.sourceNoteId, nl.sourceBlockId, nl.targetNoteId, nl.targetBlockId,
           nl.linkType, nl.linkText, nl.excerpt, n.title, n.notebookId, n.updatedAt,
           b.blockType AS sourceBlockType, b.plainText AS sourceBlockText
    FROM note_links nl
    JOIN notes n ON n.id = nl.sourceNoteId AND n.isTrashed = 0
    LEFT JOIN note_blocks_index b ON b.noteId = nl.sourceNoteId AND b.blockId = nl.sourceBlockId
    WHERE nl.targetNoteId = ? AND nl.targetBlockId = ?
    ORDER BY n.updatedAt DESC
    LIMIT 200
  `).all(noteId, blockId) as any[];
  return c.json({ backlinks: rows.filter((row) => hasPermission(resolveNotePermission(row.sourceNoteId, userId).permission, "read")) });
});

app.get("/:noteId/:blockId", (c) => {
  const noteId = c.req.param("noteId");
  const blockId = c.req.param("blockId");
  if (!BLOCK_ID_RE.test(blockId)) return c.json({ error: "无效 blockId", code: "INVALID_BLOCK_ID" }, 400);
  const required = requireNote(c, noteId, "read");
  if (required instanceof Response) return required;
  ensureNoteIndexed(getDb(), noteId);
  const block = getNoteBlock(getDb(), noteId, blockId);
  if (!block) return c.json({ error: "块不存在", code: "BLOCK_NOT_FOUND" }, 404);
  return c.json(block);
});

app.post("/:noteId", (c) => performWrite(c, "create"));
app.put("/:noteId/:blockId", (c) => performWrite(c, "update"));
app.delete("/:noteId/:blockId", (c) => performWrite(c, "delete"));
app.post("/:noteId/:blockId/move", (c) => performWrite(c, "move"));

export default app;
'''

NOTE_LINKS_REPOSITORY = r'''/**
 * Note links repository.
 *
 * Links belong to the source note, not to the user who happened to save it.
 * The legacy userId column is retained for schema compatibility and auditing,
 * but reads and replacement are keyed by sourceNoteId.
 */
import { getDb } from "../db/schema";
import { SqliteAdapter } from "../db/adapters";
import { v4 as uuid } from "uuid";
import type { BacklinkItem, NoteLinkEntry } from "./types";

function getAdapter() {
  return new SqliteAdapter(getDb());
}

export const noteLinksRepository = {
  getBacklinks(
    _userId: string,
    targetNoteId: string,
    limit = 50,
  ): BacklinkItem[] {
    try {
      return getDb().prepare(`
        SELECT
          nl.sourceNoteId,
          nl.sourceBlockId,
          n.title,
          n.notebookId AS sourceNotebookId,
          n.updatedAt,
          nl.linkText,
          nl.linkType,
          nl.targetBlockId,
          nl.excerpt
        FROM note_links nl
        JOIN notes n ON n.id = nl.sourceNoteId
        WHERE nl.targetNoteId = ?
          AND n.isTrashed = 0
        ORDER BY n.updatedAt DESC
        LIMIT ?
      `).all(targetNoteId, limit) as BacklinkItem[];
    } catch (error) {
      console.warn("[noteLinksRepository.getBacklinks] failed:", error instanceof Error ? error.message : error);
      return [];
    }
  },

  replaceLinksForSource(
    userId: string,
    sourceNoteId: string,
    links: NoteLinkEntry[],
  ): void {
    const db = getDb();
    const validEntries: NoteLinkEntry[] = [];
    const check = db.prepare("SELECT id FROM notes WHERE id = ?");
    for (const link of links) if (check.get(link.targetNoteId)) validEntries.push(link);

    const insert = db.prepare(`
      INSERT OR IGNORE INTO note_links (
        id, userId, sourceNoteId, targetNoteId, targetBlockId, sourceBlockId,
        linkType, linkText, excerpt, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    db.transaction(() => {
      db.prepare("DELETE FROM note_links WHERE sourceNoteId = ?").run(sourceNoteId);
      for (const link of validEntries) {
        insert.run(
          uuid(), userId, sourceNoteId, link.targetNoteId, link.targetBlockId,
          link.sourceBlockId, link.linkType, link.linkText, link.excerpt,
        );
      }
    })();
  },

  async replaceLinksForSourceAsync(
    userId: string,
    sourceNoteId: string,
    links: NoteLinkEntry[],
  ): Promise<void> {
    const db = getDb();
    const validEntries: NoteLinkEntry[] = [];
    const check = db.prepare("SELECT id FROM notes WHERE id = ?");
    for (const link of links) if (check.get(link.targetNoteId)) validEntries.push(link);
    await getAdapter().executeStatements([
      { sql: "DELETE FROM note_links WHERE sourceNoteId = ?", params: [sourceNoteId] },
      ...validEntries.map((link) => ({
        sql: `INSERT OR IGNORE INTO note_links (
                id, userId, sourceNoteId, targetNoteId, targetBlockId, sourceBlockId,
                linkType, linkText, excerpt, createdAt, updatedAt
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        params: [
          uuid(), userId, sourceNoteId, link.targetNoteId, link.targetBlockId,
          link.sourceBlockId, link.linkType, link.linkText, link.excerpt,
        ],
      })),
    ]);
  },

  deleteByNoteId(noteId: string): void {
    getDb().prepare("DELETE FROM note_links WHERE sourceNoteId = ? OR targetNoteId = ?").run(noteId, noteId);
  },

  async getBacklinksAsync(
    userId: string,
    targetNoteId: string,
    limit = 50,
  ): Promise<BacklinkItem[]> {
    return this.getBacklinks(userId, targetNoteId, limit);
  },

  async deleteByNoteIdAsync(noteId: string): Promise<void> {
    await getAdapter().execute(
      "DELETE FROM note_links WHERE sourceNoteId = ? OR targetNoteId = ?",
      [noteId, noteId],
    );
  },
};
'''

NOTE_LINKS = r'''/**
 * Note and block backlink extraction.
 *
 * The source block is discovered while traversing Tiptap JSON. Markdown and
 * legacy HTML links remain supported with sourceBlockId = null.
 */
import type Database from "better-sqlite3";
import { noteLinksRepository } from "../repositories";
import type { NoteLinkEntry } from "../repositories";
import { hasPermission, resolveNotePermission } from "../middleware/acl";

const NOTE_LINK_RE = /\[\[note:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:#blk:([a-zA-Z0-9_-]+))?(?:\|([^\]]*))?\]\]/g;
const NOTE_HREF_RE = /note:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:#blk:([a-zA-Z0-9_-]+))?/g;
const SOURCE_BLOCK_TYPES = new Set(["heading", "paragraph", "listItem", "taskItem", "blockquote", "codeBlock"]);

function addEntry(entries: NoteLinkEntry[], seen: Set<string>, entry: NoteLinkEntry): void {
  const key = `${entry.sourceBlockId || ""}:${entry.targetNoteId}:${entry.targetBlockId || ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  entries.push(entry);
}

function entriesFromText(text: string, sourceBlockId: string | null, entries: NoteLinkEntry[], seen: Set<string>): void {
  for (const match of text.matchAll(NOTE_LINK_RE)) {
    const targetNoteId = match[1].toLowerCase();
    const targetBlockId = match[2] || null;
    const displayText = match[3] || null;
    addEntry(entries, seen, {
      targetNoteId,
      targetBlockId,
      sourceBlockId,
      linkType: targetBlockId ? "block" : "note",
      linkText: displayText,
      excerpt: text.replace(/\s+/g, " ").trim().slice(0, 240) || displayText,
    });
  }
  for (const match of text.matchAll(NOTE_HREF_RE)) {
    const targetNoteId = match[1].toLowerCase();
    const targetBlockId = match[2] || null;
    addEntry(entries, seen, {
      targetNoteId,
      targetBlockId,
      sourceBlockId,
      linkType: targetBlockId ? "block" : "note",
      linkText: null,
      excerpt: text.replace(/\s+/g, " ").trim().slice(0, 240) || null,
    });
  }
}

export function extractNoteLinksFromContent(content: string): NoteLinkEntry[] {
  const entries: NoteLinkEntry[] = [];
  const seen = new Set<string>();
  try {
    const doc = JSON.parse(content);
    if (doc && typeof doc === "object" && Array.isArray(doc.content)) {
      const visit = (nodes: any[], parentBlockId: string | null) => {
        for (const node of nodes) {
          if (!node || typeof node !== "object") continue;
          const ownBlockId = SOURCE_BLOCK_TYPES.has(node.type) && typeof node.attrs?.blockId === "string"
            ? node.attrs.blockId
            : parentBlockId;
          if (node.type === "text") {
            const text = String(node.text || "");
            entriesFromText(text, ownBlockId, entries, seen);
            for (const mark of Array.isArray(node.marks) ? node.marks : []) {
              const href = mark?.attrs?.href;
              if (mark?.type === "link" && typeof href === "string" && href.startsWith("note:")) {
                entriesFromText(href, ownBlockId, entries, seen);
              }
            }
          }
          if (Array.isArray(node.content)) visit(node.content, ownBlockId);
        }
      };
      visit(doc.content, null);
      return entries;
    }
  } catch {
    // Markdown / HTML fallback below.
  }
  entriesFromText(content, null, entries, seen);
  return entries;
}

export function syncNoteLinks(
  _db: Database.Database,
  userId: string,
  sourceNoteId: string,
  content: string,
): void {
  try {
    const links = extractNoteLinksFromContent(content).filter(
      (link) => !(link.targetNoteId === sourceNoteId.toLowerCase() && !link.targetBlockId),
    );
    noteLinksRepository.replaceLinksForSource(userId, sourceNoteId, links);
  } catch (error) {
    console.warn("[syncNoteLinks] failed:", error instanceof Error ? error.message : error);
  }
}

export function getBacklinks(
  _db: Database.Database,
  userId: string,
  targetNoteId: string,
  limit = 50,
) {
  return noteLinksRepository
    .getBacklinks(userId, targetNoteId, Math.min(Math.max(limit * 3, limit), 600))
    .filter((item) => hasPermission(resolveNotePermission(item.sourceNoteId, userId).permission, "read"))
    .slice(0, limit);
}
'''

BLOCK_TEST = r'''import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import type Database from "better-sqlite3";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-knowledge-blocks-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");
process.env.ELECTRON_USER_DATA = tmpDir;

let db: Database.Database;
let closeDb: () => void;
let blocksApp: Hono;
let syncNoteBlocks: typeof import("../src/lib/noteBlocks").syncNoteBlocks;
let syncNoteLinks: typeof import("../src/lib/noteLinks").syncNoteLinks;

const owner = "knowledge-owner";
const viewer = "knowledge-viewer";
const notebookId = "knowledge-notebook";
const sourceId = "11111111-1111-4111-8111-111111111111";
const targetId = "22222222-2222-4222-8222-222222222222";

function tiptap(blockId: string, text: string, href?: string): string {
  return JSON.stringify({
    type: "doc",
    content: [{
      type: "paragraph",
      attrs: { blockId },
      content: [{
        type: "text",
        text,
        ...(href ? { marks: [{ type: "link", attrs: { href } }] } : {}),
      }],
    }],
  });
}

test.before(async () => {
  const [schema, blocks, blockRoute, noteLinks] = await Promise.all([
    import("../src/db/schema"),
    import("../src/lib/noteBlocks"),
    import("../src/routes/blocks"),
    import("../src/lib/noteLinks"),
  ]);
  db = schema.getDb();
  closeDb = schema.closeDb;
  syncNoteBlocks = blocks.syncNoteBlocks;
  syncNoteLinks = noteLinks.syncNoteLinks;
  blocksApp = new Hono();
  blocksApp.route("/blocks", blockRoute.default);

  db.prepare("INSERT INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(owner, owner, "hash");
  db.prepare("INSERT INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(viewer, viewer, "hash");
  db.prepare("INSERT INTO notebooks (id, userId, name) VALUES (?, ?, ?)").run(notebookId, owner, "Knowledge");
  db.prepare(`INSERT INTO notes (id, userId, notebookId, title, content, contentText, contentFormat)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(targetId, owner, notebookId, "Target", tiptap("blk_target", "Target paragraph"), "Target paragraph", "tiptap-json");
  db.prepare(`INSERT INTO notes (id, userId, notebookId, title, content, contentText, contentFormat)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(sourceId, owner, notebookId, "Source", tiptap("blk_source", "See target", `note:${targetId}#blk:blk_target`), "See target", "tiptap-json");
  db.prepare("INSERT INTO note_acl (noteId, userId, permission) VALUES (?, ?, ?)").run(targetId, viewer, "read");
  db.prepare("INSERT INTO note_acl (noteId, userId, permission) VALUES (?, ?, ?)").run(sourceId, viewer, "read");
  syncNoteBlocks(db, targetId, tiptap("blk_target", "Target paragraph"), "tiptap-json");
  syncNoteBlocks(db, sourceId, tiptap("blk_source", "See target", `note:${targetId}#blk:blk_target`), "tiptap-json");
  syncNoteLinks(db, owner, sourceId, tiptap("blk_source", "See target", `note:${targetId}#blk:blk_target`));
});

test.after(async () => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("universal block indexing adds stable IDs to supported Tiptap nodes", () => {
  const content = JSON.stringify({
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Heading" }] },
      { type: "paragraph", content: [{ type: "text", text: "Paragraph" }] },
      { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Quote" }] }] },
    ],
  });
  db.prepare(`INSERT INTO notes (id, userId, notebookId, title, content, contentText, contentFormat)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("33333333-3333-4333-8333-333333333333", owner, notebookId, "Blocks", content, "", "tiptap-json");
  const first = syncNoteBlocks(db, "33333333-3333-4333-8333-333333333333", content, "tiptap-json");
  assert.ok(first.blocks.some((block) => block.blockType === "heading"));
  assert.ok(first.blocks.some((block) => block.blockType === "paragraph"));
  assert.ok(first.blocks.some((block) => block.blockType === "blockquote"));
  assert.ok(first.blocks.every((block) => block.blockId.startsWith("blk_")));
  const second = syncNoteBlocks(db, "33333333-3333-4333-8333-333333333333", first.content, "tiptap-json");
  assert.deepEqual(second.blocks.map((block) => block.blockId), first.blocks.map((block) => block.blockId));
});

test("Markdown blocks receive persisted block markers", () => {
  const noteId = "44444444-4444-4444-8444-444444444444";
  const content = "# Markdown heading\n\nA paragraph\n\n- [ ] Task\n";
  db.prepare(`INSERT INTO notes (id, userId, notebookId, title, content, contentText, contentFormat)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(noteId, owner, notebookId, "Markdown", content, "", "markdown");
  const first = syncNoteBlocks(db, noteId, content, "markdown");
  assert.match(first.content, /\^blk_/);
  const second = syncNoteBlocks(db, noteId, first.content, "markdown");
  assert.equal(second.changed, false);
  assert.deepEqual(second.blocks.map((block) => block.blockId), first.blocks.map((block) => block.blockId));
});

test("block backlinks are visible to another user with note ACL", async () => {
  const response = await blocksApp.request(
    `/blocks/${targetId}/blk_target/backlinks`,
    { headers: { "X-User-Id": viewer } },
  );
  assert.equal(response.status, 200);
  const payload = await response.json() as any;
  assert.equal(payload.backlinks.length, 1);
  assert.equal(payload.backlinks[0].sourceBlockId, "blk_source");
});

test("block update enforces note version and operation idempotency", async () => {
  const note = db.prepare("SELECT version FROM notes WHERE id = ?").get(targetId) as { version: number };
  const body = {
    expectedNoteVersion: note.version,
    operationId: "knowledge-op-update-1",
    text: "Updated target paragraph",
  };
  const first = await blocksApp.request(`/blocks/${targetId}/blk_target`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-User-Id": owner },
    body: JSON.stringify(body),
  });
  assert.equal(first.status, 200);
  const firstPayload = await first.json() as any;
  assert.equal(firstPayload.version, note.version + 1);

  const replay = await blocksApp.request(`/blocks/${targetId}/blk_target`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-User-Id": owner },
    body: JSON.stringify(body),
  });
  assert.equal(replay.status, 200);
  const replayPayload = await replay.json() as any;
  assert.equal(replayPayload.idempotentReplay, true);
});
'''

write("backend/src/lib/noteBlocks.ts", NOTE_BLOCKS)
write("backend/src/routes/blocks.ts", BLOCK_ROUTES)
write("backend/src/repositories/noteLinksRepository.ts", NOTE_LINKS_REPOSITORY)
write("backend/src/lib/noteLinks.ts", NOTE_LINKS)
write("backend/tests/knowledge-blocks.test.ts", BLOCK_TEST)

replace_once(
    "backend/src/repositories/types.ts",
    '''export interface BacklinkItem {
  sourceNoteId: string;
  title: string;
  updatedAt: string;
  linkText: string | null;
  linkType: string;
  targetBlockId: string | null;
  excerpt: string | null;
}''',
    '''export interface BacklinkItem {
  sourceNoteId: string;
  sourceBlockId: string | null;
  sourceNotebookId: string;
  title: string;
  updatedAt: string;
  linkText: string | null;
  linkType: string;
  targetBlockId: string | null;
  excerpt: string | null;
}''',
    "backlink item source context",
)
replace_once(
    "backend/src/repositories/types.ts",
    '''export interface NoteLinkEntry {
  targetNoteId: string;
  targetBlockId: string | null;
  linkType: "note" | "block";
  linkText: string | null;
  excerpt: string | null;
}''',
    '''export interface NoteLinkEntry {
  targetNoteId: string;
  targetBlockId: string | null;
  sourceBlockId: string | null;
  linkType: "note" | "block";
  linkText: string | null;
  excerpt: string | null;
}''',
    "note link source block type",
)

replace_once(
    "backend/src/index.ts",
    'import notesRouter from "./routes/notes";\n',
    'import notesRouter from "./routes/notes";\nimport blocksRouter from "./routes/blocks";\n',
    "blocks router import",
)
replace_once(
    "backend/src/index.ts",
    'app.route("/api/notes", notesRouter);\n',
    'app.route("/api/notes", notesRouter);\napp.route("/api/blocks", blocksRouter);\n',
    "blocks router mount",
)

replace_once(
    "backend/src/routes/notes.ts",
    'import { syncNoteLinks, getBacklinks } from "../lib/noteLinks";\n',
    'import { syncNoteLinks, getBacklinks } from "../lib/noteLinks";\nimport { syncNoteBlocks } from "../lib/noteBlocks";\n',
    "note blocks import",
)
replace_once(
    "backend/src/routes/notes.ts",
    '''  if (typeof finalContent === "string") {
    try {
      syncNoteLinks(db, userId, id, finalContent);
    } catch (e) {
      console.warn("[notes.post] syncNoteLinks failed:", e instanceof Error ? e.message : e);
    }
  }

  // Y1: SELECT 时 isFavorite 按 per-user 动态计算；新建笔记当前用户尚未收藏，结果必为 0。''',
    '''  if (typeof finalContent === "string") {
    try {
      syncNoteLinks(db, userId, id, finalContent);
    } catch (e) {
      console.warn("[notes.post] syncNoteLinks failed:", e instanceof Error ? e.message : e);
    }
  }
  try {
    const stored = db.prepare("SELECT content, contentFormat FROM notes WHERE id = ?").get(id) as
      | { content: string; contentFormat: string }
      | undefined;
    if (stored) syncNoteBlocks(db, id, stored.content || "", stored.contentFormat || "tiptap-json");
  } catch (e) {
    console.warn("[notes.post] syncNoteBlocks failed:", e instanceof Error ? e.message : e);
  }

  // Y1: SELECT 时 isFavorite 按当前用户动态计算；新建笔记当前用户尚未收藏，结果必为 0。''',
    "sync blocks on note create",
)
replace_once(
    "backend/src/routes/notes.ts",
    '''  if (body.content !== undefined && typeof body.content === "string") {
    try {
      syncNoteLinks(db, userId, id, body.content);
    } catch (e) {
      console.warn("[notes.put] syncNoteLinks failed:", e instanceof Error ? e.message : e);
    }
  }

  // Y1: 返回值里 isFavorite 按当前用户动态计算（EXISTS favorites 表），''',
    '''  if (body.content !== undefined && typeof body.content === "string") {
    try {
      syncNoteLinks(db, userId, id, body.content);
    } catch (e) {
      console.warn("[notes.put] syncNoteLinks failed:", e instanceof Error ? e.message : e);
    }
    try {
      const stored = db.prepare("SELECT content, contentFormat FROM notes WHERE id = ?").get(id) as
        | { content: string; contentFormat: string }
        | undefined;
      if (stored) syncNoteBlocks(db, id, stored.content || "", stored.contentFormat || "tiptap-json");
    } catch (e) {
      console.warn("[notes.put] syncNoteBlocks failed:", e instanceof Error ? e.message : e);
    }
  }

  // Y1: 返回值里 isFavorite 按当前用户动态计算（EXISTS favorites 表），''',
    "sync blocks on note update",
)

# API token resource scope: blocks are note-scoped and must obey the same notebook grants.
replace_once(
    "backend/src/middleware/api-token-resource-scope.ts",
    '  if (pathname.startsWith("/api/notes")) return write ? "notes:write" : "notes:read";\n',
    '  if (pathname.startsWith("/api/notes")) return write ? "notes:write" : "notes:read";\n  if (pathname.startsWith("/api/blocks")) return write ? "notes:write" : "notes:read";\n',
    "block endpoint scope",
)
replace_once(
    "backend/src/middleware/api-token-resource-scope.ts",
    '''async function handleSearch(c: Context, next: Next, ctx: TokenAccessContext): Promise<void> {
  await next();
  await replaceFilteredResponse(c, (body) => Array.isArray(body)
    ? body.filter((item) => canRead(ctx, item?.notebookId))
    : body);
}
''',
    '''async function handleSearch(c: Context, next: Next, ctx: TokenAccessContext): Promise<void> {
  await next();
  await replaceFilteredResponse(c, (body) => Array.isArray(body)
    ? body.filter((item) => canRead(ctx, item?.notebookId))
    : body);
}

async function handleBlocks(c: Context, next: Next, ctx: TokenAccessContext): Promise<void> {
  const path = c.req.path;
  const method = c.req.method.toUpperCase();
  const segments = path.split("/").filter(Boolean);
  if (["search", "resolve", "graph"].includes(segments[2] || "")) {
    await next();
    return;
  }
  const noteId = segments[2] === "note" ? decodeURIComponent(segments[3] || "") : decodeURIComponent(segments[2] || "");
  if (!noteId) throw new ApiTokenAccessError("块接口缺少 noteId");
  assertNotebook(ctx, resolveNoteNotebookId(noteId), !["GET", "HEAD"].includes(method));
  await next();
}
''',
    "block token handler",
)
replace_once(
    "backend/src/middleware/api-token-resource-scope.ts",
    '    else if (c.req.path.startsWith("/api/search")) await handleSearch(c, next, ctx);\n',
    '    else if (c.req.path.startsWith("/api/search")) await handleSearch(c, next, ctx);\n    else if (c.req.path.startsWith("/api/blocks")) await handleBlocks(c, next, ctx);\n',
    "block token handler mount",
)

# SQLite migration v45.
migrations_path = Path("backend/src/db/migrations.impl.ts")
migrations = migrations_path.read_text(encoding="utf-8")
closing = "\n];\n\n/** 当前代码已知的最高 schema 版本"
if migrations.count(closing) != 1:
    raise SystemExit("migration insertion point not found")
migration = r'''
  // v45: 通用块索引、幂等块操作与来源块级双链。
  {
    version: 45,
    name: "knowledge-block-index-and-source-links",
    up: (db) => {
      const linkCols = db.prepare("PRAGMA table_info(note_links)").all() as { name: string }[];
      if (!linkCols.some((column) => column.name === "sourceBlockId")) {
        db.prepare("ALTER TABLE note_links ADD COLUMN sourceBlockId TEXT").run();
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS note_blocks_index (
          noteId TEXT NOT NULL,
          blockId TEXT NOT NULL,
          blockType TEXT NOT NULL,
          parentBlockId TEXT,
          blockOrder INTEGER NOT NULL DEFAULT 0,
          plainText TEXT NOT NULL DEFAULT '',
          contentHash TEXT NOT NULL DEFAULT '',
          path TEXT NOT NULL DEFAULT '',
          startOffset INTEGER,
          endOffset INTEGER,
          createdAt TEXT NOT NULL DEFAULT (datetime('now')),
          updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (noteId, blockId),
          FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_note_blocks_block_id ON note_blocks_index(blockId);
        CREATE INDEX IF NOT EXISTS idx_note_blocks_note_order ON note_blocks_index(noteId, blockOrder);
        CREATE INDEX IF NOT EXISTS idx_note_blocks_hash ON note_blocks_index(noteId, blockType, contentHash);

        CREATE TABLE IF NOT EXISTS block_operations (
          userId TEXT NOT NULL,
          operationId TEXT NOT NULL,
          noteId TEXT NOT NULL,
          resultJson TEXT NOT NULL,
          createdAt TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (userId, operationId),
          FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_block_operations_note ON block_operations(noteId, createdAt DESC);

        DROP INDEX IF EXISTS idx_note_links_unique_note;
        DROP INDEX IF EXISTS idx_note_links_unique_block;
      `);
      db.exec(`
        DELETE FROM note_links
        WHERE rowid NOT IN (
          SELECT MIN(rowid)
          FROM note_links
          GROUP BY sourceNoteId, targetNoteId, IFNULL(sourceBlockId, ''), IFNULL(targetBlockId, '')
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_note_links_unique_note
          ON note_links(sourceNoteId, targetNoteId, IFNULL(sourceBlockId, ''))
          WHERE targetBlockId IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_note_links_unique_block
          ON note_links(sourceNoteId, targetNoteId, targetBlockId, IFNULL(sourceBlockId, ''))
          WHERE targetBlockId IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_note_links_source_block
          ON note_links(sourceNoteId, sourceBlockId);
      `);
    },
  },
'''
migrations_path.write_text(migrations.replace(closing, migration + closing, 1), encoding="utf-8")

# PostgreSQL baseline parity.
pg_path = Path("backend/src/db/postgres/schema.base.sql")
pg = pg_path.read_text(encoding="utf-8")
pg_append = r'''

-- ============================================================
-- Universal note block index and idempotent block operations
-- ============================================================
CREATE TABLE IF NOT EXISTS note_blocks_index (
    "noteId" TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    "blockId" TEXT NOT NULL,
    "blockType" TEXT NOT NULL,
    "parentBlockId" TEXT,
    "blockOrder" INTEGER NOT NULL DEFAULT 0,
    "plainText" TEXT NOT NULL DEFAULT '',
    "contentHash" TEXT NOT NULL DEFAULT '',
    path TEXT NOT NULL DEFAULT '',
    "startOffset" INTEGER,
    "endOffset" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("noteId", "blockId")
);
CREATE INDEX IF NOT EXISTS idx_note_blocks_block_id ON note_blocks_index("blockId");
CREATE INDEX IF NOT EXISTS idx_note_blocks_note_order ON note_blocks_index("noteId", "blockOrder");
CREATE INDEX IF NOT EXISTS idx_note_blocks_hash ON note_blocks_index("noteId", "blockType", "contentHash");

CREATE TABLE IF NOT EXISTS block_operations (
    "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "operationId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    "resultJson" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("userId", "operationId")
);
CREATE INDEX IF NOT EXISTS idx_block_operations_note ON block_operations("noteId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_note_links_source_block ON note_links("sourceNoteId", "sourceBlockId");
'''
if "CREATE TABLE IF NOT EXISTS note_blocks_index" not in pg:
    pg_path.write_text(pg.rstrip() + pg_append + "\n", encoding="utf-8")

print("issue 165 backend patch applied")
