/**
 * Workspace Members Repository
 *
 * 职责：
 * - 封装 workspace_members 表的数据库操作
 * - 提供类型安全的接口
 * - 保持现有 SQLite 行为不变
 */

import { getDb } from "../db/schema";

export const workspaceMembersRepository = {
  /**
   * 获取工作区成员数量。
   *
   * @param workspaceId 工作区 ID
   * @returns 成员数量
   */
  countByWorkspace(workspaceId: string): number {
    const db = getDb();
    const row = db.prepare("SELECT COUNT(*) as c FROM workspace_members WHERE workspaceId = ?").get(workspaceId) as { c: number };
    return row.c;
  },

  /**
   * 获取成员角色。
   *
   * @param workspaceId 工作区 ID
   * @param userId 用户 ID
   * @returns 成员角色，或 undefined
   */
  getRole(workspaceId: string, userId: string): { role: string } | undefined {
    const db = getDb();
    return db
      .prepare("SELECT role FROM workspace_members WHERE workspaceId = ? AND userId = ?")
      .get(workspaceId, userId) as { role: string } | undefined;
  },

  /**
   * 创建成员。
   *
   * @param workspaceId 工作区 ID
   * @param userId 用户 ID
   * @param role 角色
   */
  create(workspaceId: string, userId: string, role: string): void {
    const db = getDb();
    db.prepare(
      "INSERT INTO workspace_members (workspaceId, userId, role) VALUES (?, ?, ?)"
    ).run(workspaceId, userId, role);
  },

  /**
   * 更新成员角色。
   *
   * @param workspaceId 工作区 ID
   * @param userId 用户 ID
   * @param role 新角色
   */
  updateRole(workspaceId: string, userId: string, role: string): void {
    const db = getDb();
    db.prepare(
      "UPDATE workspace_members SET role = ? WHERE workspaceId = ? AND userId = ?"
    ).run(role, workspaceId, userId);
  },

  /**
   * 删除成员。
   *
   * @param workspaceId 工作区 ID
   * @param userId 用户 ID
   */
  delete(workspaceId: string, userId: string): void {
    const db = getDb();
    db.prepare("DELETE FROM workspace_members WHERE workspaceId = ? AND userId = ?").run(workspaceId, userId);
  },

  /**
   * 统计用户的工作区成员数量。
   *
   * @param userId 用户 ID
   * @returns 成员数量
   */
  countByUser(userId: string): number {
    const db = getDb();
    const row = db.prepare("SELECT COUNT(*) as c FROM workspace_members WHERE userId = ?").get(userId) as { c: number };
    return row.c;
  },

  /**
   * 获取用户的工作区 ID 列表。
   *
   * @param userId 用户 ID
   * @returns 工作区 ID 列表
   */
  listWorkspaceIdsByUser(userId: string): string[] {
    const db = getDb();
    const rows = db.prepare("SELECT workspaceId FROM workspace_members WHERE userId = ?").all(userId) as { workspaceId: string }[];
    return rows.map((r) => r.workspaceId);
  },

  /**
   * 转移用户（用户迁移时使用）。
   *
   * @param fromUserId 源用户 ID
   * @param toUserId 目标用户 ID
   * @returns 更新的行数
   */
  transferOwnership(fromUserId: string, toUserId: string): number {
    const db = getDb();
    const result = db.prepare("UPDATE workspace_members SET userId = ? WHERE userId = ?").run(toUserId, fromUserId);
    return result.changes;
  },

  /**
   * 获取两个用户共同的工作区 ID 列表。
   *
   * @param userId1 用户 1 ID
   * @param userId2 用户 2 ID
   * @returns 工作区 ID 列表
   */
  listCommonWorkspaces(userId1: string, userId2: string): string[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT workspaceId FROM workspace_members
         WHERE userId = ? AND workspaceId IN (SELECT workspaceId FROM workspace_members WHERE userId = ?)`
      )
      .all(userId1, userId2) as { workspaceId: string }[];
    return rows.map((r) => r.workspaceId);
  },
};
