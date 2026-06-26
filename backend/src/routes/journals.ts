/**
 * 今日日记路由
 * ---------------------------------------------------------------------------
 * 提供"一键创建今日日记"功能。
 *
 * 接口：
 *   POST /api/journals/today   获取或创建今日日记（显式操作，避免 GET 副作用）
 *   GET  /api/journals/check   检查今日日记是否存在（只读，不创建）
 *   GET  /api/journals/list    获取日记列表（按日期倒序）
 *
 * 设计决策：
 *   - 使用 note_type = 'journal' 区分日记和普通笔记
 *   - journal_date 使用 YYYY-MM-DD 格式，按用户本地日期
 *   - 唯一性通过 UNIQUE 索引保证（userId + note_type + journal_date）
 *   - 标题默认使用日期格式 "2026-06-26"
 *   - POST 语义：显式创建或获取，避免浏览器预请求/缓存误触发
 */

import { Hono } from "hono";
import { getDb } from "../db/schema";
import { v4 as uuid } from "uuid";

const app = new Hono();

/**
 * 获取本地日期字符串（YYYY-MM-DD 格式）
 *
 * 重要：不使用 toISOString().slice(0, 10)，因为这会返回 UTC 日期，
 * 在 UTC+8 时区晚上/凌晨会生成前一天的日期。
 *
 * @param dateStr 可选日期字符串，默认使用当前本地时间
 * @returns YYYY-MM-DD 格式的本地日期字符串
 */
function getLocalDateKey(dateStr?: string): string {
  let date: Date;

  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    // 前端传入的 YYYY-MM-DD 格式，直接使用
    return dateStr;
  }

  date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 获取或创建今日日记（POST 语义）
 *
 * 为什么用 POST 而非 GET：
 *   - GET 可能被浏览器预请求、缓存、爬虫、代理误触发
 *   - POST 语义明确表示"创建或获取"，是幂等的写操作
 *   - 避免用户意外触发日记创建
 *
 * 并发安全：
 *   - UNIQUE 索引 (userId, note_type, journal_date) 防止重复创建
 *   - INSERT 冲突时回退查询已有日记
 *
 * body 参数：
 *   - localDate: YYYY-MM-DD（可选，前端传入用户本地日期）
 */
app.post("/today", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";

  if (!userId) {
    return c.json({ error: "未授权" }, 401);
  }

  // 解析 body（可选）
  let localDate: string | undefined;
  try {
    const body = await c.req.json().catch(() => ({}));
    localDate = body?.localDate;
  } catch {
    // body 解析失败不阻塞，使用服务端日期
  }

  const today = getLocalDateKey(localDate);

  // 查询是否已有今日日记
  const existing = db.prepare(`
    SELECT id, userId, notebookId, workspaceId, title, content, contentText,
           isPinned, isLocked, isArchived, isTrashed, version, sortOrder,
           createdAt, updatedAt, trashedAt, contentFormat, note_type, journal_date
    FROM notes
    WHERE userId = ? AND note_type = 'journal' AND journal_date = ?
      AND isTrashed = 0
  `).get(userId, today) as any;

  if (existing) {
    return c.json({
      ...existing,
      existed: true,
    });
  }

  // 不存在，创建新日记
  const id = uuid();
  const title = today; // 标题使用日期格式 "2026-06-26"

  // 查找用户的默认笔记本（个人空间）
  const defaultNotebook = db.prepare(`
    SELECT id FROM notebooks
    WHERE userId = ? AND workspaceId IS NULL AND isDeleted = 0
    ORDER BY sortOrder ASC, createdAt ASC
    LIMIT 1
  `).get(userId) as { id: string } | undefined;

  if (!defaultNotebook) {
    return c.json({ error: "请先创建一个笔记本" }, 400);
  }

  try {
    db.prepare(`
      INSERT INTO notes (id, userId, notebookId, title, content, contentText, note_type, journal_date)
      VALUES (?, ?, ?, ?, '{}', '', 'journal', ?)
    `).run(id, userId, defaultNotebook.id, title, today);

    const created = db.prepare(`
      SELECT id, userId, notebookId, workspaceId, title, content, contentText,
             isPinned, isLocked, isArchived, isTrashed, version, sortOrder,
             createdAt, updatedAt, trashedAt, contentFormat, note_type, journal_date
      FROM notes
      WHERE id = ?
    `).get(id);

    return c.json({
      ...created as any,
      existed: false,
    }, 201);
  } catch (err: any) {
    // UNIQUE 约束冲突：并发创建时触发，回退查询已有日记
    if (String(err?.code || "").startsWith("SQLITE_CONSTRAINT")) {
      const retry = db.prepare(`
        SELECT id, userId, notebookId, workspaceId, title, content, contentText,
               isPinned, isLocked, isArchived, isTrashed, version, sortOrder,
               createdAt, updatedAt, trashedAt, contentFormat, note_type, journal_date
        FROM notes
        WHERE userId = ? AND note_type = 'journal' AND journal_date = ?
          AND isTrashed = 0
      `).get(userId, today);

      return c.json({
        ...retry as any,
        existed: true,
      });
    }
    throw err;
  }
});

/**
 * 检查今日日记是否存在（只读，不创建）
 *
 * query 参数：
 *   - date: YYYY-MM-DD（可选，默认今天）
 */
app.get("/check", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";

  if (!userId) {
    return c.json({ error: "未授权" }, 401);
  }

  const dateParam = c.req.query("date");
  const today = getLocalDateKey(dateParam);

  const existing = db.prepare(`
    SELECT id, title
    FROM notes
    WHERE userId = ? AND note_type = 'journal' AND journal_date = ?
      AND isTrashed = 0
  `).get(userId, today) as { id: string; title: string } | undefined;

  return c.json({
    exists: !!existing,
    noteId: existing?.id || null,
    title: existing?.title || null,
  });
});

/**
 * 获取日记列表（按日期倒序）
 */
app.get("/list", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const limit = Math.min(parseInt(c.req.query("limit") || "30"), 100);
  const cursor = c.req.query("cursor"); // 上次最后一条的 journal_date

  if (!userId) {
    return c.json({ error: "未授权" }, 401);
  }

  let query = `
    SELECT id, userId, notebookId, workspaceId, title, content, contentText,
           isPinned, isLocked, isArchived, isTrashed, version, sortOrder,
           createdAt, updatedAt, trashedAt, contentFormat, note_type, journal_date
    FROM notes
    WHERE userId = ? AND note_type = 'journal' AND isTrashed = 0
  `;
  const params: any[] = [userId];

  if (cursor) {
    query += " AND journal_date < ?";
    params.push(cursor);
  }

  query += " ORDER BY journal_date DESC LIMIT ?";
  params.push(limit);

  const rows = db.prepare(query).all(...params) as any[];
  const hasMore = rows.length === limit;
  const nextCursor = rows.length > 0 ? rows[rows.length - 1].journal_date : null;

  return c.json({
    items: rows,
    hasMore,
    nextCursor,
  });
});

export default app;
