from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
route_path = root / "backend/src/routes/shares.ts"
text = route_path.read_text(encoding="utf-8")
pattern = re.compile(
    r'''\n\s*(?:// 检查访问次数(?:限制)?\n\s*)?if \(share\.maxViews && share\.viewCount >= share\.maxViews\) \{\n\s*return c\.json\(\{ error: "分享链接已达到最大访问次数" \}, 410\);\n\s*\}\n'''
)
text, count = pattern.subn("\n", text)
if count != 4:
    raise RuntimeError(f"expected four legacy max-view checks, removed {count}")
route_path.write_text(text, encoding="utf-8")

test_path = root / "backend/tests/single-share-route-session-limit.test.ts"
test_path.write_text(r'''import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowen-share-session-routes-"));
process.env.DB_PATH = path.join(dir, "test.db");
process.env.ELECTRON_USER_DATA = dir;
process.env.JWT_SECRET = "test-share-session-route-secret-308";

let closeDb: () => void;

test("an already-counted share session can still read, poll and refresh after the limit is full", async () => {
  const [{ sharedRouter }, schema] = await Promise.all([
    import("../src/routes/shares"),
    import("../src/db/schema"),
  ]);
  closeDb = schema.closeDb;
  const db = schema.getDb();
  db.prepare("INSERT INTO users (id, username, passwordHash) VALUES ('owner', 'owner', 'hash')").run();
  db.prepare("INSERT INTO notebooks (id, userId, name) VALUES ('nb', 'owner', 'Notebook')").run();
  db.prepare(`INSERT INTO notes
    (id, userId, notebookId, title, content, contentText, contentFormat, version)
    VALUES ('note', 'owner', 'nb', 'Shared', '{}', 'Shared', 'tiptap-json', 1)`)
    .run();
  db.prepare(`INSERT INTO shares
    (id, noteId, ownerId, shareToken, permission, maxViews, viewCount, credentialVersion)
    VALUES ('share', 'note', 'owner', 'share-token', 'view', 1, 0, 1)`)
    .run();

  const app = new Hono();
  app.route("/shared", sharedRouter);
  const firstSession = { "X-Share-Session": "stable-session-one" };

  const infoBefore = await app.request("/shared/share-token", { headers: firstSession });
  assert.equal(infoBefore.status, 200);

  const content = await app.request("/shared/share-token/content", { headers: firstSession });
  assert.equal(content.status, 200);
  assert.equal((db.prepare("SELECT viewCount FROM shares WHERE id = 'share'").get() as any).viewCount, 1);

  const infoAfter = await app.request("/shared/share-token", { headers: firstSession });
  assert.equal(infoAfter.status, 200);
  const refresh = await app.request("/shared/share-token/content", { headers: firstSession });
  assert.equal(refresh.status, 200);
  const poll = await app.request("/shared/share-token/poll", { headers: firstSession });
  assert.equal(poll.status, 200);
  assert.equal((db.prepare("SELECT viewCount FROM shares WHERE id = 'share'").get() as any).viewCount, 1);

  const secondSession = await app.request("/shared/share-token", {
    headers: { "X-Share-Session": "stable-session-two" },
  });
  assert.equal(secondSession.status, 410);
  const denied = await secondSession.json() as { code: string };
  assert.equal(denied.code, "SHARE_VIEW_LIMIT");
});

test.after(() => {
  closeDb?.();
  fs.rmSync(dir, { recursive: true, force: true });
});
''', encoding="utf-8")

print("Issue #308 legacy route view-limit checks removed and route regression added")
