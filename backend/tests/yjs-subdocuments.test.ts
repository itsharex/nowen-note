import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-y-subdocuments-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");
process.env.ELECTRON_USER_DATA = tmpDir;

let closeDb: () => void;
test.after(() => {
  closeDb?.();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("persists stable section GUIDs and restores a lossless Tiptap snapshot", async () => {
  const [{ getDb, closeDb: close }, service] = await Promise.all([
    import("../src/db/schema"),
    import("../src/services/yjs-subdocuments"),
  ]);
  closeDb = close;
  const db = getDb();
  db.prepare("INSERT INTO users (id, username, passwordHash) VALUES ('ys-user', 'ys-user', 'hash')").run();
  db.prepare("INSERT INTO notebooks (id, userId, name) VALUES ('ys-book', 'ys-user', 'book')").run();
  const content = JSON.stringify({ type: "doc", content: [
    { type: "heading", attrs: { level: 1, blockId: "blk_sectiona" }, content: [{ type: "text", text: "A" }] },
    { type: "paragraph", attrs: { blockId: "blk_sectiona1" }, content: [{ type: "text", text: "one" }] },
    { type: "heading", attrs: { level: 2, blockId: "blk_sectionb" }, content: [{ type: "text", text: "B" }] },
  ] });
  db.prepare(`INSERT INTO notes (id, userId, notebookId, title, content, contentText, contentFormat)
    VALUES ('ys-note', 'ys-user', 'ys-book', 'note', ?, '', 'tiptap-json')`).run(content);
  const first = service.rebuildYjsSubdocuments(db, "ys-note", content, 10);
  assert.equal(first.sections.length, 2);
  assert.equal(service.readYjsSubdocumentBundle(db, "ys-note", content).content, content);
  const changed = content.replace("one", "changed");
  db.prepare("UPDATE notes SET content = ? WHERE id = 'ys-note'").run(changed);
  const second = service.rebuildYjsSubdocuments(db, "ys-note", changed, 10);
  assert.deepEqual(first.sections.map((section) => section.guid), second.sections.map((section) => section.guid));
});

test("fails closed when a section snapshot is corrupted", async () => {
  const { getDb } = await import("../src/db/schema");
  const service = await import("../src/services/yjs-subdocuments");
  const db = getDb();
  const content = (db.prepare("SELECT content FROM notes WHERE id = 'ys-note'").get() as any).content as string;
  db.prepare("UPDATE note_y_subdocuments SET snapshotBlob = X'00' WHERE noteId = 'ys-note' AND blockStart = 0").run();
  const result = service.readYjsSubdocumentBundle(db, "ys-note", content);
  assert.equal(result.source, "notes");
  assert.equal(result.status, "mismatch");
});

test("applies and journals an offline subdocument update before materializing notes.content", async () => {
  const { getDb } = await import("../src/db/schema");
  const service = await import("../src/services/yjs-subdocuments");
  const db = getDb();
  const currentContent = (db.prepare("SELECT content FROM notes WHERE id = 'ys-note'").get() as any).content as string;
  service.rebuildYjsSubdocuments(db, "ys-note", currentContent, 10);
  const sectionId = (db.prepare("SELECT sectionId FROM note_y_subdocuments WHERE noteId = 'ys-note' ORDER BY blockStart LIMIT 1").get() as any).sectionId as string;
  const snapshot = service.getYjsSubdocumentSnapshot(db, "ys-note", sectionId)!;
  const parsed = JSON.parse(service.readYjsSubdocumentBundle(db, "ys-note", currentContent).content);
  const replacement = JSON.stringify({ type: "doc", content: parsed.content.slice(0, 2).map((node: any) => ({ ...node })) });
  const update = service.createYjsSubdocumentContentUpdate(
    snapshot.guid,
    snapshot.snapshot,
    replacement.replace("changed", "offline-change"),
  );
  const result = service.applyYjsSubdocumentUpdate(db, "ys-note", sectionId, update, "ys-user");
  assert.match(result.content, /offline-change/);
  assert.equal((db.prepare("SELECT COUNT(*) AS c FROM note_y_subdocument_updates WHERE noteId = 'ys-note'").get() as any).c, 1);
});
