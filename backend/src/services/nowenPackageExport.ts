/**
 * Nowen 数据包导出服务
 *
 * 生成 .nowen.zip 私有迁移包，用于 nowen-note 到 nowen-note 的无损迁移。
 * 保留 Markdown 原文、富文本 Tiptap JSON、笔记本结构、标签、附件关系。
 */

import { getDb } from "../db/schema";
import JSZip from "jszip";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ====== 类型定义 ======

interface ExportParams {
  userId: string;
  workspaceId?: string | null;
  notebookId?: string;
  includeSubNotebooks?: boolean;
  includeTrashed?: boolean;
}

interface ExportStats {
  notes: number;
  notebooks: number;
  tags: number;
  noteTags: number;
  attachments: number;
  warnings: number;
}

interface ExportWarning {
  type: string;
  attachmentId?: string;
  noteId?: string;
  path?: string;
  message: string;
}

interface ExportNotebook {
  id: string;
  parentId: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  sortOrder: number;
  isExpanded: number;
  createdAt: string;
  updatedAt: string;
}

interface ExportNote {
  id: string;
  notebookId: string;
  title: string;
  content: string;
  contentText: string;
  contentFormat: string | null;
  isPinned: number;
  isFavorite: number;
  isLocked: number;
  isArchived: number;
  version: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface ExportTag {
  id: string;
  name: string;
  color: string | null;
  createdAt: string;
}

interface ExportAttachment {
  id: string;
  noteId: string;
  filename: string;
  mimeType: string | null;
  size: number | null;
  path: string | null;
  createdAt: string;
}

// ====== 工具函数 ======

function sanitizeFilename(name: string): string {
  return name.replace(/[\/\\?<>:*|"]/g, "_").replace(/\s+/g, " ").trim() || "untitled";
}

function getDataDir(): string {
  return process.env.NOWEN_DATA_DIR || path.join(process.cwd(), "data");
}

function getAttachmentsDir(): string {
  return path.join(getDataDir(), "attachments");
}

/** 安全校验：防止 path traversal */
function isSafePath(filePath: string, baseDir: string): boolean {
  const resolved = path.resolve(baseDir, filePath);
  return resolved.startsWith(path.resolve(baseDir));
}

/** 读取附件物理文件 */
function readAttachmentFile(attachmentPath: string): Buffer | null {
  const attachmentsDir = getAttachmentsDir();

  // 支持新年月路径：YYYY/MM/<uuid>.<ext>
  const fullPath = path.join(attachmentsDir, attachmentPath);
  if (isSafePath(attachmentPath, attachmentsDir) && fs.existsSync(fullPath)) {
    return fs.readFileSync(fullPath);
  }

  // 支持旧平铺路径：<uuid>.<ext>（从 path 中提取文件名）
  const fileName = path.basename(attachmentPath);
  const flatPath = path.join(attachmentsDir, fileName);
  if (fs.existsSync(flatPath)) {
    return fs.readFileSync(flatPath);
  }

  return null;
}

/** 从笔记内容中提取附件 ID */
function extractAttachmentIds(content: string): string[] {
  const ids = new Set<string>();
  // 匹配 /api/attachments/<id> 模式
  const re = /\/api\/attachments\/([a-f0-9-]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    ids.add(m[1]);
  }
  return Array.from(ids);
}

// ====== 主导出函数 ======

export async function createNowenPackageExport(params: ExportParams): Promise<{
  buffer: Buffer;
  filename: string;
  stats: ExportStats;
}> {
  const db = getDb();
  const {
    userId,
    workspaceId,
    notebookId,
    includeSubNotebooks = true,
    includeTrashed = false,
  } = params;

  const warnings: ExportWarning[] = [];
  const stats: ExportStats = {
    notes: 0,
    notebooks: 0,
    tags: 0,
    noteTags: 0,
    attachments: 0,
    warnings: 0,
  };

  // ── 1. 确定导出范围：笔记本 ──

  let notebookIds: string[];

  if (notebookId) {
    // 导出指定笔记本及其子孙
    if (includeSubNotebooks) {
      const rows = db.prepare(`
        WITH RECURSIVE descendants(id) AS (
          SELECT id FROM notebooks WHERE id = ? AND userId = ? AND (isDeleted IS NULL OR isDeleted = 0)
          UNION ALL
          SELECT n.id FROM notebooks n
          INNER JOIN descendants d ON n.parentId = d.id
          WHERE n.userId = ? AND (n.isDeleted IS NULL OR n.isDeleted = 0)
        )
        SELECT id FROM descendants
      `).all(notebookId, userId, userId) as { id: string }[];
      notebookIds = rows.map((r) => r.id);
    } else {
      const nb = db.prepare("SELECT id FROM notebooks WHERE id = ? AND userId = ? AND (isDeleted IS NULL OR isDeleted = 0)").get(notebookId, userId) as { id: string } | undefined;
      notebookIds = nb ? [nb.id] : [];
    }
  } else {
    // 导出当前工作区所有笔记本
    const wsCondition = workspaceId
      ? "AND workspaceId = ?"
      : "AND (workspaceId IS NULL)";
    const wsParams = workspaceId ? [userId, workspaceId] : [userId];
    const rows = db.prepare(`
      SELECT id FROM notebooks
      WHERE userId = ? AND (isDeleted IS NULL OR isDeleted = 0) ${wsCondition}
    `).all(...wsParams) as { id: string }[];
    notebookIds = rows.map((r) => r.id);
  }

  if (notebookIds.length === 0) {
    throw new Error("No notebooks found in export scope");
  }

  // ── 2. 查询笔记 ──

  const placeholders = notebookIds.map(() => "?").join(",");
  const trashedCondition = includeTrashed ? "" : "AND isTrashed = 0";
  const notes = db.prepare(`
    SELECT id, notebookId, title, content, contentText, contentFormat,
           isPinned, isFavorite, isLocked, isArchived, version, sortOrder,
           createdAt, updatedAt
    FROM notes
    WHERE notebookId IN (${placeholders}) ${trashedCondition}
  `).all(...notebookIds) as ExportNote[];

  const noteIds = new Set(notes.map((n) => n.id));

  // ── 3. 查询笔记本详情 ──

  const notebooks = db.prepare(`
    SELECT id, parentId, name, description, icon, color, sortOrder, isExpanded,
           createdAt, updatedAt
    FROM notebooks
    WHERE id IN (${placeholders})
  `).all(...notebookIds) as ExportNotebook[];

  // ── 4. 查询标签关系 ──

  const notePlaceholders = notes.map(() => "?").join(",") || "NULL";
  const noteTags = notes.length > 0
    ? db.prepare(`
        SELECT noteId, tagId FROM note_tags
        WHERE noteId IN (${notePlaceholders})
      `).all(...notes.map((n) => n.id)) as { noteId: string; tagId: string }[]
    : [];

  // 收集使用到的标签 ID
  const usedTagIds = new Set(noteTags.map((nt) => nt.tagId));

  // 查询标签详情
  const tags = usedTagIds.size > 0
    ? db.prepare(`
        SELECT id, name, color, createdAt FROM tags
        WHERE id IN (${Array.from(usedTagIds).map(() => "?").join(",")})
      `).all(...Array.from(usedTagIds)) as ExportTag[]
    : [];

  // ── 5. 查询附件 ──

  // 从 attachments 表查询
  const dbAttachments = notes.length > 0
    ? db.prepare(`
        SELECT id, noteId, filename, mimeType, size, path, createdAt
        FROM attachments
        WHERE noteId IN (${notePlaceholders})
      `).all(...notes.map((n) => n.id)) as ExportAttachment[]
    : [];

  // 从笔记内容中提取额外的附件 ID
  const contentAttachmentIds = new Set<string>();
  for (const note of notes) {
    const ids = extractAttachmentIds(note.content || "");
    ids.forEach((id) => contentAttachmentIds.add(id));
  }

  // 合并去重
  const allAttachmentIds = new Set(dbAttachments.map((a) => a.id));
  contentAttachmentIds.forEach((id) => allAttachmentIds.add(id));

  // 查询缺失的附件元信息
  const extraAttachmentIds = Array.from(contentAttachmentIds).filter((id) => !allAttachmentIds.has(id));
  let extraAttachments: ExportAttachment[] = [];
  if (extraAttachmentIds.length > 0) {
    extraAttachments = db.prepare(`
      SELECT id, noteId, filename, mimeType, size, path, createdAt
      FROM attachments
      WHERE id IN (${extraAttachmentIds.map(() => "?").join(",")})
    `).all(...extraAttachmentIds) as ExportAttachment[];
  }

  const allAttachments = [...dbAttachments, ...extraAttachments];

  // ── 6. 生成 zip ──

  const zip = new JSZip();

  // 6.1 notebooks.json
  zip.file("notebooks.json", JSON.stringify(notebooks, null, 2));
  stats.notebooks = notebooks.length;

  // 6.2 tags.json
  zip.file("tags.json", JSON.stringify(tags, null, 2));
  stats.tags = tags.length;

  // 6.3 note_tags.json
  zip.file("note_tags.json", JSON.stringify(noteTags, null, 2));
  stats.noteTags = noteTags.length;

  // 6.4 notes/
  const formatStats = { markdown: 0, richText: 0, html: 0 };

  for (const note of notes) {
    const noteDir = `notes/${sanitizeFilename(note.id)}`;

    // 确定内容文件名
    let contentFile: string;
    const cf = note.contentFormat || "tiptap-json";
    if (cf === "markdown") {
      contentFile = "content.md";
      formatStats.markdown++;
    } else if (cf === "html") {
      contentFile = "content.html";
      formatStats.html++;
    } else {
      contentFile = "content.tiptap.json";
      formatStats.richText++;
    }

    // 写内容文件
    zip.file(`${noteDir}/${contentFile}`, note.content || "");

    // 收集该笔记的附件 ID
    const noteAttachmentIds = new Set(
      allAttachments.filter((a) => a.noteId === note.id).map((a) => a.id)
    );
    // 从内容中提取的附件 ID 也加上
    extractAttachmentIds(note.content || "").forEach((id) => noteAttachmentIds.add(id));

    // 写 meta.json
    const meta = {
      id: note.id,
      notebookId: note.notebookId,
      title: note.title,
      contentFormat: cf,
      contentFile,
      contentText: note.contentText || "",
      isPinned: note.isPinned,
      isFavorite: note.isFavorite,
      isLocked: note.isLocked,
      isArchived: note.isArchived,
      version: note.version,
      sortOrder: note.sortOrder,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      tagIds: noteTags.filter((nt) => nt.noteId === note.id).map((nt) => nt.tagId),
      attachmentIds: Array.from(noteAttachmentIds),
    };
    zip.file(`${noteDir}/meta.json`, JSON.stringify(meta, null, 2));
    stats.notes++;
  }

  // 6.5 attachments/
  for (const att of allAttachments) {
    const attDir = `attachments/${sanitizeFilename(att.id)}`;

    // 写 meta.json
    const attMeta = {
      id: att.id,
      noteId: att.noteId,
      filename: att.filename,
      mimeType: att.mimeType,
      size: att.size,
      path: att.path,
      createdAt: att.createdAt,
    };

    // 读取物理文件
    if (att.path) {
      const fileBuffer = readAttachmentFile(att.path);
      if (fileBuffer) {
        const ext = path.extname(att.filename) || ".bin";
        const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, "");
        const fileName = `file${safeExt}`;

        // 计算 sha256
        const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
        (attMeta as any).file = fileName;
        (attMeta as any).sha256 = sha256;

        zip.file(`${attDir}/${fileName}`, fileBuffer);
        zip.file(`${attDir}/meta.json`, JSON.stringify(attMeta, null, 2));
        stats.attachments++;
      } else {
        warnings.push({
          type: "missing_attachment_file",
          attachmentId: att.id,
          noteId: att.noteId,
          path: att.path,
          message: `Attachment file not found on disk: ${att.path}`,
        });
        // 仍然写 meta.json，但不写文件
        zip.file(`${attDir}/meta.json`, JSON.stringify(attMeta, null, 2));
      }
    } else {
      warnings.push({
        type: "attachment_no_path",
        attachmentId: att.id,
        noteId: att.noteId,
        message: "Attachment has no path in database",
      });
      zip.file(`${attDir}/meta.json`, JSON.stringify(attMeta, null, 2));
    }
  }

  // 6.6 warnings.json
  stats.warnings = warnings.length;
  zip.file("warnings.json", JSON.stringify({ version: 1, items: warnings }, null, 2));

  // 6.7 manifest.json
  const now = new Date().toISOString();
  const manifest = {
    format: "nowen-package",
    formatVersion: 1,
    app: "nowen-note",
    exportedAt: now,
    scope: {
      type: notebookId ? "notebook" : "all",
      notebookId: notebookId || null,
      includeSubNotebooks,
      includeTrashed,
    },
    counts: {
      notebooks: stats.notebooks,
      notes: stats.notes,
      tags: stats.tags,
      noteTags: stats.noteTags,
      attachments: stats.attachments,
    },
    formatStats,
    warnings: {
      missingAttachments: warnings.filter((w) => w.type === "missing_attachment_file").length,
      unknownContentFormat: warnings.filter((w) => w.type === "unknown_content_format").length,
    },
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  // ── 7. 生成 zip buffer ──

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const dateStr = now.slice(0, 10);
  const filename = `nowen-package-${dateStr}.nowen.zip`;

  return { buffer, filename, stats };
}
