import { Hono } from "hono";
import { getDb } from "../db/schema";
import { v4 as uuid } from "uuid";
import {
  resolveNotebookPermission,
  hasPermission,
} from "../middleware/acl";
import { broadcastNoteUpdated } from "../services/realtime";
import { extractAttachmentText } from "../services/attachment-indexer";

const app = new Hono();

// 安全校验：拒绝绝对路径和路径穿越
function isUnsafePath(p: string): boolean {
  if (!p || typeof p !== "string") return true;
  if (/^[A-Za-z]:/.test(p)) return true;
  if (p.startsWith("/")) return true;
  if (p.includes("..")) return true;
  if (p.length > 1024) return true;
  return false;
}

function filenameToTitle(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot > 0) return filename.slice(0, lastDot);
  return filename;
}

function isTextFile(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return [".md", ".txt", ".markdown", ".html", ".htm", ".csv", ".json", ".xml"].includes(ext);
}

function isBinaryFile(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return [".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".odt", ".ods"].includes(ext);
}

/** 构建 sync 元信息 HTML 注释 */
function buildSyncComment(relativePath: string, sha256: string, sourcePathHash: string): string {
  return `\n\n<!-- nowen-folder-sync: sourcePathHash=${sourcePathHash} sha256=${sha256} relativePath=${relativePath} -->`;
}

/**
 * POST /api/folder-sync/import-file
 */
app.post("/import-file", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const body = await c.req.json();

  const {
    filename,
    relativePath,
    sha256,
    targetNotebookId,
    contentText,
    sourcePathHash,
    existingNoteId,
  } = body as {
    filename?: string;
    relativePath?: string;
    sha256?: string;
    targetNotebookId?: string;
    contentText?: string;
    sourcePathHash?: string;
    existingNoteId?: string;
  };

  // 参数校验
  if (!filename || typeof filename !== "string" || filename.length > 255) {
    return c.json({ error: "filename 无效", code: "INVALID_FILENAME" }, 400);
  }
  if (!relativePath || isUnsafePath(relativePath)) {
    return c.json({ error: "relativePath 无效或包含不安全路径", code: "UNSAFE_PATH" }, 400);
  }
  if (!sha256 || typeof sha256 !== "string" || sha256.length !== 64) {
    return c.json({ error: "sha256 无效", code: "INVALID_HASH" }, 400);
  }
  if (!targetNotebookId) {
    return c.json({ error: "targetNotebookId 不能为空", code: "MISSING_NOTEBOOK" }, 400);
  }
  if (!sourcePathHash || typeof sourcePathHash !== "string") {
    return c.json({ error: "sourcePathHash 无效", code: "INVALID_SOURCE_HASH" }, 400);
  }
  if (contentText && contentText.length > 2 * 1024 * 1024) {
    return c.json({ error: "contentText 超过 2MB 限制", code: "CONTENT_TOO_LARGE" }, 400);
  }

  // 校验目标笔记本权限
  const nb = db
    .prepare("SELECT id, workspaceId, isDeleted FROM notebooks WHERE id = ?")
    .get(targetNotebookId) as { id: string; workspaceId: string | null; isDeleted: number } | undefined;
  if (!nb) return c.json({ error: "目标笔记本不存在", code: "NOTEBOOK_NOT_FOUND" }, 404);
  if (nb.isDeleted === 1) return c.json({ error: "目标笔记本已删除", code: "NOTEBOOK_TRASHED" }, 400);
  const { permission } = resolveNotebookPermission(targetNotebookId, userId);
  if (!hasPermission(permission, "write")) {
    return c.json({ error: "您在该笔记本无写入权限", code: "FORBIDDEN" }, 403);
  }
  const workspaceId = nb.workspaceId;

  // 查找已有同步映射
  const syncRow = db
    .prepare("SELECT id, noteId, sha256 AS oldSha FROM folder_sync_files WHERE userId = ? AND sourcePathHash = ?")
    .get(userId, sourcePathHash) as { id: string; noteId: string; oldSha: string } | undefined;

  // 确定更新目标
  let updateNoteId: string | null = null;
  if (existingNoteId) {
    const target = db.prepare("SELECT id, userId FROM notes WHERE id = ?").get(existingNoteId) as { id: string; userId: string } | undefined;
    if (!target) return c.json({ error: "指定的笔记不存在", code: "NOTE_NOT_FOUND" }, 404);
    if (target.userId !== userId) return c.json({ error: "无权修改他人的笔记", code: "FORBIDDEN" }, 403);
    updateNoteId = existingNoteId;
  } else if (syncRow) {
    updateNoteId = syncRow.noteId;
  }

  // sha256 去重：如果映射表里 sha256 未变，跳过
  if (syncRow && syncRow.oldSha === sha256 && updateNoteId) {
    return c.json({
      success: true, created: false, updated: false, skipped: true,
      reason: "unchanged", noteId: updateNoteId, sha256,
    });
  }

  const title = filenameToTitle(filename);
  const syncComment = buildSyncComment(relativePath, sha256, sourcePathHash);
  const isText = isTextFile(filename);
  const isBinary = isBinaryFile(filename);
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  const isHtml = [".html", ".htm"].includes(ext);

  // 确定 contentFormat
  const contentFormat = isHtml ? "html" : "markdown";

  // 构建正文
  let content: string;
  let finalContentText: string;

  if (isText && contentText) {
    content = contentText + syncComment;
    finalContentText = contentText;
  } else if (isBinary) {
    const lines = [
      `# ${title}`,
      "",
      "此文件来自桌面端文件夹同步。",
      "",
      `- 文件名：${filename}`,
      `- 相对路径：${relativePath}`,
      `- SHA-256：${sha256}`,
    ];
    content = lines.join("\n") + syncComment;
    finalContentText = content;
  } else {
    const text = contentText || "";
    content = text + syncComment;
    finalContentText = text;
  }

  if (updateNoteId) {
    // 更新已有笔记
    db.prepare(
      `UPDATE notes SET title = ?, content = ?, contentText = ?, notebookId = ?, workspaceId = ?,
       contentFormat = ?, version = version + 1, updatedAt = datetime('now')
       WHERE id = ?`
    ).run(title, content, finalContentText, targetNotebookId, workspaceId, contentFormat, updateNoteId);

    // 更新映射
    if (syncRow) {
      db.prepare("UPDATE folder_sync_files SET sha256 = ?, relativePath = ?, filename = ?, updatedAt = datetime('now') WHERE id = ?")
        .run(sha256, relativePath, filename, syncRow.id);
    } else {
      db.prepare("INSERT INTO folder_sync_files (id, userId, sourcePathHash, relativePath, filename, sha256, noteId) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(uuid(), userId, sourcePathHash, relativePath, filename, sha256, updateNoteId);
    }

    const updated = db.prepare("SELECT version, updatedAt FROM notes WHERE id = ?").get(updateNoteId) as { version: number; updatedAt: string };
    try {
      broadcastNoteUpdated(updateNoteId, {
        version: updated.version, updatedAt: updated.updatedAt,
        title, contentText: finalContentText.slice(0, 200), actorUserId: userId,
      });
    } catch { /* ignore */ }

    return c.json({ success: true, created: false, updated: true, skipped: false, noteId: updateNoteId, sha256 });
  }

  // 创建新笔记
  const noteId = uuid();
  try {
    db.prepare(
      `INSERT INTO notes (id, userId, notebookId, workspaceId, title, content, contentText, contentFormat)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(noteId, userId, targetNotebookId, workspaceId, title, content, finalContentText, contentFormat);
  } catch (e: any) {
    if (String(e?.code || "").startsWith("SQLITE_CONSTRAINT")) {
      return c.json({ error: "笔记创建失败：ID 冲突", code: "ID_CONFLICT" }, 409);
    }
    throw e;
  }

  // 创建映射
  db.prepare("INSERT INTO folder_sync_files (id, userId, sourcePathHash, relativePath, filename, sha256, noteId) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(uuid(), userId, sourcePathHash, relativePath, filename, sha256, noteId);

  return c.json({ success: true, created: true, updated: false, skipped: false, noteId, sha256 });
});

/**
 * POST /api/folder-sync/import-attachment
 * 导入 pdf/docx 等附件文件
 */
app.post("/import-attachment", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";

  // 解析 multipart form data
  const body = await c.req.parseBody();
  const file = body["file"];
  const sourcePathHash = body["sourcePathHash"] as string;
  const relativePath = body["relativePath"] as string;
  const filename = body["filename"] as string;
  const sha256 = body["sha256"] as string;
  const targetNotebookId = body["targetNotebookId"] as string;
  const existingNoteId = body["existingNoteId"] as string | undefined;

  // 参数校验
  if (!file || !(file instanceof File)) {
    return c.json({ error: "未上传文件", code: "NO_FILE" }, 400);
  }
  if (!filename || !relativePath || !sha256 || !sourcePathHash || !targetNotebookId) {
    return c.json({ error: "缺少必要参数", code: "MISSING_PARAMS" }, 400);
  }
  if (isUnsafePath(relativePath)) {
    return c.json({ error: "relativePath 不安全", code: "UNSAFE_PATH" }, 400);
  }

  // 限制文件类型
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  const allowedExts = [".pdf", ".docx"];
  if (!allowedExts.includes(ext)) {
    return c.json({ error: `不支持的文件类型: ${ext}`, code: "UNSUPPORTED_FILE_TYPE" }, 400);
  }

  // 校验目标笔记本权限
  const nb = db.prepare("SELECT id, workspaceId, isDeleted FROM notebooks WHERE id = ?").get(targetNotebookId) as any;
  if (!nb) return c.json({ error: "目标笔记本不存在", code: "NOTEBOOK_NOT_FOUND" }, 404);
  if (nb.isDeleted === 1) return c.json({ error: "目标笔记本已删除", code: "NOTEBOOK_TRASHED" }, 400);
  const { permission } = resolveNotebookPermission(targetNotebookId, userId);
  if (!hasPermission(permission, "write")) {
    return c.json({ error: "无写入权限", code: "FORBIDDEN" }, 403);
  }

  // 查找已有同步映射
  const syncRow = db.prepare("SELECT id, noteId, sha256 AS oldSha FROM folder_sync_files WHERE userId = ? AND sourcePathHash = ?")
    .get(userId, sourcePathHash) as { id: string; noteId: string; oldSha: string } | undefined;

  // sha256 去重
  if (syncRow && syncRow.oldSha === sha256) {
    return c.json({
      success: true, created: false, updated: false, skipped: true,
      reason: "unchanged", noteId: syncRow.noteId, sha256,
    });
  }

  // 读取文件内容并验证 sha256
  const arrayBuffer = await file.arrayBuffer();
  const fileBuffer = Buffer.from(arrayBuffer);
  const crypto = require("crypto");
  const fileSha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  if (fileSha256 !== sha256) {
    return c.json({ error: "文件 sha256 不匹配", code: "HASH_MISMATCH" }, 400);
  }

  // 确定更新目标并校验权限
  let updateNoteId: string | null = null;
  let isNew = false;

  if (existingNoteId) {
    const target = db.prepare("SELECT id, userId, isTrashed FROM notes WHERE id = ?").get(existingNoteId) as any;
    if (!target) return c.json({ error: "指定的笔记不存在", code: "NOTE_NOT_FOUND" }, 404);
    if (target.userId !== userId) return c.json({ error: "无权修改他人的笔记", code: "FORBIDDEN" }, 403);
    if (target.isTrashed === 1) return c.json({ error: "笔记已回收，无法更新", code: "NOTE_TRASHED" }, 400);
    updateNoteId = existingNoteId;
  } else if (syncRow) {
    const target = db.prepare("SELECT id, userId, isTrashed FROM notes WHERE id = ?").get(syncRow.noteId) as any;
    if (!target) {
      // 旧映射指向不存在的笔记，清理并创建新笔记
      db.prepare("DELETE FROM folder_sync_files WHERE id = ?").run(syncRow.id);
    } else if (target.userId !== userId) {
      return c.json({ error: "无权修改他人的笔记", code: "FORBIDDEN" }, 403);
    } else if (target.isTrashed === 1) {
      // 笔记已回收，创建新笔记
    } else {
      updateNoteId = syncRow.noteId;
    }
  }

  const title = filenameToTitle(filename);
  const syncComment = buildSyncComment(relativePath, sha256, sourcePathHash);
  const content = `# ${title}\n\n此文件来自桌面端文件夹同步。\n\n- 文件名：${filename}\n- 相对路径：${relativePath}\n${syncComment}`;

  // 附件保存目录
  const pathMod = require("path");
  const fs = require("fs");
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const baseDir = process.env.NOWEN_DATA_DIR || pathMod.join(process.cwd(), "data");
  const attachmentsDir = pathMod.join(baseDir, "attachments");
  const dir = pathMod.join(attachmentsDir, year, month);
  fs.mkdirSync(dir, { recursive: true });

  const attachmentId = uuid();
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, "");
  const fileFullName = `${attachmentId}${safeExt}`;
  const fullPath = pathMod.join(dir, fileFullName);
  const relativeAttachmentPath = `${year}/${month}/${fileFullName}`;

  let savedFile = false;

  try {
    // 写入附件文件
    fs.writeFileSync(fullPath, fileBuffer);
    savedFile = true;

    // 使用事务
    db.exec("BEGIN TRANSACTION");

    if (updateNoteId) {
      // 更新已有笔记
      db.prepare(`UPDATE notes SET title = ?, content = ?, contentText = ?, contentFormat = 'markdown', version = version + 1, updatedAt = datetime('now') WHERE id = ?`)
        .run(title, content, content, updateNoteId);
    } else {
      // 创建新笔记
      updateNoteId = uuid();
      isNew = true;
      db.prepare(`INSERT INTO notes (id, userId, notebookId, workspaceId, title, content, contentText, contentFormat) VALUES (?, ?, ?, ?, ?, ?, ?, 'markdown')`)
        .run(updateNoteId, userId, targetNotebookId, nb.workspaceId, title, content, content);
    }

    // 插入附件记录（与主附件上传保持一致：含 workspaceId、hash、uploadSource）
    db.prepare(`INSERT INTO attachments (id, userId, noteId, filename, mimeType, size, path, workspaceId, hash, uploadSource) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'folder_sync')`)
      .run(attachmentId, userId, updateNoteId, filename, file.type || null, fileBuffer.length, relativeAttachmentPath, nb.workspaceId, fileSha256);

    // 更新同步映射
    if (syncRow) {
      db.prepare("UPDATE folder_sync_files SET sha256 = ?, relativePath = ?, filename = ?, noteId = ?, updatedAt = datetime('now') WHERE id = ?")
        .run(sha256, relativePath, filename, updateNoteId, syncRow.id);
    } else {
      db.prepare("INSERT INTO folder_sync_files (id, userId, sourcePathHash, relativePath, filename, sha256, noteId) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(uuid(), userId, sourcePathHash, relativePath, filename, sha256, updateNoteId);
    }

    db.exec("COMMIT");

    // 广播更新
    try {
      const updated = db.prepare("SELECT version, updatedAt FROM notes WHERE id = ?").get(updateNoteId) as any;
      broadcastNoteUpdated(updateNoteId, {
        version: updated.version, updatedAt: updated.updatedAt,
        title, contentText: filename, actorUserId: userId,
      });
    } catch { /* ignore */ }

    // 提取 PDF/DOCX 文本写入 contentText（事务外执行，失败不影响上传结果）
    let extracted = false;
    let extractedChars = 0;
    let extractionTruncated = false;
    let extractionError: string | undefined;
    let noText = false;

    const EXTRACT_START = "<!-- nowen-folder-sync-extracted:start -->";
    const EXTRACT_END = "<!-- nowen-folder-sync-extracted:end -->";
    try {
      const extractResult = await extractAttachmentText({
        id: attachmentId,
        path: relativeAttachmentPath,
        mimeType: file.type || "application/octet-stream",
        filename,
        size: fileBuffer.length,
      });
      if (extractResult.skipReason) {
        noText = extractResult.skipReason === "empty";
        if (!noText) extractionError = extractResult.skipReason;
      } else if (extractResult.text && extractResult.text.trim()) {
        const fullText = extractResult.text;
        const truncated = fullText.slice(0, 200000);
        extracted = true;
        extractedChars = truncated.length;
        extractionTruncated = fullText.length > 200000;
        // 读取当前 contentText，替换或追加提取文本块
        const current = db.prepare("SELECT contentText FROM notes WHERE id = ?").get(updateNoteId) as { contentText: string } | undefined;
        const base = (current?.contentText || "").split(EXTRACT_START)[0].trimEnd();
        const newContentText = `${base}\n\n${EXTRACT_START}\n${truncated}\n${EXTRACT_END}`;
        db.prepare("UPDATE notes SET contentText = ? WHERE id = ?").run(newContentText, updateNoteId);
      } else {
        noText = true;
      }
    } catch (e: any) {
      extractionError = e?.message?.slice(0, 200) || "extraction failed";
      console.warn("[folder-sync] text extraction failed for", filename, e);
    }

    return c.json({
      success: true, created: isNew, updated: !isNew, skipped: false,
      noteId: updateNoteId, attachmentId, sha256,
      extracted, extractedChars, extractionTruncated, extractionError, noText,
    });
  } catch (err: any) {
    // 回滚事务
    try { db.exec("ROLLBACK"); } catch {}
    // 清理已写入文件
    if (savedFile) {
      try { fs.unlinkSync(fullPath); } catch { /* ignore */ }
    }
    throw err;
  }
});

/**
 * POST /api/folder-sync/check-dedup
 */
app.post("/check-dedup", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const body = await c.req.json();
  const hashes = body.sourcePathHashes as string[] | undefined;

  if (!Array.isArray(hashes) || hashes.length === 0) return c.json({});
  if (hashes.length > 500) return c.json({ error: "单次最多检查 500 条", code: "TOO_MANY" }, 400);

  const result: Record<string, string> = {};
  const placeholders = hashes.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT sourcePathHash, noteId FROM folder_sync_files WHERE userId = ? AND sourcePathHash IN (${placeholders})`)
    .all(userId, ...hashes) as { sourcePathHash: string; noteId: string }[];
  for (const row of rows) {
    result[row.sourcePathHash] = row.noteId;
  }
  return c.json(result);
});

export default app;
