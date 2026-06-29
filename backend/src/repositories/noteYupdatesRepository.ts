/**
 * Note Y-updates Repository
 *
 * 职责：
 * - 封装 note_yupdates 表的数据库操作
 * - 提供类型安全的接口
 * - 保持现有 SQLite 行为不变
 */

import { getDb } from "../db/schema";

export const noteYupdatesRepository = {
  /**
   * 获取笔记的 Y.js updates（指定 ID 之后的）。
   *
   * @param noteId 笔记 ID
   * @param afterId 起始 ID（不含）
   * @returns updates 列表
   */
  listAfterId(noteId: string, afterId: number): Array<{ id: number; update_blob: Buffer }> {
    const db = getDb();
    return db
      .prepare("SELECT id, update_blob FROM note_yupdates WHERE noteId = ? AND id > ? ORDER BY id ASC")
      .all(noteId, afterId) as Array<{ id: number; update_blob: Buffer }>;
  },

  /**
   * 创建 Y.js update。
   *
   * @param noteId 笔记 ID
   * @param userId 用户 ID
   * @param update 更新数据
   * @returns 创建的记录 ID
   */
  create(noteId: string, userId: string, update: Buffer): number {
    const db = getDb();
    const info = db
      .prepare("INSERT INTO note_yupdates (noteId, userId, update_blob, clock) VALUES (?, ?, ?, ?)")
      .run(noteId, userId, update, Date.now());
    return Number(info.lastInsertRowid);
  },

  /**
   * 获取笔记的最大 update ID。
   *
   * @param noteId 笔记 ID
   * @returns 最大 ID，或 undefined
   */
  getMaxId(noteId: string): { maxId: number | null } | undefined {
    const db = getDb();
    return db
      .prepare("SELECT MAX(id) as maxId FROM note_yupdates WHERE noteId = ?")
      .get(noteId) as { maxId: number | null } | undefined;
  },

  /**
   * 删除指定 ID 以下的 updates。
   *
   * @param noteId 笔记 ID
   * @param maxId 最大 ID（含）
   */
  deleteUpTo(noteId: string, maxId: number): void {
    const db = getDb();
    db.prepare("DELETE FROM note_yupdates WHERE noteId = ? AND id <= ?").run(noteId, maxId);
  },
};
