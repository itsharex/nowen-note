/**
 * Note Links Repository
 *
 * 职责：
 * - 封装 note_links 表的只读查询操作
 * - 提供类型安全的接口
 * - 保持现有 SQLite 行为不变
 *
 * 注意：
 * - C1 阶段只迁移 getBacklinks 只读查询
 * - syncNoteLinks 的 DELETE + INSERT 事务暂不迁移
 * - routes/notes.ts 中的删除清理暂不迁移
 */

import { getDb } from "../db/schema";
import type { BacklinkItem } from "./types";

export const noteLinksRepository = {
  /**
   * 获取目标笔记的所有反向链接（来源笔记）。
   *
   * 返回结构：
   *   - sourceNoteId: 来源笔记 ID
   *   - title: 来源笔记标题
   *   - updatedAt: 来源笔记更新时间
   *   - linkText: 引用时的显示文本（可选）
   *   - linkType: 'note' 或 'block'
   *   - targetBlockId: 被引用的块 ID（可选）
   *   - excerpt: 块级引用摘要（可选）
   *
   * 排除规则：
   *   - isTrashed = 1 的来源笔记
   *   - 无权限的来源笔记（调用方应已做过权限校验）
   */
  getBacklinks(
    userId: string,
    targetNoteId: string,
    limit: number = 50,
  ): BacklinkItem[] {
    try {
      const db = getDb();
      const rows = db
        .prepare(
          `SELECT
            nl.sourceNoteId,
            n.title,
            n.updatedAt,
            nl.linkText,
            nl.linkType,
            nl.targetBlockId,
            nl.excerpt
          FROM note_links nl
          JOIN notes n ON n.id = nl.sourceNoteId
          WHERE nl.userId = ?
            AND nl.targetNoteId = ?
            AND n.isTrashed = 0
          ORDER BY n.updatedAt DESC
          LIMIT ?`,
        )
        .all(userId, targetNoteId, limit) as BacklinkItem[];

      return rows;
    } catch (e) {
      console.warn("[noteLinksRepository.getBacklinks] failed:", e instanceof Error ? e.message : e);
      return [];
    }
  },
};
