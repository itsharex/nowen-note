import { createHash } from "node:crypto";
import { v4 as uuid } from "uuid";
import type Database from "better-sqlite3";
import { syncNoteBlocks } from "./noteBlocks.js";

interface IndexedBlockRow {
  blockId: string;
  blockType: string;
  parentBlockId: string | null;
  blockOrder: number;
  plainText: string;
  contentHash: string;
  path: string;
  startOffset: number | null;
  endOffset: number | null;
}

interface PreviousRecord {
  blockId: string;
  version: number;
  payloadHash: string;
}

export interface RebuildBlockAuthorityOptions {
  noteVersion: number;
  operationId?: string;
  operationType?: string;
  operationJson?: unknown;
}

export interface BlockAuthorityDocumentState {
  status: "healthy" | "mismatch";
  blockVersion: number;
  structureVersion: number;
  snapshotHash: string;
}

export interface ExpectedBlockAuthorityVersions {
  expectedStructureVersion?: number;
  expectedBlockVersions?: Record<string, number>;
}

export class BlockAuthorityConflictError extends Error {
  constructor(
    readonly code: "BLOCK_VERSION_CONFLICT" | "STRUCTURE_VERSION_CONFLICT",
    readonly details: Record<string, unknown>,
  ) {
    super(code);
  }
}

export function hashBlockAuthorityContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function ensureBlockAuthorityTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS note_block_documents (
      noteId TEXT PRIMARY KEY,
      contentFormat TEXT NOT NULL,
      noteVersion INTEGER NOT NULL DEFAULT 1,
      blockVersion INTEGER NOT NULL DEFAULT 1,
      structureVersion INTEGER NOT NULL DEFAULT 1,
      snapshotHash TEXT NOT NULL,
      materializedHash TEXT NOT NULL,
      snapshotContent TEXT NOT NULL,
      rootOrderJson TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'healthy',
      mismatchReason TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS note_block_records (
      noteId TEXT NOT NULL,
      blockId TEXT NOT NULL,
      parentBlockId TEXT,
      blockType TEXT NOT NULL,
      blockOrder INTEGER NOT NULL,
      path TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      payload TEXT NOT NULL,
      payloadHash TEXT NOT NULL,
      plainText TEXT NOT NULL DEFAULT '',
      contentHash TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (noteId, blockId),
      FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_note_block_records_order ON note_block_records(noteId, blockOrder);
    CREATE INDEX IF NOT EXISTS idx_note_block_records_parent ON note_block_records(noteId, parentBlockId);
    CREATE TABLE IF NOT EXISTS note_block_operations (
      id TEXT PRIMARY KEY,
      noteId TEXT NOT NULL,
      operationId TEXT,
      operationType TEXT NOT NULL,
      noteVersion INTEGER NOT NULL,
      blockVersion INTEGER NOT NULL,
      structureVersion INTEGER NOT NULL,
      operationJson TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_note_block_operations_note ON note_block_operations(noteId, createdAt DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_note_block_operations_idempotency
      ON note_block_operations(noteId, operationId) WHERE operationId IS NOT NULL;
    CREATE TABLE IF NOT EXISTS note_block_attachment_refs (
      noteId TEXT NOT NULL,
      blockId TEXT NOT NULL,
      attachmentId TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (noteId, blockId, attachmentId),
      FOREIGN KEY (noteId, blockId) REFERENCES note_block_records(noteId, blockId) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_note_block_attachment_refs_attachment
      ON note_block_attachment_refs(attachmentId, noteId);
  `);
}

function readIndexedBlocks(db: Database.Database, noteId: string): IndexedBlockRow[] {
  return db.prepare(`
    SELECT blockId, blockType, parentBlockId, blockOrder, plainText, contentHash,
           path, startOffset, endOffset
    FROM note_blocks_index WHERE noteId = ? ORDER BY blockOrder
  `).all(noteId) as IndexedBlockRow[];
}

function tiptapNodeAtPath(content: string, path: string): unknown {
  const doc = JSON.parse(content || "{}");
  let nodes = Array.isArray(doc?.content) ? doc.content : [];
  let node: unknown = null;
  for (const part of path.split(".")) {
    const index = Number(part);
    if (!Number.isInteger(index) || !Array.isArray(nodes) || index < 0 || index >= nodes.length) return null;
    node = nodes[index];
    nodes = Array.isArray((node as any)?.content) ? (node as any).content : [];
  }
  return node;
}

function blockPayload(content: string, contentFormat: string, row: IndexedBlockRow): string {
  if (contentFormat === "tiptap-json") {
    const node = tiptapNodeAtPath(content, row.path);
    if (!node) throw new Error(`无法从 path ${row.path} 读取 Block ${row.blockId}`);
    return JSON.stringify(node);
  }
  if (row.startOffset == null || row.endOffset == null || row.startOffset < 0 || row.endOffset < row.startOffset) {
    throw new Error(`Markdown Block ${row.blockId} 缺少合法范围`);
  }
  return content.slice(row.startOffset, row.endOffset);
}

function structureSignature(rows: IndexedBlockRow[]): string {
  return hashBlockAuthorityContent(JSON.stringify(rows.map((row) => ({
    blockId: row.blockId,
    parentBlockId: row.parentBlockId,
    blockOrder: row.blockOrder,
    path: row.path,
  }))));
}

function readPreviousStructureSignature(db: Database.Database, noteId: string): string | null {
  const rows = db.prepare(`
    SELECT blockId, parentBlockId, blockOrder, path
    FROM note_block_records WHERE noteId = ? ORDER BY blockOrder
  `).all(noteId) as Array<{ blockId: string; parentBlockId: string | null; blockOrder: number; path: string }>;
  if (rows.length === 0) return null;
  return hashBlockAuthorityContent(JSON.stringify(rows));
}

function attachmentIdsFromPayload(payload: string): string[] {
  const ids = new Set<string>();
  for (const match of payload.matchAll(/\/api\/attachments\/([A-Za-z0-9_-]{6,128})/g)) ids.add(match[1]);
  for (const match of payload.matchAll(/"attachmentId"\s*:\s*"([A-Za-z0-9_-]{6,128})"/g)) ids.add(match[1]);
  return [...ids];
}

export function rebuildBlockAuthorityStore(
  db: Database.Database,
  noteId: string,
  content: string,
  contentFormat: string,
  options: RebuildBlockAuthorityOptions,
): BlockAuthorityDocumentState {
  ensureBlockAuthorityTables(db);
  const rows = readIndexedBlocks(db, noteId);
  const previousDocument = db.prepare(`
    SELECT blockVersion, structureVersion FROM note_block_documents WHERE noteId = ?
  `).get(noteId) as { blockVersion: number; structureVersion: number } | undefined;
  const previousRecords = new Map((db.prepare(`
    SELECT blockId, version, payloadHash FROM note_block_records WHERE noteId = ?
  `).all(noteId) as PreviousRecord[]).map((row) => [row.blockId, row]));
  const previousStructure = readPreviousStructureSignature(db, noteId);
  const nextStructure = structureSignature(rows);
  const materialized = rows.map((row) => {
    const payload = blockPayload(content, contentFormat, row);
    return { row, payload, payloadHash: hashBlockAuthorityContent(payload) };
  });
  const removed = [...previousRecords.keys()].some((blockId) => !rows.some((row) => row.blockId === blockId));
  const blockChanged = removed || materialized.some(({ row, payloadHash }) => previousRecords.get(row.blockId)?.payloadHash !== payloadHash);
  const structureChanged = previousStructure == null || previousStructure !== nextStructure;
  const blockVersion = previousDocument ? previousDocument.blockVersion + (blockChanged ? 1 : 0) : 1;
  const structureVersion = previousDocument ? previousDocument.structureVersion + (structureChanged ? 1 : 0) : 1;
  const snapshotHash = hashBlockAuthorityContent(content);

  const write = db.transaction(() => {
    db.prepare("DELETE FROM note_block_attachment_refs WHERE noteId = ?").run(noteId);
    db.prepare("DELETE FROM note_block_records WHERE noteId = ?").run(noteId);
    const insertRecord = db.prepare(`
      INSERT INTO note_block_records (
        noteId, blockId, parentBlockId, blockType, blockOrder, path, version,
        payload, payloadHash, plainText, contentHash, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    const insertRef = db.prepare(`
      INSERT OR IGNORE INTO note_block_attachment_refs (noteId, blockId, attachmentId)
      VALUES (?, ?, ?)
    `);
    for (const { row, payload, payloadHash } of materialized) {
      const previous = previousRecords.get(row.blockId);
      const version = previous ? previous.version + (previous.payloadHash === payloadHash ? 0 : 1) : 1;
      insertRecord.run(
        noteId, row.blockId, row.parentBlockId, row.blockType, row.blockOrder, row.path,
        version, payload, payloadHash, row.plainText, row.contentHash,
      );
      for (const attachmentId of attachmentIdsFromPayload(payload)) insertRef.run(noteId, row.blockId, attachmentId);
    }
    db.prepare(`
      INSERT INTO note_block_documents (
        noteId, contentFormat, noteVersion, blockVersion, structureVersion,
        snapshotHash, materializedHash, snapshotContent, rootOrderJson,
        status, mismatchReason, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'healthy', NULL, datetime('now'), datetime('now'))
      ON CONFLICT(noteId) DO UPDATE SET
        contentFormat = excluded.contentFormat,
        noteVersion = excluded.noteVersion,
        blockVersion = excluded.blockVersion,
        structureVersion = excluded.structureVersion,
        snapshotHash = excluded.snapshotHash,
        materializedHash = excluded.materializedHash,
        snapshotContent = excluded.snapshotContent,
        rootOrderJson = excluded.rootOrderJson,
        status = 'healthy', mismatchReason = NULL, updatedAt = datetime('now')
    `).run(
      noteId, contentFormat, options.noteVersion, blockVersion, structureVersion,
      snapshotHash, snapshotHash, content, JSON.stringify(rows.map((row) => row.blockId)),
    );
    if (options.operationId || options.operationJson !== undefined) {
      db.prepare(`
        INSERT OR IGNORE INTO note_block_operations (
          id, noteId, operationId, operationType, noteVersion,
          blockVersion, structureVersion, operationJson
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        uuid(), noteId, options.operationId || null, options.operationType || "snapshot",
        options.noteVersion, blockVersion, structureVersion, JSON.stringify(options.operationJson ?? {}),
      );
    }
  });
  write();
  return { status: "healthy", blockVersion, structureVersion, snapshotHash };
}

export function readAuthoritativeNoteContent(
  db: Database.Database,
  noteId: string,
  notesContent: string,
): { content: string; source: "blocks" | "notes"; status: "healthy" | "missing" | "mismatch" } {
  ensureBlockAuthorityTables(db);
  const row = db.prepare(`
    SELECT snapshotContent, snapshotHash, materializedHash, status
    FROM note_block_documents WHERE noteId = ?
  `).get(noteId) as { snapshotContent: string; snapshotHash: string; materializedHash: string; status: string } | undefined;
  if (!row) return { content: notesContent, source: "notes", status: "missing" };
  const storedHash = hashBlockAuthorityContent(row.snapshotContent);
  const notesHash = hashBlockAuthorityContent(notesContent);
  if (row.status !== "healthy" || storedHash !== row.snapshotHash || row.materializedHash !== row.snapshotHash || notesHash !== row.snapshotHash) {
    db.prepare(`
      UPDATE note_block_documents
      SET status = 'mismatch', mismatchReason = ?, updatedAt = datetime('now')
      WHERE noteId = ?
    `).run("snapshot_hash_mismatch", noteId);
    return { content: notesContent, source: "notes", status: "mismatch" };
  }
  return { content: row.snapshotContent, source: "blocks", status: "healthy" };
}

export function assertBlockAuthorityVersions(
  db: Database.Database,
  noteId: string,
  expected: ExpectedBlockAuthorityVersions,
): BlockAuthorityDocumentState | null {
  ensureBlockAuthorityTables(db);
  const document = db.prepare(`
    SELECT status, blockVersion, structureVersion, snapshotHash
    FROM note_block_documents WHERE noteId = ?
  `).get(noteId) as BlockAuthorityDocumentState | undefined;
  if (!document || document.status !== "healthy") return null;
  if (
    expected.expectedStructureVersion !== undefined
    && expected.expectedStructureVersion !== document.structureVersion
  ) {
    throw new BlockAuthorityConflictError("STRUCTURE_VERSION_CONFLICT", {
      currentStructureVersion: document.structureVersion,
    });
  }
  const entries = Object.entries(expected.expectedBlockVersions || {});
  if (entries.length > 0) {
    const readVersion = db.prepare(`
      SELECT version FROM note_block_records WHERE noteId = ? AND blockId = ?
    `);
    const conflicts = entries.flatMap(([blockId, expectedVersion]) => {
      const row = readVersion.get(noteId, blockId) as { version: number } | undefined;
      return row?.version === expectedVersion
        ? []
        : [{ blockId, expectedVersion, currentVersion: row?.version ?? null }];
    });
    if (conflicts.length > 0) {
      throw new BlockAuthorityConflictError("BLOCK_VERSION_CONFLICT", { conflicts });
    }
  }
  return document;
}

export function backfillBlockAuthorityStore(
  db: Database.Database,
  options: { limit?: number; afterId?: string } = {},
): { scanned: number; rebuilt: number; failed: Array<{ noteId: string; error: string }>; nextCursor: string | null } {
  ensureBlockAuthorityTables(db);
  const limit = Math.max(1, Math.min(1000, options.limit ?? 100));
  const rows = db.prepare(`
    SELECT id, content, contentFormat, version
    FROM notes
    WHERE id > ? AND contentFormat IN ('tiptap-json', 'markdown')
    ORDER BY id LIMIT ?
  `).all(options.afterId || "", limit) as Array<{
    id: string;
    content: string;
    contentFormat: string;
    version: number;
  }>;
  const failed: Array<{ noteId: string; error: string }> = [];
  let rebuilt = 0;
  for (const row of rows) {
    try {
      db.transaction(() => {
        const synced = syncNoteBlocks(db, row.id, row.content, row.contentFormat);
        if (synced.content !== row.content) {
          db.prepare("UPDATE notes SET content = ?, contentText = ? WHERE id = ?")
            .run(synced.content, synced.contentText, row.id);
        }
        rebuildBlockAuthorityStore(db, row.id, synced.content, row.contentFormat, {
          noteVersion: row.version,
          operationType: "backfill",
        });
      })();
      rebuilt += 1;
    } catch (error) {
      markBlockAuthorityMismatch(db, row.id, `backfill:${error instanceof Error ? error.message : String(error)}`);
      failed.push({ noteId: row.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    scanned: rows.length,
    rebuilt,
    failed,
    nextCursor: rows.length === limit ? rows[rows.length - 1]?.id || null : null,
  };
}

export function markBlockAuthorityMismatch(db: Database.Database, noteId: string, reason: string): void {
  ensureBlockAuthorityTables(db);
  db.prepare(`
    UPDATE note_block_documents SET status = 'mismatch', mismatchReason = ?, updatedAt = datetime('now')
    WHERE noteId = ?
  `).run(reason.slice(0, 512), noteId);
}
