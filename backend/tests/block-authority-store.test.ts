import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-block-authority-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");
process.env.ELECTRON_USER_DATA = tmpDir;

let closeDb: () => void;

test.after(() => {
  closeDb?.();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("rebuilds a healthy Block shadow with versions, operation history and attachment refs", async () => {
  const [{ getDb, closeDb: close }, store, noteBlocks] = await Promise.all([
    import("../src/db/schema"),
    import("../src/lib/blockAuthorityStore"),
    import("../src/lib/noteBlocks"),
  ]);
  closeDb = close;
  const db = getDb();
  const userId = "authority-user";
  const notebookId = "authority-notebook";
  const noteId = "15151515-1515-4515-8515-151515151515";
  db.prepare("INSERT INTO users (id, username, passwordHash) VALUES (?, ?, ?)").run(userId, userId, "hash");
  db.prepare("INSERT INTO notebooks (id, userId, name) VALUES (?, ?, ?)").run(notebookId, userId, "Authority");
  const content = JSON.stringify({
    type: "doc",
    content: [{
      type: "paragraph",
      attrs: { blockId: "blk_authority0" },
      content: [{ type: "image", attrs: { src: "/api/attachments/attachment-001", alt: null, title: null } }],
    }],
  });
  db.prepare(`
    INSERT INTO notes (id, userId, notebookId, title, content, contentText, contentFormat, version)
    VALUES (?, ?, ?, 'Authority', ?, '', 'tiptap-json', 1)
  `).run(noteId, userId, notebookId, content);
  noteBlocks.syncNoteBlocks(db, noteId, content, "tiptap-json");

  const first = store.rebuildBlockAuthorityStore(db, noteId, content, "tiptap-json", {
    noteVersion: 1,
    operationId: "authority-operation-1",
    operationType: "snapshot",
    operationJson: { source: "test" },
  });
  assert.equal(first.status, "healthy");
  assert.equal(first.blockVersion, 1);
  assert.equal(first.structureVersion, 1);
  assert.equal(store.readAuthoritativeNoteContent(db, noteId, content).source, "blocks");
  assert.equal((db.prepare("SELECT version FROM note_block_records WHERE noteId = ? AND blockId = ?").get(noteId, "blk_authority0") as any).version, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS c FROM note_block_operations WHERE noteId = ?").get(noteId) as any).c, 1);
  assert.equal((db.prepare("SELECT attachmentId FROM note_block_attachment_refs WHERE noteId = ?").get(noteId) as any).attachmentId, "attachment-001");

  const changed = content.replace("attachment-001", "attachment-002");
  db.prepare("UPDATE notes SET content = ?, version = 2 WHERE id = ?").run(changed, noteId);
  noteBlocks.syncNoteBlocks(db, noteId, changed, "tiptap-json");
  const second = store.rebuildBlockAuthorityStore(db, noteId, changed, "tiptap-json", { noteVersion: 2 });
  assert.equal(second.blockVersion, 2);
  assert.equal(second.structureVersion, 1);
  assert.equal((db.prepare("SELECT version FROM note_block_records WHERE noteId = ? AND blockId = ?").get(noteId, "blk_authority0") as any).version, 2);
});

test("fails closed to notes.content when the shadow snapshot hash diverges", async () => {
  const { getDb } = await import("../src/db/schema");
  const store = await import("../src/lib/blockAuthorityStore");
  const db = getDb();
  const noteId = "15151515-1515-4515-8515-151515151515";
  const notesContent = (db.prepare("SELECT content FROM notes WHERE id = ?").get(noteId) as any).content as string;
  db.prepare("UPDATE note_block_documents SET snapshotContent = 'corrupted' WHERE noteId = ?").run(noteId);
  const result = store.readAuthoritativeNoteContent(db, noteId, notesContent);
  assert.equal(result.source, "notes");
  assert.equal(result.content, notesContent);
  assert.equal(result.status, "mismatch");
});

test("checks per-block and structure versions independently", async () => {
  const { getDb } = await import("../src/db/schema");
  const store = await import("../src/lib/blockAuthorityStore");
  const db = getDb();
  const noteId = "15151515-1515-4515-8515-151515151515";
  const content = (db.prepare("SELECT content FROM notes WHERE id = ?").get(noteId) as any).content as string;
  const state = store.rebuildBlockAuthorityStore(db, noteId, content, "tiptap-json", { noteVersion: 2 });
  const record = db.prepare("SELECT blockId, version FROM note_block_records WHERE noteId = ? ORDER BY blockOrder LIMIT 1")
    .get(noteId) as { blockId: string; version: number };
  assert.doesNotThrow(() => store.assertBlockAuthorityVersions(db, noteId, {
    expectedStructureVersion: state.structureVersion,
    expectedBlockVersions: { [record.blockId]: record.version },
  }));
  assert.throws(
    () => store.assertBlockAuthorityVersions(db, noteId, { expectedBlockVersions: { [record.blockId]: 99 } }),
    (error: unknown) => error instanceof store.BlockAuthorityConflictError && error.code === "BLOCK_VERSION_CONFLICT",
  );
  assert.throws(
    () => store.assertBlockAuthorityVersions(db, noteId, { expectedStructureVersion: state.structureVersion + 1 }),
    (error: unknown) => error instanceof store.BlockAuthorityConflictError && error.code === "STRUCTURE_VERSION_CONFLICT",
  );
});

test("backfills canonical block snapshots in bounded batches", async () => {
  const { getDb } = await import("../src/db/schema");
  const store = await import("../src/lib/blockAuthorityStore");
  const db = getDb();
  db.prepare("DELETE FROM note_block_documents").run();
  const result = store.backfillBlockAuthorityStore(db, { limit: 1 });
  assert.equal(result.scanned, 1);
  assert.equal(result.rebuilt, 1);
  assert.deepEqual(result.failed, []);
  assert.equal((db.prepare("SELECT status FROM note_block_documents LIMIT 1").get() as any).status, "healthy");
});
